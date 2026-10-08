import { afterEach, describe, expect, it } from "vitest";
import type { Routine, RoutineRun, RoutineStep, RoutineStepRun } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteRoutineStepRunStore,
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
  initialSteps: readonly Record<string, unknown>[] = [],
  initialStepRuns: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [docKey(doc.entity_type, doc.id), doc]));
  const routines = new Map(initialRoutines.map((row) => [String(row.id), row]));
  const runs = new Map(initialRuns.map((row) => [String(row.id), row]));
  const steps = new Map(initialSteps.map((row) => [String(row.id), row]));
  const stepRuns = new Map(initialStepRuns.map((row) => [String(row.id), row]));
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
          rows = [...runs.values()];
        } else if (request.kind === "query" && request.op === "listRoutineSteps") {
          rows = [...steps.values()];
        } else if (request.kind === "query" && request.op === "listRoutineStepRuns") {
          rows = [...stepRuns.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getRoutineStepRun") {
          const row = stepRuns.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextRoutines = new Map(routines);
          const nextRuns = new Map(runs);
          const nextSteps = new Map(steps);
          const nextStepRuns = new Map(stepRuns);
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
            } else if (write.op === "putRoutineStep") {
              const existing = nextSteps.get(id);
              nextSteps.set(id, {
                id,
                routine_id: values.routine_id,
                title: values.title,
                sort_order: values.sort_order,
                optional: values.optional,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "putRoutineStepRun") {
              const existing = nextStepRuns.get(id);
              nextStepRuns.set(id, {
                id,
                routine_run_id: values.routine_run_id,
                routine_step_id: values.routine_step_id,
                status: values.status,
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
          steps.clear();
          for (const [id, row] of nextSteps) steps.set(id, row);
          stepRuns.clear();
          for (const [id, row] of nextStepRuns) stepRuns.set(id, row);
        } else if (request.kind === "exec" && request.op === "deleteRoutineStepRun") {
          stepRuns.delete(stringValue(params.id));
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
  return {
    worker: worker as unknown as Worker,
    docs,
    routines,
    runs,
    steps,
    stepRuns,
    transactions,
  };
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

describe("SQLite RoutineStepRun relational store", () => {
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
  const run: RoutineRun = {
    id: "run-parent",
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
  const step: RoutineStep = {
    id: "step-parent",
    routineId: routine.id,
    title: "Avaa verhot",
    sortOrder: 0,
    optional: false,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const pending: RoutineStepRun = {
    id: "step-run-1",
    routineRunId: run.id,
    routineStepId: step.id,
    status: "pending",
    completedAt: null,
    skipReason: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates all parents first and preserves step-run status transitions", async () => {
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-run", run),
      legacyDoc("routine-step", step),
      legacyDoc("routine-step-run", pending),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepRunStore();

    expect(await store.list()).toEqual({ ok: true, value: [pending] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.routines.has(routine.id)).toBe(true);
    expect(fixture.runs.has(run.id)).toBe(true);
    expect(fixture.steps.has(step.id)).toBe(true);
    expect(fixture.stepRuns.get(pending.id)).toMatchObject({
      routine_run_id: run.id,
      routine_step_id: step.id,
      status: "pending",
      completed_at: null,
      skip_reason: null,
    });

    const skipped: RoutineStepRun = {
      ...pending,
      status: "skipped",
      completedAt: "2026-09-21T07:01:00.000Z",
      skipReason: "Aika ei riittänyt",
      updatedAt: "2026-09-21T07:01:00.000Z",
      version: 2,
    };
    expect(await store.save(skipped)).toEqual({ ok: true, value: skipped });
    expect(await store.getById(skipped.id)).toEqual({ ok: true, value: skipped });
    expect(fixture.stepRuns.get(skipped.id)?.created_at).toBe(at);
    expect(await store.remove(skipped.id)).toEqual({ ok: true, value: true });
    expect(fixture.stepRuns.has(skipped.id)).toBe(false);
  });

  it("keeps legacy data when either parent is missing", async () => {
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-run", run),
      legacyDoc("routine-step-run", pending),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepRunStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-step-run.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-step-run", pending.id))).toBe(true);
    expect(fixture.stepRuns.size).toBe(0);
  });

  it("commits a routine step run and its encrypted sync operation atomically", async () => {
    const completed: RoutineStepRun = {
      ...pending,
      id: "step-run-sync",
      status: "completed",
      completedAt: "2026-09-21T07:01:00.000Z",
      updatedAt: "2026-09-21T07:01:00.000Z",
      version: 1,
    };
    const fixture = createWorker(
      [],
      [
        {
          id: routine.id,
          title: routine.title,
          archived_at: null,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
      [
        {
          id: run.id,
          routine_id: run.routineId,
          local_date: run.localDate,
          status: run.status,
          day_mode: null,
          started_at: run.startedAt,
          completed_at: null,
          skip_reason: null,
          created_at: at,
          updated_at: at,
          version: 1,
        },
      ],
      [
        {
          id: step.id,
          routine_id: step.routineId,
          title: step.title,
          sort_order: step.sortOrder,
          optional: 0,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepRunStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(21));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(completed, {
          operationId: "installation-1:step-run-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: completed.updatedAt,
          changedFields: ["routineRunId", "routineStepId", "status", "completedAt", "skipReason"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: completed });

      const transaction = fixture.transactions.at(-1);
      expect(transaction?.map((write) => write.op)).toEqual([
        "putRoutineStepRun",
        "putSyncOperation",
      ]);
      expect(transaction?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.stepRuns.get(completed.id)?.status).toBe("completed");
    } finally {
      keySession.lock();
    }
  });

  it("refuses cross-routine parent links and duplicate step entries before migration", async () => {
    const otherRoutine: Routine = { ...routine, id: "routine-other", title: "Muu rutiini" };
    const otherStep: RoutineStep = { ...step, id: "step-other", routineId: otherRoutine.id };
    const mismatch = { ...pending, routineStepId: otherStep.id };
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine", otherRoutine),
      legacyDoc("routine-run", run),
      legacyDoc("routine-step", step),
      legacyDoc("routine-step", otherStep),
      legacyDoc("routine-step-run", mismatch),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepRunStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-step-run.invalid" },
    });
    expect(fixture.docs.has(docKey("routine-step-run", mismatch.id))).toBe(true);
    expect(fixture.stepRuns.size).toBe(0);

    resetDatabaseWorkerForTests();
    const duplicate = { ...pending, id: "step-run-duplicate" };
    const duplicateFixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-run", run),
      legacyDoc("routine-step", step),
      legacyDoc("routine-step-run", pending),
      legacyDoc("routine-step-run", duplicate),
    ]);
    configureDatabaseWorker({ create: () => duplicateFixture.worker });
    const duplicateStore = createSqliteRoutineStepRunStore();
    expect(await duplicateStore.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-step-run.invalid" },
    });
    expect(duplicateFixture.docs.has(docKey("routine-step-run", duplicate.id))).toBe(true);
    expect(duplicateFixture.stepRuns.size).toBe(0);
  });

  it("rejects invalid status shapes and empty skip reasons", async () => {
    const currentRoutine = {
      id: routine.id,
      title: routine.title,
      archived_at: null,
      created_at: at,
      updated_at: at,
      version: 1,
      deleted_at: null,
    };
    const currentRun = {
      id: run.id,
      routine_id: run.routineId,
      local_date: run.localDate,
      status: run.status,
      day_mode: null,
      started_at: run.startedAt,
      completed_at: null,
      skip_reason: null,
      created_at: at,
      updated_at: at,
      version: 1,
    };
    const currentStep = {
      id: step.id,
      routine_id: step.routineId,
      title: step.title,
      sort_order: step.sortOrder,
      optional: 0,
      created_at: at,
      updated_at: at,
      version: 1,
      deleted_at: null,
    };
    const fixture = createWorker([], [currentRoutine], [currentRun], [currentStep]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepRunStore();

    expect(await store.save({ ...pending, status: "completed" })).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine-step-run.invalid" },
    });
    expect(
      await store.save({
        ...pending,
        status: "skipped",
        completedAt: at,
        skipReason: "   ",
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine-step-run.invalid" },
    });
    expect(fixture.stepRuns.size).toBe(0);
  });
});
