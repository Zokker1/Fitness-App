import type { EntityId, Supplement } from "@lifeos/domain";
import { containsControlCharacters } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "supplement";
const LEGACY_BATCH_SIZE = 32;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

interface RelationalSupplementRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly dose_label?: unknown;
  readonly amount?: unknown;
  readonly unit?: unknown;
  readonly schedule_json?: unknown;
  readonly stock_amount?: unknown;
  readonly stock_unit?: unknown;
  readonly stock_counted_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedSupplement(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua lisäravinnetta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.supplement.doc.invalid",
    },
  };
}

function validSchedule(schedule: unknown): schedule is readonly string[] {
  return (
    Array.isArray(schedule) &&
    schedule.length <= 12 &&
    schedule.every((time) => typeof time === "string" && LOCAL_TIME_PATTERN.test(time)) &&
    new Set(schedule).size === schedule.length
  );
}

export function validSupplement(supplement: Supplement): boolean {
  return (
    typeof supplement.id === "string" &&
    supplement.id.length > 0 &&
    typeof supplement.name === "string" &&
    supplement.name.trim().length > 0 &&
    supplement.name.length <= 200 &&
    !containsControlCharacters(supplement.name) &&
    (supplement.doseLabel === null ||
      (typeof supplement.doseLabel === "string" &&
        supplement.doseLabel.length <= 200 &&
        !containsControlCharacters(supplement.doseLabel))) &&
    (supplement.amount === undefined ||
      (typeof supplement.amount === "number" &&
        Number.isFinite(supplement.amount) &&
        supplement.amount > 0)) &&
    (supplement.unit === undefined ||
      (typeof supplement.unit === "string" &&
        supplement.unit.trim().length > 0 &&
        supplement.unit.length <= 40 &&
        !containsControlCharacters(supplement.unit))) &&
    (supplement.schedule === undefined || validSchedule(supplement.schedule)) &&
    (supplement.stockAmount === undefined ||
      supplement.stockAmount === null ||
      (typeof supplement.stockAmount === "number" &&
        Number.isFinite(supplement.stockAmount) &&
        supplement.stockAmount >= 0)) &&
    (supplement.stockUnit === undefined ||
      supplement.stockUnit === null ||
      (typeof supplement.stockUnit === "string" &&
        supplement.stockUnit.trim().length > 0 &&
        supplement.stockUnit.length <= 40 &&
        !containsControlCharacters(supplement.stockUnit))) &&
    (supplement.stockCountedAt === undefined ||
      supplement.stockCountedAt === null ||
      typeof supplement.stockCountedAt === "string") &&
    (supplement.deletedAt === null || typeof supplement.deletedAt === "string") &&
    typeof supplement.createdAt === "string" &&
    typeof supplement.updatedAt === "string" &&
    Number.isInteger(supplement.version) &&
    supplement.version >= 1
  );
}

function normalizeSupplement(supplement: Supplement): Supplement {
  return {
    ...supplement,
    doseLabel: supplement.doseLabel ?? null,
    deletedAt: supplement.deletedAt ?? null,
  };
}

export function putSupplementOp(supplement: Supplement): DbTransactionOp {
  return {
    op: "putSupplement",
    params: {
      id: supplement.id,
      name: supplement.name,
      dose_label: supplement.doseLabel ?? "",
      amount: supplement.amount ?? "",
      unit: supplement.unit ?? "",
      schedule_json: supplement.schedule === undefined ? "" : JSON.stringify(supplement.schedule),
      stock_amount: supplement.stockAmount ?? "",
      stock_unit: supplement.stockUnit ?? "",
      stock_counted_at: supplement.stockCountedAt ?? "",
      created_at: supplement.createdAt,
      updated_at: supplement.updatedAt,
      version: supplement.version,
      deleted_at: supplement.deletedAt ?? "",
    },
  };
}

async function migrateLegacySupplements(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<Supplement>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const supplements = legacyResult.value.map(normalizeSupplement);
  if (supplements.some((supplement) => !validSupplement(supplement))) {
    return corruptedSupplement();
  }

  for (let offset = 0; offset < supplements.length; offset += LEGACY_BATCH_SIZE) {
    const batch = supplements.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const supplement of batch) {
      ops.push(putSupplementOp(supplement));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: supplement.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseSupplements(rows: readonly unknown[]): DataResult<readonly Supplement[]> {
  const supplements: Supplement[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedSupplement();
    }
    const row = value as RelationalSupplementRow;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      (row.dose_label !== null && typeof row.dose_label !== "string") ||
      (row.amount !== null && typeof row.amount !== "number") ||
      (row.unit !== null && typeof row.unit !== "string") ||
      (row.schedule_json !== null && typeof row.schedule_json !== "string") ||
      (row.stock_amount !== null && typeof row.stock_amount !== "number") ||
      (row.stock_unit !== null && typeof row.stock_unit !== "string") ||
      (row.stock_counted_at !== null && typeof row.stock_counted_at !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedSupplement();
    }
    let schedule: readonly string[] | undefined;
    if (row.schedule_json !== null) {
      try {
        const parsed: unknown = JSON.parse(row.schedule_json);
        if (!validSchedule(parsed)) {
          return corruptedSupplement();
        }
        schedule = parsed;
      } catch {
        return corruptedSupplement();
      }
    }
    const supplement: Supplement = {
      id: row.id,
      name: row.name,
      doseLabel: row.dose_label,
      ...(row.amount === null ? {} : { amount: row.amount }),
      ...(row.unit === null ? {} : { unit: row.unit }),
      ...(schedule === undefined ? {} : { schedule }),
      ...(row.stock_amount === null ? {} : { stockAmount: row.stock_amount }),
      ...(row.stock_unit === null ? {} : { stockUnit: row.stock_unit }),
      ...(row.stock_counted_at === null ? {} : { stockCountedAt: row.stock_counted_at }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validSupplement(supplement)) {
      return corruptedSupplement();
    }
    supplements.push(supplement);
  }
  return { ok: true, value: supplements };
}

export function createSqliteSupplementStore(): EntityStore<Supplement> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacySupplements();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Supplement> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Supplement[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "listSupplements", params: {} });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseSupplements(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Supplement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "getSupplement", params: { id } });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as Supplement);
      }
      const parsed = parseSupplements(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const supplement = parsed.value[0];
      return supplement === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: supplement };
    },
    async save(supplement: Supplement): Promise<DataResult<Supplement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const normalized = normalizeSupplement(supplement);
      if (!validSupplement(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.supplement.invalid",
            "Lisäravinnetta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putSupplementOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      supplement: Supplement,
      context: SyncWriteContext,
    ): Promise<DataResult<Supplement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeSupplement(supplement);
      if (!validSupplement(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.supplement.invalid",
            "Lisäravinnetta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: normalized.id,
        operation: context.operation,
        entityVersion: normalized.version,
        occurredAt: context.occurredAt,
        createdAt: normalized.createdAt,
        entity: normalized as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putSupplementOp(normalized)],
      });
      return committed.ok ? { ok: true, value: normalized } : committed;
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
