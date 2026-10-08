import { afterEach, describe, expect, it } from "vitest";
import type { HydrationEntry } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteHydrationEntryStore,
  createSyncCryptoAdapter,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface EntityDocRow {
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

type FakeRequest = {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly {
    readonly op: string;
    readonly params: Record<string, string | number | boolean>;
  }[];
  readonly params?: Record<string, string | number | boolean>;
};

function createHydrationWorker(initialRows: readonly EntityDocRow[]) {
  const entityDocs = new Map(initialRows.map((row) => [row.id, row]));
  const hydrationEntries = new Map<string, Record<string, unknown>>();
  const requests: FakeRequest[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as FakeRequest;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...entityDocs.values()];
        } else if (request.kind === "query" && request.op === "listHydrationEntries") {
          rows = [...hydrationEntries.values()];
        } else if (request.kind === "query" && request.op === "getHydrationEntry") {
          const id = String(request.params?.id ?? "");
          const entry = hydrationEntries.get(id);
          rows = entry === undefined ? [] : [entry];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(entityDocs);
          const nextEntries = new Map(hydrationEntries);
          for (const write of request.ops ?? []) {
            if (write.op === "putHydrationEntry") {
              nextEntries.set(String(write.params.id), {
                id: write.params.id,
                drunk_at: write.params.drunk_at,
                milliliters: write.params.milliliters,
                created_at: write.params.created_at,
                updated_at: write.params.updated_at,
                version: write.params.version,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(String(write.params.id));
            }
          }
          entityDocs.clear();
          for (const [id, row] of nextDocs) entityDocs.set(id, row);
          hydrationEntries.clear();
          for (const [id, row] of nextEntries) hydrationEntries.set(id, row);
        } else if (request.kind === "exec" && request.op === "putHydrationEntry") {
          const params = request.params ?? {};
          hydrationEntries.set(String(params.id), {
            id: params.id,
            drunk_at: params.drunk_at,
            milliliters: params.milliliters,
            created_at: params.created_at,
            updated_at: params.updated_at,
            version: params.version,
          });
        } else if (request.kind === "exec" && request.op === "deleteHydrationEntry") {
          hydrationEntries.delete(String(request.params?.id ?? ""));
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

  return { worker: worker as unknown as Worker, entityDocs, hydrationEntries, requests };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite hydration-entry relational store", () => {
  it("moves legacy documents atomically and uses the relation for later operations", async () => {
    const createdAt = "2026-08-01T08:00:00.000Z";
    const updatedAt = "2026-08-01T08:00:00.000Z";
    const legacy: HydrationEntry = {
      id: "hydration-legacy",
      createdAt,
      updatedAt,
      version: 2,
      drunkAt: "2026-08-01T07:55:00.000Z",
      milliliters: 300,
    };
    const { worker, entityDocs, hydrationEntries, requests } = createHydrationWorker([
      {
        id: legacy.id,
        created_at: legacy.createdAt,
        updated_at: legacy.updatedAt,
        doc_version: 0,
        value: JSON.stringify(legacy),
      },
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteHydrationEntryStore();

    const listed = await store.list();

    expect(listed).toEqual({ ok: true, value: [legacy] });
    expect(entityDocs.size).toBe(0);
    expect(hydrationEntries.get(legacy.id)).toEqual({
      id: legacy.id,
      drunk_at: legacy.drunkAt,
      milliliters: legacy.milliliters,
      created_at: legacy.createdAt,
      updated_at: legacy.updatedAt,
      version: legacy.version,
    });
    expect(requests.find((request) => request.kind === "transaction")?.ops).toHaveLength(2);

    const saved: HydrationEntry = {
      ...legacy,
      id: "hydration-new",
      version: 1,
      milliliters: 450,
    };
    expect(await store.save(saved)).toEqual({ ok: true, value: saved });
    expect(await store.getById(saved.id)).toEqual({ ok: true, value: saved });
    expect(await store.remove(saved.id)).toEqual({ ok: true, value: true });
    expect(hydrationEntries.has(saved.id)).toBe(false);
    expect(requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("leaves legacy documents untouched when one cannot be validated", async () => {
    const row: EntityDocRow = {
      id: "hydration-invalid",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-01T08:00:00.000Z",
      doc_version: 0,
      value: "not-json",
    };
    const { worker, entityDocs, hydrationEntries, requests } = createHydrationWorker([row]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteHydrationEntryStore();

    const listed = await store.list();

    expect(listed).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.get(row.id)).toEqual(row);
    expect(hydrationEntries.size).toBe(0);
    expect(requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a hydration entry and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const entry: HydrationEntry = {
      id: "hydration-sync",
      drunkAt: at,
      milliliters: 300,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const { worker, hydrationEntries, requests } = createHydrationWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteHydrationEntryStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(28));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(entry, {
          operationId: "installation-1:hydration-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: ["drunkAt", "milliliters"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: entry });

      const transaction = requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putHydrationEntry",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(hydrationEntries.get(entry.id)?.milliliters).toBe(entry.milliliters);
    } finally {
      keySession.lock();
    }
  });
});
