import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { XPTransaction } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteXpTransactionStore,
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
  const transactions = new Map<string, Record<string, unknown>>();
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
        } else if (request.kind === "query" && request.op === "listXpTransactions") {
          rows = [...transactions.values()];
        } else if (request.kind === "query" && request.op === "getXpTransaction") {
          const row = transactions.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextTransactions = new Map(transactions);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putXpTransaction") {
              const params = write.params;
              nextTransactions.set(id, {
                id,
                source: params.source,
                source_entity_id: params.source_entity_id === "" ? null : params.source_entity_id,
                amount: params.amount,
                earned_at: params.earned_at,
                reason: params.reason_is_null ? null : params.reason,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          transactions.clear();
          for (const [id, transaction] of nextTransactions) transactions.set(id, transaction);
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
  return { worker: worker as unknown as Worker, docs, transactions };
}

function legacyDoc(transaction: XPTransaction): StoredDoc {
  return {
    entity_type: "xp-transaction",
    id: transaction.id,
    created_at: transaction.createdAt,
    updated_at: transaction.updatedAt,
    doc_version: 0,
    value: JSON.stringify(transaction),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite XPTransaction append-only store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const legacy: XPTransaction = {
    id: "xp-manual-fix",
    source: "manual",
    sourceEntityId: null,
    amount: -25,
    earnedAt: at,
    reason: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates legacy rows and preserves nullable and empty fields", async () => {
    const legacyWithEmptyReason: XPTransaction = {
      ...legacy,
      id: "xp-task-empty-reason",
      source: "task",
      sourceEntityId: "task-1",
      amount: 10,
      reason: "",
    };
    const fixture = createWorker([legacyDoc(legacy), legacyDoc(legacyWithEmptyReason)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteXpTransactionStore();

    expect(await store.list()).toEqual({
      ok: true,
      value: [legacy, legacyWithEmptyReason],
    });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.transactions.get(legacy.id)).toMatchObject({
      source_entity_id: null,
      amount: -25,
      reason: null,
    });
    expect(fixture.transactions.get(legacyWithEmptyReason.id)).toMatchObject({
      source_entity_id: "task-1",
      reason: "",
    });

    expect(await store.save(legacy)).toMatchObject({
      ok: false,
      error: { code: "already-exists" },
    });
    expect(await store.remove(legacy.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.xp-transaction.append-only" },
    });
  });

  it("rejects malformed legacy entries without deleting them", async () => {
    const malformed = { ...legacy, id: "xp-invalid", source: "import" } as unknown as XPTransaction;
    const fixture = createWorker([legacyDoc(malformed)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteXpTransactionStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.xp-transaction.invalid" },
    });
    expect(fixture.docs.has(malformed.id)).toBe(true);
    expect(fixture.transactions.size).toBe(0);
  });
});
