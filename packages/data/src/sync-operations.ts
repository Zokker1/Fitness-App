// T311: durable access to the append-only sync operation log.

import type { SyncOperation } from "@lifeos/domain";
import type { DataError, DataResult } from "./errors.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const SYNC_OPERATION_KINDS = new Set<SyncOperation["operation"]>([
  "create",
  "update",
  "delete",
  "resolve",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function parseSyncOperationRow(value: unknown): SyncOperation | null {
  if (!isRecord(value)) return null;
  const {
    id,
    operation_id: operationId,
    installation_id: installationId,
    entity_type: entityType,
    entity_id: entityId,
    operation,
    entity_version: entityVersion,
    occurred_at: occurredAt,
    encrypted_payload_ref: encryptedPayloadRef,
    integrity_ref: integrityRef,
    created_at: createdAt,
    updated_at: updatedAt,
    version,
  } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof operationId !== "string" ||
    operationId.length === 0 ||
    operationId.length > 128 ||
    typeof installationId !== "string" ||
    installationId.length === 0 ||
    typeof entityType !== "string" ||
    entityType.length === 0 ||
    entityType.length > 60 ||
    typeof entityId !== "string" ||
    entityId.length === 0 ||
    typeof operation !== "string" ||
    !SYNC_OPERATION_KINDS.has(operation as SyncOperation["operation"]) ||
    !isPositiveSafeInteger(entityVersion) ||
    typeof occurredAt !== "string" ||
    !Number.isFinite(Date.parse(occurredAt)) ||
    typeof encryptedPayloadRef !== "string" ||
    encryptedPayloadRef.length === 0 ||
    typeof integrityRef !== "string" ||
    integrityRef.length === 0 ||
    typeof createdAt !== "string" ||
    !Number.isFinite(Date.parse(createdAt)) ||
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt)) ||
    !isPositiveSafeInteger(version)
  ) {
    return null;
  }
  return {
    id,
    operationId,
    installationId,
    entityType,
    entityId,
    operation: operation as SyncOperation["operation"],
    entityVersion,
    occurredAt,
    encryptedPayloadRef,
    integrityRef,
    createdAt,
    updatedAt,
    version,
  };
}

function corruptedSyncLog(): DataError {
  return {
    code: "data-corrupted",
    userMessage: "Paikallista synkronointijonoa ei voitu lukea turvallisesti.",
    diagnosticCode: "data.sync-log.invalid-row",
  };
}

export async function listSyncOperations(): Promise<DataResult<readonly SyncOperation[]>> {
  const response = await sendDbRequest({
    kind: "query",
    op: "listSyncOperations",
    params: {},
  });
  if (!response.ok) return toDataResult(response, () => []);
  if (!Array.isArray(response.rows)) return { ok: false, error: corruptedSyncLog() };
  const operations: SyncOperation[] = [];
  for (const row of response.rows) {
    const operation = parseSyncOperationRow(row);
    if (operation === null) return { ok: false, error: corruptedSyncLog() };
    operations.push(operation);
  }
  return { ok: true, value: operations };
}
