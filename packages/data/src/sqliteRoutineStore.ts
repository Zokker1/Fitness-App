import type { EntityId, Routine } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "routine";
const LEGACY_BATCH_SIZE = 32;

interface RoutineRow {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly archived_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedRoutine(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua rutiinia ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.routine.invalid",
    },
  };
}

export function validRoutine(routine: Routine): boolean {
  return (
    typeof routine.id === "string" &&
    routine.id.length > 0 &&
    typeof routine.title === "string" &&
    routine.title.trim().length > 0 &&
    routine.title.length <= 200 &&
    (routine.archivedAt === null || typeof routine.archivedAt === "string") &&
    typeof routine.createdAt === "string" &&
    routine.createdAt.length > 0 &&
    typeof routine.updatedAt === "string" &&
    routine.updatedAt.length > 0 &&
    Number.isInteger(routine.version) &&
    routine.version >= 1 &&
    (routine.deletedAt === null || typeof routine.deletedAt === "string")
  );
}

function normalizeLegacyRoutine(value: Routine): Routine {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    archivedAt: raw.archivedAt === undefined ? null : (raw.archivedAt as Routine["archivedAt"]),
    deletedAt: raw.deletedAt === undefined ? null : (raw.deletedAt as Routine["deletedAt"]),
  };
}

export function putRoutineOp(routine: Routine): DbTransactionOp {
  return {
    op: "putRoutine",
    params: {
      id: routine.id,
      title: routine.title,
      archived_at: routine.archivedAt ?? "",
      archived_at_is_null: routine.archivedAt === null,
      created_at: routine.createdAt,
      updated_at: routine.updatedAt,
      version: routine.version,
      deleted_at: routine.deletedAt ?? "",
      deleted_at_is_null: routine.deletedAt === null,
    },
  };
}

function parseRoutines(rows: readonly unknown[]): DataResult<readonly Routine[]> {
  const routines: Routine[] = [];
  const ids = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedRoutine();
    }
    const row = value as RoutineRow;
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      typeof row.title !== "string" ||
      (row.archived_at !== null && typeof row.archived_at !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedRoutine();
    }
    const routine: Routine = {
      id: row.id,
      title: row.title,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validRoutine(routine)) return corruptedRoutine();
    ids.add(routine.id);
    routines.push(routine);
  }
  return { ok: true, value: routines };
}

async function readRoutines(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly Routine[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseRoutines(response.rows);
}

async function migrateLegacyRoutines(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<Routine>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const routines = legacyResult.value.map(normalizeLegacyRoutine);
  const legacyIds = new Set<string>();
  for (const routine of routines) {
    if (!validRoutine(routine) || legacyIds.has(routine.id)) return corruptedRoutine();
    legacyIds.add(routine.id);
  }

  const currentResult = await readRoutines({ kind: "query", op: "listRoutines", params: {} });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((routine) => routine.id));
  if (routines.some((routine) => currentIds.has(routine.id))) return corruptedRoutine();

  for (let offset = 0; offset < routines.length; offset += LEGACY_BATCH_SIZE) {
    const batch = routines.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const routine of batch) {
      ops.push(putRoutineOp(routine));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: routine.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteRoutineStore(): EntityStore<Routine> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyRoutines();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Routine> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Routine[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readRoutines({ kind: "query", op: "listRoutines", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<Routine>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readRoutines({ kind: "query", op: "getRoutine", params: { id } });
      if (!result.ok) return result;
      const routine = result.value[0];
      return routine === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: routine };
    },
    async save(value: Routine): Promise<DataResult<Routine>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const routine = normalizeLegacyRoutine(value);
      if (!validRoutine(routine)) {
        return {
          ok: false,
          error: invalidInput("data.routine.invalid", "Rutiinin tiedot eivät kelpaa."),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putRoutineOp(routine)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: routine } : result;
    },
    async saveWithSyncOperation(
      value: Routine,
      context: SyncWriteContext,
    ): Promise<DataResult<Routine>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const routine = normalizeLegacyRoutine(value);
      if (!validRoutine(routine)) {
        return {
          ok: false,
          error: invalidInput("data.routine.invalid", "Rutiinin tiedot eivät kelpaa."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: routine.id,
        operation: context.operation,
        entityVersion: routine.version,
        occurredAt: context.occurredAt,
        createdAt: routine.createdAt,
        entity: routine as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putRoutineOp(routine)],
      });
      return committed.ok ? { ok: true, value: routine } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const now = new Date().toISOString();
      const saved = await store.save({ ...existing.value, deletedAt: now, updatedAt: now });
      return saved.ok ? { ok: true, value: true } : saved;
    },
  };
  return store;
}
