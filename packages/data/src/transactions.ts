// T076: atominen kirjoituserä (§32: domain-mutaatio + metadata samassa
// transaktiossa — kaikki tai ei mitään).
// - TransactionWrite: yksi NIMETTY kirjoitusop (putMeta/putPreferences/
//   putInstallation) — ei raakaa SQL:ää (worker omistaa lauseet).
// - runAtomicWrite(writes): lähettää erän workerille joka suorittaa sen
//   BEGIN/COMMIT-välissä; ensimmäinen virhe ROLLBACKaa kaiken ja palautuu
//   DataResulttina (diagnostiikassa epäonnistuneen opin indeksi).
// - 1–64 kirjoitusta per erä (protokollaraja); muisti-Unit устанавлива
//   saman sopimuksen EntityStore-tasolla (T032).
// Ei Reactia/selainta suoraan.

import type { SyncOperation } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";
import type {
  DbResolveConflictTransactionOp,
  DbSyncOperationTransactionOp,
  DbTransactionOp,
} from "./sqliteProtocol.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

export type TransactionWrite =
  DbTransactionOp | DbSyncOperationTransactionOp | DbResolveConflictTransactionOp;
export type DomainTransactionWrite = DbTransactionOp;
const SYNC_OPERATION_KINDS = new Set<SyncOperation["operation"]>([
  "create",
  "update",
  "delete",
  "resolve",
]);

function isValidSyncOperation(operation: SyncOperation): boolean {
  return (
    typeof operation.id === "string" &&
    operation.id.length > 0 &&
    typeof operation.operationId === "string" &&
    operation.operationId.length > 0 &&
    operation.operationId.length <= 128 &&
    typeof operation.installationId === "string" &&
    operation.installationId.length > 0 &&
    typeof operation.entityType === "string" &&
    operation.entityType.length > 0 &&
    operation.entityType.length <= 60 &&
    typeof operation.entityId === "string" &&
    operation.entityId.length > 0 &&
    SYNC_OPERATION_KINDS.has(operation.operation) &&
    Number.isInteger(operation.entityVersion) &&
    operation.entityVersion >= 1 &&
    typeof operation.occurredAt === "string" &&
    operation.occurredAt.length > 0 &&
    typeof operation.encryptedPayloadRef === "string" &&
    operation.encryptedPayloadRef.length > 0 &&
    typeof operation.integrityRef === "string" &&
    operation.integrityRef.length > 0 &&
    typeof operation.createdAt === "string" &&
    operation.createdAt.length > 0 &&
    typeof operation.updatedAt === "string" &&
    operation.updatedAt.length > 0 &&
    Number.isInteger(operation.version) &&
    operation.version >= 1
  );
}

function putSyncOperation(operation: SyncOperation): DbSyncOperationTransactionOp {
  return {
    op: "putSyncOperation",
    params: {
      id: operation.id,
      operation_id: operation.operationId,
      installation_id: operation.installationId,
      entity_type: operation.entityType,
      entity_id: operation.entityId,
      operation: operation.operation,
      entity_version: operation.entityVersion,
      occurred_at: operation.occurredAt,
      encrypted_payload_ref: operation.encryptedPayloadRef,
      integrity_ref: operation.integrityRef,
      created_at: operation.createdAt,
      updated_at: operation.updatedAt,
      version: operation.version,
    },
  };
}

export async function runAtomicWrite(
  writes: readonly TransactionWrite[],
): Promise<DataResult<true>> {
  const response = await sendDbRequest({ kind: "transaction", ops: writes });
  return toDataResult<true>(response, () => true);
}

/**
 * T301: tallentaa domain-kirjoituksen ja sen SyncOperation-outbox-rivin
 * samalla SQLite-transaktiolla. Jos kumpi tahansa epäonnistuu, worker peruu
 * koko erän. Payload- ja eheysviitteiden on oltava valmiita opaakkeja
 * viitteitä; tämä funktio ei salaa domain-dataa.
 */
export async function runAtomicSyncWrite(
  writes: readonly DomainTransactionWrite[],
  operation: SyncOperation,
): Promise<DataResult<true>> {
  if (writes.length < 1 || writes.length > 63) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync-outbox.invalid-write-count",
        "Synkattava tallennus ei sisältänyt kelvollista domain-kirjoituserää.",
      ),
    };
  }
  if (!isValidSyncOperation(operation)) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync-outbox.invalid-operation",
        "Synkkaoperaation metatiedot eivät kelpaa.",
      ),
    };
  }
  return runAtomicWrite([...writes, putSyncOperation(operation)]);
}

/** Append an immutable operation to the local sync log. */
export async function appendSyncOperation(operation: SyncOperation): Promise<DataResult<true>> {
  if (!isValidSyncOperation(operation)) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync-log.invalid-operation",
        "Synkkaoperaation metatiedot eivät kelpaa.",
      ),
    };
  }
  const response = await sendDbRequest({
    kind: "transaction",
    ops: [putSyncOperation(operation)],
  });
  return toDataResult<true>(response, () => true);
}

/**
 * T311: append a remote operation to the local immutable operation log.
 * The worker deduplicates an identical operationId and rejects changed metadata.
 */
export async function appendRemoteSyncOperation(
  operation: SyncOperation,
): Promise<DataResult<true>> {
  if (!isValidSyncOperation(operation)) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync-inbox.invalid-operation",
        "Vastaanotetun synkkaoperaation metatiedot eivät kelpaa.",
      ),
    };
  }
  return appendSyncOperation(operation);
}

/** Store the resolution operation and close its conflict record atomically. */
export async function resolveSyncConflict(
  conflictId: string,
  operation: SyncOperation,
): Promise<DataResult<true>> {
  if (
    typeof conflictId !== "string" ||
    conflictId.length === 0 ||
    !isValidSyncOperation(operation) ||
    operation.operation !== "resolve"
  ) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync-conflict.invalid-resolution",
        "Synkronointiristiriidan ratkaisu ei kelpaa.",
      ),
    };
  }
  const resolveWrite: DbResolveConflictTransactionOp = {
    op: "resolveConflictRecord",
    params: {
      id: conflictId,
      resolution_operation_id: operation.operationId,
      updated_at: operation.occurredAt,
    },
  };
  const response = await sendDbRequest({
    kind: "transaction",
    ops: [putSyncOperation(operation), resolveWrite],
  });
  return toDataResult<true>(response, () => true);
}
