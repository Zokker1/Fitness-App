// T313: durable conflict records reference the encrypted operation versions.

import type { ConflictRecord, SyncOperation } from "@lifeos/domain";
import type { DataError, DataResult } from "./errors.ts";
import type { SyncFieldConflict } from "./sync-merge.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const MAX_CONFLICT_REFERENCE_LENGTH = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalidConflict(diagnosticCode: string): DataError {
  return {
    code: "invalid-input",
    diagnosticCode,
    userMessage: "Synkronointiristiriidan tiedot eivät kelpaa.",
  };
}

function corruptedConflict(): DataError {
  return {
    code: "data-corrupted",
    diagnosticCode: "data.sync.conflict.invalid-row",
    userMessage: "Tallennettua synkronointiristiriitaa ei voitu lukea turvallisesti.",
  };
}

function parseConflictRecord(value: unknown): ConflictRecord | null {
  if (!isRecord(value)) return null;
  const {
    id,
    entity_type: entityType,
    entity_id: entityId,
    status,
    local_version_ref: localVersionRef,
    remote_version_ref: remoteVersionRef,
    resolved_at: resolvedAt,
    resolution_operation_id: resolutionOperationId,
    created_at: createdAt,
    updated_at: updatedAt,
    version,
  } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof entityType !== "string" ||
    entityType.length === 0 ||
    entityType.length > 60 ||
    typeof entityId !== "string" ||
    entityId.length === 0 ||
    (status !== "open" && status !== "resolved") ||
    typeof localVersionRef !== "string" ||
    localVersionRef.length === 0 ||
    localVersionRef.length > MAX_CONFLICT_REFERENCE_LENGTH ||
    typeof remoteVersionRef !== "string" ||
    remoteVersionRef.length === 0 ||
    remoteVersionRef.length > MAX_CONFLICT_REFERENCE_LENGTH ||
    !(resolvedAt === null || isTimestamp(resolvedAt)) ||
    !(
      resolutionOperationId === null ||
      (typeof resolutionOperationId === "string" && resolutionOperationId.length > 0)
    ) ||
    (status === "open" && (resolvedAt !== null || resolutionOperationId !== null)) ||
    (status === "resolved" && (resolvedAt === null || resolutionOperationId === null)) ||
    !isTimestamp(createdAt) ||
    !isTimestamp(updatedAt) ||
    !Number.isSafeInteger(version) ||
    typeof version !== "number" ||
    version < 1
  ) {
    return null;
  }
  return {
    id,
    entityType,
    entityId,
    status,
    localVersionRef,
    remoteVersionRef,
    resolvedAt,
    resolutionOperationId,
    createdAt,
    updatedAt,
    version,
  };
}

function isValidOpenConflictRecord(record: ConflictRecord): boolean {
  return (
    record.status === "open" &&
    record.resolvedAt === null &&
    record.resolutionOperationId === null &&
    typeof record.id === "string" &&
    record.id.length > 0 &&
    typeof record.entityType === "string" &&
    record.entityType.length > 0 &&
    record.entityType.length <= 60 &&
    typeof record.entityId === "string" &&
    record.entityId.length > 0 &&
    typeof record.localVersionRef === "string" &&
    record.localVersionRef.length > 0 &&
    record.localVersionRef.length <= MAX_CONFLICT_REFERENCE_LENGTH &&
    typeof record.remoteVersionRef === "string" &&
    record.remoteVersionRef.length > 0 &&
    record.remoteVersionRef.length <= MAX_CONFLICT_REFERENCE_LENGTH &&
    isTimestamp(record.createdAt) &&
    isTimestamp(record.updatedAt) &&
    Number.isSafeInteger(record.version) &&
    record.version >= 1
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function conflictRecordId(input: {
  readonly entityType: string;
  readonly entityId: string;
  readonly field: string;
  readonly operationIds: readonly [string, string];
}): Promise<string | null> {
  if (typeof crypto === "undefined" || typeof TextEncoder === "undefined") return null;
  const canonical = JSON.stringify([
    input.entityType,
    input.entityId,
    input.field,
    [...input.operationIds].sort(),
  ]);
  const bytes = new TextEncoder().encode(canonical);
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `conflict_${bytesToHex(new Uint8Array(digest))}`;
  } catch {
    return null;
  } finally {
    bytes.fill(0);
  }
}

function conflictVersionRef(operationId: string, field: string): string {
  return `sync-operation:${encodeURIComponent(operationId)}#field=${encodeURIComponent(field)}`;
}

function chooseConflictSides(
  conflict: SyncFieldConflict,
  operations: ReadonlyMap<string, SyncOperation>,
  localInstallationId: string,
): { readonly local: SyncOperation; readonly remote: SyncOperation } | null {
  const current = operations.get(conflict.currentOperationId);
  const incoming = operations.get(conflict.incomingOperationId);
  if (current === undefined || incoming === undefined) return null;
  if (current.installationId === localInstallationId) return { local: current, remote: incoming };
  if (incoming.installationId === localInstallationId) return { local: incoming, remote: current };
  return current.operationId.localeCompare(incoming.operationId) <= 0
    ? { local: current, remote: incoming }
    : { local: incoming, remote: current };
}

function laterTimestamp(first: string, second: string): string {
  const difference = Date.parse(first) - Date.parse(second);
  if (difference > 0) return first;
  if (difference < 0) return second;
  return first.localeCompare(second) >= 0 ? first : second;
}

/** Build and idempotently persist one same-field conflict without storing plaintext values. */
export async function saveSyncFieldConflict(input: {
  readonly entityType: string;
  readonly entityId: string;
  readonly localInstallationId: string;
  readonly conflict: SyncFieldConflict;
  readonly operations: ReadonlyMap<string, SyncOperation>;
}): Promise<DataResult<ConflictRecord>> {
  if (
    input.conflict.field.length === 0 ||
    input.conflict.currentOperationId === input.conflict.incomingOperationId
  ) {
    return { ok: false, error: invalidConflict("data.sync.conflict.invalid-input") };
  }
  const sides = chooseConflictSides(input.conflict, input.operations, input.localInstallationId);
  if (sides === null) {
    return {
      ok: false,
      error: {
        code: "data-corrupted",
        diagnosticCode: "data.sync.conflict.version-reference-missing",
        userMessage: "Synkronointiristiriidan versioita ei voitu säilyttää.",
      },
    };
  }
  const id = await conflictRecordId({
    entityType: input.entityType,
    entityId: input.entityId,
    field: input.conflict.field,
    operationIds: [sides.local.operationId, sides.remote.operationId],
  });
  if (id === null) {
    return {
      ok: false,
      error: {
        code: "transient-failure",
        diagnosticCode: "data.sync.conflict.hash-unavailable",
        userMessage: "Synkronointiristiriitaa ei voitu valmistella tallennettavaksi.",
      },
    };
  }
  const createdAt = laterTimestamp(sides.local.occurredAt, sides.remote.occurredAt);
  const record: ConflictRecord = {
    id,
    entityType: input.entityType,
    entityId: input.entityId,
    status: "open",
    localVersionRef: conflictVersionRef(sides.local.operationId, input.conflict.field),
    remoteVersionRef: conflictVersionRef(sides.remote.operationId, input.conflict.field),
    resolvedAt: null,
    resolutionOperationId: null,
    createdAt,
    updatedAt: createdAt,
    version: 1,
  };
  const saved = await putOpenConflictRecord(record);
  return saved.ok ? { ok: true, value: record } : saved;
}

export async function putOpenConflictRecord(record: ConflictRecord): Promise<DataResult<true>> {
  if (!isValidOpenConflictRecord(record)) {
    return { ok: false, error: invalidConflict("data.sync.conflict.invalid-record") };
  }
  const response = await sendDbRequest({
    kind: "transaction",
    ops: [
      {
        op: "putConflictRecord",
        params: {
          id: record.id,
          entity_type: record.entityType,
          entity_id: record.entityId,
          status: record.status,
          local_version_ref: record.localVersionRef,
          remote_version_ref: record.remoteVersionRef,
          resolved_at: "",
          resolution_operation_id: "",
          created_at: record.createdAt,
          updated_at: record.updatedAt,
          version: record.version,
        },
      },
    ],
  });
  return toDataResult(response, () => true);
}

export async function listConflictRecords(): Promise<DataResult<readonly ConflictRecord[]>> {
  const response = await sendDbRequest({
    kind: "query",
    op: "listConflictRecords",
    params: {},
  });
  if (!response.ok) return toDataResult(response, () => []);
  if (!Array.isArray(response.rows)) return { ok: false, error: corruptedConflict() };
  const conflicts: ConflictRecord[] = [];
  for (const row of response.rows) {
    const conflict = parseConflictRecord(row);
    if (conflict === null) return { ok: false, error: corruptedConflict() };
    conflicts.push(conflict);
  }
  return { ok: true, value: conflicts };
}
