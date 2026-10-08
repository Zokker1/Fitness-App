import type { ActivityEntry, EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "activity-entry";
const LEGACY_BATCH_SIZE = 32;

interface ActivityEntryRow {
  readonly id?: unknown;
  readonly activity_at?: unknown;
  readonly kind?: unknown;
  readonly duration_seconds?: unknown;
  readonly distance_meters?: unknown;
  readonly note?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedActivityEntry(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua aktiivisuusmerkintää ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.activity-entry.invalid",
    },
  };
}

function normalizeActivityEntry(entry: ActivityEntry): ActivityEntry {
  return { ...entry, deletedAt: entry.deletedAt ?? null };
}

export function validActivityEntry(entry: ActivityEntry): boolean {
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.activityAt === "string" &&
    typeof entry.kind === "string" &&
    entry.kind.trim().length > 0 &&
    entry.kind.length <= 60 &&
    (entry.durationSeconds === null ||
      (Number.isInteger(entry.durationSeconds) && entry.durationSeconds >= 0)) &&
    (entry.distanceMeters === null ||
      (typeof entry.distanceMeters === "number" &&
        Number.isFinite(entry.distanceMeters) &&
        entry.distanceMeters >= 0)) &&
    (entry.note === undefined ||
      entry.note === null ||
      (typeof entry.note === "string" && entry.note.length <= 500)) &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    Number.isInteger(entry.version) &&
    entry.version >= 1 &&
    (entry.deletedAt === null || typeof entry.deletedAt === "string")
  );
}

export function putActivityEntryOp(entry: ActivityEntry): DbTransactionOp {
  return {
    op: "putActivityEntry",
    params: {
      id: entry.id,
      activity_at: entry.activityAt,
      kind: entry.kind,
      duration_seconds: entry.durationSeconds ?? "",
      distance_meters: entry.distanceMeters ?? "",
      note: entry.note ?? "",
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      version: entry.version,
      deleted_at: entry.deletedAt ?? "",
    },
  };
}

async function migrateLegacyActivityEntries(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<ActivityEntry>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const entries = legacyResult.value.map(normalizeActivityEntry);
  if (entries.some((entry) => !validActivityEntry(entry))) {
    return corruptedActivityEntry();
  }

  for (let offset = 0; offset < entries.length; offset += LEGACY_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const entry of batch) {
      ops.push(putActivityEntryOp(entry));
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

function parseActivityEntries(rows: readonly unknown[]): DataResult<readonly ActivityEntry[]> {
  const entries: ActivityEntry[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedActivityEntry();
    }
    const row = value as ActivityEntryRow;
    if (
      typeof row.id !== "string" ||
      typeof row.activity_at !== "string" ||
      typeof row.kind !== "string" ||
      (row.duration_seconds !== null && typeof row.duration_seconds !== "number") ||
      (row.distance_meters !== null && typeof row.distance_meters !== "number") ||
      (row.note !== undefined && row.note !== null && typeof row.note !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedActivityEntry();
    }
    const entry: ActivityEntry = {
      id: row.id,
      activityAt: row.activity_at,
      kind: row.kind,
      durationSeconds: row.duration_seconds,
      distanceMeters: row.distance_meters,
      note:
        row.note === undefined
          ? undefined
          : typeof row.note === "string" && row.note.length > 0
            ? row.note
            : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validActivityEntry(entry)) {
      return corruptedActivityEntry();
    }
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

export function createSqliteActivityEntryStore(): EntityStore<ActivityEntry> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyActivityEntries();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<ActivityEntry> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly ActivityEntry[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "listActivityEntries",
        params: {},
      });
      if (!response.ok) return toDataResult(response, () => []);
      return parseActivityEntries(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<ActivityEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getActivityEntry",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as ActivityEntry);
      const parsed = parseActivityEntries(response.rows);
      if (!parsed.ok) return parsed;
      const entry = parsed.value[0];
      return entry === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: entry };
    },
    async save(entry: ActivityEntry): Promise<DataResult<ActivityEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeActivityEntry(entry);
      if (!validActivityEntry(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.activity-entry.invalid",
            "Aktiivisuusmerkintää ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putActivityEntryOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      entry: ActivityEntry,
      context: SyncWriteContext,
    ): Promise<DataResult<ActivityEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeActivityEntry(entry);
      if (!validActivityEntry(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.activity-entry.invalid",
            "Aktiivisuusmerkintää ei voi tallentaa näillä tiedoilla.",
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
        writes: [putActivityEntryOp(normalized)],
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
