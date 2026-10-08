import type { EntityId, SupplementLog, SupplementLogStatus } from "@lifeos/domain";
import { containsControlCharacters } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteSupplementStore } from "./sqliteSupplementStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "supplement-log";
const LEGACY_BATCH_SIZE = 32;
const VALID_STATUSES: readonly SupplementLogStatus[] = ["taken", "skipped", "pending"];

interface RelationalSupplementLogRow {
  readonly id?: unknown;
  readonly supplement_id?: unknown;
  readonly status?: unknown;
  readonly scheduled_at?: unknown;
  readonly dose_amount?: unknown;
  readonly dose_unit?: unknown;
  readonly taken_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedSupplementLog(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage:
        "Tallennettua lisäravinnekirjausta tai sen lisäravinneviitettä ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.supplement-log.doc.invalid",
    },
  };
}

function normalizedLog(log: SupplementLog): SupplementLog {
  const status = log.status ?? (log.takenAt === null ? "pending" : "taken");
  return {
    ...log,
    status,
    scheduledAt: log.scheduledAt ?? null,
    doseAmount: log.doseAmount ?? null,
    doseUnit: log.doseUnit ?? null,
  };
}

export function validSupplementLog(log: SupplementLog): boolean {
  return (
    typeof log.id === "string" &&
    log.id.length > 0 &&
    typeof log.supplementId === "string" &&
    log.supplementId.trim().length > 0 &&
    !containsControlCharacters(log.supplementId) &&
    VALID_STATUSES.includes(log.status as SupplementLogStatus) &&
    (log.scheduledAt === null || typeof log.scheduledAt === "string") &&
    (log.doseAmount === null ||
      (typeof log.doseAmount === "number" &&
        Number.isFinite(log.doseAmount) &&
        log.doseAmount > 0)) &&
    (log.doseUnit === null ||
      (typeof log.doseUnit === "string" &&
        log.doseUnit.trim().length > 0 &&
        log.doseUnit.length <= 40 &&
        !containsControlCharacters(log.doseUnit))) &&
    (log.takenAt === null || typeof log.takenAt === "string") &&
    (log.status === "taken" ? log.takenAt !== null : log.takenAt === null) &&
    typeof log.createdAt === "string" &&
    typeof log.updatedAt === "string" &&
    Number.isInteger(log.version) &&
    log.version >= 1
  );
}

export function putSupplementLogOp(log: SupplementLog): DbTransactionOp {
  const normalized = normalizedLog(log);
  return {
    op: "putSupplementLog",
    params: {
      id: normalized.id,
      supplement_id: normalized.supplementId,
      status: normalized.status ?? "pending",
      scheduled_at: normalized.scheduledAt ?? "",
      dose_amount: normalized.doseAmount ?? "",
      dose_unit: normalized.doseUnit ?? "",
      taken_at: normalized.takenAt ?? "",
      created_at: normalized.createdAt,
      updated_at: normalized.updatedAt,
      version: normalized.version,
    },
  };
}

async function migrateLegacySupplementLogs(): Promise<DataResult<true>> {
  const supplementsResult = await createSqliteSupplementStore().list();
  if (!supplementsResult.ok) {
    return supplementsResult;
  }
  const supplementIds = new Set(supplementsResult.value.map((supplement) => supplement.id));

  const legacyResult = await createSqliteEntityDocStore<SupplementLog>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const logs = legacyResult.value.map(normalizedLog);
  const scheduledKeys = new Set<string>();
  for (const log of logs) {
    const scheduledKey =
      typeof log.scheduledAt !== "string" ? null : `${log.supplementId}\u0000${log.scheduledAt}`;
    if (
      !validSupplementLog(log) ||
      !supplementIds.has(log.supplementId) ||
      (scheduledKey !== null && scheduledKeys.has(scheduledKey))
    ) {
      return corruptedSupplementLog();
    }
    if (scheduledKey !== null) {
      scheduledKeys.add(scheduledKey);
    }
  }

  for (let offset = 0; offset < logs.length; offset += LEGACY_BATCH_SIZE) {
    const batch = logs.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const log of batch) {
      ops.push(putSupplementLogOp(log));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: log.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseSupplementLogs(rows: readonly unknown[]): DataResult<readonly SupplementLog[]> {
  const logs: SupplementLog[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedSupplementLog();
    }
    const row = value as RelationalSupplementLogRow;
    if (
      typeof row.id !== "string" ||
      typeof row.supplement_id !== "string" ||
      typeof row.status !== "string" ||
      (row.scheduled_at !== null && typeof row.scheduled_at !== "string") ||
      (row.dose_amount !== null && typeof row.dose_amount !== "number") ||
      (row.dose_unit !== null && typeof row.dose_unit !== "string") ||
      (row.taken_at !== null && typeof row.taken_at !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedSupplementLog();
    }
    const log: SupplementLog = {
      id: row.id,
      supplementId: row.supplement_id,
      status: row.status as SupplementLogStatus,
      scheduledAt: row.scheduled_at,
      doseAmount: row.dose_amount,
      doseUnit: row.dose_unit,
      takenAt: row.taken_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validSupplementLog(log)) {
      return corruptedSupplementLog();
    }
    logs.push(log);
  }
  return { ok: true, value: logs };
}

export function createSqliteSupplementLogStore(): EntityStore<SupplementLog> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacySupplementLogs();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<SupplementLog> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly SupplementLog[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "listSupplementLogs", params: {} });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseSupplementLogs(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<SupplementLog>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "getSupplementLog",
        params: { id },
      });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as SupplementLog);
      }
      const parsed = parseSupplementLogs(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const log = parsed.value[0];
      return log === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: log };
    },
    async save(log: SupplementLog): Promise<DataResult<SupplementLog>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const normalized = normalizedLog(log);
      if (!validSupplementLog(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.supplement-log.invalid",
            "Lisäravinnekirjausta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putSupplementLogOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      log: SupplementLog,
      context: SyncWriteContext,
    ): Promise<DataResult<SupplementLog>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizedLog(log);
      if (!validSupplementLog(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.supplement-log.invalid",
            "Lisäravinnekirjausta ei voi tallentaa näillä tiedoilla.",
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
        writes: [putSupplementLogOp(normalized)],
      });
      return committed.ok ? { ok: true, value: normalized } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteSupplementLog",
        params: { id },
      });
      return toDataResult(response, () => true);
    },
  };
  return store;
}
