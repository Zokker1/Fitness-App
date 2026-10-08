import { afterEach, describe, expect, it } from "vitest";
import type { JournalEntry } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteJournalEntryStore,
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
  const journalRows = new Map<string, Record<string, unknown>>();
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
        } else if (request.kind === "query" && request.op === "listJournalEntries") {
          rows = [...journalRows.values()];
        } else if (request.kind === "query" && request.op === "getJournalEntry") {
          const row = journalRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextRows = new Map(journalRows);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putJournalEntry") {
              const p = write.params;
              const row: Record<string, unknown> = {
                id,
                written_at: p.written_at,
                title: p.title_is_null === true ? null : p.title,
                body: p.body,
                reflection_success: p.reflection_success === "" ? null : p.reflection_success,
                reflection_difficult: p.reflection_difficult === "" ? null : p.reflection_difficult,
                reflection_tomorrow: p.reflection_tomorrow === "" ? null : p.reflection_tomorrow,
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
          journalRows.clear();
          for (const [id, row] of nextRows) journalRows.set(id, row);
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
  return { worker: worker as unknown as Worker, docs, journalRows, requests };
}

function legacyJournalEntry(entry: JournalEntry): StoredDoc {
  return {
    entity_type: "journal",
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

describe("SQLite JournalEntry relational store", () => {
  it("migrates legacy entries and preserves nullable versus empty titles", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const legacy: JournalEntry = {
      id: "journal-old",
      writtenAt: at,
      title: null,
      body: "Vanha päiväkirjamerkintä.",
      reflectionSuccess: null,
      reflectionDifficult: null,
      reflectionTomorrow: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const fixture = createWorker([legacyJournalEntry(legacy)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteJournalEntryStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.journalRows.get(legacy.id)).toMatchObject({
      written_at: at,
      title: null,
      body: "Vanha päiväkirjamerkintä.",
      deleted_at: null,
    });

    const saved: JournalEntry = {
      ...legacy,
      id: "journal-new",
      title: "",
      body: "Uusi merkintä.",
      createdAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 1,
    };
    expect(await store.save(saved)).toEqual({ ok: true, value: saved });
    expect(await store.getById(saved.id)).toEqual({ ok: true, value: saved });
    expect(fixture.journalRows.get(saved.id)).toMatchObject({ title: "" });
    expect(await store.remove(saved.id)).toEqual({ ok: true, value: true });
    const deletedJournalRow = fixture.journalRows.get(saved.id);
    expect(deletedJournalRow?.deleted_at).toEqual(expect.any(String));
    expect(deletedJournalRow?.version).toBe(2);
    expect(fixture.requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("blocks invalid legacy entries without deleting their source", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const invalid: JournalEntry = {
      id: "journal-invalid",
      writtenAt: at,
      title: null,
      body: "   ",
      reflectionSuccess: null,
      reflectionDifficult: null,
      reflectionTomorrow: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const source = legacyJournalEntry(invalid);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteJournalEntryStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(invalid.id)).toEqual(source);
    expect(fixture.journalRows.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a journal entry and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const entry: JournalEntry = {
      id: "journal-sync",
      writtenAt: at,
      title: "Päivän muistiinpanot",
      body: "Tänään kävin kävelyllä.",
      reflectionSuccess: null,
      reflectionDifficult: null,
      reflectionTomorrow: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteJournalEntryStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(13));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(entry, {
          operationId: "installation-1:journal-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "writtenAt",
            "title",
            "body",
            "reflectionSuccess",
            "reflectionDifficult",
            "reflectionTomorrow",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: entry });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putJournalEntry",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.journalRows.get(entry.id)?.body).toBe(entry.body);
    } finally {
      keySession.lock();
    }
  });
});
