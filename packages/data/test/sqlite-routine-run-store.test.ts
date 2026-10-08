import { afterEach, describe, expect, it } from "vitest";
import type { Routine, RoutineRun } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteRoutineRunStore,
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

const docKey = (entityType: string, id: string) => `${entityType}:${id}`;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialRoutines: readonly Record<string, unknown>[] = [],
  initialRuns: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [docKey(doc.entity_type, doc.id), doc]));
  const routines = new Map(initialRoutines.map((row) => [String(row.id), row]));
  const runs = new Map(initialRuns.map((row) => [String(row.id), row]));
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
        } else if (request.kind === "query" && request.op === "listRoutineRuns") {
          rows = [...runs.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getRoutineRun") {
          const row = runs.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextRoutines = new Map(routines);
          const nextRuns = new Map(runs);
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
            } else if (write.op === "putRoutineRun") {
              const existing = nextRuns.get(id);
              nextRuns.set(id, {
                id,
                routine_id: values.routine_id,
                local_date: values.local_date,
                status: values.status,
                day_mode: values.day_mode_is_null ? null : values.day_mode,
                started_at: values.started_at,
                completed_at: values.completed_at_is_null ? null : values.completed_at,
                skip_reason: values.skip_reason_is_null ? null : values.skip_reason,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(docKey(stringValue(values.entity_type), id));
            }
          }
          docs.clear();
          for (const [key, doc] of nextDocs) docs.set(key, doc);
          routines.clear();
          for (const [id, row] of nextRoutines) routines.set(id, row);
          runs.clear();
          for (const [id, row] of nextRuns) runs.set(id, row);
        } else if (request.kind === "exec" && request.op === "deleteRoutineRun") {
          runs.delete(stringValue(params.id));
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
  return { worker: worker as unknown as Worker, docs, routines, runs, transactions };
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

describe("SQLite RoutineRun relational store", () => {
  const at = "2026-09-21T07:00:00.000Z";
  const routine: Routine = {
    id: "routine-parent",
    title: "Aamurutiini",
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const running: RoutineRun = {
    id: "routine-run-1",
    routineId: routine.id,
    localDate: "2026-09-21",
    status: "running",
    startedAt: at,
    completedAt: null,
    skipReason: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates Routine parents first and preserves run lifecycle fields", async () => {
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-run", running),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineRunStore();

    expect(await store.list()).toEqual({ ok: true, value: [running] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.routines.has(routine.id)).toBe(true);
    expect(fixture.runs.get(running.id)).toMatchObject({
      routine_id: routine.id,
      local_date: running.localDate,
      status: "running",
      day_mode: null,
      completed_at: null,
      skip_reason: null,
    });

    const completed: RoutineRun = {
      ...running,
      status: "completed",
      dayMode: "minimum",
      completedAt: "2026-09-21T07:15:00.000Z",
      updatedAt: "2026-09-21T07:15:00.000Z",
      version: 2,
    };
    expect(await store.save(completed)).toEqual({ ok: true, value: completed });
    expect(await store.getById(completed.id)).toEqual({ ok: true, value: completed });
    expect(fixture.runs.get(completed.id)?.created_at).toBe(at);
    expect(fixture.runs.get(completed.id)?.day_mode).toBe("minimum");
    expect(await store.remove(completed.id)).toEqual({ ok: true, value: true });
    expect(fixture.runs.has(completed.id)).toBe(false);
  });

  it("does not migrate a run whose Routine parent is missing", async () => {
    const fixture = createWorker([legacyDoc("routine-run", running)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineRunStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-run.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-run", running.id))).toBe(true);
    expect(fixture.runs.size).toBe(0);
  });

  it("commits a routine run and its encrypted sync operation atomically", async () => {
    const run: RoutineRun = {
      ...running,
      id: "routine-run-sync",
      status: "running",
      dayMode: "full",
      version: 1,
    };
    const fixture = createWorker([legacyDoc("routine", routine)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineRunStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(20));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(run, {
          operationId: "installation-1:routine-run-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "routineId",
            "localDate",
            "status",
            "dayMode",
            "startedAt",
            "completedAt",
            "skipReason",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: run });

      const transaction = fixture.transactions.at(-1);
      expect(transaction?.map((write) => write.op)).toEqual(["putRoutineRun", "putSyncOperation"]);
      expect(transaction?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.runs.get(run.id)?.status).toBe("running");
    } finally {
      keySession.lock();
    }
  });

  it("keeps all legacy documents when active runs duplicate a Routine day", async () => {
    const second: RoutineRun = { ...running, id: "routine-run-2", version: 2 };
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-run", running),
      legacyDoc("routine-run", second),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineRunStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-run.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-run", running.id))).toBe(true);
    expect(fixture.docs.has(docKey("routine-run", second.id))).toBe(true);
    expect(fixture.runs.size).toBe(0);
  });

  it("rejects invalid dates and unknown statuses without writing", async () => {
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
    const store = createSqliteRoutineRunStore();

    expect(await store.save({ ...running, localDate: "2026-02-30" })).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine-run.invalid" },
    });
    expect(
      await store.save({ ...running, status: "unknown" as RoutineRun["status"] }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine-run.invalid" },
    });
    expect(fixture.runs.size).toBe(0);
  });
});
