// T320: portable snapshot wrapped in a versioned AES-GCM backup envelope.
// The complete clear manifest is authenticated as AEAD associated data.

import { gcm } from "@noble/ciphers/webcrypto.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import type { BackupManifest } from "@lifeos/domain";
import { CURRENT_SCHEMA_VERSION } from "./migrations.ts";
import {
  buildPortableDataSnapshot,
  PORTABLE_DATA_COLLECTION_KEYS as COLLECTION_KEYS,
  type PortableDataSnapshotInput,
} from "./portable-data-export.ts";
import type { DataKeySession } from "./key-material.ts";
import { SYNC_CRYPTO_VERSION } from "./sync-crypto.ts";

export const ENCRYPTED_BACKUP_FORMAT = "lifeos-encrypted-backup" as const;
export const ENCRYPTED_BACKUP_FORMAT_VERSION = 1 as const;
export const ENCRYPTED_BACKUP_CRYPTO_VERSION = SYNC_CRYPTO_VERSION;

const BACKUP_ID_BYTES = 16;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const MAX_BACKUP_PLAINTEXT_BYTES = 64 * 1024 * 1024;
const MAX_BACKUP_CIPHERTEXT_HEX_LENGTH =
  (MAX_BACKUP_PLAINTEXT_BYTES + AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) * 2;
export const MAX_ENCRYPTED_BACKUP_FILE_BYTES = MAX_BACKUP_CIPHERTEXT_HEX_LENGTH + 128 * 1024;
const FORMAT_KEYS = ["format", "formatVersion", "manifest", "encryptedDataHex"] as const;
const MANIFEST_KEYS = [
  "id",
  "createdAt",
  "updatedAt",
  "version",
  "backupVersion",
  "schemaVersion",
  "cryptoVersion",
  "contents",
] as const;
const managedGcm = managedNonce(gcm);
const textEncoder = new TextEncoder();

export interface EncryptedBackup {
  readonly format: typeof ENCRYPTED_BACKUP_FORMAT;
  readonly formatVersion: typeof ENCRYPTED_BACKUP_FORMAT_VERSION;
  readonly manifest: BackupManifest;
  /** Hex of the 96-bit nonce, ciphertext, and 128-bit GCM tag. */
  readonly encryptedDataHex: string;
}

export type EncryptedBackupErrorCode =
  | "invalid-input"
  | "invalid-format"
  | "unsupported-version"
  | "crypto-unavailable"
  | "encryption-failed"
  | "authentication-failed";

export interface EncryptedBackupError {
  readonly code: EncryptedBackupErrorCode;
  readonly diagnosticCode: string;
  readonly userMessage: string;
}

export type EncryptedBackupResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: EncryptedBackupError };

export interface OpenedEncryptedBackup {
  readonly manifest: BackupManifest;
  /** Parsed, authenticated data is still untrusted until a restore validator checks each record. */
  readonly payload: unknown;
}

function failure<T>(
  code: EncryptedBackupErrorCode,
  diagnosticCode: string,
  userMessage: string,
): EncryptedBackupResult<T> {
  return { ok: false, error: { code, diagnosticCode, userMessage } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHex(value: unknown, minLength: number, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length >= minLength &&
    value.length <= maxLength &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/.test(value)
  );
}

function normalizeManifest(value: unknown): EncryptedBackupResult<BackupManifest> {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) {
    return failure(
      "invalid-format",
      "encrypted-backup.manifest.invalid-shape",
      "Varmuuskopion manifesti ei ole kelvollinen.",
    );
  }

  if (value.backupVersion !== ENCRYPTED_BACKUP_FORMAT_VERSION) {
    return failure(
      "unsupported-version",
      "encrypted-backup.manifest.unsupported-backup-version",
      "Varmuuskopion versiota ei tueta.",
    );
  }
  if (value.cryptoVersion !== ENCRYPTED_BACKUP_CRYPTO_VERSION) {
    return failure(
      "unsupported-version",
      "encrypted-backup.manifest.unsupported-crypto-version",
      "Varmuuskopion salausversiota ei tueta.",
    );
  }

  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    return failure(
      "invalid-format",
      "encrypted-backup.manifest.invalid-fields",
      "Varmuuskopion manifestin tiedot eivät kelpaa.",
    );
  }
  if ((value.schemaVersion as number) > CURRENT_SCHEMA_VERSION) {
    return failure(
      "unsupported-version",
      "encrypted-backup.manifest.unsupported-schema-version",
      "Varmuuskopion tietokantaversiota ei tueta.",
    );
  }

  if (
    typeof value.id !== "string" ||
    !/^[0-9a-f]{32}$/.test(value.id) ||
    !isCanonicalTimestamp(value.createdAt) ||
    !isCanonicalTimestamp(value.updatedAt) ||
    !Number.isSafeInteger(value.version) ||
    (value.version as number) < 1 ||
    !isRecord(value.contents)
  ) {
    return failure(
      "invalid-format",
      "encrypted-backup.manifest.invalid-fields",
      "Varmuuskopion manifestin tiedot eivät kelpaa.",
    );
  }

  const rawContents = value.contents;
  if (
    !hasExactKeys(rawContents, COLLECTION_KEYS) ||
    !COLLECTION_KEYS.every(
      (key) => Number.isSafeInteger(rawContents[key]) && (rawContents[key] as number) >= 0,
    )
  ) {
    return failure(
      "invalid-format",
      "encrypted-backup.manifest.invalid-contents",
      "Varmuuskopion sisältöluettelo ei kelpaa.",
    );
  }

  const contents: Record<string, number> = {};
  for (const key of [...COLLECTION_KEYS].sort()) {
    const count = rawContents[key];
    if (typeof count !== "number") {
      return failure(
        "invalid-format",
        "encrypted-backup.manifest.invalid-contents",
        "Varmuuskopion sisältöluettelo ei kelpaa.",
      );
    }
    contents[key] = count;
  }

  return {
    ok: true,
    value: {
      id: value.id,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      version: value.version as number,
      backupVersion: value.backupVersion,
      schemaVersion: value.schemaVersion as number,
      cryptoVersion: value.cryptoVersion,
      contents,
    },
  };
}

function normalizeEncryptedBackup(value: unknown): EncryptedBackupResult<EncryptedBackup> {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, FORMAT_KEYS) ||
    value.format !== ENCRYPTED_BACKUP_FORMAT
  ) {
    return failure(
      "invalid-format",
      "encrypted-backup.envelope.invalid-shape",
      "Varmuuskopiotiedoston rakenne ei kelpaa.",
    );
  }
  if (value.formatVersion !== ENCRYPTED_BACKUP_FORMAT_VERSION) {
    return failure(
      "unsupported-version",
      "encrypted-backup.envelope.unsupported-version",
      "Varmuuskopiotiedoston versiota ei tueta.",
    );
  }

  const manifest = normalizeManifest(value.manifest);
  if (!manifest.ok) return manifest;
  if (
    !isHex(
      value.encryptedDataHex,
      (AES_GCM_NONCE_BYTES + AES_GCM_TAG_BYTES) * 2,
      MAX_BACKUP_CIPHERTEXT_HEX_LENGTH,
    )
  ) {
    return failure(
      "invalid-format",
      "encrypted-backup.envelope.invalid-ciphertext",
      "Varmuuskopion salattu sisältö ei kelpaa.",
    );
  }

  return {
    ok: true,
    value: {
      format: ENCRYPTED_BACKUP_FORMAT,
      formatVersion: ENCRYPTED_BACKUP_FORMAT_VERSION,
      manifest: manifest.value,
      encryptedDataHex: value.encryptedDataHex,
    },
  };
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function manifestAssociatedData(manifest: BackupManifest): Uint8Array {
  const contents = Object.keys(manifest.contents)
    .sort()
    .map((key) => [key, manifest.contents[key]]);
  return textEncoder.encode(
    JSON.stringify([
      ENCRYPTED_BACKUP_FORMAT,
      ENCRYPTED_BACKUP_FORMAT_VERSION,
      manifest.id,
      manifest.createdAt,
      manifest.updatedAt,
      manifest.version,
      manifest.backupVersion,
      manifest.schemaVersion,
      manifest.cryptoVersion,
      contents,
    ]),
  );
}

function createManifest(snapshot: ReturnType<typeof buildPortableDataSnapshot>): BackupManifest {
  if (
    typeof globalThis.crypto === "undefined" ||
    typeof globalThis.crypto.getRandomValues !== "function"
  ) {
    throw new Error("Secure random number generation is unavailable.");
  }
  const idBytes = new Uint8Array(BACKUP_ID_BYTES);
  try {
    globalThis.crypto.getRandomValues(idBytes);
    const contents: Record<string, number> = {};
    for (const key of [...COLLECTION_KEYS].sort()) {
      contents[key] = snapshot.collections[key].length;
    }
    return {
      id: bytesToHex(idBytes),
      createdAt: snapshot.exportedAt,
      updatedAt: snapshot.exportedAt,
      version: 1,
      backupVersion: ENCRYPTED_BACKUP_FORMAT_VERSION,
      schemaVersion: snapshot.sourceSchemaVersion,
      cryptoVersion: ENCRYPTED_BACKUP_CRYPTO_VERSION,
      contents,
    };
  } finally {
    idBytes.fill(0);
  }
}

function validPortableSnapshot(value: unknown, manifest: BackupManifest): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "format",
      "formatVersion",
      "sourceSchemaVersion",
      "exportedAt",
      "settings",
      "collections",
    ]) ||
    value.format !== "lifeos-portable-export" ||
    value.formatVersion !== 1 ||
    value.sourceSchemaVersion !== manifest.schemaVersion ||
    value.exportedAt !== manifest.createdAt ||
    !isRecord(value.settings) ||
    !isRecord(value.collections)
  ) {
    return false;
  }
  const collections = value.collections;
  if (!hasExactKeys(collections, COLLECTION_KEYS)) return false;
  return COLLECTION_KEYS.every(
    (key) =>
      Array.isArray(collections[key]) &&
      (collections[key] as unknown[]).length === manifest.contents[key],
  );
}

/** Encrypt an explicit portable-data allowlist with the active, memory-only data key. */
export async function createEncryptedBackup(
  input: PortableDataSnapshotInput,
  keySession: DataKeySession,
): Promise<EncryptedBackupResult<EncryptedBackup>> {
  let plaintext: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let nonceAndCiphertext: Uint8Array | undefined;
  try {
    const snapshot = buildPortableDataSnapshot(input);
    const snapshotJson = JSON.stringify(snapshot);
    if (typeof snapshotJson !== "string") {
      return failure(
        "invalid-input",
        "encrypted-backup.create.invalid-snapshot",
        "Varmuuskopion sisältö ei kelpaa.",
      );
    }
    const plaintextBytes = textEncoder.encode(snapshotJson);
    plaintext = plaintextBytes;
    if (plaintextBytes.length > MAX_BACKUP_PLAINTEXT_BYTES) {
      return failure(
        "invalid-input",
        "encrypted-backup.create.too-large",
        "Varmuuskopio on liian suuri salattavaksi.",
      );
    }
    const manifest = createManifest(snapshot);
    const associatedData = manifestAssociatedData(manifest);
    aad = associatedData;
    nonceAndCiphertext = await keySession.withKey(async (sessionKey) => {
      const key = new Uint8Array(sessionKey);
      try {
        return await managedGcm(key, associatedData).encrypt(plaintextBytes);
      } finally {
        key.fill(0);
      }
    });
    return {
      ok: true,
      value: {
        format: ENCRYPTED_BACKUP_FORMAT,
        formatVersion: ENCRYPTED_BACKUP_FORMAT_VERSION,
        manifest,
        encryptedDataHex: bytesToHex(nonceAndCiphertext),
      },
    };
  } catch {
    return failure(
      "encryption-failed",
      "encrypted-backup.create.failed",
      "Varmuuskopiota ei voitu salata. Tarkista, että avain on avattu.",
    );
  } finally {
    plaintext?.fill(0);
    aad?.fill(0);
    nonceAndCiphertext?.fill(0);
  }
}

/** Authenticate the manifest and decrypt the payload; individual records need restore validation. */
export async function openEncryptedBackup(
  value: unknown,
  keySession: DataKeySession,
): Promise<EncryptedBackupResult<OpenedEncryptedBackup>> {
  const normalized = normalizeEncryptedBackup(value);
  if (!normalized.ok) return normalized;

  let ciphertext: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let plaintext: Uint8Array | undefined;
  try {
    const ciphertextBytes = hexToBytes(normalized.value.encryptedDataHex);
    ciphertext = ciphertextBytes;
    const associatedData = manifestAssociatedData(normalized.value.manifest);
    aad = associatedData;
    const plaintextBytes = await keySession.withKey(async (sessionKey) => {
      const key = new Uint8Array(sessionKey);
      try {
        return await managedGcm(key, associatedData).decrypt(ciphertextBytes);
      } finally {
        key.fill(0);
      }
    });
    plaintext = plaintextBytes;
    const payload: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(plaintextBytes),
    );
    if (!validPortableSnapshot(payload, normalized.value.manifest)) {
      return failure(
        "invalid-format",
        "encrypted-backup.open.payload-invalid",
        "Varmuuskopion sisältö ei vastaa sen manifestia.",
      );
    }
    return { ok: true, value: { manifest: normalized.value.manifest, payload } };
  } catch {
    return failure(
      "authentication-failed",
      "encrypted-backup.open.authentication-failed",
      "Varmuuskopiota ei voitu todentaa tai avata.",
    );
  } finally {
    ciphertext?.fill(0);
    aad?.fill(0);
    plaintext?.fill(0);
  }
}

/** Verify an untrusted backup fully without exposing the decrypted payload to the caller. */
export async function verifyEncryptedBackupIntegrity(
  value: unknown,
  keySession: DataKeySession,
): Promise<EncryptedBackupResult<{ readonly manifest: BackupManifest }>> {
  const opened = await openEncryptedBackup(value, keySession);
  if (!opened.ok) return opened;
  return { ok: true, value: { manifest: opened.value.manifest } };
}

/** Encode a validated envelope as a UTF-8-ready JSON file body. */
export function serializeEncryptedBackup(value: unknown): EncryptedBackupResult<string> {
  const normalized = normalizeEncryptedBackup(value);
  if (!normalized.ok) return normalized;
  return { ok: true, value: `${JSON.stringify(normalized.value, null, 2)}\n` };
}

/** Parse an untrusted backup file without allocating decoded ciphertext bytes. */
export function parseEncryptedBackup(serialized: string): EncryptedBackupResult<EncryptedBackup> {
  if (
    typeof serialized !== "string" ||
    serialized.length > MAX_BACKUP_CIPHERTEXT_HEX_LENGTH + 128 * 1024
  ) {
    return failure(
      "invalid-format",
      "encrypted-backup.parse.too-large",
      "Varmuuskopiotiedosto on virheellinen tai liian suuri.",
    );
  }
  try {
    return normalizeEncryptedBackup(JSON.parse(serialized) as unknown);
  } catch {
    return failure(
      "invalid-format",
      "encrypted-backup.parse.invalid-json",
      "Varmuuskopiotiedosto ei ole kelvollista JSON-muotoa.",
    );
  }
}

/** Runtime shape check for callers that need to inspect an opaque backup envelope. */
export function isEncryptedBackup(value: unknown): value is EncryptedBackup {
  return normalizeEncryptedBackup(value).ok;
}
