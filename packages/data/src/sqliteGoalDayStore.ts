import type { EntityId, GoalDay } from "@lifeos/domain";
import { isValidLocalDateKey } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import {
  ensureSqliteGoalsMigrated,
  getSqliteGoalIds,
  isCorruptedGoalResult,
} from "./sqliteGoalStore.ts";

const ENTITY_TYPE = "goal-day";
const LEGACY_BATCH_SIZE = 32;

interface RelationalGoalDayRow {
  readonly id?: unknown;
  readonly goal_id?: unknown;
  readonly local_date?: unknown;
  readonly completed?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedGoalDay(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tavoitepäivää ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.goal-day.doc.invalid",
    },
  };
}

export function validGoalDay(day: GoalDay): boolean {
  return (
    typeof day.id === "string" &&
    day.id.length > 0 &&
    typeof day.goalId === "string" &&
    day.goalId.length > 0 &&
    typeof day.localDate === "string" &&
    isValidLocalDateKey(day.localDate) &&
    typeof day.completed === "boolean" &&
    typeof day.createdAt === "string" &&
    typeof day.updatedAt === "string" &&
    Number.isInteger(day.version) &&
    day.version >= 1
  );
}

function parseRelationalGoalDay(row: unknown): GoalDay | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }
  const value = row as RelationalGoalDayRow;
  if (
    typeof value.id !== "string" ||
    typeof value.goal_id !== "string" ||
    typeof value.local_date !== "string" ||
    (value.completed !== 0 && value.completed !== 1) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.version !== "number"
  ) {
    return null;
  }
  const day: GoalDay = {
    id: value.id,
    goalId: value.goal_id,
    localDate: value.local_date,
    completed: value.completed === 1,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
  };
  return validGoalDay(day) ? day : null;
}

function parseGoalDays(rows: readonly unknown[]): DataResult<readonly GoalDay[]> {
  const days: GoalDay[] = [];
  for (const row of rows) {
    const day = parseRelationalGoalDay(row);
    if (day === null) {
      return corruptedGoalDay();
    }
    days.push(day);
  }
  return { ok: true, value: days };
}

export function putGoalDayOp(day: GoalDay): DbTransactionOp {
  return {
    op: "putGoalDay",
    params: {
      id: day.id,
      goal_id: day.goalId,
      local_date: day.localDate,
      completed: day.completed ? 1 : 0,
      created_at: day.createdAt,
      updated_at: day.updatedAt,
      version: day.version,
    },
  };
}

async function migrateLegacyGoalDays(): Promise<DataResult<true>> {
  const goalsMigrated = await ensureSqliteGoalsMigrated();
  if (!goalsMigrated.ok) {
    return goalsMigrated;
  }
  const goalsResponse = await sendDbRequest({ kind: "query", op: "listGoals", params: {} });
  if (!goalsResponse.ok) {
    return toDataResult(goalsResponse, () => true as const);
  }
  const goalIds = getSqliteGoalIds(goalsResponse.rows);
  if (!goalIds.ok) {
    return isCorruptedGoalResult();
  }

  const legacyResult = await createSqliteEntityDocStore<GoalDay>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const days = legacyResult.value;
  const uniqueGoalDates = new Set<string>();
  for (const day of days) {
    const uniqueKey = `${day.goalId}\u0000${day.localDate}`;
    if (!validGoalDay(day) || !goalIds.value.has(day.goalId) || uniqueGoalDates.has(uniqueKey)) {
      return corruptedGoalDay();
    }
    uniqueGoalDates.add(uniqueKey);
  }

  for (let offset = 0; offset < days.length; offset += LEGACY_BATCH_SIZE) {
    const batch = days.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const day of batch) {
      ops.push(putGoalDayOp(day));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: day.id } });
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

export function createSqliteGoalDayStore(): EntityStore<GoalDay> {
  const ensureMigrated = memoizeMigration(migrateLegacyGoalDays);
  const store: EntityStore<GoalDay> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly GoalDay[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "listGoalDays", params: {} });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseGoalDays(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<GoalDay>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({ kind: "query", op: "getGoalDay", params: { id } });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as GoalDay);
      }
      const parsed = parseGoalDays(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const day = parsed.value[0];
      return day === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: day };
    },
    async save(day: GoalDay): Promise<DataResult<GoalDay>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validGoalDay(day)) {
        return {
          ok: false,
          error: invalidInput(
            "data.goal-day.invalid",
            "Tavoitepäivää ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({ kind: "exec", ...putGoalDayOp(day) });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: day } : result;
    },
    async saveWithSyncOperation(
      day: GoalDay,
      context: SyncWriteContext,
    ): Promise<DataResult<GoalDay>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validGoalDay(day)) {
        return {
          ok: false,
          error: invalidInput(
            "data.goal-day.invalid",
            "Tavoitepäivää ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: day.id,
        operation: context.operation,
        entityVersion: day.version,
        occurredAt: context.occurredAt,
        createdAt: day.createdAt,
        entity: day as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putGoalDayOp(day)],
      });
      return committed.ok ? { ok: true, value: day } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteGoalDay",
        params: { id },
      });
      return toDataResult(response, () => true);
    },
  };
  return store;
}
