import type { EntityId, RoutineRun } from "@lifeos/domain";
import { isValidLocalDateKey } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteRoutineStore } from "./sqliteRoutineStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "routine-run";
const LEGACY_BATCH_SIZE = 32;

function isRoutineRunStatus(value: unknown): value is RoutineRun["status"] {
  return (
    value === "running" || value === "completed" || value === "skipped" || value === "cancelled"
  );
}

function isRoutineRunDayMode(value: unknown): value is NonNullable<RoutineRun["dayMode"]> {
  return value === "full" || value === "minimum";
}

interface RoutineRunRow {
  readonly id?: unknown;
  readonly routine_id?: unknown;
  readonly local_date?: unknown;
  readonly status?: unknown;
  readonly day_mode?: unknown;
  readonly started_at?: unknown;
  readonly completed_at?: unknown;
  readonly skip_reason?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedRoutineRun(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua rutiinisuoritusta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.routine-run.invalid",
    },
  };
}

export function validRoutineRun(run: RoutineRun): boolean {
  return (
    typeof run.id === "string" &&
    run.id.length > 0 &&
    typeof run.routineId === "string" &&
    run.routineId.length > 0 &&
    isValidLocalDateKey(run.localDate) &&
    isRoutineRunStatus(run.status) &&
    (run.dayMode === undefined || isRoutineRunDayMode(run.dayMode)) &&
    typeof run.startedAt === "string" &&
    run.startedAt.length > 0 &&
    (run.completedAt === null ||
      (typeof run.completedAt === "string" && run.completedAt.length > 0)) &&
    (run.skipReason === null || typeof run.skipReason === "string") &&
    typeof run.createdAt === "string" &&
    run.createdAt.length > 0 &&
    typeof run.updatedAt === "string" &&
    run.updatedAt.length > 0 &&
    Number.isInteger(run.version) &&
    run.version >= 1
  );
}

function parseRoutineRun(row: unknown): RoutineRun | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const value = row as RoutineRunRow;
  if (
    typeof value.id !== "string" ||
    typeof value.routine_id !== "string" ||
    typeof value.local_date !== "string" ||
    typeof value.status !== "string" ||
    (value.day_mode !== null && value.day_mode !== "full" && value.day_mode !== "minimum") ||
    typeof value.started_at !== "string" ||
    (value.completed_at !== null && typeof value.completed_at !== "string") ||
    (value.skip_reason !== null && typeof value.skip_reason !== "string") ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.version !== "number"
  ) {
    return null;
  }
  const run: RoutineRun = {
    id: value.id,
    routineId: value.routine_id,
    localDate: value.local_date,
    status: value.status as RoutineRun["status"],
    ...(value.day_mode === null ? {} : { dayMode: value.day_mode }),
    startedAt: value.started_at,
    completedAt: value.completed_at,
    skipReason: value.skip_reason,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
  };
  return validRoutineRun(run) ? run : null;
}

function parseRoutineRuns(rows: readonly unknown[]): DataResult<readonly RoutineRun[]> {
  const runs: RoutineRun[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const run = parseRoutineRun(row);
    if (run === null || ids.has(run.id)) return corruptedRoutineRun();
    ids.add(run.id);
    runs.push(run);
  }
  return { ok: true, value: runs };
}

export function putRoutineRunOp(run: RoutineRun): DbTransactionOp {
  return {
    op: "putRoutineRun",
    params: {
      id: run.id,
      routine_id: run.routineId,
      local_date: run.localDate,
      status: run.status,
      day_mode: run.dayMode ?? "",
      day_mode_is_null: run.dayMode === undefined,
      started_at: run.startedAt,
      completed_at: run.completedAt ?? "",
      completed_at_is_null: run.completedAt === null,
      skip_reason: run.skipReason ?? "",
      skip_reason_is_null: run.skipReason === null,
      created_at: run.createdAt,
      updated_at: run.updatedAt,
      version: run.version,
    },
  };
}

async function readRoutineRuns(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly RoutineRun[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseRoutineRuns(response.rows);
}

function duplicateActiveDay(
  existing: readonly RoutineRun[],
  incoming: readonly RoutineRun[],
): boolean {
  const keys = new Set<string>();
  for (const run of [...existing, ...incoming]) {
    if (run.status === "cancelled") continue;
    const key = `${run.routineId}\u0000${run.localDate}`;
    if (keys.has(key)) return true;
    keys.add(key);
  }
  return false;
}

async function migrateLegacyRoutineRuns(): Promise<DataResult<true>> {
  const routinesResult = await createSqliteRoutineStore().list();
  if (!routinesResult.ok) return routinesResult;
  const routineIds = new Set(routinesResult.value.map((routine) => routine.id));

  const legacyResult = await createSqliteEntityDocStore<RoutineRun>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const runs = legacyResult.value;
  const legacyIds = new Set<string>();
  for (const run of runs) {
    if (!validRoutineRun(run) || legacyIds.has(run.id) || !routineIds.has(run.routineId)) {
      return corruptedRoutineRun();
    }
    legacyIds.add(run.id);
  }

  const currentResult = await readRoutineRuns({
    kind: "query",
    op: "listRoutineRuns",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((run) => run.id));
  if (runs.some((run) => currentIds.has(run.id)) || duplicateActiveDay(currentResult.value, runs)) {
    return corruptedRoutineRun();
  }

  for (let offset = 0; offset < runs.length; offset += LEGACY_BATCH_SIZE) {
    const batch = runs.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const run of batch) {
      ops.push(putRoutineRunOp(run));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: run.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteRoutineRunStore(): EntityStore<RoutineRun> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyRoutineRuns();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<RoutineRun> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly RoutineRun[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readRoutineRuns({ kind: "query", op: "listRoutineRuns", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<RoutineRun>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readRoutineRuns({
        kind: "query",
        op: "getRoutineRun",
        params: { id },
      });
      if (!result.ok) return result;
      const run = result.value[0];
      return run === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: run };
    },
    async save(value: RoutineRun): Promise<DataResult<RoutineRun>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validRoutineRun(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.routine-run.invalid",
            "Rutiinisuorituksen tiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putRoutineRunOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async saveWithSyncOperation(
      value: RoutineRun,
      context: SyncWriteContext,
    ): Promise<DataResult<RoutineRun>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validRoutineRun(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.routine-run.invalid",
            "Rutiinisuorituksen tiedot eivät kelpaa.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: value.id,
        operation: context.operation,
        entityVersion: value.version,
        occurredAt: context.occurredAt,
        createdAt: value.createdAt,
        entity: value as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putRoutineRunOp(value)],
      });
      return committed.ok ? { ok: true, value } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteRoutineRun",
        params: { id },
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
