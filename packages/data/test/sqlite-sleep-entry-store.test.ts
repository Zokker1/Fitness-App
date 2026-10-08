import { afterEach, describe, expect, it } from "vitest";
import type { SleepEntry } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteSleepEntryStore,
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

interface Request {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly { readonly op: string; readonly params: Record<string, unknown> }[];
  readonly params?: Record<string, unknown>;
}

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const sleepRows = new Map<string, Record<string, unknown>>();
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
        } else if (request.kind === "query" && request.op === "listSleepEntries") {
          rows = [...sleepRows.values()];
        } else if (request.kind === "query" && request.op === "getSleepEntry") {
          const row = sleepRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextRows = new Map(sleepRows);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putSleepEntry") {
              const params = write.params;
              const row = {
                id,
                sleep_start: params.sleep_start,
                sleep_end: params.sleep_end,
                quality: params.quality === "" ? null : params.quality,
                is_nap: params.is_nap,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at === "" ? null : params.deleted_at,
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
          sleepRows.clear();
          for (const [id, row] of nextRows) sleepRows.set(id, row);
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
  return { worker: worker as unknown as Worker, docs, sleepRows, requests };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function legacySleepEntry(entry: SleepEntry): StoredDoc {
  return {
    entity_type: "sleep-entry",
    id: entry.id,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    doc_version: 0,
    value: JSON.stringify(entry),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite SleepEntry relational store", () => {
  it("migrates legacy data and uses the relation for reads, writes, and soft-delete", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const entry: SleepEntry = {
      id: "sleep-1",
      sleepStart: "2026-08-31T22:00:00.000Z",
      sleepEnd: at,
      quality: 4,
      isNap: false,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const fixture = createWorker([legacySleepEntry(entry)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteSleepEntryStore();

    expect(await store.list()).toEqual({ ok: true, value: [entry] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.sleepRows.get(entry.id)).toMatchObject({
      sleep_start: entry.sleepStart,
      sleep_end: entry.sleepEnd,
      quality: 4,
      deleted_at: null,
    });
    const updated = { ...entry, quality: 5, version: 3, updatedAt: "2026-09-02T08:00:00.000Z" };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(entry.id)).toEqual({ ok: true, value: updated });
    expect(await store.remove(entry.id)).toEqual({ ok: true, value: true });
    expect(typeof fixture.sleepRows.get(entry.id)?.deleted_at).toBe("string");
    expect(fixture.sleepRows.get(entry.id)?.version).toBe(4);
    expect(fixture.requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("blocks an invalid legacy interval without deleting its source", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const entry: SleepEntry = {
      id: "sleep-invalid",
      sleepStart: at,
      sleepEnd: "2026-08-31T22:00:00.000Z",
      quality: null,
      isNap: false,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const source = legacySleepEntry(entry);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteSleepEntryStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(entry.id)).toEqual(source);
    expect(fixture.sleepRows.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits sleep data and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const entry: SleepEntry = {
      id: "sleep-sync",
      sleepStart: "2026-09-02T22:00:00.000Z",
      sleepEnd: at,
      quality: 4,
      isNap: false,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteSleepEntryStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(11));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(entry, {
          operationId: "installation-1:sleep-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: ["sleepStart", "sleepEnd", "quality", "isNap", "deletedAt"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: entry });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putSleepEntry",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.sleepRows.get(entry.id)?.sleep_start).toBe(entry.sleepStart);
    } finally {
      keySession.lock();
    }
  });
});
