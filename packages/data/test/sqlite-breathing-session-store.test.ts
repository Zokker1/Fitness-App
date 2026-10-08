import { afterEach, describe, expect, it } from "vitest";
import type { BreathingSession } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteBreathingSessionStore,
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

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const breathingRows = new Map<string, Record<string, unknown>>();
  const requests: Request[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listBreathingSessions") {
          rows = [...breathingRows.values()];
        } else if (request.kind === "query" && request.op === "getBreathingSession") {
          const row = breathingRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextRows = new Map(breathingRows);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putBreathingSession") {
              const params = write.params;
              const row: Record<string, unknown> = {
                id,
                started_at: params.started_at,
                ended_at: params.ended_at === "" ? null : params.ended_at,
                pattern_key: params.pattern_key,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              };
              const existing = nextRows.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextRows.set(id, row);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          breathingRows.clear();
          for (const [id, row] of nextRows) breathingRows.set(id, row);
        } else if (request.kind === "exec" && request.op === "deleteBreathingSession") {
          breathingRows.delete(stringValue(request.params?.id));
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
  return { worker: worker as unknown as Worker, docs, breathingRows, requests };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function legacyBreathingSession(session: BreathingSession): StoredDoc {
  return {
    entity_type: "breathing-session",
    id: session.id,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    doc_version: 0,
    value: JSON.stringify(session),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite BreathingSession relational store", () => {
  it("migrates legacy sessions and supports relational CRUD with hard-delete", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const legacy: BreathingSession = {
      id: "breathing-old",
      startedAt: at,
      endedAt: null,
      patternKey: "box-breathing",
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const fixture = createWorker([legacyBreathingSession(legacy)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteBreathingSessionStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.breathingRows.get(legacy.id)).toMatchObject({
      started_at: at,
      ended_at: null,
      pattern_key: "box-breathing",
    });

    const completed: BreathingSession = {
      ...legacy,
      id: "breathing-completed",
      startedAt: at,
      endedAt: "2026-09-01T08:05:00.000Z",
      createdAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 1,
    };
    expect(await store.save(completed)).toEqual({ ok: true, value: completed });
    expect(await store.getById(completed.id)).toEqual({ ok: true, value: completed });
    expect(await store.remove(completed.id)).toEqual({ ok: true, value: true });
    expect(fixture.breathingRows.has(completed.id)).toBe(false);
    expect(fixture.requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("blocks invalid legacy sessions without deleting their source", async () => {
    const invalid: BreathingSession = {
      id: "breathing-invalid",
      startedAt: "2026-09-01T08:05:00.000Z",
      endedAt: "2026-09-01T08:00:00.000Z",
      patternKey: "box-breathing",
      createdAt: "2026-09-01T08:00:00.000Z",
      updatedAt: "2026-09-01T08:00:00.000Z",
      version: 1,
    };
    const source = legacyBreathingSession(invalid);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteBreathingSessionStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(invalid.id)).toEqual(source);
    expect(fixture.breathingRows.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a breathing session and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const session: BreathingSession = {
      id: "breathing-sync",
      startedAt: at,
      endedAt: "2026-09-03T08:05:00.000Z",
      patternKey: "box-breathing",
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteBreathingSessionStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(24));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(session, {
          operationId: "installation-1:breathing-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: ["startedAt", "endedAt", "patternKey"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: session });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putBreathingSession",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.breathingRows.get(session.id)?.pattern_key).toBe(session.patternKey);
    } finally {
      keySession.lock();
    }
  });
});
