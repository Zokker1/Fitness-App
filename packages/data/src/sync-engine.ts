// T311: append-only replica exchange over the provider-neutral transport.

import type { ConflictRecord, SyncOperation } from "@lifeos/domain";
import type { DataError, DataResult } from "./errors.ts";
import type { DomainTransactionWrite } from "./transactions.ts";
import {
  appendRemoteSyncOperation,
  appendSyncOperation,
  runAtomicSyncWrite,
} from "./transactions.ts";
import { saveSyncFieldConflict } from "./conflict-records.ts";
import { getSyncCursor, saveSyncCursor } from "./sync-cursors.ts";
import { listSyncOperations } from "./sync-operations.ts";
import type { DataKeySession } from "./key-material.ts";
import type { SyncCryptoAdapter, SyncCryptoError, SyncCryptoResult } from "./sync-crypto.ts";
import type { SyncPayload, SyncPayloadEntity, SyncPayloadJsonValue } from "./sync-payload.ts";
import { decodeSyncPayload, encodeSyncPayload } from "./sync-payload.ts";
import {
  mergeSyncEntityChanges,
  syncJsonValuesEqual,
  type SyncEntityChange,
  type SyncFieldClock,
} from "./sync-merge.ts";
import type { SyncProvider, SyncProviderError, SyncProviderObjectRef } from "./sync-provider.ts";

const SYNC_BATCH_FORMAT = "lifeos-sync-batch";
const SYNC_BATCH_VERSION = 1;
const MAX_SYNC_BATCH_BYTES = 16 * 1024 * 1024;
const MAX_SYNC_BATCH_OPERATIONS = 64;
const MAX_SYNC_LIST_PAGES = 10_000;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const BROWSER_INSTALLATION_ENTITY_TYPE = "browser-installation";
const BROWSER_INSTALLATION_SYNC_FIELDS = [
  "installationName",
  "lastSeenAppVersion",
  "lastSyncAt",
  "revokedAt",
] as const;
const SYNC_OPERATION_KINDS = new Set<SyncOperation["operation"]>([
  "create",
  "update",
  "delete",
  "resolve",
]);

export interface CreateEncryptedSyncOperationInput {
  readonly operationId: string;
  readonly installationId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperation["operation"];
  readonly entityVersion: number;
  readonly occurredAt: string;
  readonly createdAt: string;
  readonly entity: SyncPayloadEntity;
  /**
   * Top-level fields changed by this operation; required for safe field merge.
   * Include an optional field name when the update removes it from the snapshot.
   */
  readonly changedFields: readonly string[];
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
}

export interface CommitSyncableChangeInput extends CreateEncryptedSyncOperationInput {
  readonly writes: readonly DomainTransactionWrite[];
}

export interface SyncReplicaSummary {
  readonly uploadedBatches: number;
  readonly uploadedOperations: number;
  readonly downloadedBatches: number;
  readonly receivedOperations: number;
  readonly skippedOwnOperations: number;
  readonly mergedEntities: number;
  readonly mergeConflicts: number;
}

export interface SyncConflictVersionValues {
  readonly field: string;
  readonly localValue: SyncPayloadJsonValue | undefined;
  readonly remoteValue: SyncPayloadJsonValue | undefined;
}

/**
 * Typed persistence seam for applying merged remote snapshots. Implementations
 * must validate entityType and the complete domain shape before writing.
 */
export interface SyncEntityStoreAdapter {
  read(entityType: string, entityId: string): Promise<DataResult<SyncPayloadEntity | null>>;
  /** Persist the supplied snapshot as-is without creating another sync operation. */
  write(entityType: string, entityId: string, entity: SyncPayloadEntity): Promise<DataResult<true>>;
}

export interface SyncCoordinatorError {
  readonly source: "local" | "provider";
  readonly code: string;
  readonly userMessage: string;
  readonly diagnosticCode: string;
  readonly retryAfterSeconds?: number;
}

export type SyncCoordinatorResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SyncCoordinatorError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dataFailure<T>(
  code: DataError["code"],
  diagnosticCode: string,
  userMessage: string,
): DataResult<T> {
  return { ok: false, error: { code, diagnosticCode, userMessage } };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function isValidSyncOperation(value: unknown): value is SyncOperation {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.operationId === "string" &&
    value.operationId.length > 0 &&
    value.operationId.length <= 128 &&
    typeof value.installationId === "string" &&
    value.installationId.length > 0 &&
    typeof value.entityType === "string" &&
    value.entityType.length > 0 &&
    value.entityType.length <= 60 &&
    typeof value.entityId === "string" &&
    value.entityId.length > 0 &&
    typeof value.operation === "string" &&
    SYNC_OPERATION_KINDS.has(value.operation as SyncOperation["operation"]) &&
    Number.isSafeInteger(value.entityVersion) &&
    typeof value.entityVersion === "number" &&
    value.entityVersion >= 1 &&
    isTimestamp(value.occurredAt) &&
    typeof value.encryptedPayloadRef === "string" &&
    value.encryptedPayloadRef.length > 0 &&
    value.encryptedPayloadRef.length <= MAX_SYNC_BATCH_BYTES &&
    BASE64URL_PATTERN.test(value.encryptedPayloadRef) &&
    typeof value.integrityRef === "string" &&
    SHA256_HEX_PATTERN.test(value.integrityRef) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt) &&
    Number.isSafeInteger(value.version) &&
    typeof value.version === "number" &&
    value.version >= 1
  );
}

function bytesToBase64Url(bytes: Uint8Array): string | null {
  if (typeof btoa !== "function") return null;
  try {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  } catch {
    return null;
  }
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (
    value.length === 0 ||
    value.length > MAX_SYNC_BATCH_BYTES ||
    !BASE64URL_PATTERN.test(value) ||
    typeof atob !== "function"
  ) {
    return null;
  }
  try {
    const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  if (typeof crypto === "undefined") return null;
  const copy = new Uint8Array(bytes);
  try {
    const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
    return bytesToHex(new Uint8Array(digest));
  } catch {
    return null;
  } finally {
    copy.fill(0);
  }
}

function dataErrorFromCrypto(error: SyncCryptoError): DataError {
  return {
    code: error.code === "invalid-input" ? "invalid-input" : "transient-failure",
    userMessage: error.userMessage,
    diagnosticCode: error.diagnosticCode,
  };
}

export async function createEncryptedSyncOperation(
  input: CreateEncryptedSyncOperationInput,
): Promise<DataResult<SyncOperation>> {
  if (
    !isRecord(input.entity) ||
    typeof input.operationId !== "string" ||
    input.operationId.length === 0 ||
    input.operationId.length > 128 ||
    typeof input.installationId !== "string" ||
    input.installationId.length === 0 ||
    typeof input.entityType !== "string" ||
    input.entityType.length === 0 ||
    input.entityType.length > 60 ||
    typeof input.entityId !== "string" ||
    input.entityId.length === 0 ||
    !SYNC_OPERATION_KINDS.has(input.operation) ||
    !Number.isSafeInteger(input.entityVersion) ||
    input.entityVersion < 1 ||
    !isTimestamp(input.occurredAt) ||
    !isTimestamp(input.createdAt)
  ) {
    return dataFailure(
      "invalid-input",
      "data.sync-operation.invalid-input",
      "Synkronointitoimenpiteen tiedot eivät kelpaa.",
    );
  }
  if (!Array.isArray(input.changedFields) || input.changedFields.length === 0) {
    return dataFailure(
      "invalid-input",
      "data.sync-operation.changed-fields-required",
      "Synkattavan muutoksen muuttuneet kentät puuttuivat.",
    );
  }
  if (
    input.operation === "delete" &&
    (typeof input.entity.deletedAt !== "string" ||
      !isTimestamp(input.entity.deletedAt) ||
      input.changedFields.length !== 1 ||
      input.changedFields[0] !== "deletedAt")
  ) {
    return dataFailure(
      "invalid-input",
      "data.sync-operation.invalid-tombstone",
      "Poiston synkronointitoimenpide vaati deletedAt-tombstonen.",
    );
  }
  if (input.operation === "create") {
    const allDataFields = Object.keys(input.entity).filter(
      (field) => !["id", "createdAt", "updatedAt", "version"].includes(field),
    );
    if (
      allDataFields.length !== input.changedFields.length ||
      !allDataFields.every((field) => input.changedFields.includes(field))
    ) {
      return dataFailure(
        "invalid-input",
        "data.sync-operation.create-fields-incomplete",
        "Uuden tietueen synkronointi vaati kaikki sen kentät.",
      );
    }
  }
  if (
    input.entity.id !== input.entityId ||
    input.entity.version !== input.entityVersion ||
    typeof input.entity.createdAt !== "string" ||
    !isTimestamp(input.entity.createdAt) ||
    typeof input.entity.updatedAt !== "string" ||
    !isTimestamp(input.entity.updatedAt)
  ) {
    return dataFailure(
      "invalid-input",
      "data.sync-operation.entity-metadata-invalid",
      "Synkattavan tietueen tunniste tai versio ei täsmännyt.",
    );
  }
  const encoded = encodeSyncPayload(input.entity, input.changedFields);
  if (!encoded.ok) return encoded;
  let encrypted: SyncCryptoResult<Uint8Array>;
  try {
    encrypted = await input.keySession.withKey((key) =>
      input.crypto.encrypt({
        plaintext: encoded.value,
        key,
        context: {
          operationId: input.operationId,
          installationId: input.installationId,
          entityType: input.entityType,
          entityId: input.entityId,
          operation: input.operation,
          entityVersion: input.entityVersion,
          occurredAt: input.occurredAt,
        },
      }),
    );
  } catch {
    encoded.value.fill(0);
    return dataFailure(
      "transient-failure",
      "data.sync-operation.encryption-failed",
      "Synkronointitoimenpidettä ei voitu salata.",
    );
  }
  encoded.value.fill(0);
  if (!encrypted.ok) return { ok: false, error: dataErrorFromCrypto(encrypted.error) };

  const ciphertext = encrypted.value;
  const [encryptedPayloadRef, integrityRef] = await Promise.all([
    Promise.resolve(bytesToBase64Url(ciphertext)),
    sha256Hex(ciphertext),
  ]);
  ciphertext.fill(0);
  if (encryptedPayloadRef === null || integrityRef === null) {
    return dataFailure(
      "transient-failure",
      "data.sync-operation.crypto-unavailable",
      "Synkronointitoimenpidettä ei voitu valmistella turvallisesti.",
    );
  }

  return {
    ok: true,
    value: {
      id: input.operationId,
      operationId: input.operationId,
      installationId: input.installationId,
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      entityVersion: input.entityVersion,
      occurredAt: input.occurredAt,
      encryptedPayloadRef,
      integrityRef,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      version: 1,
    },
  };
}

export async function commitSyncableChange(
  input: CommitSyncableChangeInput,
): Promise<DataResult<true>> {
  const operation = await createEncryptedSyncOperation(input);
  if (!operation.ok) return operation;
  return runAtomicSyncWrite(input.writes, operation.value);
}

function operationForWire(operation: SyncOperation): SyncOperation {
  return {
    id: operation.id,
    operationId: operation.operationId,
    installationId: operation.installationId,
    entityType: operation.entityType,
    entityId: operation.entityId,
    operation: operation.operation,
    entityVersion: operation.entityVersion,
    occurredAt: operation.occurredAt,
    encryptedPayloadRef: operation.encryptedPayloadRef,
    integrityRef: operation.integrityRef,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    version: operation.version,
  };
}

function encodeBatchBytes(operations: readonly SyncOperation[]): Uint8Array | null {
  if (typeof TextEncoder === "undefined") return null;
  try {
    const serialized = JSON.stringify({
      format: SYNC_BATCH_FORMAT,
      version: SYNC_BATCH_VERSION,
      operations: operations.map(operationForWire),
    });
    return new TextEncoder().encode(serialized);
  } catch {
    return null;
  }
}

async function buildOperationBatches(
  operations: readonly SyncOperation[],
): Promise<
  DataResult<
    readonly { readonly operations: readonly SyncOperation[]; readonly bytes: Uint8Array }[]
  >
> {
  const batches: { operations: SyncOperation[]; bytes: Uint8Array }[] = [];
  let currentOperations: SyncOperation[] = [];
  let currentBytes: Uint8Array | null = null;

  for (const operation of operations) {
    if (!isValidSyncOperation(operation)) {
      currentBytes?.fill(0);
      return dataFailure(
        "data-corrupted",
        "data.sync-batch.invalid-operation",
        "Paikallinen synkronointitoimenpide ei kelpaa lähetettäväksi.",
      );
    }
    const ciphertext = base64UrlToBytes(operation.encryptedPayloadRef);
    if (ciphertext === null) {
      currentBytes?.fill(0);
      return dataFailure(
        "data-corrupted",
        "data.sync-batch.invalid-ciphertext",
        "Paikallisen synkronointitoimenpiteen salattu sisältö ei kelpaa.",
      );
    }
    const digest = await sha256Hex(ciphertext);
    ciphertext.fill(0);
    if (digest === null || digest !== operation.integrityRef) {
      currentBytes?.fill(0);
      return dataFailure(
        "data-corrupted",
        "data.sync-batch.integrity-mismatch",
        "Paikallisen synkronointitoimenpiteen eheystarkistus epäonnistui.",
      );
    }
    const candidateOperations = [...currentOperations, operation];
    const candidateBytes =
      candidateOperations.length <= MAX_SYNC_BATCH_OPERATIONS
        ? encodeBatchBytes(candidateOperations)
        : null;
    if (candidateBytes !== null && candidateBytes.byteLength <= MAX_SYNC_BATCH_BYTES) {
      currentBytes?.fill(0);
      currentOperations = candidateOperations;
      currentBytes = candidateBytes;
      continue;
    }
    candidateBytes?.fill(0);
    if (currentOperations.length === 0 || currentBytes === null) {
      return dataFailure(
        "invalid-input",
        "data.sync-batch.operation-too-large",
        "Yksittäinen synkronointierä ylittää sallitun koon.",
      );
    }
    batches.push({ operations: currentOperations, bytes: currentBytes });
    currentOperations = [operation];
    currentBytes = encodeBatchBytes(currentOperations);
    if (currentBytes === null || currentBytes.byteLength > MAX_SYNC_BATCH_BYTES) {
      currentBytes?.fill(0);
      return dataFailure(
        "invalid-input",
        "data.sync-batch.operation-too-large",
        "Yksittäinen synkronointierä ylittää sallitun koon.",
      );
    }
  }
  if (currentBytes !== null) batches.push({ operations: currentOperations, bytes: currentBytes });
  return { ok: true, value: batches };
}

async function decryptSyncOperation(
  operation: SyncOperation,
  keySession: DataKeySession,
  cryptoAdapter: SyncCryptoAdapter,
): Promise<DataResult<SyncPayload>> {
  const ciphertext = base64UrlToBytes(operation.encryptedPayloadRef);
  if (ciphertext === null) {
    return dataFailure(
      "data-corrupted",
      "data.sync.operation.invalid-ciphertext",
      "Vastaanotetun synkronointitoimenpiteen salattu sisältö ei kelpaa.",
    );
  }
  const digest = await sha256Hex(ciphertext);
  if (digest === null || digest !== operation.integrityRef) {
    ciphertext.fill(0);
    return dataFailure(
      "data-corrupted",
      "data.sync.operation.integrity-mismatch",
      "Synkronointimuutoksen eheystarkistus epäonnistui.",
    );
  }
  let decrypted: SyncCryptoResult<Uint8Array>;
  try {
    decrypted = await keySession.withKey((key) =>
      cryptoAdapter.decrypt({
        ciphertext,
        key,
        context: {
          operationId: operation.operationId,
          installationId: operation.installationId,
          entityType: operation.entityType,
          entityId: operation.entityId,
          operation: operation.operation,
          entityVersion: operation.entityVersion,
          occurredAt: operation.occurredAt,
        },
      }),
    );
  } catch {
    ciphertext.fill(0);
    return dataFailure(
      "transient-failure",
      "data.sync.operation.decrypt-failed",
      "Synkronointitietoa ei voitu avata. Tarkista sovelluksen lukitus.",
    );
  }
  ciphertext.fill(0);
  if (!decrypted.ok) return { ok: false, error: dataErrorFromCrypto(decrypted.error) };
  const payload = decodeSyncPayload(decrypted.value);
  const entityId = payload.ok ? payload.value.entity.id : undefined;
  decrypted.value.fill(0);
  if (!payload.ok) return payload;
  if (
    typeof entityId !== "string" ||
    entityId !== operation.entityId ||
    typeof payload.value.entity.createdAt !== "string" ||
    typeof payload.value.entity.updatedAt !== "string" ||
    typeof payload.value.entity.version !== "number" ||
    payload.value.entity.version !== operation.entityVersion ||
    (Object.hasOwn(payload.value.entity, "deletedAt") &&
      payload.value.entity.deletedAt !== null &&
      (typeof payload.value.entity.deletedAt !== "string" ||
        !isTimestamp(payload.value.entity.deletedAt)))
  ) {
    return dataFailure(
      "data-corrupted",
      "data.sync.operation.entity-mismatch",
      "Synkronointitoimenpide ei vastannut sen sisältöä.",
    );
  }
  if (operation.operation === "create") {
    const allDataFields = Object.keys(payload.value.entity).filter(
      (field) => !SYNC_ENTITY_METADATA_FIELDS.has(field),
    );
    if (
      allDataFields.length !== payload.value.changedFields.length ||
      !allDataFields.every((field) => payload.value.changedFields.includes(field))
    ) {
      return dataFailure(
        "data-corrupted",
        "data.sync.operation.create-fields-incomplete",
        "Uuden synkronoitavan tietueen kentät puuttuivat.",
      );
    }
  }
  if (
    operation.operation === "delete" &&
    (typeof payload.value.entity.deletedAt !== "string" ||
      !isTimestamp(payload.value.entity.deletedAt) ||
      payload.value.changedFields.length !== 1 ||
      payload.value.changedFields[0] !== "deletedAt")
  ) {
    return dataFailure(
      "data-corrupted",
      "data.sync.operation.invalid-tombstone",
      "Vastaanotetun poiston tombstone ei kelpaa.",
    );
  }
  return payload;
}

function newBrowserInstallationOperationId(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  bytes.fill(0);
  return `browser-installation-${random}`;
}

async function queueBrowserInstallationMetadata(input: {
  readonly installationId: string;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
  readonly entityStore: SyncEntityStoreAdapter;
}): Promise<DataResult<true>> {
  const currentResult = await input.entityStore.read(
    BROWSER_INSTALLATION_ENTITY_TYPE,
    input.installationId,
  );
  if (!currentResult.ok) return currentResult;
  const current = currentResult.value;
  if (current === null) return { ok: true, value: true };
  if (
    current.id !== input.installationId ||
    current.installationId !== input.installationId ||
    typeof current.installationName !== "string" ||
    typeof current.lastSeenAppVersion !== "string" ||
    (current.revokedAt !== null && !isTimestamp(current.revokedAt)) ||
    typeof current.createdAt !== "string" ||
    typeof current.updatedAt !== "string" ||
    typeof current.version !== "number" ||
    !Number.isSafeInteger(current.version) ||
    current.version < 1
  ) {
    return dataFailure(
      "data-corrupted",
      "data.sync.installation.invalid-snapshot",
      "Selaininstanssin synkronointitiedot eivät kelpaa.",
    );
  }
  if (current.revokedAt !== null) {
    return dataFailure(
      "invalid-input",
      "data.sync.installation.revoked",
      "Tämän selaimen synkkausoikeus on peruttu. Parita selain uudelleen ennen synkronointia.",
    );
  }

  const operationsResult = await listSyncOperations();
  if (!operationsResult.ok) return operationsResult;
  const priorOperations = operationsResult.value
    .filter(
      (operation) =>
        operation.installationId === input.installationId &&
        operation.entityType === BROWSER_INSTALLATION_ENTITY_TYPE &&
        operation.entityId === input.installationId,
    )
    .sort((first, second) => {
      const versionDifference = first.entityVersion - second.entityVersion;
      return versionDifference === 0
        ? first.operationId.localeCompare(second.operationId)
        : versionDifference;
    });
  const latest = priorOperations.at(-1);
  let operation: SyncOperation["operation"] = "create";
  let changedFields: readonly string[] = ["installationId", ...BROWSER_INSTALLATION_SYNC_FIELDS];
  let entityVersion = current.version;

  if (latest !== undefined) {
    const previousPayload = await decryptSyncOperation(latest, input.keySession, input.crypto);
    if (!previousPayload.ok) return previousPayload;
    changedFields = BROWSER_INSTALLATION_SYNC_FIELDS.filter(
      (field) => !syncJsonValuesEqual(current[field], previousPayload.value.entity[field]),
    );
    if (changedFields.length === 0) return { ok: true, value: true };
    operation = "update";
    entityVersion = Math.max(current.version, latest.entityVersion + 1);
  }

  const operationId = newBrowserInstallationOperationId();
  if (operationId === null) {
    return dataFailure(
      "transient-failure",
      "data.sync.installation.random-unavailable",
      "Selaininstanssin synkronointia ei voitu valmistella turvallisesti.",
    );
  }
  const entity: SyncPayloadEntity = { ...current, version: entityVersion };
  const encrypted = await createEncryptedSyncOperation({
    operationId,
    installationId: input.installationId,
    entityType: BROWSER_INSTALLATION_ENTITY_TYPE,
    entityId: input.installationId,
    operation,
    entityVersion,
    occurredAt: current.updatedAt,
    createdAt: current.createdAt,
    entity,
    changedFields,
    keySession: input.keySession,
    crypto: input.crypto,
  });
  if (!encrypted.ok) return encrypted;
  return appendSyncOperation(encrypted.value);
}

function parseConflictVersionRef(
  reference: string,
): { readonly operationId: string; readonly field: string } | null {
  const prefix = "sync-operation:";
  const separator = "#field=";
  if (!reference.startsWith(prefix)) return null;
  const separatorIndex = reference.indexOf(separator, prefix.length);
  if (separatorIndex <= prefix.length) return null;
  try {
    const operationId = decodeURIComponent(reference.slice(prefix.length, separatorIndex));
    const field = decodeURIComponent(reference.slice(separatorIndex + separator.length));
    return operationId.length > 0 && field.length > 0 ? { operationId, field } : null;
  } catch {
    return null;
  }
}

/** Decrypt only the two field values referenced by a conflict record. */
export async function readConflictVersionValues(input: {
  readonly conflict: ConflictRecord;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
}): Promise<DataResult<SyncConflictVersionValues>> {
  const localRef = parseConflictVersionRef(input.conflict.localVersionRef);
  const remoteRef = parseConflictVersionRef(input.conflict.remoteVersionRef);
  if (localRef === null || remoteRef === null || localRef.field !== remoteRef.field) {
    return dataFailure(
      "data-corrupted",
      "data.sync.conflict.invalid-version-reference",
      "Ristiriidan versioita ei voitu lukea turvallisesti.",
    );
  }
  const operationsResult = await listSyncOperations();
  if (!operationsResult.ok) return operationsResult;
  const operations = new Map(
    operationsResult.value.map((operation) => [operation.operationId, operation]),
  );
  const localOperation = operations.get(localRef.operationId);
  const remoteOperation = operations.get(remoteRef.operationId);
  if (
    localOperation === undefined ||
    remoteOperation === undefined ||
    localOperation.entityType !== input.conflict.entityType ||
    remoteOperation.entityType !== input.conflict.entityType ||
    localOperation.entityId !== input.conflict.entityId ||
    remoteOperation.entityId !== input.conflict.entityId
  ) {
    return dataFailure(
      "data-corrupted",
      "data.sync.conflict.version-not-found",
      "Ristiriidan versioita ei löytynyt paikallisesta salatusta lokista.",
    );
  }
  const localPayload = await decryptSyncOperation(localOperation, input.keySession, input.crypto);
  if (!localPayload.ok) return localPayload;
  const remotePayload = await decryptSyncOperation(remoteOperation, input.keySession, input.crypto);
  if (!remotePayload.ok) return remotePayload;
  const field = localRef.field;
  return {
    ok: true,
    value: {
      field,
      localValue:
        field === "$entity"
          ? localPayload.value.entity
          : Object.hasOwn(localPayload.value.entity, field)
            ? localPayload.value.entity[field]
            : undefined,
      remoteValue:
        field === "$entity"
          ? remotePayload.value.entity
          : Object.hasOwn(remotePayload.value.entity, field)
            ? remotePayload.value.entity[field]
            : undefined,
    },
  };
}

function parseSyncOperation(value: unknown): SyncOperation | null {
  if (!isRecord(value)) return null;
  const expectedKeys = [
    "id",
    "operationId",
    "installationId",
    "entityType",
    "entityId",
    "operation",
    "entityVersion",
    "occurredAt",
    "encryptedPayloadRef",
    "integrityRef",
    "createdAt",
    "updatedAt",
    "version",
  ];
  if (
    Object.keys(value).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(value, key))
  ) {
    return null;
  }
  return isValidSyncOperation(value) ? operationForWire(value) : null;
}

async function decodeBatchBytes(bytes: Uint8Array): Promise<DataResult<readonly SyncOperation[]>> {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_SYNC_BATCH_BYTES ||
    typeof TextDecoder === "undefined"
  ) {
    return dataFailure(
      "data-corrupted",
      "data.sync-batch.invalid-size",
      "Synkronointierän koko tai merkistökoodaus ei kelpaa.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return dataFailure(
      "data-corrupted",
      "data.sync-batch.invalid-json",
      "Synkronointierän rakenne on virheellinen.",
    );
  }
  if (
    !isRecord(parsed) ||
    Object.keys(parsed).length !== 3 ||
    parsed.format !== SYNC_BATCH_FORMAT ||
    parsed.version !== SYNC_BATCH_VERSION ||
    !Array.isArray(parsed.operations) ||
    parsed.operations.length === 0 ||
    parsed.operations.length > MAX_SYNC_BATCH_OPERATIONS
  ) {
    return dataFailure(
      "data-corrupted",
      "data.sync-batch.unsupported-format",
      "Synkronointierän versiota tai rakennetta ei tueta.",
    );
  }
  const operations: SyncOperation[] = [];
  const operationIds = new Set<string>();
  for (const candidate of parsed.operations) {
    const operation = parseSyncOperation(candidate);
    if (operation === null || operationIds.has(operation.operationId)) {
      return dataFailure(
        "data-corrupted",
        "data.sync-batch.invalid-operation",
        "Synkronointierän toimenpidetiedot eivät kelpaa.",
      );
    }
    operationIds.add(operation.operationId);
    const ciphertext = base64UrlToBytes(operation.encryptedPayloadRef);
    if (ciphertext === null) {
      return dataFailure(
        "data-corrupted",
        "data.sync-batch.invalid-ciphertext",
        "Synkronointierän salattu sisältö ei kelpaa.",
      );
    }
    const digest = await sha256Hex(ciphertext);
    ciphertext.fill(0);
    if (digest === null || digest !== operation.integrityRef) {
      return dataFailure(
        "data-corrupted",
        "data.sync-batch.integrity-mismatch",
        "Synkronointierän eheystarkistus epäonnistui.",
      );
    }
    operations.push(operation);
  }
  return { ok: true, value: operations };
}

function localFailure<T>(error: DataError): SyncCoordinatorResult<T> {
  return {
    ok: false,
    error: {
      source: "local",
      code: error.code,
      diagnosticCode: error.diagnosticCode,
      userMessage: error.userMessage,
    },
  };
}

function providerFailure<T>(error: SyncProviderError): SyncCoordinatorResult<T> {
  return {
    ok: false,
    error: {
      source: "provider",
      code: error.code,
      diagnosticCode: error.diagnosticCode,
      userMessage: error.userMessage,
      ...(error.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: error.retryAfterSeconds }),
    },
  };
}

function isProviderObjectRef(value: unknown): value is SyncProviderObjectRef {
  return (
    isRecord(value) &&
    typeof value.objectId === "string" &&
    value.objectId.length > 0 &&
    typeof value.revision === "string" &&
    value.revision.length > 0
  );
}

function invalidCoordinatorInput<T>(): SyncCoordinatorResult<T> {
  return {
    ok: false,
    error: {
      source: "local",
      code: "invalid-input",
      diagnosticCode: "data.sync.invalid-input",
      userMessage: "Synkronointipyyntö ei kelpaa.",
    },
  };
}

const SYNC_ENTITY_METADATA_FIELDS = new Set(["id", "createdAt", "updatedAt", "version"]);

function compareFieldClock(first: SyncFieldClock, second: SyncFieldClock): number {
  const timeDifference = Date.parse(first.occurredAt) - Date.parse(second.occurredAt);
  if (timeDifference !== 0) return timeDifference;
  const deletionDifference =
    Number(first.operation === "delete") - Number(second.operation === "delete");
  if (deletionDifference !== 0) return deletionDifference;
  const installationDifference = first.installationId.localeCompare(second.installationId);
  if (installationDifference !== 0) return installationDifference;
  return first.operationId.localeCompare(second.operationId);
}

function fieldClockForChange(
  operation: SyncOperation,
  field: string,
  value: SyncPayloadJsonValue | undefined,
): SyncOperation {
  return field === "deletedAt" && typeof value === "string"
    ? { ...operation, operation: "delete" }
    : operation;
}

function entityKey(entityType: string, entityId: string): string {
  return JSON.stringify([entityType, entityId]);
}

function newConflictSnapshotOperationId(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  bytes.fill(0);
  return `conflict-snapshot-${random}`;
}

async function mergeDownloadedEntities(input: {
  readonly receivedOperations: readonly SyncOperation[];
  readonly installationId: string;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
  readonly entityStore: SyncEntityStoreAdapter;
  readonly decryptedPayloads: Map<string, SyncPayload>;
}): Promise<DataResult<{ readonly mergedEntities: number; readonly mergeConflicts: number }>> {
  if (input.receivedOperations.length === 0) {
    return { ok: true, value: { mergedEntities: 0, mergeConflicts: 0 } };
  }
  const allOperationsResult = await listSyncOperations();
  if (!allOperationsResult.ok) return allOperationsResult;
  const allOperations = allOperationsResult.value;
  const groups = new Map<string, SyncOperation[]>();
  for (const operation of input.receivedOperations) {
    const key = entityKey(operation.entityType, operation.entityId);
    const group = groups.get(key) ?? [];
    if (!group.some((candidate) => candidate.operationId === operation.operationId)) {
      group.push(operation);
      groups.set(key, group);
    }
  }

  let mergedEntities = 0;
  let mergeConflicts = 0;
  for (const receivedGroup of groups.values()) {
    const first = receivedGroup[0];
    if (first === undefined) continue;
    const entityOperations = allOperations.filter(
      (operation) =>
        operation.entityType === first.entityType && operation.entityId === first.entityId,
    );
    const operationsById = new Map<string, SyncOperation>(
      entityOperations.map((operation) => [operation.operationId, operation]),
    );
    const changesByOperationId = new Map<string, SyncEntityChange>();
    for (const operation of entityOperations) {
      let payload = input.decryptedPayloads.get(operation.operationId);
      if (payload === undefined) {
        const decrypted = await decryptSyncOperation(operation, input.keySession, input.crypto);
        if (!decrypted.ok) return decrypted;
        payload = decrypted.value;
        input.decryptedPayloads.set(operation.operationId, payload);
      }
      changesByOperationId.set(operation.operationId, {
        operation,
        entity: payload.entity,
        changedFields: payload.changedFields,
      });
    }

    const currentResult = await input.entityStore.read(first.entityType, first.entityId);
    if (!currentResult.ok) return currentResult;
    const currentEntity = currentResult.value;
    const fieldClocks: Record<string, SyncFieldClock> = {};
    if (currentEntity !== null) {
      // A current entity timestamp covers the whole record, but a matching
      // operation gives the actual clock for the specific field it changed.
      // Keep those clocks separately so an edit to `notes` does not make an
      // older, independent remote edit to `title` look stale.
      const matchedFieldClocks = new Map<string, SyncFieldClock>();
      const baselineClock: SyncFieldClock = {
        operationId: `local-snapshot:${first.entityId}`,
        installationId: input.installationId,
        operation: "update",
        occurredAt: currentEntity.updatedAt as string,
        entityVersion: currentEntity.version as number,
      };
      for (const field of Object.keys(currentEntity)) {
        if (!SYNC_ENTITY_METADATA_FIELDS.has(field)) {
          if (field === "deletedAt") {
            fieldClocks[field] =
              typeof currentEntity.deletedAt === "string"
                ? {
                    ...baselineClock,
                    operation: "delete",
                    occurredAt: currentEntity.deletedAt,
                  }
                : {
                    ...baselineClock,
                    operation: "create",
                    occurredAt: currentEntity.createdAt as string,
                  };
          } else {
            fieldClocks[field] = baselineClock;
          }
        }
      }
      for (const change of changesByOperationId.values()) {
        const fields =
          change.operation.operation === "create"
            ? Object.keys(change.entity).filter((field) => !SYNC_ENTITY_METADATA_FIELDS.has(field))
            : change.changedFields;
        for (const field of fields) {
          if (
            !SYNC_ENTITY_METADATA_FIELDS.has(field) &&
            Object.hasOwn(currentEntity, field) === Object.hasOwn(change.entity, field) &&
            syncJsonValuesEqual(
              Object.hasOwn(currentEntity, field) ? currentEntity[field] : undefined,
              Object.hasOwn(change.entity, field) ? change.entity[field] : undefined,
            )
          ) {
            const currentClock = matchedFieldClocks.get(field);
            const matchingClock = fieldClockForChange(
              change.operation,
              field,
              currentEntity[field],
            );
            if (currentClock === undefined || compareFieldClock(currentClock, matchingClock) < 0) {
              matchedFieldClocks.set(field, matchingClock);
            }
          }
        }
      }
      for (const [field, clock] of matchedFieldClocks) {
        fieldClocks[field] = clock;
      }
      if (first.entityType === "measurement") {
        for (const change of changesByOperationId.values()) {
          if (
            change.operation.operation === "create" &&
            syncJsonValuesEqual(currentEntity, change.entity)
          ) {
            const currentClock = fieldClocks.$entity;
            if (
              currentClock === undefined ||
              compareFieldClock(currentClock, change.operation) < 0
            ) {
              fieldClocks.$entity = change.operation;
            }
          }
        }
      }
    }

    const remoteChanges = [...changesByOperationId.values()].filter(
      (change) => change.operation.installationId !== input.installationId,
    );
    let merged = mergeSyncEntityChanges({
      entityType: first.entityType,
      currentEntity,
      currentFieldClocks: fieldClocks,
      changes: remoteChanges,
    });
    if (!merged.ok) return merged;
    const snapshotFields = new Set<string>();
    for (const conflict of merged.value.conflicts) {
      if (
        currentEntity === null ||
        !conflict.currentOperationId.startsWith("local-snapshot") ||
        snapshotFields.has(conflict.field)
      ) {
        continue;
      }
      const operationId = newConflictSnapshotOperationId();
      if (operationId === null) {
        return dataFailure(
          "transient-failure",
          "data.sync.conflict.snapshot-id-unavailable",
          "Synkronointiristiriidan paikallisversiota ei voitu säilyttää.",
        );
      }
      const isWholeEntitySnapshot = first.entityType === "measurement";
      const changedFields = isWholeEntitySnapshot
        ? Object.keys(currentEntity).filter((field) => !SYNC_ENTITY_METADATA_FIELDS.has(field))
        : [conflict.field];
      const snapshot = await createEncryptedSyncOperation({
        operationId,
        installationId: input.installationId,
        entityType: first.entityType,
        entityId: first.entityId,
        operation: isWholeEntitySnapshot ? "create" : "update",
        entityVersion: currentEntity.version as number,
        occurredAt: currentEntity.updatedAt as string,
        createdAt: currentEntity.createdAt as string,
        entity: currentEntity,
        changedFields,
        keySession: input.keySession,
        crypto: input.crypto,
      });
      if (!snapshot.ok) return snapshot;
      const appended = await appendSyncOperation(snapshot.value);
      if (!appended.ok) return appended;
      operationsById.set(snapshot.value.operationId, snapshot.value);
      fieldClocks[conflict.field] = snapshot.value;
      snapshotFields.add(conflict.field);
    }
    if (snapshotFields.size > 0) {
      merged = mergeSyncEntityChanges({
        entityType: first.entityType,
        currentEntity,
        currentFieldClocks: fieldClocks,
        changes: remoteChanges,
      });
      if (!merged.ok) return merged;
    }
    for (const conflict of merged.value.conflicts) {
      const saved = await saveSyncFieldConflict({
        entityType: first.entityType,
        entityId: first.entityId,
        localInstallationId: input.installationId,
        conflict,
        operations: operationsById,
      });
      if (!saved.ok) return saved;
    }
    mergeConflicts += merged.value.conflicts.length;
    if (currentEntity === null || merged.value.changed) {
      const written = await input.entityStore.write(
        first.entityType,
        first.entityId,
        merged.value.entity,
      );
      if (!written.ok) return written;
      mergedEntities += 1;
    }
  }
  return { ok: true, value: { mergedEntities, mergeConflicts } };
}

export async function syncReplica(input: {
  readonly provider: SyncProvider;
  readonly installationId: string;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
  readonly entityStore: SyncEntityStoreAdapter;
}): Promise<SyncCoordinatorResult<SyncReplicaSummary>> {
  if (
    typeof input.installationId !== "string" ||
    input.installationId.length === 0 ||
    input.installationId.length > 128
  ) {
    return invalidCoordinatorInput();
  }
  if (
    !isRecord(input.entityStore) ||
    typeof input.entityStore.read !== "function" ||
    typeof input.entityStore.write !== "function"
  ) {
    return invalidCoordinatorInput();
  }
  if (
    !isRecord(input.provider) ||
    typeof input.provider.providerId !== "string" ||
    input.provider.providerId.length === 0 ||
    input.provider.providerId.length > 128 ||
    typeof input.provider.upload !== "function" ||
    typeof input.provider.listChanges !== "function" ||
    typeof input.provider.download !== "function"
  ) {
    return invalidCoordinatorInput();
  }
  if (!input.keySession.isUnlocked) {
    return {
      ok: false,
      error: {
        source: "local",
        code: "unauthorized",
        diagnosticCode: "data.sync.key-locked",
        userMessage: "Avaa sovelluksen lukitus ennen synkronointia.",
      },
    };
  }
  try {
    const installationMetadata = await queueBrowserInstallationMetadata({
      installationId: input.installationId,
      keySession: input.keySession,
      crypto: input.crypto,
      entityStore: input.entityStore,
    });
    if (!installationMetadata.ok) {
      if (installationMetadata.error.diagnosticCode === "data.sync.installation.revoked") {
        return {
          ok: false,
          error: {
            source: "local",
            code: "unauthorized",
            diagnosticCode: installationMetadata.error.diagnosticCode,
            userMessage: installationMetadata.error.userMessage,
          },
        };
      }
      return localFailure(installationMetadata.error);
    }
    const localResult = await listSyncOperations();
    if (!localResult.ok) return localFailure(localResult.error);
    const localOperations = localResult.value
      .filter((operation) => operation.installationId === input.installationId)
      .slice()
      .sort((first, second) => {
        const timeDifference = Date.parse(first.occurredAt) - Date.parse(second.occurredAt);
        return timeDifference === 0
          ? first.operationId.localeCompare(second.operationId)
          : timeDifference;
      });
    const batches = await buildOperationBatches(localOperations);
    if (!batches.ok) return localFailure(batches.error);

    let uploadedOperations = 0;
    for (const batch of batches.value) {
      const idempotencyDigest = await sha256Hex(batch.bytes);
      if (idempotencyDigest === null) {
        batch.bytes.fill(0);
        return {
          ok: false,
          error: {
            source: "local",
            code: "transient-failure",
            diagnosticCode: "data.sync.hash-unavailable",
            userMessage: "Synkronointierää ei voitu valmistella turvallisesti.",
          },
        };
      }
      let uploaded;
      try {
        uploaded = await input.provider.upload({
          idempotencyKey: `sync-batch-v1:${idempotencyDigest}`,
          ciphertext: batch.bytes,
        });
      } finally {
        batch.bytes.fill(0);
      }
      if (!uploaded.ok) return providerFailure(uploaded.error);
      uploadedOperations += batch.operations.length;
    }

    const storedCursor = await getSyncCursor(input.installationId, input.provider.providerId);
    if (!storedCursor.ok) return localFailure(storedCursor.error);
    const startingCursor = storedCursor.value?.providerCursor ?? null;
    let cursor: string | null = startingCursor;
    let downloadedBatches = 0;
    let receivedOperations = 0;
    let skippedOwnOperations = 0;
    const operationsForMerge = new Map<string, SyncOperation>();
    const decryptedPayloads = new Map<string, SyncPayload>();
    const cursors = new Set<string>();
    let pages = 0;
    for (;;) {
      pages += 1;
      if (pages > MAX_SYNC_LIST_PAGES) {
        return {
          ok: false,
          error: {
            source: "provider",
            code: "transient-failure",
            diagnosticCode: "data.sync.list.page-limit",
            userMessage: "Synkronointiluettelo on liian suuri yhdelle synkka-ajolle.",
          },
        };
      }
      const page = await input.provider.listChanges({ cursor, limit: 500 });
      if (!page.ok) return providerFailure(page.error);
      const references: unknown = page.value.objects;
      if (
        !Array.isArray(references) ||
        !references.every(isProviderObjectRef) ||
        typeof page.value.cursor !== "string" ||
        page.value.cursor.length === 0 ||
        typeof page.value.hasMore !== "boolean"
      ) {
        return {
          ok: false,
          error: {
            source: "provider",
            code: "transient-failure",
            diagnosticCode: "data.sync.list.invalid-page",
            userMessage: "Synkronointipalvelu palautti virheellisen sivun.",
          },
        };
      }
      if (page.value.hasMore && (page.value.cursor === cursor || cursors.has(page.value.cursor))) {
        return {
          ok: false,
          error: {
            source: "provider",
            code: "transient-failure",
            diagnosticCode: "data.sync.list.repeated-cursor",
            userMessage: "Synkronointipalvelun jatkokohta ei edennyt.",
          },
        };
      }
      cursors.add(page.value.cursor);
      for (const reference of references) {
        const downloaded = await input.provider.download(reference);
        if (!downloaded.ok) return providerFailure(downloaded.error);
        if (
          downloaded.value.object.objectId !== reference.objectId ||
          downloaded.value.object.revision !== reference.revision
        ) {
          downloaded.value.ciphertext.fill(0);
          return {
            ok: false,
            error: {
              source: "provider",
              code: "conflict",
              diagnosticCode: "data.sync.download.reference-mismatch",
              userMessage: "Synkronointitiedoston versio ei vastannut luetteloa.",
            },
          };
        }
        const decoded = await decodeBatchBytes(downloaded.value.ciphertext);
        downloaded.value.ciphertext.fill(0);
        if (!decoded.ok) return localFailure(decoded.error);
        downloadedBatches += 1;
        for (const operation of decoded.value) {
          if (operation.installationId === input.installationId) {
            skippedOwnOperations += 1;
            continue;
          }
          const decrypted = await decryptSyncOperation(operation, input.keySession, input.crypto);
          if (!decrypted.ok) return localFailure(decrypted.error);
          decryptedPayloads.set(operation.operationId, decrypted.value);
          operationsForMerge.set(operation.operationId, operation);
        }
      }
      cursor = page.value.cursor;
      if (!page.value.hasMore) break;
    }

    const revokedAtByInstallation = new Map<string, string>();
    const setRevocationCutoff = (installationId: string, revokedAt: string): void => {
      const existing = revokedAtByInstallation.get(installationId);
      if (existing === undefined || Date.parse(revokedAt) < Date.parse(existing)) {
        revokedAtByInstallation.set(installationId, revokedAt);
      }
    };
    for (const authorId of new Set(
      [...operationsForMerge.values()].map((operation) => operation.installationId),
    )) {
      const metadata = await input.entityStore.read(BROWSER_INSTALLATION_ENTITY_TYPE, authorId);
      if (!metadata.ok) return localFailure(metadata.error);
      const entity = metadata.value;
      if (
        entity !== null &&
        entity.id === authorId &&
        entity.installationId === authorId &&
        typeof entity.revokedAt === "string" &&
        Number.isFinite(Date.parse(entity.revokedAt))
      ) {
        setRevocationCutoff(authorId, entity.revokedAt);
      }
    }
    for (const operation of operationsForMerge.values()) {
      const payload = decryptedPayloads.get(operation.operationId);
      if (
        operation.entityType === BROWSER_INSTALLATION_ENTITY_TYPE &&
        payload !== undefined &&
        (operation.operation === "create" || payload.changedFields.includes("revokedAt")) &&
        payload.entity.id === operation.entityId &&
        payload.entity.installationId === operation.entityId &&
        typeof payload.entity.revokedAt === "string" &&
        Number.isFinite(Date.parse(payload.entity.revokedAt))
      ) {
        setRevocationCutoff(operation.entityId, payload.entity.revokedAt);
      }
    }
    const acceptedOperations: SyncOperation[] = [];
    for (const operation of operationsForMerge.values()) {
      const cutoff = revokedAtByInstallation.get(operation.installationId);
      const payload = decryptedPayloads.get(operation.operationId);
      const isOwnRevocationAnnouncement =
        cutoff !== undefined &&
        operation.entityType === BROWSER_INSTALLATION_ENTITY_TYPE &&
        operation.entityId === operation.installationId &&
        payload?.entity.revokedAt === cutoff &&
        Date.parse(operation.occurredAt) === Date.parse(cutoff);
      if (
        cutoff !== undefined &&
        Date.parse(operation.occurredAt) >= Date.parse(cutoff) &&
        !isOwnRevocationAnnouncement
      ) {
        continue;
      }
      const appended = await appendRemoteSyncOperation(operation);
      if (!appended.ok) return localFailure(appended.error);
      acceptedOperations.push(operation);
    }
    operationsForMerge.clear();
    for (const operation of acceptedOperations) {
      operationsForMerge.set(operation.operationId, operation);
    }
    receivedOperations = acceptedOperations.length;

    const merge = await mergeDownloadedEntities({
      receivedOperations: [...operationsForMerge.values()],
      installationId: input.installationId,
      keySession: input.keySession,
      crypto: input.crypto,
      entityStore: input.entityStore,
      decryptedPayloads,
    });
    if (!merge.ok) return localFailure(merge.error);

    if (cursor !== startingCursor) {
      const latestReceivedOperation = [...operationsForMerge.values()]
        .sort((first, second) => {
          const timeDifference = Date.parse(first.occurredAt) - Date.parse(second.occurredAt);
          return timeDifference === 0
            ? first.operationId.localeCompare(second.operationId)
            : timeDifference;
        })
        .at(-1);
      const savedCursor = await saveSyncCursor({
        installationId: input.installationId,
        providerId: input.provider.providerId,
        providerCursor: cursor,
        lastSeenOperationId:
          latestReceivedOperation?.operationId ?? storedCursor.value?.lastSeenOperationId ?? null,
      });
      if (!savedCursor.ok) return localFailure(savedCursor.error);
    }

    return {
      ok: true,
      value: {
        uploadedBatches: batches.value.length,
        uploadedOperations,
        downloadedBatches,
        receivedOperations,
        skippedOwnOperations,
        mergedEntities: merge.value.mergedEntities,
        mergeConflicts: merge.value.mergeConflicts,
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        source: "local",
        code: "transient-failure",
        diagnosticCode: "data.sync.unexpected-failure",
        userMessage: "Synkronointia ei voitu suorittaa. Yritä uudelleen.",
      },
    };
  }
}
