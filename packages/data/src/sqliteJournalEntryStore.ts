import type { EntityId, JournalEntry } from "@lifeos/domain";
import { JOURNAL_REFLECTION_FIELD_MAX_LENGTH } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "journal";
const LEGACY_BATCH_SIZE = 32;

interface JournalEntryRow {
  readonly id?: unknown;
  readonly written_at?: unknown;
  readonly title?: unknown;
  readonly body?: unknown;
  readonly reflection_success?: unknown;
  readonly reflection_difficult?: unknown;
  readonly reflection_tomorrow?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedJournalEntry(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua päiväkirjamerkintää ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.journal-entry.invalid",
    },
  };
}

function normalizeJournalEntry(entry: JournalEntry): JournalEntry {
  return {
    ...entry,
    reflectionSuccess: entry.reflectionSuccess ?? null,
    reflectionDifficult: entry.reflectionDifficult ?? null,
    reflectionTomorrow: entry.reflectionTomorrow ?? null,
    deletedAt: entry.deletedAt ?? null,
  };
}

function isOptionalText(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function validJournalEntry(entry: JournalEntry): boolean {
  const reflectionValues: readonly unknown[] = [
    entry.reflectionSuccess,
    entry.reflectionDifficult,
    entry.reflectionTomorrow,
  ];
  const hasReflection = reflectionValues.some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.writtenAt === "string" &&
    (entry.title === null || typeof entry.title === "string") &&
    typeof entry.body === "string" &&
    (entry.body.trim().length > 0 || hasReflection) &&
    isOptionalText(entry.reflectionSuccess) &&
    (entry.reflectionSuccess === null ||
      entry.reflectionSuccess.length <= JOURNAL_REFLECTION_FIELD_MAX_LENGTH) &&
    isOptionalText(entry.reflectionDifficult) &&
    (entry.reflectionDifficult === null ||
      entry.reflectionDifficult.length <= JOURNAL_REFLECTION_FIELD_MAX_LENGTH) &&
    isOptionalText(entry.reflectionTomorrow) &&
    (entry.reflectionTomorrow === null ||
      entry.reflectionTomorrow.length <= JOURNAL_REFLECTION_FIELD_MAX_LENGTH) &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    Number.isInteger(entry.version) &&
    entry.version >= 1 &&
    (entry.deletedAt === null || typeof entry.deletedAt === "string")
  );
}

export function putJournalEntryOp(entry: JournalEntry): DbTransactionOp {
  return {
    op: "putJournalEntry",
    params: {
      id: entry.id,
      written_at: entry.writtenAt,
      title: entry.title ?? "",
      title_is_null: entry.title === null,
      body: entry.body,
      reflection_success: entry.reflectionSuccess ?? "",
      reflection_difficult: entry.reflectionDifficult ?? "",
      reflection_tomorrow: entry.reflectionTomorrow ?? "",
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      version: entry.version,
      deleted_at: entry.deletedAt ?? "",
    },
  };
}

async function migrateLegacyJournalEntries(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<JournalEntry>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const entries = legacyResult.value.map(normalizeJournalEntry);
  if (entries.some((entry) => !validJournalEntry(entry))) {
    return corruptedJournalEntry();
  }

  for (let offset = 0; offset < entries.length; offset += LEGACY_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const entry of batch) {
      ops.push(putJournalEntryOp(entry));
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

function parseJournalEntries(rows: readonly unknown[]): DataResult<readonly JournalEntry[]> {
  const entries: JournalEntry[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedJournalEntry();
    }
    const row = value as JournalEntryRow;
    const reflectionSuccess = row.reflection_success;
    const reflectionDifficult = row.reflection_difficult;
    const reflectionTomorrow = row.reflection_tomorrow;
    if (
      typeof row.id !== "string" ||
      typeof row.written_at !== "string" ||
      (row.title !== null && typeof row.title !== "string") ||
      typeof row.body !== "string" ||
      !isOptionalText(reflectionSuccess) ||
      !isOptionalText(reflectionDifficult) ||
      !isOptionalText(reflectionTomorrow) ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedJournalEntry();
    }
    const entry: JournalEntry = {
      id: row.id,
      writtenAt: row.written_at,
      title: row.title,
      body: row.body,
      reflectionSuccess,
      reflectionDifficult,
      reflectionTomorrow,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validJournalEntry(entry)) {
      return corruptedJournalEntry();
    }
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

export function createSqliteJournalEntryStore(): EntityStore<JournalEntry> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyJournalEntries();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<JournalEntry> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly JournalEntry[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listJournalEntries", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseJournalEntries(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<JournalEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getJournalEntry",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as JournalEntry);
      const parsed = parseJournalEntries(response.rows);
      if (!parsed.ok) return parsed;
      const entry = parsed.value[0];
      return entry === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: entry };
    },
    async save(entry: JournalEntry): Promise<DataResult<JournalEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeJournalEntry(entry);
      if (!validJournalEntry(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.journal-entry.invalid",
            "Päiväkirjamerkinnässä pitää olla sisältöä ja kelvolliset metatiedot.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putJournalEntryOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      entry: JournalEntry,
      context: SyncWriteContext,
    ): Promise<DataResult<JournalEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeJournalEntry(entry);
      if (!validJournalEntry(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.journal-entry.invalid",
            "Päiväkirjamerkinnässä pitää olla sisältöä ja kelvolliset metatiedot.",
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
        writes: [putJournalEntryOp(normalized)],
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
