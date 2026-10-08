import type { EntityId, RoutineStepRun } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteRoutineRunStore } from "./sqliteRoutineRunStore.ts";
import { createSqliteRoutineStepStore } from "./sqliteRoutineStepStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "routine-step-run";
const LEGACY_BATCH_SIZE = 32;

function isRoutineStepRunStatus(value: unknown): value is RoutineStepRun["status"] {
  return value === "pending" || value === "completed" || value === "skipped";
}

interface RoutineStepRunRow {
  readonly id?: unknown;
  readonly routine_run_id?: unknown;
  readonly routine_step_id?: unknown;
  readonly status?: unknown;
  readonly completed_at?: unknown;
  readonly skip_reason?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedRoutineStepRun(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua rutiinin askelkirjausta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.routine-step-run.invalid",
    },
  };
}

export function validRoutineStepRun(value: RoutineStepRun): boolean {
  const status: unknown = value.status;
  const baseValid =
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.routineRunId === "string" &&
    value.routineRunId.length > 0 &&
    typeof value.routineStepId === "string" &&
    value.routineStepId.length > 0 &&
    (value.completedAt === null ||
      (typeof value.completedAt === "string" && value.completedAt.length > 0)) &&
    (value.skipReason === null || typeof value.skipReason === "string") &&
    typeof value.createdAt === "string" &&
    value.createdAt.length > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.length > 0 &&
    Number.isInteger(value.version) &&
    value.version >= 1;
  if (!baseValid) return false;
  if (!isRoutineStepRunStatus(status)) return false;
  if (status === "pending") {
    return value.completedAt === null && value.skipReason === null;
  }
  if (status === "completed") {
    return value.completedAt !== null && value.skipReason === null;
  }
  return (
    value.completedAt !== null &&
    typeof value.skipReason === "string" &&
    value.skipReason.trim().length > 0
  );
}

function parseRoutineStepRun(row: unknown): RoutineStepRun | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const value = row as RoutineStepRunRow;
  if (
    typeof value.id !== "string" ||
    typeof value.routine_run_id !== "string" ||
    typeof value.routine_step_id !== "string" ||
    (value.status !== "pending" && value.status !== "completed" && value.status !== "skipped") ||
    (value.completed_at !== null && typeof value.completed_at !== "string") ||
    (value.skip_reason !== null && typeof value.skip_reason !== "string") ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.version !== "number"
  ) {
    return null;
  }
  const stepRun: RoutineStepRun = {
    id: value.id,
    routineRunId: value.routine_run_id,
    routineStepId: value.routine_step_id,
    status: value.status,
    completedAt: value.completed_at,
    skipReason: value.skip_reason,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
  };
  return validRoutineStepRun(stepRun) ? stepRun : null;
}

function parseRoutineStepRuns(rows: readonly unknown[]): DataResult<readonly RoutineStepRun[]> {
  const stepRuns: RoutineStepRun[] = [];
  const ids = new Set<string>();
  const pairs = new Set<string>();
  for (const row of rows) {
    const stepRun = parseRoutineStepRun(row);
    if (stepRun === null || ids.has(stepRun.id)) return corruptedRoutineStepRun();
    const pair = `${stepRun.routineRunId}\u0000${stepRun.routineStepId}`;
    if (pairs.has(pair)) return corruptedRoutineStepRun();
    ids.add(stepRun.id);
    pairs.add(pair);
    stepRuns.push(stepRun);
  }
  return { ok: true, value: stepRuns };
}

export function putRoutineStepRunOp(stepRun: RoutineStepRun): DbTransactionOp {
  return {
    op: "putRoutineStepRun",
    params: {
      id: stepRun.id,
      routine_run_id: stepRun.routineRunId,
      routine_step_id: stepRun.routineStepId,
      status: stepRun.status,
      completed_at: stepRun.completedAt ?? "",
      completed_at_is_null: stepRun.completedAt === null,
      skip_reason: stepRun.skipReason ?? "",
      skip_reason_is_null: stepRun.skipReason === null,
      created_at: stepRun.createdAt,
      updated_at: stepRun.updatedAt,
      version: stepRun.version,
    },
  };
}

async function readRoutineStepRuns(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly RoutineStepRun[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseRoutineStepRuns(response.rows);
}

function hasDuplicateParentPair(
  existing: readonly RoutineStepRun[],
  incoming: readonly RoutineStepRun[],
): boolean {
  const pairs = new Set<string>();
  for (const stepRun of [...existing, ...incoming]) {
    const pair = `${stepRun.routineRunId}\u0000${stepRun.routineStepId}`;
    if (pairs.has(pair)) return true;
    pairs.add(pair);
  }
  return false;
}

async function migrateLegacyRoutineStepRuns(): Promise<DataResult<true>> {
  const runsResult = await createSqliteRoutineRunStore().list();
  if (!runsResult.ok) return runsResult;
  const stepsResult = await createSqliteRoutineStepStore().list();
  if (!stepsResult.ok) return stepsResult;
  const runRoutines = new Map(runsResult.value.map((run) => [run.id, run.routineId]));
  const stepRoutines = new Map(stepsResult.value.map((step) => [step.id, step.routineId]));

  const legacyResult = await createSqliteEntityDocStore<RoutineStepRun>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const stepRuns = legacyResult.value;
  const legacyIds = new Set<string>();
  for (const stepRun of stepRuns) {
    const runRoutineId = runRoutines.get(stepRun.routineRunId);
    const stepRoutineId = stepRoutines.get(stepRun.routineStepId);
    if (
      !validRoutineStepRun(stepRun) ||
      legacyIds.has(stepRun.id) ||
      runRoutineId === undefined ||
      stepRoutineId === undefined ||
      runRoutineId !== stepRoutineId
    ) {
      return corruptedRoutineStepRun();
    }
    legacyIds.add(stepRun.id);
  }

  const currentResult = await readRoutineStepRuns({
    kind: "query",
    op: "listRoutineStepRuns",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((stepRun) => stepRun.id));
  if (
    stepRuns.some((stepRun) => currentIds.has(stepRun.id)) ||
    hasDuplicateParentPair(currentResult.value, stepRuns)
  ) {
    return corruptedRoutineStepRun();
  }

  for (let offset = 0; offset < stepRuns.length; offset += LEGACY_BATCH_SIZE) {
    const batch = stepRuns.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const stepRun of batch) {
      ops.push(putRoutineStepRunOp(stepRun));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: stepRun.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteRoutineStepRunStore(): EntityStore<RoutineStepRun> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyRoutineStepRuns();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<RoutineStepRun> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly RoutineStepRun[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readRoutineStepRuns({ kind: "query", op: "listRoutineStepRuns", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<RoutineStepRun>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readRoutineStepRuns({
        kind: "query",
        op: "getRoutineStepRun",
        params: { id },
      });
      if (!result.ok) return result;
      const stepRun = result.value[0];
      return stepRun === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: stepRun };
    },
    async save(value: RoutineStepRun): Promise<DataResult<RoutineStepRun>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validRoutineStepRun(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.routine-step-run.invalid",
            "Rutiinin askelkirjauksen tiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putRoutineStepRunOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async saveWithSyncOperation(
      value: RoutineStepRun,
      context: SyncWriteContext,
    ): Promise<DataResult<RoutineStepRun>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validRoutineStepRun(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.routine-step-run.invalid",
            "Rutiinin askelkirjauksen tiedot eivät kelpaa.",
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
        writes: [putRoutineStepRunOp(value)],
      });
      return committed.ok ? { ok: true, value } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteRoutineStepRun",
        params: { id },
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
