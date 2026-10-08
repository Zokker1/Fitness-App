import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { LevelState } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteLevelStateStore,
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

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const states = new Map<string, Record<string, unknown>>();
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listLevelStates") {
          rows = [...states.values()];
        } else if (request.kind === "query" && request.op === "getLevelState") {
          const row = states.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextStates = new Map(states);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putLevelState") {
              const params = write.params;
              const existing = nextStates.get(id);
              nextStates.set(id, {
                id,
                total_xp: params.total_xp,
                level: params.level,
                computed_at: params.computed_at,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteLevelState") {
              nextStates.delete(id);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          states.clear();
          for (const [id, state] of nextStates) states.set(id, state);
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
  return { worker: worker as unknown as Worker, docs, states };
}

function legacyDoc(state: LevelState): StoredDoc {
  return {
    entity_type: "level-state",
    id: state.id,
    created_at: state.createdAt,
    updated_at: state.updatedAt,
    doc_version: 0,
    value: JSON.stringify(state),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite LevelState snapshot store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const state: LevelState = {
    id: "level-profile",
    totalXp: 1250,
    level: 4,
    computedAt: at,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates legacy snapshots, updates them and supports removal", async () => {
    const fixture = createWorker([legacyDoc(state)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteLevelStateStore();

    expect(await store.list()).toEqual({ ok: true, value: [state] });
    expect(fixture.docs.has(state.id)).toBe(false);
    expect(fixture.states.get(state.id)).toMatchObject({ total_xp: 1250, level: 4 });

    const updated: LevelState = {
      ...state,
      totalXp: 1600,
      level: 5,
      computedAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(state.id)).toEqual({ ok: true, value: updated });
    expect(fixture.states.get(state.id)?.created_at).toBe(at);
    expect(await store.remove(state.id)).toEqual({ ok: true, value: true });
    expect(await store.getById(state.id)).toMatchObject({
      ok: false,
      error: { code: "not-found" },
    });
  });

  it("rejects malformed legacy snapshots without deleting them", async () => {
    const malformed = { ...state, level: 0 };
    const fixture = createWorker([legacyDoc(malformed)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteLevelStateStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.level-state.invalid" },
    });
    expect(fixture.docs.has(state.id)).toBe(true);
    expect(fixture.states.size).toBe(0);
  });
});
