import type { EntityId, Goal } from "@lifeos/domain";
import { validateGoalValues } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "goal";
const LEGACY_BATCH_SIZE = 32;

interface RelationalGoalRow {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly active_from?: unknown;
  readonly active_until?: unknown;
  readonly archived_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedGoal(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tavoitetta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.goal.doc.invalid",
    },
  };
}

export function validGoal(goal: Goal): boolean {
  const archivedAt: unknown = (goal as unknown as { readonly archivedAt: unknown }).archivedAt;
  const deletedAt: unknown = (goal as unknown as { readonly deletedAt: unknown }).deletedAt;
  if (
    typeof goal.id !== "string" ||
    goal.id.length === 0 ||
    typeof goal.title !== "string" ||
    (goal.description !== null && typeof goal.description !== "string") ||
    (goal.activeFrom !== undefined &&
      goal.activeFrom !== null &&
      typeof goal.activeFrom !== "string") ||
    (goal.activeUntil !== undefined &&
      goal.activeUntil !== null &&
      typeof goal.activeUntil !== "string") ||
    typeof goal.createdAt !== "string" ||
    typeof goal.updatedAt !== "string" ||
    !Number.isInteger(goal.version) ||
    goal.version < 1 ||
    (typeof archivedAt !== "string" && archivedAt !== null) ||
    (typeof deletedAt !== "string" && deletedAt !== null)
  ) {
    return false;
  }
  const values = validateGoalValues({
    title: goal.title,
    description: goal.description,
    activeFrom: goal.activeFrom ?? null,
    activeUntil: goal.activeUntil ?? null,
  });
  return values.ok;
}

function parseRelationalGoal(row: unknown): Goal | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }
  const value = row as RelationalGoalRow;
  if (
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    (value.description !== null && typeof value.description !== "string") ||
    (value.active_from !== null && typeof value.active_from !== "string") ||
    (value.active_until !== null && typeof value.active_until !== "string") ||
    (value.archived_at !== null && typeof value.archived_at !== "string") ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.version !== "number" ||
    (typeof value.deleted_at !== "string" && value.deleted_at !== null)
  ) {
    return null;
  }
  const goal: Goal = {
    id: value.id,
    title: value.title,
    description: value.description,
    activeFrom: value.active_from,
    activeUntil: value.active_until,
    archivedAt: value.archived_at,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
    deletedAt: value.deleted_at,
  };
  return validGoal(goal) ? goal : null;
}

function parseGoals(rows: readonly unknown[]): DataResult<readonly Goal[]> {
  const goals: Goal[] = [];
  for (const row of rows) {
    const goal = parseRelationalGoal(row);
    if (goal === null) {
      return corruptedGoal();
    }
    goals.push(goal);
  }
  return { ok: true, value: goals };
}

export function putGoalOp(goal: Goal): DbTransactionOp {
  return {
    op: "putGoal",
    params: {
      id: goal.id,
      title: goal.title,
      description: goal.description ?? "",
      active_from: goal.activeFrom ?? "",
      active_until: goal.activeUntil ?? "",
      archived_at: goal.archivedAt ?? "",
      created_at: goal.createdAt,
      updated_at: goal.updatedAt,
      deleted_at: goal.deletedAt ?? "",
      version: goal.version,
    },
  };
}

/** GoalDay tarvitsee FK-isäntänsä valmiiksi ennen omien rivien siirtoa. */
export async function ensureSqliteGoalsMigrated(): Promise<DataResult<true>> {
  const legacyStore = createSqliteEntityDocStore<Goal>(ENTITY_TYPE);
  const legacyResult = await legacyStore.list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const goals = legacyResult.value;
  if (goals.some((goal) => !validGoal(goal))) {
    return corruptedGoal();
  }

  for (let offset = 0; offset < goals.length; offset += LEGACY_BATCH_SIZE) {
    const batch = goals.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const goal of batch) {
      ops.push(putGoalOp(goal));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: goal.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function memoizeMigration(
  migrate: () => Promise<DataResult<true>>,
): () => Promise<DataResult<true>> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  return () => {
    if (migrationPromise === null) {
      const attempt = migrate();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };
}

export function createSqliteGoalStore(): EntityStore<Goal> {
  const ensureMigrated = memoizeMigration(ensureSqliteGoalsMigrated);
  const store: EntityStore<Goal> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Goal[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "listGoals", params: {} });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseGoals(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Goal>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "getGoal", params: { id } });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as Goal);
      }
      const parsed = parseGoals(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const goal = parsed.value[0];
      return goal === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: goal };
    },
    async save(goal: Goal): Promise<DataResult<Goal>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validGoal(goal)) {
        return {
          ok: false,
          error: invalidInput("data.goal.invalid", "Tavoitetta ei voi tallentaa näillä tiedoilla."),
        };
      }
      const response = await sendDbRequest({ kind: "exec", ...putGoalOp(goal) });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: goal } : result;
    },
    async saveWithSyncOperation(goal: Goal, context: SyncWriteContext): Promise<DataResult<Goal>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validGoal(goal)) {
        return {
          ok: false,
          error: invalidInput("data.goal.invalid", "Tavoitetta ei voi tallentaa näillä tiedoilla."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: goal.id,
        operation: context.operation,
        entityVersion: goal.version,
        occurredAt: context.occurredAt,
        createdAt: goal.createdAt,
        entity: goal as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putGoalOp(goal)],
      });
      return committed.ok ? { ok: true, value: goal } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const now = new Date().toISOString();
      const saved = await store.save({
        ...existing.value,
        deletedAt: now,
        updatedAt: now,
      });
      return saved.ok ? { ok: true, value: true } : saved;
    },
  };
  return store;
}

export function parseSqliteGoalRows(rows: readonly unknown[]): DataResult<readonly Goal[]> {
  return parseGoals(rows);
}

export function isCorruptedGoalResult(): DataResult<never> {
  return corruptedGoal();
}

export function getSqliteGoalIds(rows: readonly unknown[]): DataResult<ReadonlySet<string>> {
  const parsed = parseGoals(rows);
  return parsed.ok ? { ok: true, value: new Set(parsed.value.map((goal) => goal.id)) } : parsed;
}
