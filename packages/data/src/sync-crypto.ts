// T304: authenticated encryption for versioned sync payload bytes.
// @noble/ciphers' WebCrypto wrapper keeps the AES implementation in the
// browser's maintained SubtleCrypto backend; keys are supplied per call.

import { gcm } from "@noble/ciphers/webcrypto.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import type { SyncOperationKind } from "@lifeos/domain";

export const SYNC_CRYPTO_VERSION = "aes-256-gcm-webcrypto-v1" as const;

const ENVELOPE_HEADER = Uint8Array.of(0x4c, 0x53, 0x59, 0x4e, 0x43, 0x01); // "LSYNC", v1
const AES_256_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
// Noble's managedNonce uses a CSPRNG-generated 96-bit IV. Key lifecycle must
// rotate a DEK before its per-key AES-GCM message budget is exhausted (T305).
const managedGcm = managedNonce(gcm);
const OPERATION_KINDS = new Set<SyncOperationKind>(["create", "update", "delete", "resolve"]);

export interface SyncPayloadContext {
  readonly operationId: string;
  readonly installationId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly operation: SyncOperationKind;
  readonly entityVersion: number;
  readonly occurredAt: string;
}

export interface SyncCryptoError {
  readonly code:
    "invalid-input" | "unsupported-version" | "encryption-failed" | "authentication-failed";
  readonly userMessage: string;
  readonly diagnosticCode: string;
}

export type SyncCryptoResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SyncCryptoError };

export interface SyncCryptoEncryptInput {
  /** Versioned plaintext bytes from encodeSyncPayload. */
  readonly plaintext: Uint8Array;
  /** AES-256 data-encryption key. Key lifecycle belongs to the caller (T305). */
  readonly key: Uint8Array;
  /** Clear operation metadata authenticated with the ciphertext. */
  readonly context: SyncPayloadContext;
}

export interface SyncCryptoDecryptInput {
  /** Packed LSYNC envelope returned by encrypt. */
  readonly ciphertext: Uint8Array;
  readonly key: Uint8Array;
  /** Must be the same clear operation metadata used for encryption. */
  readonly context: SyncPayloadContext;
}

export interface SyncCryptoAdapter {
  readonly cryptoVersion: typeof SYNC_CRYPTO_VERSION;
  encrypt(input: SyncCryptoEncryptInput): Promise<SyncCryptoResult<Uint8Array>>;
  decrypt(input: SyncCryptoDecryptInput): Promise<SyncCryptoResult<Uint8Array>>;
}

function error<T>(
  code: SyncCryptoError["code"],
  diagnosticCode: string,
  userMessage: string,
): SyncCryptoResult<T> {
  return { ok: false, error: { code, diagnosticCode, userMessage } };
}

function validContext(context: SyncPayloadContext): boolean {
  return (
    typeof context.operationId === "string" &&
    context.operationId.length > 0 &&
    context.operationId.length <= 128 &&
    typeof context.installationId === "string" &&
    context.installationId.length > 0 &&
    typeof context.entityType === "string" &&
    context.entityType.length > 0 &&
    context.entityType.length <= 60 &&
    typeof context.entityId === "string" &&
    context.entityId.length > 0 &&
    OPERATION_KINDS.has(context.operation) &&
    Number.isSafeInteger(context.entityVersion) &&
    context.entityVersion >= 1 &&
    typeof context.occurredAt === "string" &&
    context.occurredAt.length > 0
  );
}

function associatedData(context: SyncPayloadContext): Uint8Array {
  // A fixed-order JSON tuple is unambiguous and stable across platforms.
  return new TextEncoder().encode(
    JSON.stringify([
      SYNC_CRYPTO_VERSION,
      context.operationId,
      context.installationId,
      context.entityType,
      context.entityId,
      context.operation,
      context.entityVersion,
      context.occurredAt,
    ]),
  );
}

function validKey(key: Uint8Array): boolean {
  return key instanceof Uint8Array && key.length === AES_256_KEY_BYTES;
}

/** Create an AES-256-GCM adapter using @noble/ciphers' WebCrypto wrapper. */
export function createSyncCryptoAdapter(): SyncCryptoAdapter {
  return {
    cryptoVersion: SYNC_CRYPTO_VERSION,
    async encrypt(input): Promise<SyncCryptoResult<Uint8Array>> {
      if (
        !validKey(input.key) ||
        !(input.plaintext instanceof Uint8Array) ||
        !validContext(input.context)
      ) {
        return error(
          "invalid-input",
          "sync-crypto.encrypt.invalid-input",
          "Synkronointitiedon salauspyyntö ei kelpaa.",
        );
      }

      const key = new Uint8Array(input.key);
      const plaintext = new Uint8Array(input.plaintext);
      const aad = associatedData(input.context);
      try {
        const nonceAndCiphertext = await managedGcm(key, aad).encrypt(plaintext);
        const packed = new Uint8Array(ENVELOPE_HEADER.length + nonceAndCiphertext.length);
        packed.set(ENVELOPE_HEADER, 0);
        packed.set(nonceAndCiphertext, ENVELOPE_HEADER.length);
        return { ok: true, value: packed };
      } catch {
        return error(
          "encryption-failed",
          "sync-crypto.encrypt.failed",
          "Synkronointitietoa ei voitu salata.",
        );
      } finally {
        key.fill(0);
        plaintext.fill(0);
        aad.fill(0);
      }
    },
    async decrypt(input): Promise<SyncCryptoResult<Uint8Array>> {
      if (
        !validKey(input.key) ||
        !(input.ciphertext instanceof Uint8Array) ||
        !validContext(input.context)
      ) {
        return error(
          "invalid-input",
          "sync-crypto.decrypt.invalid-input",
          "Synkronointitiedon purkupyynnön tiedot eivät kelpaa.",
        );
      }
      if (input.ciphertext.length < ENVELOPE_HEADER.length + GCM_NONCE_BYTES + GCM_TAG_BYTES) {
        return error(
          "invalid-input",
          "sync-crypto.decrypt.truncated",
          "Synkronointitiedon salattu sisältö on virheellinen.",
        );
      }
      for (let index = 0; index < ENVELOPE_HEADER.length - 1; index += 1) {
        if (input.ciphertext[index] !== ENVELOPE_HEADER[index]) {
          return error(
            "invalid-input",
            "sync-crypto.decrypt.bad-envelope",
            "Synkronointitiedon salattu sisältö on virheellinen.",
          );
        }
      }
      if (input.ciphertext[ENVELOPE_HEADER.length - 1] !== ENVELOPE_HEADER.at(-1)) {
        return error(
          "unsupported-version",
          "sync-crypto.decrypt.unsupported-version",
          "Synkronointitiedon salausversiota ei tueta.",
        );
      }

      const key = new Uint8Array(input.key);
      const aad = associatedData(input.context);
      const nonceAndCiphertext = new Uint8Array(input.ciphertext.subarray(ENVELOPE_HEADER.length));
      try {
        const plaintext = await managedGcm(key, aad).decrypt(nonceAndCiphertext);
        return { ok: true, value: new Uint8Array(plaintext) };
      } catch {
        return error(
          "authentication-failed",
          "sync-crypto.decrypt.authentication-failed",
          "Synkronointitietoa ei voitu todentaa tai purkaa.",
        );
      } finally {
        key.fill(0);
        aad.fill(0);
        nonceAndCiphertext.fill(0);
      }
    },
  };
}
