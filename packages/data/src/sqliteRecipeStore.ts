import type { EntityId, Food, Recipe, RecipeIngredient } from "@lifeos/domain";
import { containsControlCharacters } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteFoodStore } from "./sqliteFoodStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "recipe";
const LEGACY_BATCH_SIZE = 32;

interface RelationalRecipeRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly servings?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
  readonly food_id?: unknown;
  readonly amount_g?: unknown;
  readonly position?: unknown;
}

interface RecipeRecord {
  readonly id: string;
  readonly name: string;
  readonly servings: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly deletedAt: string | null;
  readonly ingredients: readonly {
    readonly foodId: string;
    readonly amountG: number | null;
  }[];
}

function corruptedRecipe(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage:
        "Tallennettua reseptiä tai sen ruoka-aineviitteitä ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.recipe.doc.invalid",
    },
  };
}

function validIngredient(ingredient: unknown): ingredient is RecipeIngredient {
  if (typeof ingredient !== "object" || ingredient === null || Array.isArray(ingredient)) {
    return false;
  }
  const row = ingredient as Record<string, unknown>;
  return (
    typeof row.foodId === "string" &&
    row.foodId.trim().length > 0 &&
    row.foodId.length <= 128 &&
    !containsControlCharacters(row.foodId) &&
    typeof row.amountG === "number" &&
    Number.isFinite(row.amountG) &&
    row.amountG > 0
  );
}

function validFoodId(id: unknown): id is string {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    id.length <= 128 &&
    !containsControlCharacters(id)
  );
}

// Older T069 recipe documents still need their deprecated ID-only ingredient field read.
/* eslint-disable @typescript-eslint/no-deprecated */
export function validRecipe(recipe: Recipe): boolean {
  if (
    typeof recipe.id !== "string" ||
    recipe.id.length === 0 ||
    typeof recipe.name !== "string" ||
    recipe.name.trim().length === 0 ||
    recipe.name.length > 200 ||
    containsControlCharacters(recipe.name) ||
    (recipe.servings !== undefined &&
      (typeof recipe.servings !== "number" ||
        !Number.isFinite(recipe.servings) ||
        recipe.servings <= 0)) ||
    (recipe.deletedAt !== null && typeof recipe.deletedAt !== "string") ||
    typeof recipe.createdAt !== "string" ||
    typeof recipe.updatedAt !== "string" ||
    !Number.isInteger(recipe.version) ||
    recipe.version < 1 ||
    (recipe.foodIds !== undefined &&
      (!Array.isArray(recipe.foodIds) || !recipe.foodIds.every(validFoodId))) ||
    (recipe.ingredients !== undefined &&
      (!Array.isArray(recipe.ingredients) || !recipe.ingredients.every(validIngredient)))
  ) {
    return false;
  }
  if (recipe.ingredients !== undefined && recipe.foodIds !== undefined) {
    const ingredientIds = new Set(recipe.ingredients.map(({ foodId }) => foodId));
    const foodIds = new Set(recipe.foodIds);
    if (ingredientIds.size !== foodIds.size || [...ingredientIds].some((id) => !foodIds.has(id))) {
      return false;
    }
  }
  return true;
}

function recipeIngredientRows(recipe: Recipe): readonly {
  readonly food_id: string;
  readonly amount_g: number | null;
  readonly position: number;
}[] {
  const ingredients =
    recipe.ingredients ?? (recipe.foodIds ?? []).map((foodId) => ({ foodId, amountG: null }));
  return ingredients.map((ingredient, position) => ({
    food_id: ingredient.foodId,
    amount_g: ingredient.amountG,
    position,
  }));
}
/* eslint-enable @typescript-eslint/no-deprecated */

export function putRecipeOp(recipe: Recipe): DbTransactionOp {
  return {
    op: "putRecipe",
    params: {
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings ?? "",
      ingredients_json: JSON.stringify(recipeIngredientRows(recipe)),
      created_at: recipe.createdAt,
      updated_at: recipe.updatedAt,
      version: recipe.version,
      deleted_at: recipe.deletedAt ?? "",
    },
  };
}

async function migrateLegacyRecipes(): Promise<DataResult<true>> {
  const foodStore = createSqliteFoodStore();
  const foodsResult = await foodStore.list();
  if (!foodsResult.ok) {
    return foodsResult;
  }
  const foodIds = new Set(foodsResult.value.map((food: Food) => food.id));

  const legacyStore = createSqliteEntityDocStore<Recipe>(ENTITY_TYPE);
  const legacyResult = await legacyStore.list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const recipes = legacyResult.value;
  for (const recipe of recipes) {
    if (
      !validRecipe(recipe) ||
      recipeIngredientRows(recipe).some((ingredient) => !foodIds.has(ingredient.food_id))
    ) {
      return corruptedRecipe();
    }
  }

  for (let offset = 0; offset < recipes.length; offset += LEGACY_BATCH_SIZE) {
    const batch = recipes.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const recipe of batch) {
      ops.push(putRecipeOp(recipe));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: recipe.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseRecipes(rows: readonly unknown[]): DataResult<readonly Recipe[]> {
  const records = new Map<string, RecipeRecord>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedRecipe();
    }
    const row = value as RelationalRecipeRow;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      (row.servings !== null && typeof row.servings !== "number") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string") ||
      (row.food_id !== null && typeof row.food_id !== "string") ||
      (row.amount_g !== null && typeof row.amount_g !== "number") ||
      (row.position !== null && typeof row.position !== "number")
    ) {
      return corruptedRecipe();
    }
    let record = records.get(row.id);
    if (record === undefined) {
      record = {
        id: row.id,
        name: row.name,
        servings: row.servings,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
        deletedAt: row.deleted_at,
        ingredients: [],
      };
      records.set(row.id, record);
    } else if (
      record.name !== row.name ||
      record.servings !== row.servings ||
      record.createdAt !== row.created_at ||
      record.updatedAt !== row.updated_at ||
      record.version !== row.version ||
      record.deletedAt !== row.deleted_at
    ) {
      return corruptedRecipe();
    }
    if (row.food_id === null) {
      if (row.amount_g !== null || row.position !== null) {
        return corruptedRecipe();
      }
      continue;
    }
    if (
      row.position === null ||
      !Number.isInteger(row.position) ||
      row.position < 0 ||
      row.position !== record.ingredients.length ||
      (row.amount_g !== null && (!Number.isFinite(row.amount_g) || row.amount_g <= 0))
    ) {
      return corruptedRecipe();
    }
    (record.ingredients as { foodId: string; amountG: number | null }[]).push({
      foodId: row.food_id,
      amountG: row.amount_g,
    });
  }

  const recipes: Recipe[] = [];
  for (const record of records.values()) {
    const ingredients = [...record.ingredients];
    const hasMissingAmounts = ingredients.some((ingredient) => ingredient.amountG === null);
    const hasAmounts = ingredients.some((ingredient) => ingredient.amountG !== null);
    if (hasMissingAmounts && hasAmounts) {
      return corruptedRecipe();
    }
    const withAmounts = ingredients.every((ingredient) => ingredient.amountG !== null);
    const recipe: Recipe = {
      id: record.id,
      name: record.name,
      ...(record.servings === null ? {} : { servings: record.servings }),
      ...(withAmounts && ingredients.length > 0
        ? { ingredients: ingredients as readonly RecipeIngredient[] }
        : {}),
      foodIds: [...new Set(ingredients.map(({ foodId }) => foodId))],
      deletedAt: record.deletedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      version: record.version,
    };
    if (!validRecipe(recipe)) {
      return corruptedRecipe();
    }
    recipes.push(recipe);
  }
  return { ok: true, value: recipes };
}

export function createSqliteRecipeStore(): EntityStore<Recipe> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyRecipes();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Recipe> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Recipe[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "listRecipes", params: {} });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseRecipes(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Recipe>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "getRecipe",
        params: { id },
      });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as Recipe);
      }
      const parsed = parseRecipes(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const recipe = parsed.value[0];
      return recipe === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: recipe };
    },
    async save(recipe: Recipe): Promise<DataResult<Recipe>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validRecipe(recipe)) {
        return {
          ok: false,
          error: invalidInput("data.recipe.invalid", "Reseptiä ei voi tallentaa näillä tiedoilla."),
        };
      }
      const response = await sendDbRequest({ kind: "transaction", ops: [putRecipeOp(recipe)] });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: recipe } : result;
    },
    async saveWithSyncOperation(
      recipe: Recipe,
      context: SyncWriteContext,
    ): Promise<DataResult<Recipe>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validRecipe(recipe)) {
        return {
          ok: false,
          error: invalidInput("data.recipe.invalid", "Reseptiä ei voi tallentaa näillä tiedoilla."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: recipe.id,
        operation: context.operation,
        entityVersion: recipe.version,
        occurredAt: context.occurredAt,
        createdAt: recipe.createdAt,
        entity: recipe as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putRecipeOp(recipe)],
      });
      return committed.ok ? { ok: true, value: recipe } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const now = new Date().toISOString();
      const removed = await store.save({
        ...existing.value,
        deletedAt: now,
        updatedAt: now,
        version: existing.value.version + 1,
      });
      return removed.ok ? { ok: true, value: true } : removed;
    },
  };
  return store;
}
