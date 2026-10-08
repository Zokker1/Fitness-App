import type { EntityId, HydrationEntry } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { listEntityDocs } from "./sqliteEntityClient.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "hydration-entry";
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
      userMessage: "Tallennettua nestekirjausta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.hydration-entry.doc.invalid",
    },
  };
}

function parseLegacyRow(value: unknown): HydrationEntry | null {
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
    const doc = parsed as Record<string, unknown>;
    if (
      typeof doc.id !== "string" ||
      typeof doc.createdAt !== "string" ||
      typeof doc.updatedAt !== "string" ||
      typeof doc.version !== "number" ||
      !Number.isInteger(doc.version) ||
      doc.version < 1 ||
      typeof doc.drunkAt !== "string" ||
      typeof doc.milliliters !== "number" ||
      !Number.isInteger(doc.milliliters) ||
      doc.milliliters < 0 ||
      row.id !== doc.id ||
      row.created_at !== doc.createdAt ||
      row.updated_at !== doc.updatedAt
    ) {
      return null;
    }
    return doc as unknown as HydrationEntry;
  } catch {
    return null;
  }
}

function parseRelationalRow(value: unknown): HydrationEntry | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.drunk_at !== "string" ||
    typeof row.milliliters !== "number" ||
    !Number.isInteger(row.milliliters) ||
    row.milliliters < 0 ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.version !== "number" ||
    !Number.isInteger(row.version) ||
    row.version < 1
  ) {
    return null;
  }
  return {
    id: row.id,
    drunkAt: row.drunk_at,
    milliliters: row.milliliters,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

export function putEntryOp(entry: HydrationEntry): DbTransactionOp {
  return {
    op: "putHydrationEntry",
    params: {
      id: entry.id,
      drunk_at: entry.drunkAt,
      milliliters: entry.milliliters,
      created_at: entry.createdAt,
      updated_at: entry.updatedAt,
      version: entry.version,
    },
  };
}

async function migrateLegacyEntries(): Promise<DataResult<true>> {
  const legacyResult = await listEntityDocs(ENTITY_TYPE);
  if (!legacyResult.ok) {
    return legacyResult;
  }

  const entries: HydrationEntry[] = [];
  for (const row of legacyResult.value) {
    const entry = parseLegacyRow(row);
    if (entry === null) {
      return corruptedData();
    }
    entries.push(entry);
  }

  for (let offset = 0; offset < entries.length; offset += LEGACY_BATCH_SIZE) {
    const batch = entries.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const entry of batch) {
      ops.push(putEntryOp(entry));
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

function parseQueryRows(rows: readonly unknown[]): DataResult<readonly HydrationEntry[]> {
  const entries: HydrationEntry[] = [];
  for (const row of rows) {
    const entry = parseRelationalRow(row);
    if (entry === null) {
      return corruptedData();
    }
    entries.push(entry);
  }
  return { ok: true, value: entries };
}

export function validEntity(entry: HydrationEntry): boolean {
  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.drunkAt === "string" &&
    Number.isInteger(entry.milliliters) &&
    entry.milliliters >= 0 &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string" &&
    Number.isInteger(entry.version) &&
    entry.version >= 1
  );
}

export function createSqliteHydrationEntryStore(): EntityStore<HydrationEntry> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyEntries();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<HydrationEntry> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly HydrationEntry[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "listHydrationEntries",
        params: {},
      });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseQueryRows(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<HydrationEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "getHydrationEntry",
        params: { id },
      });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as HydrationEntry);
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
    async save(entry: HydrationEntry): Promise<DataResult<HydrationEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validEntity(entry)) {
        return {
          ok: false,
          error: invalidInput(
            "data.hydration-entry.invalid",
            "Nestekirjaus ei ole tallennettavassa muodossa.",
          ),
        };
      }
      const response = await sendDbRequest({ kind: "exec", ...putEntryOp(entry) });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: entry } : result;
    },
    async saveWithSyncOperation(
      entry: HydrationEntry,
      context: SyncWriteContext,
    ): Promise<DataResult<HydrationEntry>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validEntity(entry)) {
        return {
          ok: false,
          error: invalidInput(
            "data.hydration-entry.invalid",
            "Nestekirjaus ei ole tallennettavassa muodossa.",
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
        writes: [putEntryOp(entry)],
      });
      return committed.ok ? { ok: true, value: entry } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteHydrationEntry",
        params: { id },
      });
      return toDataResult(response, () => true);
    },
  };
  return store;
}
