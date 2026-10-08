import type { EntityId, XPTransaction, XpSource } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "xp-transaction";
const LEGACY_BATCH_SIZE = 32;
const XP_SOURCES: readonly XpSource[] = [
  "task",
  "routine",
  "focus",
  "habit",
  "health",
  "quest",
  "manual",
];

interface XPTransactionRow {
  readonly id?: unknown;
  readonly source?: unknown;
  readonly source_entity_id?: unknown;
  readonly amount?: unknown;
  readonly earned_at?: unknown;
  readonly reason?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedXpTransaction(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua XP-historiaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.xp-transaction.invalid",
    },
  };
}

export function validXpTransaction(transaction: XPTransaction): boolean {
  return (
    typeof transaction.id === "string" &&
    transaction.id.length > 0 &&
    XP_SOURCES.includes(transaction.source) &&
    (transaction.sourceEntityId === null ||
      (typeof transaction.sourceEntityId === "string" && transaction.sourceEntityId.length > 0)) &&
    Number.isSafeInteger(transaction.amount) &&
    typeof transaction.earnedAt === "string" &&
    transaction.earnedAt.length > 0 &&
    (transaction.reason === null || typeof transaction.reason === "string") &&
    typeof transaction.createdAt === "string" &&
    transaction.createdAt.length > 0 &&
    typeof transaction.updatedAt === "string" &&
    transaction.updatedAt.length > 0 &&
    Number.isInteger(transaction.version) &&
    transaction.version >= 1
  );
}

export function putXpTransactionOp(transaction: XPTransaction): DbTransactionOp {
  return {
    op: "putXpTransaction",
    params: {
      id: transaction.id,
      source: transaction.source,
      source_entity_id: transaction.sourceEntityId ?? "",
      amount: transaction.amount,
      earned_at: transaction.earnedAt,
      reason: transaction.reason ?? "",
      reason_is_null: transaction.reason === null,
      created_at: transaction.createdAt,
      updated_at: transaction.updatedAt,
      version: transaction.version,
    },
  };
}

async function migrateLegacyXpTransactions(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<XPTransaction>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const transactions = legacy.value;
  if (transactions.some((transaction) => !validXpTransaction(transaction))) {
    return corruptedXpTransaction();
  }

  for (let offset = 0; offset < transactions.length; offset += LEGACY_BATCH_SIZE) {
    const batch = transactions.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const transaction of batch) {
      ops.push(putXpTransactionOp(transaction));
      ops.push({
        op: "deleteEntity",
        params: { entity_type: ENTITY_TYPE, id: transaction.id },
      });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function parseXpTransactions(rows: readonly unknown[]): DataResult<readonly XPTransaction[]> {
  const transactions: XPTransaction[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedXpTransaction();
    }
    const row = value as XPTransactionRow;
    if (
      typeof row.id !== "string" ||
      typeof row.source !== "string" ||
      (row.source_entity_id !== null && typeof row.source_entity_id !== "string") ||
      typeof row.amount !== "number" ||
      typeof row.earned_at !== "string" ||
      (row.reason !== null && typeof row.reason !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedXpTransaction();
    }
    const transaction: XPTransaction = {
      id: row.id,
      source: row.source as XpSource,
      sourceEntityId: row.source_entity_id,
      amount: row.amount,
      earnedAt: row.earned_at,
      reason: row.reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validXpTransaction(transaction)) return corruptedXpTransaction();
    transactions.push(transaction);
  }
  return { ok: true, value: transactions };
}

export function createSqliteXpTransactionStore(): EntityStore<XPTransaction> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyXpTransactions();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<XPTransaction> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly XPTransaction[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listXpTransactions", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseXpTransactions(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<XPTransaction>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getXpTransaction",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as XPTransaction);
      const parsed = parseXpTransactions(response.rows);
      if (!parsed.ok) return parsed;
      const transaction = parsed.value[0];
      return transaction === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: transaction };
    },
    async save(value: XPTransaction): Promise<DataResult<XPTransaction>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validXpTransaction(value)) {
        return {
          ok: false,
          error: invalidInput("data.xp-transaction.invalid", "XP-kirjauksen tiedot eivät kelpaa."),
        };
      }
      const existing = await store.getById(value.id);
      if (existing.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      if (existing.error.code !== "not-found") return existing;

      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putXpTransactionOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      if (!result.ok) {
        const raced = await store.getById(value.id);
        if (raced.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
        return result;
      }
      return { ok: true, value };
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      return {
        ok: false,
        error: invalidInput(
          "data.xp-transaction.append-only",
          "XP-historiaa ei voi muuttaa tai poistaa.",
        ),
      };
    },
  };
  return store;
}
