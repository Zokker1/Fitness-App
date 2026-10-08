import type { EntityId, SleepEntry } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "sleep-entry";
const LEGACY_BATCH_SIZE = 32;

interface SleepRow {
  readonly id?: unknown;
  readonly sleep_start?: unknown;
  readonly sleep_end?: unknown;
  readonly quality?: unknown;
  readonly is_nap?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedSleepEntry(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua unitietoa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.sleep-entry.invalid",
    },
  };
}

function normalizeSleepEntry(entry: SleepEntry): SleepEntry {
  return { ...entry, isNap: entry.isNap ?? false, deletedAt: entry.deletedAt ?? null };
}

export function validSleepEntry(entry: SleepEntry): boolean {
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.sleepStart === "string" &&
    typeof entry.sleepEnd === "string" &&
    entry.sleepEnd >= entry.sleepStart &&
    typeof entry.isNap === "boolean" &&
    (entry.quality === null ||
      (typeof entry.quality === "number" && Number.isInteger(entry.quality))) &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    Number.isInteger(entry.version) &&
    entry.version >= 1 &&
    (entry.deletedAt === null || typeof entry.deletedAt === "string")
  );
}

export function putSleepEntryOp(entry: SleepEntry): DbTransactionOp {
  return {
    op: "putSleepEntry",
    params: {
      id: entry.id,
      sleep_start: entry.sleepStart,
      sleep_end: entry.sleepEnd,
      quality: entry.quality ?? "",
      is_nap: entry.isNap === true ? 1 : 0,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      version: entry.version,
      deleted_at: entry.deletedAt ?? "",
    },
  };
}

async function migrateLegacySleepEntries(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<SleepEntry>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const entries = legacyResult.value.map(normalizeSleepEntry);
  if (entries.some((entry) => !validSleepEntry(entry))) {
    return corruptedSleepEntry();
  }

  for (let offset = 0; offset < entries.length; offset += LEGACY_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const entry of batch) {
      ops.push(putSleepEntryOp(entry));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: entry.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseSleepEntries(rows: readonly unknown[]): DataResult<readonly SleepEntry[]> {
  const entries: SleepEntry[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedSleepEntry();
    }
    const row = value as SleepRow;
    if (
      typeof row.id !== "string" ||
      typeof row.sleep_start !== "string" ||
      typeof row.sleep_end !== "string" ||
      (row.is_nap !== undefined && row.is_nap !== 0 && row.is_nap !== 1) ||
      (row.quality !== null && typeof row.quality !== "number") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedSleepEntry();
    }
    const entry: SleepEntry = {
      id: row.id,
      sleepStart: row.sleep_start,
      sleepEnd: row.sleep_end,
      quality: row.quality,
      isNap: row.is_nap === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validSleepEntry(entry)) {
      return corruptedSleepEntry();
    }
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

export function createSqliteSleepEntryStore(): EntityStore<SleepEntry> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacySleepEntries();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<SleepEntry> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly SleepEntry[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listSleepEntries", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseSleepEntries(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<SleepEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getSleepEntry", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as SleepEntry);
      const parsed = parseSleepEntries(response.rows);
      if (!parsed.ok) return parsed;
      const entry = parsed.value[0];
      return entry === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: entry };
    },
    async save(entry: SleepEntry): Promise<DataResult<SleepEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeSleepEntry(entry);
      if (!validSleepEntry(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.sleep-entry.invalid",
            "Unitietoa ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putSleepEntryOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      entry: SleepEntry,
      context: SyncWriteContext,
    ): Promise<DataResult<SleepEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeSleepEntry(entry);
      if (!validSleepEntry(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.sleep-entry.invalid",
            "Unitietoa ei voi tallentaa näillä tiedoilla.",
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
        writes: [putSleepEntryOp(normalized)],
      });
      return committed.ok ? { ok: true, value: normalized } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
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
