import { afterEach, describe, expect, it } from "vitest";
import type { MoodCheckin } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteMoodCheckinStore,
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

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const moodRows = new Map<string, Record<string, unknown>>();
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
        } else if (request.kind === "query" && request.op === "listMoodCheckins") {
          rows = [...moodRows.values()];
        } else if (request.kind === "query" && request.op === "getMoodCheckin") {
          const row = moodRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextRows = new Map(moodRows);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putMoodCheckin") {
              const p = write.params;
              const row: Record<string, unknown> = {
                id,
                checked_at: p.checked_at,
                mood: p.mood,
                stress: p.stress === "" ? null : p.stress,
                energy: p.energy === "" ? null : p.energy,
                motivation: p.motivation === "" ? null : p.motivation,
                focus: p.focus === "" ? null : p.focus,
                note: p.note === "" ? null : p.note,
                created_at: p.created_at,
                updated_at: p.updated_at,
                version: p.version,
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
          moodRows.clear();
          for (const [id, row] of nextRows) moodRows.set(id, row);
        } else if (request.kind === "exec" && request.op === "deleteMoodCheckin") {
          moodRows.delete(stringValue(request.params?.id));
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
  return { worker: worker as unknown as Worker, docs, moodRows, requests };
}

function legacyMoodCheckin(checkin: MoodCheckin): StoredDoc {
  return {
    entity_type: "mood-checkin",
    id: checkin.id,
    created_at: checkin.createdAt,
    updated_at: checkin.updatedAt,
    doc_version: 0,
    value: JSON.stringify(checkin),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite MoodCheckin relational store", () => {
  it("migrates legacy check-ins and uses relational CRUD with hard-delete", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const legacy: MoodCheckin = {
      id: "mood-legacy",
      checkedAt: at,
      mood: 3,
      stress: null,
      energy: null,
      motivation: null,
      focus: null,
      note: null,
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const fixture = createWorker([legacyMoodCheckin(legacy)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteMoodCheckinStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.moodRows.get(legacy.id)).toMatchObject({
      checked_at: at,
      mood: 3,
      energy: null,
      note: null,
    });

    const saved: MoodCheckin = {
      ...legacy,
      id: "mood-new",
      checkedAt: "2026-09-02T08:00:00.000Z",
      mood: 5,
      energy: 4,
      note: "Hyvä päivä",
      createdAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 1,
    };
    expect(await store.save(saved)).toEqual({ ok: true, value: saved });
    expect(await store.getById(saved.id)).toEqual({ ok: true, value: saved });
    expect(await store.remove(saved.id)).toEqual({ ok: true, value: true });
    expect(fixture.moodRows.has(saved.id)).toBe(false);
    expect(fixture.requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("keeps an invalid legacy mood record untouched", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const invalid: MoodCheckin = {
      id: "mood-invalid",
      checkedAt: at,
      mood: 6,
      stress: null,
      energy: null,
      motivation: null,
      focus: null,
      note: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const source = legacyMoodCheckin(invalid);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteMoodCheckinStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(invalid.id)).toEqual(source);
    expect(fixture.moodRows.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a mood check-in and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const checkin: MoodCheckin = {
      id: "mood-sync",
      checkedAt: at,
      mood: 4,
      stress: 2,
      energy: 4,
      motivation: 3,
      focus: 5,
      note: "Hyvä aamu",
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteMoodCheckinStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(18));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(checkin, {
          operationId: "installation-1:mood-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: ["checkedAt", "mood", "stress", "energy", "motivation", "focus", "note"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: checkin });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putMoodCheckin",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.moodRows.get(checkin.id)?.mood).toBe(checkin.mood);
    } finally {
      keySession.lock();
    }
  });
});
