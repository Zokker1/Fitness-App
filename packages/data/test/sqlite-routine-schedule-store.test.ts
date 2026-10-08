import { afterEach, describe, expect, it } from "vitest";
import type { Routine, RoutineSchedule } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteRoutineScheduleStore,
  createSyncCryptoAdapter,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface StoredDoc {
  readonly entity_type: string;
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

interface Write {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

interface Request {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly Write[];
  readonly params?: Record<string, unknown>;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const docKey = (entityType: string, id: string) => `${entityType}:${id}`;

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialRoutines: readonly Record<string, unknown>[] = [],
  initialSchedules: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [docKey(doc.entity_type, doc.id), doc]));
  const routines = new Map(initialRoutines.map((row) => [stringValue(row.id), row]));
  const schedules = new Map(initialSchedules.map((row) => [stringValue(row.id), row]));
  const transactions: (readonly Write[])[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        const params = request.params ?? {};
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter((doc) => doc.entity_type === params.entity_type);
        } else if (request.kind === "query" && request.op === "listRoutines") {
          rows = [...routines.values()];
        } else if (request.kind === "query" && request.op === "getRoutine") {
          const row = routines.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listRoutineSchedules") {
          rows = [...schedules.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getRoutineSchedule") {
          const row = schedules.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextRoutines = new Map(routines);
          const nextSchedules = new Map(schedules);
          for (const write of request.ops ?? []) {
            const values = write.params;
            const id = stringValue(values.id);
            if (write.op === "putRoutine") {
              const existing = nextRoutines.get(id);
              nextRoutines.set(id, {
                id,
                title: values.title,
                archived_at: values.archived_at_is_null ? null : values.archived_at,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "putRoutineSchedule") {
              const existing = nextSchedules.get(id);
              nextSchedules.set(id, {
                id,
                routine_id: values.routine_id,
                cadence: values.cadence,
                weekdays_json: values.weekdays_json,
                local_time: values.local_time_is_null ? null : values.local_time,
                enabled: values.enabled,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "deleteEntity") {
              const entityType = stringValue(values.entity_type);
              nextDocs.delete(docKey(entityType, id));
            }
          }
          docs.clear();
          for (const [key, doc] of nextDocs) docs.set(key, doc);
          routines.clear();
          for (const [id, row] of nextRoutines) routines.set(id, row);
          schedules.clear();
          for (const [id, row] of nextSchedules) schedules.set(id, row);
        }
        onmessage?.({
          data: {
            requestId: request.requestId,
            ok: true,
            rows,
            backend: "memory",
            persisted: false,
          },
        } as MessageEvent);
      });
    },
    terminate() {},
    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      onmessage = listener;
    },
    set onerror(_listener: ((event: ErrorEvent) => void) | null) {},
  };
  return { worker: worker as unknown as Worker, docs, routines, schedules, transactions };
}

function legacyDoc(
  entityType: string,
  entity: { readonly id: string; readonly createdAt: string; readonly updatedAt: string },
): StoredDoc {
  return {
    entity_type: entityType,
    id: entity.id,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    doc_version: 0,
    value: JSON.stringify(entity),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite RoutineSchedule relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const routine: Routine = {
    id: "routine-parent",
    title: "Aamurutiini",
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const weekly: RoutineSchedule = {
    id: "schedule-weekly",
    routineId: routine.id,
    cadence: "weekly",
    weekdays: [1, 3, 5],
    localTime: "07:30",
    enabled: false,
    createdAt: at,
    updatedAt: at,
    version: 2,
    deletedAt: null,
  };

  it("migrates Routine parents first and preserves schedule fields", async () => {
    const legacyDaily = {
      ...weekly,
      id: "schedule-daily",
      cadence: "daily" as const,
      weekdays: undefined,
      localTime: null,
      enabled: undefined,
      version: 1,
    };
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-schedule", legacyDaily),
      legacyDoc("routine-schedule", weekly),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineScheduleStore();
    const normalizedDaily: RoutineSchedule = {
      ...legacyDaily,
      weekdays: [],
      enabled: true,
      deletedAt: null,
    };

    expect(await store.list()).toEqual({ ok: true, value: [normalizedDaily, weekly] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.routines.has(routine.id)).toBe(true);
    expect(fixture.schedules.get(weekly.id)).toMatchObject({
      routine_id: routine.id,
      cadence: "weekly",
      weekdays_json: "[1,3,5]",
      local_time: "07:30",
      enabled: 0,
    });
    expect(fixture.schedules.get("schedule-daily")).toMatchObject({
      weekdays_json: "[]",
      local_time: null,
      enabled: 1,
    });

    const updated = { ...weekly, weekdays: [2, 4], version: 3, updatedAt: "2026-09-02" };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(updated.id)).toEqual({ ok: true, value: updated });
    expect(fixture.schedules.get(updated.id)?.created_at).toBe(at);
    expect(await store.remove(updated.id)).toEqual({ ok: true, value: true });
    expect(fixture.schedules.get(updated.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("leaves legacy schedules untouched when the Routine parent is missing", async () => {
    const fixture = createWorker([legacyDoc("routine-schedule", weekly)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineScheduleStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-schedule.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-schedule", weekly.id))).toBe(true);
    expect(fixture.schedules.size).toBe(0);
  });

  it("commits a routine schedule and encrypted sync operation in one transaction", async () => {
    const currentRoutine = {
      id: routine.id,
      title: routine.title,
      archived_at: null,
      created_at: at,
      updated_at: at,
      version: 1,
      deleted_at: null,
    };
    const fixture = createWorker([], [currentRoutine]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineScheduleStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(9));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(weekly, {
          operationId: "installation-1:routine-schedule-1",
          installationId: "installation-1",
          operation: "create",
          occurredAt: weekly.updatedAt,
          changedFields: ["routineId", "cadence", "weekdays", "localTime", "enabled", "deletedAt"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: weekly });

      const writeBatch = fixture.transactions.at(-1);
      expect(writeBatch?.map((write) => write.op)).toEqual([
        "putRoutineSchedule",
        "putSyncOperation",
      ]);
      expect(writeBatch?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.schedules.get(weekly.id)?.routine_id).toBe(routine.id);
    } finally {
      keySession.lock();
    }
  });

  it("rejects invalid legacy schedules without removing their source documents", async () => {
    const invalid = { ...weekly, weekdays: [1, 1] };
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-schedule", invalid),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineScheduleStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-schedule.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-schedule", invalid.id))).toBe(true);
    expect(fixture.schedules.size).toBe(0);
  });

  it("refuses relational ID conflicts and invalid writes", async () => {
    const currentRoutine = {
      id: routine.id,
      title: routine.title,
      archived_at: null,
      created_at: at,
      updated_at: at,
      version: 1,
      deleted_at: null,
    };
    const currentSchedule = {
      id: weekly.id,
      routine_id: routine.id,
      cadence: weekly.cadence,
      weekdays_json: JSON.stringify(weekly.weekdays),
      local_time: weekly.localTime,
      enabled: 0,
      created_at: at,
      updated_at: at,
      version: weekly.version,
      deleted_at: null,
    };
    const fixture = createWorker(
      [legacyDoc("routine-schedule", weekly)],
      [currentRoutine],
      [currentSchedule],
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineScheduleStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-schedule.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-schedule", weekly.id))).toBe(true);
    expect(fixture.schedules.get(weekly.id)?.weekdays_json).toBe("[1,3,5]");

    resetDatabaseWorkerForTests();
    const validFixture = createWorker([], [currentRoutine]);
    configureDatabaseWorker({ create: () => validFixture.worker });
    const validStore = createSqliteRoutineScheduleStore();
    expect(await validStore.save({ ...weekly, weekdays: [1, 1] })).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine-schedule.invalid" },
    });
    expect(validFixture.schedules.size).toBe(0);
  });
});
