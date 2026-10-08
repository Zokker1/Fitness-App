import { afterEach, describe, expect, it } from "vitest";
import type { Routine } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteRoutineStore,
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
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const routines = new Map(initialRoutines.map((routine) => [stringValue(routine.id), routine]));
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
          rows = [...routines.values()].sort(
            (left, right) =>
              stringValue(left.created_at).localeCompare(stringValue(right.created_at)) ||
              stringValue(left.id).localeCompare(stringValue(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getRoutine") {
          const row = routines.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextRoutines = new Map(routines);
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
            } else if (write.op === "deleteEntity") {
              const existing = nextDocs.get(id);
              if (existing?.entity_type === values.entity_type) nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          routines.clear();
          for (const [id, routine] of nextRoutines) routines.set(id, routine);
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
  return { worker: worker as unknown as Worker, docs, routines, transactions };
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

describe("SQLite Routine relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const routine: Routine = {
    id: "routine-morning",
    title: "Aamurutiini",
    archivedAt: "",
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };

  it("migrates legacy routines and preserves nullable, empty, and metadata fields", async () => {
    const fixture = createWorker([legacyDoc("routine", routine)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStore();

    expect(await store.list()).toEqual({ ok: true, value: [routine] });
    expect(fixture.docs.has(routine.id)).toBe(false);
    expect(fixture.routines.get(routine.id)?.archived_at).toBe("");

    const updated: Routine = {
      ...routine,
      title: "Päivitetty aamurutiini",
      archivedAt: null,
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(routine.id)).toEqual({ ok: true, value: updated });
    expect(fixture.routines.get(routine.id)?.created_at).toBe(at);

    expect(await store.remove(routine.id)).toEqual({ ok: true, value: true });
    expect(fixture.routines.get(routine.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("normalizes nullable fields absent from older routine documents", async () => {
    const olderRoutine = {
      id: "routine-old",
      title: "Vanha rutiini",
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const fixture = createWorker([legacyDoc("routine", olderRoutine)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStore();

    expect(await store.list()).toEqual({
      ok: true,
      value: [{ ...olderRoutine, archivedAt: null, deletedAt: null }],
    });
    expect(fixture.docs.has(olderRoutine.id)).toBe(false);
  });

  it("commits a routine and encrypted sync operation in one transaction", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(5));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      const saved = await store.saveWithSyncOperation?.(routine, {
        operationId: "installation-1:routine-1",
        installationId: "installation-1",
        operation: "create",
        occurredAt: routine.updatedAt,
        changedFields: ["title", "archivedAt", "deletedAt"],
        keySession,
        crypto: createSyncCryptoAdapter(),
      });

      expect(saved).toEqual({ ok: true, value: routine });
      const writeBatch = fixture.transactions.at(-1);
      expect(writeBatch?.map((write) => write.op)).toEqual(["putRoutine", "putSyncOperation"]);
      expect(writeBatch?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.routines.get(routine.id)?.title).toBe(routine.title);
    } finally {
      keySession.lock();
    }
  });

  it("keeps malformed legacy routines untouched", async () => {
    const malformed: Routine = { ...routine, title: "   " };
    const fixture = createWorker([legacyDoc("routine", malformed)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine.invalid" },
    });
    expect(fixture.docs.has(malformed.id)).toBe(true);
    expect(fixture.routines.size).toBe(0);
  });

  it("refuses relational ID conflicts and invalid routine writes", async () => {
    const currentRow = {
      id: routine.id,
      title: "Jo olemassa",
      archived_at: null,
      created_at: at,
      updated_at: at,
      version: 1,
      deleted_at: null,
    };
    const fixture = createWorker([legacyDoc("routine", routine)], [currentRow]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteRoutineStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.routine.invalid" },
    });
    expect(fixture.docs.has(routine.id)).toBe(true);
    expect(fixture.routines.get(routine.id)?.title).toBe("Jo olemassa");

    resetDatabaseWorkerForTests();
    const validFixture = createWorker([]);
    configureDatabaseWorker({ create: () => validFixture.worker });
    const validStore = createSqliteRoutineStore();
    expect(await validStore.save({ ...routine, id: "bad", title: "  " })).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.routine.invalid" },
    });
    expect(validFixture.routines.size).toBe(0);
  });
});
