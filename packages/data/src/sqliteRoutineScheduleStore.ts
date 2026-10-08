import type { EntityId, RoutineSchedule } from "@lifeos/domain";
import { validateRoutineScheduleValues } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteRoutineStore } from "./sqliteRoutineStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "routine-schedule";
const LEGACY_BATCH_SIZE = 32;

interface RoutineScheduleRow {
  readonly id?: unknown;
  readonly routine_id?: unknown;
  readonly cadence?: unknown;
  readonly weekdays_json?: unknown;
  readonly local_time?: unknown;
  readonly enabled?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedRoutineSchedule(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua rutiinin aikataulua ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.routine-schedule.invalid",
    },
  };
}

function normalizeRoutineSchedule(value: RoutineSchedule): RoutineSchedule {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    weekdays:
      raw.weekdays === undefined && raw.cadence === "daily"
        ? []
        : (raw.weekdays as readonly number[]),
    localTime: raw.localTime === undefined ? null : (raw.localTime as string | null),
    enabled: raw.enabled === undefined ? true : (raw.enabled as boolean),
    deletedAt: raw.deletedAt === undefined ? null : (raw.deletedAt as string | null),
  };
}

export function validRoutineSchedule(schedule: RoutineSchedule): boolean {
  return (
    typeof schedule.id === "string" &&
    schedule.id.length > 0 &&
    typeof schedule.routineId === "string" &&
    schedule.routineId.length > 0 &&
    Array.isArray(schedule.weekdays) &&
    (schedule.localTime === null || typeof schedule.localTime === "string") &&
    typeof schedule.enabled === "boolean" &&
    typeof schedule.createdAt === "string" &&
    schedule.createdAt.length > 0 &&
    typeof schedule.updatedAt === "string" &&
    schedule.updatedAt.length > 0 &&
    Number.isInteger(schedule.version) &&
    schedule.version >= 1 &&
    (schedule.deletedAt === null || typeof schedule.deletedAt === "string") &&
    validateRoutineScheduleValues(schedule).ok
  );
}

function parseRoutineSchedule(row: unknown): RoutineSchedule | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const value = row as RoutineScheduleRow;
  if (
    typeof value.id !== "string" ||
    typeof value.routine_id !== "string" ||
    typeof value.cadence !== "string" ||
    typeof value.weekdays_json !== "string" ||
    (value.local_time !== null && typeof value.local_time !== "string") ||
    (value.enabled !== 0 && value.enabled !== 1) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.version !== "number" ||
    (value.deleted_at !== null && typeof value.deleted_at !== "string")
  ) {
    return null;
  }
  let weekdays: unknown;
  try {
    weekdays = JSON.parse(value.weekdays_json);
  } catch {
    return null;
  }
  if (!Array.isArray(weekdays)) return null;
  const schedule: RoutineSchedule = {
    id: value.id,
    routineId: value.routine_id,
    cadence: value.cadence as RoutineSchedule["cadence"],
    weekdays,
    localTime: value.local_time,
    enabled: value.enabled === 1,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
    deletedAt: value.deleted_at,
  };
  return validRoutineSchedule(schedule) ? schedule : null;
}

function parseRoutineSchedules(rows: readonly unknown[]): DataResult<readonly RoutineSchedule[]> {
  const schedules: RoutineSchedule[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const schedule = parseRoutineSchedule(row);
    if (schedule === null || ids.has(schedule.id)) return corruptedRoutineSchedule();
    ids.add(schedule.id);
    schedules.push(schedule);
  }
  return { ok: true, value: schedules };
}

export function putRoutineScheduleOp(schedule: RoutineSchedule): DbTransactionOp {
  return {
    op: "putRoutineSchedule",
    params: {
      id: schedule.id,
      routine_id: schedule.routineId,
      cadence: schedule.cadence,
      weekdays_json: JSON.stringify(schedule.weekdays),
      enabled: schedule.enabled ? 1 : 0,
      local_time: schedule.localTime ?? "",
      local_time_is_null: schedule.localTime === null,
      created_at: schedule.createdAt,
      updated_at: schedule.updatedAt,
      version: schedule.version,
      deleted_at: schedule.deletedAt ?? "",
      deleted_at_is_null: schedule.deletedAt === null,
    },
  };
}

async function readRoutineSchedules(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly RoutineSchedule[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseRoutineSchedules(response.rows);
}

async function migrateLegacyRoutineSchedules(): Promise<DataResult<true>> {
  const routinesResult = await createSqliteRoutineStore().list();
  if (!routinesResult.ok) return routinesResult;
  const routineIds = new Set(routinesResult.value.map((routine) => routine.id));

  const legacyResult = await createSqliteEntityDocStore<RoutineSchedule>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const schedules = legacyResult.value.map(normalizeRoutineSchedule);
  const legacyIds = new Set<string>();
  for (const schedule of schedules) {
    if (
      !validRoutineSchedule(schedule) ||
      legacyIds.has(schedule.id) ||
      !routineIds.has(schedule.routineId)
    ) {
      return corruptedRoutineSchedule();
    }
    legacyIds.add(schedule.id);
  }

  const currentResult = await readRoutineSchedules({
    kind: "query",
    op: "listRoutineSchedules",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((schedule) => schedule.id));
  if (schedules.some((schedule) => currentIds.has(schedule.id))) {
    return corruptedRoutineSchedule();
  }

  for (let offset = 0; offset < schedules.length; offset += LEGACY_BATCH_SIZE) {
    const batch = schedules.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const schedule of batch) {
      ops.push(putRoutineScheduleOp(schedule));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: schedule.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteRoutineScheduleStore(): EntityStore<RoutineSchedule> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyRoutineSchedules();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<RoutineSchedule> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly RoutineSchedule[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readRoutineSchedules({ kind: "query", op: "listRoutineSchedules", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<RoutineSchedule>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readRoutineSchedules({
        kind: "query",
        op: "getRoutineSchedule",
        params: { id },
      });
      if (!result.ok) return result;
      const schedule = result.value[0];
      return schedule === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: schedule };
    },
    async save(value: RoutineSchedule): Promise<DataResult<RoutineSchedule>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const schedule = normalizeRoutineSchedule(value);
      if (!validRoutineSchedule(schedule)) {
        return {
          ok: false,
          error: invalidInput(
            "data.routine-schedule.invalid",
            "Rutiinin aikataulun tiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putRoutineScheduleOp(schedule)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: schedule } : result;
    },
    async saveWithSyncOperation(
      value: RoutineSchedule,
      context: SyncWriteContext,
    ): Promise<DataResult<RoutineSchedule>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const schedule = normalizeRoutineSchedule(value);
      if (!validRoutineSchedule(schedule)) {
        return {
          ok: false,
          error: invalidInput(
            "data.routine-schedule.invalid",
            "Rutiinin aikataulun tiedot eivät kelpaa.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: schedule.id,
        operation: context.operation,
        entityVersion: schedule.version,
        occurredAt: context.occurredAt,
        createdAt: schedule.createdAt,
        entity: schedule as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putRoutineScheduleOp(schedule)],
      });
      return committed.ok ? { ok: true, value: schedule } : committed;
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
