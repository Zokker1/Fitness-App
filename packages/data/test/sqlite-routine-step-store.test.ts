import { afterEach, describe, expect, it } from "vitest";
import type { Routine, RoutineStep } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteRoutineStepStore,
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

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialRoutines: readonly Record<string, unknown>[] = [],
  initialSteps: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const routines = new Map(initialRoutines.map((routine) => [stringValue(routine.id), routine]));
  const steps = new Map(initialSteps.map((step) => [stringValue(step.id), step]));
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
        } else if (request.kind === "query" && request.op === "listRoutineSteps") {
          rows = [...steps.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getRoutineStep") {
          const row = steps.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "exec" && request.op === "putEntity") {
          const id = stringValue(params.id);
          const entityType = stringValue(params.entity_type);
          docs.set(id, {
            entity_type: entityType,
            id,
            created_at: stringValue(params.created_at),
            updated_at: stringValue(params.updated_at),
            doc_version: Number(params.doc_version ?? 0),
            value: stringValue(params.doc),
          });
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextRoutines = new Map(routines);
          const nextSteps = new Map(steps);
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
            } else if (write.op === "deleteEntity") {
              const existing = nextDocs.get(id);
              if (existing?.entity_type === values.entity_type) nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          routines.clear();
          for (const [id, routine] of nextRoutines) routines.set(id, routine);
          steps.clear();
          for (const [id, step] of nextSteps) steps.set(id, step);
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
  return { worker: worker as unknown as Worker, docs, routines, steps, transactions };
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

describe("SQLite RoutineStep relational store", () => {
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
  const requiredStep = {
    id: "step-required",
    routineId: routine.id,
    title: "Avaa verhot",
    sortOrder: 0,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const optionalStep: RoutineStep = {
    id: "step-optional",
    routineId: routine.id,
    title: "Tee venyttely",
    sortOrder: 1,
    optional: true,
    createdAt: "2026-09-01T08:01:00.000Z",
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };

  it("migrates Routine parents first and preserves optionality and step fields", async () => {
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-step", requiredStep),
      legacyDoc("routine-step", optionalStep),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepStore();
    const migratedRequired = { ...requiredStep, optional: false };

    expect(await store.list()).toEqual({ ok: true, value: [migratedRequired, optionalStep] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.routines.has(routine.id)).toBe(true);
    expect(fixture.steps.get(requiredStep.id)).toMatchObject({
      routine_id: routine.id,
      optional: 0,
      sort_order: 0,
    });
    expect(fixture.steps.get(optionalStep.id)?.optional).toBe(1);

    const updated: RoutineStep = {
      ...migratedRequired,
      title: "Avaa verhot ja ikkuna",
      optional: true,
      sortOrder: 2,
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(updated.id)).toEqual({ ok: true, value: updated });
    expect(fixture.steps.get(updated.id)?.created_at).toBe(at);
    expect(await store.remove(updated.id)).toEqual({ ok: true, value: true });
    expect(fixture.steps.get(updated.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("leaves legacy steps untouched when their Routine parent is missing", async () => {
    const fixture = createWorker([legacyDoc("routine-step", requiredStep)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-step.invalid" },
    });
    expect(fixture.docs.has(requiredStep.id)).toBe(true);
    expect(fixture.steps.size).toBe(0);
  });

  it("commits a routine step and encrypted sync operation in one transaction", async () => {
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
    const store = createSqliteRoutineStepStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(7));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(optionalStep, {
          operationId: "installation-1:routine-step-1",
          installationId: "installation-1",
          operation: "create",
          occurredAt: optionalStep.updatedAt,
          changedFields: ["routineId", "title", "sortOrder", "optional", "deletedAt"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: optionalStep });

      const writeBatch = fixture.transactions.at(-1);
      expect(writeBatch?.map((write) => write.op)).toEqual(["putRoutineStep", "putSyncOperation"]);
      expect(writeBatch?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.steps.get(optionalStep.id)?.title).toBe(optionalStep.title);
    } finally {
      keySession.lock();
    }
  });

  it("rejects an invalid legacy optional value without migrating it", async () => {
    const invalidStep = { ...requiredStep, optional: "sometimes" };
    const fixture = createWorker([
      legacyDoc("routine", routine),
      legacyDoc("routine-step", invalidStep),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-step.doc.invalid" },
    });
    expect(fixture.docs.has(invalidStep.id)).toBe(true);
    expect(fixture.steps.size).toBe(0);
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
    const currentStep = {
      id: requiredStep.id,
      routine_id: routine.id,
      title: "Already migrated",
      sort_order: 9,
      optional: 0,
      created_at: at,
      updated_at: at,
      version: 1,
      deleted_at: null,
    };
    const fixture = createWorker(
      [legacyDoc("routine-step", requiredStep)],
      [currentRoutine],
      [currentStep],
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStepStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine-step.invalid" },
    });
    expect(fixture.docs.has(requiredStep.id)).toBe(true);
    expect(fixture.steps.get(requiredStep.id)?.title).toBe("Already migrated");

    resetDatabaseWorkerForTests();
    const validFixture = createWorker([], [currentRoutine]);
    configureDatabaseWorker({ create: () => validFixture.worker });
    const validStore = createSqliteRoutineStepStore();
    expect(await validStore.save({ ...optionalStep, id: "bad", title: "   " })).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine-step.invalid" },
    });
    expect(validFixture.steps.size).toBe(0);
  });
});
