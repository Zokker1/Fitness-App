import type { EntityId, Food } from "@lifeos/domain";
import { containsControlCharacters } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { listEntityDocs } from "./sqliteEntityClient.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "food";
const LEGACY_BATCH_SIZE = 32;

interface LegacyEntityRow {
  readonly id?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly doc_version?: unknown;
  readonly value?: unknown;
}

function corruptedData(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua ruokaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.food.doc.invalid",
    },
  };
}

function validNullableNutrient(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export function validFood(food: Food): boolean {
  const fiber = food.fiberPer100G;
  const serving = food.servingSizeG;
  return (
    typeof food.id === "string" &&
    food.id.length > 0 &&
    typeof food.name === "string" &&
    food.name.trim().length > 0 &&
    food.name.length <= 200 &&
    !containsControlCharacters(food.name) &&
    validNullableNutrient(food.caloriesPer100G) &&
    validNullableNutrient(food.proteinPer100G) &&
    validNullableNutrient(food.carbsPer100G) &&
    validNullableNutrient(food.fatPer100G) &&
    (fiber === undefined || fiber === null || validNullableNutrient(fiber)) &&
    (serving === undefined ||
      serving === null ||
      (typeof serving === "number" && Number.isFinite(serving) && serving > 0)) &&
    (food.deletedAt === null || typeof food.deletedAt === "string") &&
    typeof food.createdAt === "string" &&
    typeof food.updatedAt === "string" &&
    Number.isInteger(food.version) &&
    food.version >= 1
  );
}

function parseLegacyRow(value: unknown): Food | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as LegacyEntityRow;
  if (row.doc_version !== 0 || typeof row.value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const doc = parsed as Food;
    const food: Food = { ...doc, deletedAt: doc.deletedAt ?? null };
    if (
      row.id !== food.id ||
      row.created_at !== food.createdAt ||
      row.updated_at !== food.updatedAt ||
      !validFood(food)
    ) {
      return null;
    }
    return food;
  } catch {
    return null;
  }
}

function parseRelationalRow(value: unknown): Food | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.name !== "string" ||
    (row.calories_per_100g !== null && typeof row.calories_per_100g !== "number") ||
    (row.protein_per_100g !== null && typeof row.protein_per_100g !== "number") ||
    (row.carbs_per_100g !== null && typeof row.carbs_per_100g !== "number") ||
    (row.fat_per_100g !== null && typeof row.fat_per_100g !== "number") ||
    (row.fiber_per_100g !== null && typeof row.fiber_per_100g !== "number") ||
    (row.serving_size_g !== null && typeof row.serving_size_g !== "number") ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.version !== "number" ||
    (row.deleted_at !== null && typeof row.deleted_at !== "string")
  ) {
    return null;
  }
  const food: Food = {
    id: row.id,
    name: row.name,
    caloriesPer100G: row.calories_per_100g,
    proteinPer100G: row.protein_per_100g,
    carbsPer100G: row.carbs_per_100g,
    fatPer100G: row.fat_per_100g,
    ...(row.fiber_per_100g === null ? {} : { fiberPer100G: row.fiber_per_100g }),
    ...(row.serving_size_g === null ? {} : { servingSizeG: row.serving_size_g }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    deletedAt: row.deleted_at,
  };
  return validFood(food) ? food : null;
}

export function putFoodOp(food: Food): DbTransactionOp {
  return {
    op: "putFood",
    params: {
      id: food.id,
      name: food.name,
      calories_per_100g: food.caloriesPer100G ?? "",
      protein_per_100g: food.proteinPer100G ?? "",
      carbs_per_100g: food.carbsPer100G ?? "",
      fat_per_100g: food.fatPer100G ?? "",
      fiber_per_100g: food.fiberPer100G ?? "",
      serving_size_g: food.servingSizeG ?? "",
      created_at: food.createdAt,
      updated_at: food.updatedAt,
      deleted_at: food.deletedAt ?? "",
      version: food.version,
    },
  };
}

async function migrateLegacyFoods(): Promise<DataResult<true>> {
  const legacyResult = await listEntityDocs(ENTITY_TYPE);
  if (!legacyResult.ok) {
    return legacyResult;
  }

  const foods: Food[] = [];
  for (const row of legacyResult.value) {
    const food = parseLegacyRow(row);
    if (food === null) {
      return corruptedData();
    }
    foods.push(food);
  }

  for (let offset = 0; offset < foods.length; offset += LEGACY_BATCH_SIZE) {
    const batch = foods.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const food of batch) {
      ops.push(putFoodOp(food));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: food.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseQueryRows(rows: readonly unknown[]): DataResult<readonly Food[]> {
  const foods: Food[] = [];
  for (const row of rows) {
    const food = parseRelationalRow(row);
    if (food === null) {
      return corruptedData();
    }
    foods.push(food);
  }
  return { ok: true, value: foods };
}

export function createSqliteFoodStore(): EntityStore<Food> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyFoods();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Food> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Food[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "listFoods", params: {} });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseQueryRows(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Food>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "getFood", params: { id } });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as Food);
      }
      const parsed = parseQueryRows(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const food = parsed.value[0];
      return food === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: food };
    },
    async save(food: Food): Promise<DataResult<Food>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validFood(food)) {
        return {
          ok: false,
          error: invalidInput("data.food.invalid", "Ruokaa ei voi tallentaa näillä tiedoilla."),
        };
      }
      const response = await sendDbRequest({ kind: "exec", ...putFoodOp(food) });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: food } : result;
    },
    async saveWithSyncOperation(food: Food, context: SyncWriteContext): Promise<DataResult<Food>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validFood(food)) {
        return {
          ok: false,
          error: invalidInput("data.food.invalid", "Ruokaa ei voi tallentaa näillä tiedoilla."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: food.id,
        operation: context.operation,
        entityVersion: food.version,
        occurredAt: context.occurredAt,
        createdAt: food.createdAt,
        entity: food as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putFoodOp(food)],
      });
      return committed.ok ? { ok: true, value: food } : committed;
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
