import { afterEach, describe, expect, it } from "vitest";
import type { Food, Recipe } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteRecipeStore,
  createSyncCryptoAdapter,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface EntityDocRow {
  readonly entity_type: string;
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

interface FakeWrite {
  readonly op: string;
  readonly params: Record<string, string | number | boolean>;
}

interface FakeRequest {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly FakeWrite[];
  readonly params?: Record<string, string | number | boolean>;
}

function key(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullable(value: string | number | boolean | undefined): string | number | null {
  return value === "" || value === undefined || typeof value === "boolean" ? null : value;
}

function foodRow(params: FakeWrite["params"]): Record<string, unknown> {
  return {
    id: params.id,
    name: params.name,
    calories_per_100g: nullable(params.calories_per_100g),
    protein_per_100g: nullable(params.protein_per_100g),
    carbs_per_100g: nullable(params.carbs_per_100g),
    fat_per_100g: nullable(params.fat_per_100g),
    fiber_per_100g: nullable(params.fiber_per_100g),
    serving_size_g: nullable(params.serving_size_g),
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
    deleted_at: nullable(params.deleted_at),
  };
}

function recipeRow(
  params: FakeWrite["params"],
  ingredients: readonly { food_id: string; amount_g: number | null; position: number }[],
): readonly Record<string, unknown>[] {
  const base = {
    id: params.id,
    name: params.name,
    servings: nullable(params.servings),
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
    deleted_at: nullable(params.deleted_at),
  };
  return ingredients.length === 0
    ? [{ ...base, food_id: null, amount_g: null, position: null }]
    : ingredients.map((ingredient) => ({ ...base, ...ingredient }));
}

function createRecipeWorker(initialDocs: readonly EntityDocRow[]) {
  const entityDocs = new Map(initialDocs.map((row) => [key(row.entity_type, row.id), row]));
  const foods = new Map<string, Record<string, unknown>>();
  const recipes = new Map<string, Record<string, unknown>>();
  const recipeIngredients = new Map<
    string,
    readonly { food_id: string; amount_g: number | null; position: number }[]
  >();
  const requests: FakeRequest[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as FakeRequest;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        let errorCode: string | null = null;
        if (request.kind === "query" && request.op === "listEntities") {
          const entityType = String(request.params?.entity_type ?? "");
          rows = [...entityDocs.values()].filter((row) => row.entity_type === entityType);
        } else if (request.kind === "query" && request.op === "listFoods") {
          rows = [...foods.values()];
        } else if (request.kind === "query" && request.op === "getFood") {
          const row = foods.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listRecipes") {
          rows = [...recipes].flatMap(([id, row]) =>
            recipeRow(
              {
                id: String(row.id),
                name: String(row.name),
                servings: row.servings === null ? "" : (row.servings as number),
                created_at: String(row.created_at),
                updated_at: String(row.updated_at),
                version: Number(row.version),
                deleted_at: stringValue(row.deleted_at),
              },
              recipeIngredients.get(id) ?? [],
            ),
          );
        } else if (request.kind === "query" && request.op === "getRecipe") {
          const id = String(request.params?.id ?? "");
          const row = recipes.get(id);
          rows =
            row === undefined
              ? []
              : recipeRow(
                  {
                    id: String(row.id),
                    name: String(row.name),
                    servings: row.servings === null ? "" : (row.servings as number),
                    created_at: String(row.created_at),
                    updated_at: String(row.updated_at),
                    version: Number(row.version),
                    deleted_at: stringValue(row.deleted_at),
                  },
                  recipeIngredients.get(id) ?? [],
                );
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(entityDocs);
          const nextFoods = new Map(foods);
          const nextRecipes = new Map(recipes);
          const nextIngredients = new Map(recipeIngredients);
          for (const write of request.ops ?? []) {
            const id = String(write.params.id ?? "");
            if (write.op === "putFood") {
              const row = foodRow(write.params);
              const existing = nextFoods.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextFoods.set(id, row);
            } else if (write.op === "putRecipe") {
              const ingredients = JSON.parse(String(write.params.ingredients_json)) as {
                food_id: string;
                amount_g: number | null;
                position: number;
              }[];
              if (ingredients.some((ingredient) => !nextFoods.has(ingredient.food_id))) {
                errorCode = "invalid-input";
                break;
              }
              const row: Record<string, unknown> = {
                id,
                name: write.params.name,
                servings: nullable(write.params.servings),
                created_at: write.params.created_at,
                updated_at: write.params.updated_at,
                version: write.params.version,
                deleted_at: nullable(write.params.deleted_at),
              };
              const existing = nextRecipes.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextRecipes.set(id, row);
              nextIngredients.set(id, ingredients);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(key(String(write.params.entity_type ?? ""), id));
            }
          }
          if (errorCode === null) {
            entityDocs.clear();
            for (const [docKey, row] of nextDocs) entityDocs.set(docKey, row);
            foods.clear();
            for (const [foodId, row] of nextFoods) foods.set(foodId, row);
            recipes.clear();
            for (const [recipeId, row] of nextRecipes) recipes.set(recipeId, row);
            recipeIngredients.clear();
            for (const [recipeId, rows] of nextIngredients) recipeIngredients.set(recipeId, rows);
          }
        }

        onmessage?.({
          data:
            errorCode === null
              ? {
                  requestId: request.requestId,
                  ok: true,
                  rows,
                  backend: "memory",
                  persisted: false,
                }
              : {
                  requestId: request.requestId,
                  ok: false,
                  code: errorCode,
                  diagnosticCode: "db.constraint.foreign-key",
                },
        } as MessageEvent);
      });
    },
    terminate() {},
    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      onmessage = listener;
    },
    set onerror(_listener: ((event: ErrorEvent) => void) | null) {},
  };

  return {
    worker: worker as unknown as Worker,
    entityDocs,
    foods,
    recipes,
    recipeIngredients,
    requests,
  };
}

function legacyFood(food: Food): EntityDocRow {
  return {
    entity_type: "food",
    id: food.id,
    created_at: food.createdAt,
    updated_at: food.updatedAt,
    doc_version: 0,
    value: JSON.stringify(food),
  };
}

function legacyRecipe(recipe: Recipe): EntityDocRow {
  return {
    entity_type: "recipe",
    id: recipe.id,
    created_at: recipe.createdAt,
    updated_at: recipe.updatedAt,
    doc_version: 0,
    value: JSON.stringify(recipe),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite recipe relational store", () => {
  it("migrates Food first and preserves recipe portions, ingredient order, and duplicate foods", async () => {
    const timestamp = "2026-08-01T08:00:00.000Z";
    const food: Food = {
      id: "food-legacy",
      name: "Kaurapuuro",
      caloriesPer100G: 70,
      proteinPer100G: 2.5,
      carbsPer100G: 12,
      fatPer100G: 1.5,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const legacy: Recipe = {
      id: "recipe-legacy",
      name: "Puuro",
      servings: 2.5,
      ingredients: [
        { foodId: food.id, amountG: 80 },
        { foodId: food.id, amountG: 120 },
      ],
      foodIds: [food.id],
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 2,
    };
    const { worker, entityDocs, foods, recipes, recipeIngredients, requests } = createRecipeWorker([
      legacyFood(food),
      legacyRecipe(legacy),
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteRecipeStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(entityDocs.size).toBe(0);
    expect(foods.has(food.id)).toBe(true);
    expect(recipes.get(legacy.id)).toMatchObject({ servings: 2.5 });
    expect(recipeIngredients.get(legacy.id)).toEqual([
      { food_id: food.id, amount_g: 80, position: 0 },
      { food_id: food.id, amount_g: 120, position: 1 },
    ]);
    const foodTransfer = requests.findIndex((request) =>
      request.ops?.some((write) => write.op === "putFood"),
    );
    const recipeTransfer = requests.findIndex((request) =>
      request.ops?.some((write) => write.op === "putRecipe"),
    );
    expect(recipeTransfer).toBeGreaterThan(foodTransfer);

    const updated: Recipe = {
      ...legacy,
      id: "recipe-new",
      servings: 1,
      ingredients: [{ foodId: food.id, amountG: 200 }],
      version: 1,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(updated.id)).toEqual({ ok: true, value: updated });
    expect(await store.remove(updated.id)).toEqual({ ok: true, value: true });
    expect(typeof recipes.get(updated.id)?.deleted_at).toBe("string");
    expect(recipes.get(updated.id)?.version).toBe(2);
    expect(requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("keeps amountless legacy food links readable and blocks orphaned recipe links", async () => {
    const timestamp = "2026-08-01T08:00:00.000Z";
    const food: Food = {
      id: "food-legacy",
      name: "Kaura",
      caloriesPer100G: null,
      proteinPer100G: null,
      carbsPer100G: null,
      fatPer100G: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const legacy: Recipe = {
      id: "recipe-old",
      name: "Vanha resepti",
      foodIds: [food.id],
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const first = createRecipeWorker([legacyFood(food), legacyRecipe(legacy)]);
    configureDatabaseWorker({ create: () => first.worker });
    expect(await createSqliteRecipeStore().list()).toEqual({ ok: true, value: [legacy] });
    expect(first.recipeIngredients.get(legacy.id)).toEqual([
      { food_id: food.id, amount_g: null, position: 0 },
    ]);

    resetDatabaseWorkerForTests();
    const orphan: Recipe = { ...legacy, id: "recipe-orphan", foodIds: ["missing-food"] };
    const second = createRecipeWorker([legacyRecipe(orphan)]);
    configureDatabaseWorker({ create: () => second.worker });
    const result = await createSqliteRecipeStore().list();
    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(second.entityDocs.get(key("recipe", orphan.id))).toEqual(legacyRecipe(orphan));
    expect(second.recipes.size).toBe(0);
    expect(second.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a recipe and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const recipe: Recipe = {
      id: "recipe-sync",
      name: "Jogurttikulho",
      servings: 1,
      ingredients: [],
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const { worker, recipes, requests } = createRecipeWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteRecipeStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(23));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(recipe, {
          operationId: "installation-1:recipe-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: ["name", "servings", "ingredients", "deletedAt"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: recipe });

      const transaction = requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual(["putRecipe", "putSyncOperation"]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(recipes.get(recipe.id)?.name).toBe(recipe.name);
    } finally {
      keySession.lock();
    }
  });
});
