import type { EntityId, Food, NutritionEntry } from "@lifeos/domain";
import { containsControlCharacters } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { listEntityDocs } from "./sqliteEntityClient.ts";
import { createSqliteFoodStore } from "./sqliteFoodStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "nutrition-entry";
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
      userMessage:
        "Tallennettua ravintokirjausta tai sen ruokaviitettä ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.nutrition-entry.doc.invalid",
    },
  };
}

function validNullableNutrient(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

export function validNutritionEntry(entry: NutritionEntry): boolean {
  const foodId = entry.foodId;
  const amountG = entry.amountG;
  const mealSlotId = entry.mealSlotId;
  const fiberG = entry.fiberG;
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.eatenAt === "string" &&
    (foodId === undefined ||
      foodId === null ||
      (typeof foodId === "string" &&
        foodId.trim().length > 0 &&
        !containsControlCharacters(foodId))) &&
    (amountG === undefined ||
      amountG === null ||
      (typeof amountG === "number" && Number.isFinite(amountG) && amountG > 0)) &&
    (mealSlotId === undefined ||
      mealSlotId === null ||
      (typeof mealSlotId === "string" &&
        mealSlotId.trim().length > 0 &&
        mealSlotId.length <= 60 &&
        !containsControlCharacters(mealSlotId))) &&
    typeof entry.label === "string" &&
    entry.label.trim().length > 0 &&
    entry.label.length <= 200 &&
    !containsControlCharacters(entry.label) &&
    validNullableNutrient(entry.calories) &&
    validNullableNutrient(entry.proteinG) &&
    validNullableNutrient(entry.carbsG) &&
    validNullableNutrient(entry.fatG) &&
    (fiberG === undefined || fiberG === null || validNullableNutrient(fiberG)) &&
    (entry.deletedAt === null || typeof entry.deletedAt === "string") &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    Number.isInteger(entry.version) &&
    entry.version >= 1
  );
}

function parseLegacyRow(value: unknown): NutritionEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as LegacyEntityRow;
  if ((row.doc_version !== 0 && row.doc_version !== 1) || typeof row.value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const doc = parsed as NutritionEntry;
    const entry: NutritionEntry = {
      ...doc,
      foodId: doc.foodId ?? null,
      amountG: doc.amountG ?? null,
      mealSlotId: doc.mealSlotId ?? null,
      fiberG: doc.fiberG ?? null,
      deletedAt: doc.deletedAt ?? null,
    };
    if (
      row.id !== entry.id ||
      row.created_at !== entry.createdAt ||
      row.updated_at !== entry.updatedAt ||
      !validNutritionEntry(entry)
    ) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function parseRelationalRow(value: unknown): NutritionEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.eaten_at !== "string" ||
    (row.food_id !== null && typeof row.food_id !== "string") ||
    (row.amount_g !== null && typeof row.amount_g !== "number") ||
    (row.meal_slot_id !== null && typeof row.meal_slot_id !== "string") ||
    typeof row.label !== "string" ||
    (row.calories !== null && typeof row.calories !== "number") ||
    (row.protein_g !== null && typeof row.protein_g !== "number") ||
    (row.carbs_g !== null && typeof row.carbs_g !== "number") ||
    (row.fat_g !== null && typeof row.fat_g !== "number") ||
    (row.fiber_g !== null && typeof row.fiber_g !== "number") ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.version !== "number" ||
    (row.deleted_at !== null && typeof row.deleted_at !== "string")
  ) {
    return null;
  }
  const entry: NutritionEntry = {
    id: row.id,
    eatenAt: row.eaten_at,
    foodId: row.food_id,
    amountG: row.amount_g,
    mealSlotId: row.meal_slot_id,
    label: row.label,
    calories: row.calories,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    fiberG: row.fiber_g,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
    deletedAt: row.deleted_at,
  };
  return validNutritionEntry(entry) ? entry : null;
}

export function putNutritionEntryOp(entry: NutritionEntry): DbTransactionOp {
  return {
    op: "putNutritionEntry",
    params: {
      id: entry.id,
      eaten_at: entry.eatenAt,
      food_id: entry.foodId ?? "",
      amount_g: entry.amountG ?? "",
      meal_slot_id: entry.mealSlotId ?? "",
      label: entry.label,
      calories: entry.calories ?? "",
      protein_g: entry.proteinG ?? "",
      carbs_g: entry.carbsG ?? "",
      fat_g: entry.fatG ?? "",
      fiber_g: entry.fiberG ?? "",
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      deleted_at: entry.deletedAt ?? "",
      version: entry.version,
    },
  };
}

async function migrateLegacyNutritionEntries(): Promise<DataResult<true>> {
  const foodStore = createSqliteFoodStore();
  const foodsResult = await foodStore.list();
  if (!foodsResult.ok) {
    return foodsResult;
  }
  const foodIds = new Set(foodsResult.value.map((food: Food) => food.id));

  const legacyResult = await listEntityDocs(ENTITY_TYPE);
  if (!legacyResult.ok) {
    return legacyResult;
  }

  const entries: NutritionEntry[] = [];
  for (const row of legacyResult.value) {
    const entry = parseLegacyRow(row);
    if (
      entry === null ||
      (entry.foodId !== null && entry.foodId !== undefined && !foodIds.has(entry.foodId))
    ) {
      return corruptedData();
    }
    entries.push(entry);
  }

  for (let offset = 0; offset < entries.length; offset += LEGACY_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const entry of batch) {
      ops.push(putNutritionEntryOp(entry));
      ops.push({
        op: "deleteEntity",
        params: { entity_type: ENTITY_TYPE, id: entry.id },
      });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseQueryRows(rows: readonly unknown[]): DataResult<readonly NutritionEntry[]> {
  const entries: NutritionEntry[] = [];
  for (const row of rows) {
    const entry = parseRelationalRow(row);
    if (entry === null) {
      return corruptedData();
    }
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

export function createSqliteNutritionEntryStore(): EntityStore<NutritionEntry> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyNutritionEntries();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<NutritionEntry> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly NutritionEntry[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "listNutritionEntries",
        params: {},
      });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseQueryRows(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<NutritionEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "getNutritionEntry",
        params: { id },
      });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as NutritionEntry);
      }
      const parsed = parseQueryRows(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const entry = parsed.value[0];
      return entry === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: entry };
    },
    async save(entry: NutritionEntry): Promise<DataResult<NutritionEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validNutritionEntry(entry)) {
        return {
          ok: false,
          error: invalidInput(
            "data.nutrition-entry.invalid",
            "Ravintokirjausta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "exec",
        ...putNutritionEntryOp(entry),
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: entry } : result;
    },
    async saveWithSyncOperation(
      entry: NutritionEntry,
      context: SyncWriteContext,
    ): Promise<DataResult<NutritionEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validNutritionEntry(entry)) {
        return {
          ok: false,
          error: invalidInput(
            "data.nutrition-entry.invalid",
            "Ravintokirjausta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: entry.id,
        operation: context.operation,
        entityVersion: entry.version,
        occurredAt: context.occurredAt,
        createdAt: entry.createdAt,
        entity: entry as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putNutritionEntryOp(entry)],
      });
      return committed.ok ? { ok: true, value: entry } : committed;
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
