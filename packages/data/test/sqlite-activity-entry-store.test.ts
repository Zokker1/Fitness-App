import { afterEach, describe, expect, it } from "vitest";
import type { ActivityEntry } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteActivityEntryStore,
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
  const activityRows = new Map<string, Record<string, unknown>>();
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
        } else if (request.kind === "query" && request.op === "listActivityEntries") {
          rows = [...activityRows.values()];
        } else if (request.kind === "query" && request.op === "getActivityEntry") {
          const row = activityRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextRows = new Map(activityRows);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putActivityEntry") {
              const p = write.params;
              const row: Record<string, unknown> = {
                id,
                activity_at: p.activity_at,
                kind: p.kind,
                duration_seconds: p.duration_seconds === "" ? null : p.duration_seconds,
                distance_meters: p.distance_meters === "" ? null : p.distance_meters,
                created_at: p.created_at,
                updated_at: p.updated_at,
                version: p.version,
                deleted_at: p.deleted_at === "" ? null : p.deleted_at,
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
          activityRows.clear();
          for (const [id, row] of nextRows) activityRows.set(id, row);
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
  return { worker: worker as unknown as Worker, docs, activityRows, requests };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function legacyActivityEntry(entry: ActivityEntry): StoredDoc {
  return {
    entity_type: "activity-entry",
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

describe("SQLite ActivityEntry relational store", () => {
  it("migrates legacy activity and uses relational CRUD with soft-delete", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const legacy: ActivityEntry = {
      id: "activity-old",
      activityAt: at,
      kind: "kävely",
      durationSeconds: 2400,
      distanceMeters: 3520.5,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const fixture = createWorker([legacyActivityEntry(legacy)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteActivityEntryStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.activityRows.get(legacy.id)).toMatchObject({
      activity_at: at,
      kind: "kävely",
      duration_seconds: 2400,
      distance_meters: 3520.5,
      deleted_at: null,
    });

    const saved: ActivityEntry = {
      ...legacy,
      id: "activity-new",
      durationSeconds: null,
      distanceMeters: null,
      createdAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 1,
    };
    expect(await store.save(saved)).toEqual({ ok: true, value: saved });
    expect(await store.getById(saved.id)).toEqual({ ok: true, value: saved });
    expect(await store.remove(saved.id)).toEqual({ ok: true, value: true });
    expect(typeof fixture.activityRows.get(saved.id)?.deleted_at).toBe("string");
    expect(fixture.activityRows.get(saved.id)?.version).toBe(2);
    expect(fixture.requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("blocks invalid legacy activity without deleting its source", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const invalid: ActivityEntry = {
      id: "activity-invalid",
      activityAt: at,
      kind: "  ",
      durationSeconds: -1,
      distanceMeters: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const source = legacyActivityEntry(invalid);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteActivityEntryStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(invalid.id)).toEqual(source);
    expect(fixture.activityRows.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits activity data and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const entry: ActivityEntry = {
      id: "activity-sync",
      activityAt: at,
      kind: "kävely",
      durationSeconds: 1800,
      distanceMeters: 2400,
      note: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteActivityEntryStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(12));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(entry, {
          operationId: "installation-1:activity-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "activityAt",
            "kind",
            "durationSeconds",
            "distanceMeters",
            "note",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: entry });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putActivityEntry",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.activityRows.get(entry.id)?.kind).toBe(entry.kind);
    } finally {
      keySession.lock();
    }
  });
});
