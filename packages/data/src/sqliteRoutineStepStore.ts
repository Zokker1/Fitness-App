import type { EntityId, RoutineStep } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteRoutineStore } from "./sqliteRoutineStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "routine-step";
const LEGACY_BATCH_SIZE = 32;

interface RoutineStepRow {
  readonly id?: unknown;
  readonly routine_id?: unknown;
  readonly title?: unknown;
  readonly sort_order?: unknown;
  readonly optional?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedRoutineStep(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua rutiinin vaihetta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.routine-step.invalid",
    },
  };
}

export function validRoutineStep(step: RoutineStep): boolean {
  return (
    typeof step.id === "string" &&
    step.id.length > 0 &&
    typeof step.routineId === "string" &&
    step.routineId.length > 0 &&
    typeof step.title === "string" &&
    step.title.trim().length > 0 &&
    step.title.length <= 200 &&
    Number.isInteger(step.sortOrder) &&
    step.sortOrder >= 0 &&
    typeof step.optional === "boolean" &&
    typeof step.createdAt === "string" &&
    step.createdAt.length > 0 &&
    typeof step.updatedAt === "string" &&
    step.updatedAt.length > 0 &&
    Number.isInteger(step.version) &&
    step.version >= 1 &&
    (step.deletedAt === null || typeof step.deletedAt === "string")
  );
}

function normalizeRoutineStep(value: RoutineStep): RoutineStep {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    optional: raw.optional === undefined ? false : (raw.optional as boolean),
    deletedAt: raw.deletedAt === undefined ? null : (raw.deletedAt as RoutineStep["deletedAt"]),
  };
}

export function putRoutineStepOp(step: RoutineStep): DbTransactionOp {
  return {
    op: "putRoutineStep",
    params: {
      id: step.id,
      routine_id: step.routineId,
      title: step.title,
      sort_order: step.sortOrder,
      optional: step.optional ? 1 : 0,
      created_at: step.createdAt,
      updated_at: step.updatedAt,
      version: step.version,
      deleted_at: step.deletedAt ?? "",
      deleted_at_is_null: step.deletedAt === null,
    },
  };
}

function parseRoutineSteps(rows: readonly unknown[]): DataResult<readonly RoutineStep[]> {
  const steps: RoutineStep[] = [];
  const ids = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedRoutineStep();
    }
    const row = value as RoutineStepRow;
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      typeof row.routine_id !== "string" ||
      typeof row.sort_order !== "number" ||
      (row.optional !== 0 && row.optional !== 1) ||
      typeof row.version !== "number"
    ) {
      return corruptedRoutineStep();
    }
    const step: RoutineStep = {
      id: row.id,
      routineId: row.routine_id,
      title: row.title as string,
      sortOrder: row.sort_order,
      optional: row.optional === 1,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      version: row.version,
      deletedAt: row.deleted_at as RoutineStep["deletedAt"],
    };
    if (!validRoutineStep(step)) return corruptedRoutineStep();
    ids.add(step.id);
    steps.push(step);
  }
  return { ok: true, value: steps };
}

async function readRoutineSteps(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly RoutineStep[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseRoutineSteps(response.rows);
}

async function migrateLegacyRoutineSteps(): Promise<DataResult<true>> {
  const routinesResult = await createSqliteRoutineStore().list();
  if (!routinesResult.ok) return routinesResult;
  const routineIds = new Set(routinesResult.value.map((routine) => routine.id));

  const legacyResult = await createSqliteEntityDocStore<RoutineStep>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const steps = legacyResult.value.map(normalizeRoutineStep);
  const legacyIds = new Set<string>();
  for (const step of steps) {
    if (!validRoutineStep(step) || legacyIds.has(step.id) || !routineIds.has(step.routineId)) {
      return corruptedRoutineStep();
    }
    legacyIds.add(step.id);
  }

  const currentResult = await readRoutineSteps({
    kind: "query",
    op: "listRoutineSteps",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((step) => step.id));
  if (steps.some((step) => currentIds.has(step.id))) return corruptedRoutineStep();

  for (let offset = 0; offset < steps.length; offset += LEGACY_BATCH_SIZE) {
    const batch = steps.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const step of batch) {
      ops.push(putRoutineStepOp(step));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: step.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteRoutineStepStore(): EntityStore<RoutineStep> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyRoutineSteps();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<RoutineStep> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly RoutineStep[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readRoutineSteps({ kind: "query", op: "listRoutineSteps", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<RoutineStep>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readRoutineSteps({
        kind: "query",
        op: "getRoutineStep",
        params: { id },
      });
      if (!result.ok) return result;
      const step = result.value[0];
      return step === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: step };
    },
    async save(value: RoutineStep): Promise<DataResult<RoutineStep>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const step = normalizeRoutineStep(value);
      if (!validRoutineStep(step)) {
        return {
          ok: false,
          error: invalidInput("data.routine-step.invalid", "Rutiinin vaiheen tiedot eivät kelpaa."),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putRoutineStepOp(step)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: step } : result;
    },
    async saveWithSyncOperation(
      value: RoutineStep,
      context: SyncWriteContext,
    ): Promise<DataResult<RoutineStep>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const step = normalizeRoutineStep(value);
      if (!validRoutineStep(step)) {
        return {
          ok: false,
          error: invalidInput("data.routine-step.invalid", "Rutiinin vaiheen tiedot eivät kelpaa."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: step.id,
        operation: context.operation,
        entityVersion: step.version,
        occurredAt: context.occurredAt,
        createdAt: step.createdAt,
        entity: step as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putRoutineStepOp(step)],
      });
      return committed.ok ? { ok: true, value: step } : committed;
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
