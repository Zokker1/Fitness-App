import type { EntityId, FocusPhase, FocusSession } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteCalendarBlockStore } from "./sqliteCalendarBlockStore.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteRoutineStore } from "./sqliteRoutineStore.ts";
import { createSqliteTaskStore } from "./sqliteTaskStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "focus-session";
const LEGACY_BATCH_SIZE = 32;
const VALID_PHASES: readonly FocusPhase[] = [
  "planned",
  "running",
  "paused",
  "completed",
  "cancelled",
];

interface FocusSessionRow {
  readonly id?: unknown;
  readonly task_id?: unknown;
  readonly routine_id?: unknown;
  readonly calendar_block_id?: unknown;
  readonly phase?: unknown;
  readonly started_at?: unknown;
  readonly ended_at?: unknown;
  readonly duration_seconds?: unknown;
  readonly active_elapsed_seconds?: unknown;
  readonly active_segment_started_at?: unknown;
  readonly accumulated_pause_seconds?: unknown;
  readonly interruption_count?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedFocusSession(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua fokusistuntoa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.focus-session.invalid",
    },
  };
}

function validNullableId(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function validNullableText(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function validOptionalCount(value: unknown): value is number | undefined {
  return (
    value === undefined || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
  );
}

function validNullableCount(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

export function validFocusSession(session: FocusSession): boolean {
  return (
    typeof session.id === "string" &&
    session.id.length > 0 &&
    validNullableId(session.taskId) &&
    validNullableId(session.routineId) &&
    validNullableId(session.calendarBlockId ?? null) &&
    VALID_PHASES.includes(session.phase) &&
    validNullableText(session.startedAt) &&
    validNullableText(session.endedAt) &&
    (session.startedAt === null ||
      session.endedAt === null ||
      session.endedAt >= session.startedAt) &&
    validNullableCount(session.durationSeconds) &&
    validOptionalCount(session.activeElapsedSeconds) &&
    (session.activeSegmentStartedAt === undefined ||
      validNullableText(session.activeSegmentStartedAt)) &&
    validOptionalCount(session.accumulatedPauseSeconds) &&
    validOptionalCount(session.interruptionCount) &&
    typeof session.createdAt === "string" &&
    session.createdAt.length > 0 &&
    typeof session.updatedAt === "string" &&
    session.updatedAt.length > 0 &&
    Number.isInteger(session.version) &&
    session.version >= 1
  );
}

function normalizeLegacySession(value: FocusSession): FocusSession {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    taskId: raw.taskId === undefined ? null : (raw.taskId as FocusSession["taskId"]),
    routineId: raw.routineId === undefined ? null : (raw.routineId as FocusSession["routineId"]),
    calendarBlockId:
      raw.calendarBlockId === undefined || raw.calendarBlockId === null
        ? null
        : (raw.calendarBlockId as string),
  };
}

export function putFocusSessionOp(session: FocusSession): DbTransactionOp {
  const activeElapsedSeconds = session.activeElapsedSeconds ?? null;
  const activeSegmentStartedAt = session.activeSegmentStartedAt ?? null;
  const accumulatedPauseSeconds = session.accumulatedPauseSeconds ?? null;
  const interruptionCount = session.interruptionCount ?? null;
  return {
    op: "putFocusSession",
    params: {
      id: session.id,
      task_id: session.taskId ?? "",
      task_id_is_null: session.taskId === null,
      routine_id: session.routineId ?? "",
      routine_id_is_null: session.routineId === null,
      calendar_block_id: session.calendarBlockId ?? "",
      calendar_block_id_is_null: session.calendarBlockId === null,
      phase: session.phase,
      started_at: session.startedAt ?? "",
      started_at_is_null: session.startedAt === null,
      ended_at: session.endedAt ?? "",
      ended_at_is_null: session.endedAt === null,
      duration_seconds: session.durationSeconds ?? 0,
      duration_seconds_is_null: session.durationSeconds === null,
      active_elapsed_seconds: activeElapsedSeconds ?? 0,
      active_elapsed_seconds_is_null: activeElapsedSeconds === null,
      active_segment_started_at: activeSegmentStartedAt ?? "",
      active_segment_started_at_is_null: activeSegmentStartedAt === null,
      accumulated_pause_seconds: accumulatedPauseSeconds ?? 0,
      accumulated_pause_seconds_is_null: accumulatedPauseSeconds === null,
      interruption_count: interruptionCount ?? 0,
      interruption_count_is_null: interruptionCount === null,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      version: session.version,
    },
  };
}

function parseFocusSessions(rows: readonly unknown[]): DataResult<readonly FocusSession[]> {
  const sessions: FocusSession[] = [];
  const ids = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedFocusSession();
    }
    const row = value as FocusSessionRow;
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      !validNullableId(row.task_id) ||
      !validNullableId(row.routine_id) ||
      !validNullableId(row.calendar_block_id) ||
      !validNullableText(row.started_at) ||
      !validNullableText(row.ended_at) ||
      !validNullableCount(row.duration_seconds) ||
      (row.active_elapsed_seconds !== null &&
        (typeof row.active_elapsed_seconds !== "number" ||
          !Number.isSafeInteger(row.active_elapsed_seconds) ||
          row.active_elapsed_seconds < 0)) ||
      !validNullableText(row.active_segment_started_at) ||
      (row.accumulated_pause_seconds !== null &&
        (typeof row.accumulated_pause_seconds !== "number" ||
          !Number.isSafeInteger(row.accumulated_pause_seconds) ||
          row.accumulated_pause_seconds < 0)) ||
      (row.interruption_count !== null &&
        (typeof row.interruption_count !== "number" ||
          !Number.isSafeInteger(row.interruption_count) ||
          row.interruption_count < 0)) ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedFocusSession();
    }
    const session: FocusSession = {
      id: row.id,
      taskId: row.task_id,
      routineId: row.routine_id,
      calendarBlockId: row.calendar_block_id,
      phase: row.phase as FocusPhase,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      ...(row.active_elapsed_seconds === null
        ? {}
        : { activeElapsedSeconds: row.active_elapsed_seconds }),
      ...(row.active_segment_started_at === null
        ? {}
        : { activeSegmentStartedAt: row.active_segment_started_at }),
      ...(row.accumulated_pause_seconds === null
        ? {}
        : { accumulatedPauseSeconds: row.accumulated_pause_seconds }),
      ...(row.interruption_count === null ? {} : { interruptionCount: row.interruption_count }),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validFocusSession(session)) return corruptedFocusSession();
    ids.add(session.id);
    sessions.push(session);
  }
  return { ok: true, value: sessions };
}

async function readFocusSessions(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly FocusSession[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseFocusSessions(response.rows);
}

async function migrateLegacyFocusSessions(): Promise<DataResult<true>> {
  const [tasksResult, routinesResult] = await Promise.all([
    createSqliteTaskStore().list(),
    createSqliteRoutineStore().list(),
  ]);
  if (!tasksResult.ok) return tasksResult;
  if (!routinesResult.ok) return routinesResult;
  const calendarBlocksResult = await createSqliteCalendarBlockStore().list();
  if (!calendarBlocksResult.ok) return calendarBlocksResult;
  const taskIds = new Set(tasksResult.value.map((task) => task.id));
  const routineIds = new Set(routinesResult.value.map((routine) => routine.id));
  const calendarBlockIds = new Set(calendarBlocksResult.value.map((block) => block.id));

  const legacyResult = await createSqliteEntityDocStore<FocusSession>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const sessions = legacyResult.value.map(normalizeLegacySession);
  const legacyIds = new Set<string>();
  for (const session of sessions) {
    if (
      !validFocusSession(session) ||
      legacyIds.has(session.id) ||
      (session.taskId !== null && !taskIds.has(session.taskId)) ||
      (session.routineId !== null && !routineIds.has(session.routineId)) ||
      (session.calendarBlockId !== null &&
        session.calendarBlockId !== undefined &&
        !calendarBlockIds.has(session.calendarBlockId))
    ) {
      return corruptedFocusSession();
    }
    legacyIds.add(session.id);
  }

  const currentResult = await readFocusSessions({
    kind: "query",
    op: "listFocusSessions",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((session) => session.id));
  if (sessions.some((session) => currentIds.has(session.id))) return corruptedFocusSession();

  for (let offset = 0; offset < sessions.length; offset += LEGACY_BATCH_SIZE) {
    const batch = sessions.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const session of batch) {
      ops.push(putFocusSessionOp(session));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: session.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteFocusSessionStore(): EntityStore<FocusSession> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyFocusSessions();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<FocusSession> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly FocusSession[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readFocusSessions({ kind: "query", op: "listFocusSessions", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<FocusSession>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readFocusSessions({
        kind: "query",
        op: "getFocusSession",
        params: { id },
      });
      if (!result.ok) return result;
      const session = result.value[0];
      return session === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: session };
    },
    async save(value: FocusSession): Promise<DataResult<FocusSession>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const session = normalizeLegacySession(value);
      if (!validFocusSession(session)) {
        return {
          ok: false,
          error: invalidInput("data.focus-session.invalid", "Fokusistunnon tiedot eivät kelpaa."),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putFocusSessionOp(session)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: session } : result;
    },
    async saveWithSyncOperation(
      value: FocusSession,
      context: SyncWriteContext,
    ): Promise<DataResult<FocusSession>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const session = normalizeLegacySession(value);
      if (!validFocusSession(session)) {
        return {
          ok: false,
          error: invalidInput("data.focus-session.invalid", "Fokusistunnon tiedot eivät kelpaa."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: session.id,
        operation: context.operation,
        entityVersion: session.version,
        occurredAt: context.occurredAt,
        createdAt: session.createdAt,
        entity: session as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putFocusSessionOp(session)],
      });
      return committed.ok ? { ok: true, value: session } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteFocusSession", params: { id } }],
      });
      return toDataResult(response, () => true as const);
    },
  };
  return store;
}
