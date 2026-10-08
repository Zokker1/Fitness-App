// T305: the data-encryption key is wrapped before it reaches persistent storage.
// The session owns the only long-lived plaintext copy and clears it on lock.

import { gcm } from "@noble/ciphers/webcrypto.js";
import { managedNonce } from "@noble/ciphers/utils.js";
import { scryptAsync } from "@noble/hashes/scrypt.js";

export const KEY_ENVELOPE_FORMAT = "lifeos-key-envelope" as const;
export const KEY_ENVELOPE_VERSION = 1 as const;
export const KEY_ENVELOPE_CIPHER = "aes-256-gcm" as const;
export const DATA_ENCRYPTION_KEY_BYTES = 32 as const;
/** NIST's invocation ceiling; enforced per active session (a durable lifetime ledger is separate). */
export const DATA_KEY_SESSION_MAX_USES = 2 ** 32;

const KEY_ID_HEX_LENGTH = 32;
const SALT_BYTES = 16;
const AES_GCM_NONCE_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;
const SCRYPT_N = 2 ** 16;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DK_LEN = DATA_ENCRYPTION_KEY_BYTES;
const WRAPPED_KEY_BYTES = AES_GCM_NONCE_BYTES + DATA_ENCRYPTION_KEY_BYTES + AES_GCM_TAG_BYTES;
const MIN_PASSPHRASE_CODE_UNITS = 12;
const MAX_PASSPHRASE_CODE_UNITS = 1024;

const managedGcm = managedNonce(gcm);
const textEncoder = new TextEncoder();

export interface PassphraseKeyEnvelopeWrapping {
  readonly kind: "passphrase";
  readonly kdf: "scrypt";
  readonly saltHex: string;
  readonly params: {
    readonly n: typeof SCRYPT_N;
    readonly r: typeof SCRYPT_R;
    readonly p: typeof SCRYPT_P;
    readonly dkLen: typeof SCRYPT_DK_LEN;
  };
}

export interface RecoveryKeyEnvelopeWrapping {
  readonly kind: "recovery";
  /** A 256-bit recovery key already has sufficient entropy and is used directly. */
  readonly kdf: "direct-256";
}

/** Persistable metadata and wrapped DEK only. This shape contains no credential or plaintext key. */
export interface KeyEnvelope {
  readonly format: typeof KEY_ENVELOPE_FORMAT;
  readonly version: typeof KEY_ENVELOPE_VERSION;
  readonly envelopeId: string;
  /** Stable identifier shared by multiple envelopes protecting the same DEK. */
  readonly keyId: string;
  readonly cipher: typeof KEY_ENVELOPE_CIPHER;
  readonly wrapping: PassphraseKeyEnvelopeWrapping | RecoveryKeyEnvelopeWrapping;
  /** Hex-encoded 96-bit nonce followed by AES-GCM ciphertext and its 128-bit tag. */
  readonly wrappedKeyHex: string;
}

export type KeyWrappingCredential =
  | { readonly kind: "passphrase"; readonly passphrase: string }
  | { readonly kind: "recovery"; readonly recoveryKey: Uint8Array };

export type KeyMaterialErrorCode =
  | "invalid-key"
  | "invalid-credential"
  | "invalid-envelope"
  | "unsupported-envelope"
  | "crypto-unavailable"
  | "wrap-failed"
  | "unlock-failed";

export interface KeyMaterialError {
  readonly code: KeyMaterialErrorCode;
  readonly diagnosticCode: string;
  readonly userMessage: string;
}

export type KeyMaterialResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyMaterialError };

/** Persistence boundary for versioned, already-wrapped key envelopes. */
export interface KeyEnvelopeStore {
  list(): Promise<readonly KeyEnvelope[]>;
  put(envelope: KeyEnvelope): Promise<void>;
  delete(envelopeId: string): Promise<void>;
}

export interface DataKeySession {
  readonly isUnlocked: boolean;
  /** Gives the callback an ephemeral copy and clears it when settled; reopening resets the session budget. */
  withKey<T>(useKey: (key: Uint8Array) => T | Promise<T>): Promise<T>;
  /** Best-effort zeroization of the session key and any callback copies. */
  lock(): void;
}

function failure<T>(
  code: KeyMaterialErrorCode,
  diagnosticCode: string,
  userMessage: string,
): KeyMaterialResult<T> {
  return { ok: false, error: { code, diagnosticCode, userMessage } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHex(value: unknown, length: number): value is string {
  return typeof value === "string" && value.length === length && /^[0-9a-f]+$/.test(value);
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

function secureCryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.getRandomValues === "function" &&
    typeof globalThis.crypto.subtle !== "undefined"
  );
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function randomId(): string {
  const bytes = randomBytes(KEY_ID_HEX_LENGTH / 2);
  try {
    return bytesToHex(bytes);
  } finally {
    bytes.fill(0);
  }
}

function validDataKey(key: unknown): key is Uint8Array {
  return key instanceof Uint8Array && key.length === DATA_ENCRYPTION_KEY_BYTES;
}

function validCredential(credential: unknown): credential is KeyWrappingCredential {
  if (!isRecord(credential)) return false;
  if (credential.kind === "passphrase") {
    return (
      typeof credential.passphrase === "string" &&
      credential.passphrase.length >= MIN_PASSPHRASE_CODE_UNITS &&
      credential.passphrase.length <= MAX_PASSPHRASE_CODE_UNITS
    );
  }
  return (
    credential.kind === "recovery" &&
    credential.recoveryKey instanceof Uint8Array &&
    credential.recoveryKey.length === DATA_ENCRYPTION_KEY_BYTES
  );
}

function envelopeAssociatedData(envelope: Omit<KeyEnvelope, "wrappedKeyHex">): Uint8Array {
  const wrapping = envelope.wrapping;
  const wrappingDescription =
    wrapping.kind === "passphrase"
      ? [
          wrapping.kind,
          wrapping.kdf,
          wrapping.saltHex,
          wrapping.params.n,
          wrapping.params.r,
          wrapping.params.p,
          wrapping.params.dkLen,
        ]
      : [wrapping.kind, wrapping.kdf];
  return textEncoder.encode(
    JSON.stringify([
      envelope.format,
      envelope.version,
      envelope.envelopeId,
      envelope.keyId,
      envelope.cipher,
      wrappingDescription,
    ]),
  );
}

function isCurrentEnvelope(value: unknown): value is KeyEnvelope {
  if (!isRecord(value)) return false;
  if (
    value.format !== KEY_ENVELOPE_FORMAT ||
    value.version !== KEY_ENVELOPE_VERSION ||
    value.cipher !== KEY_ENVELOPE_CIPHER ||
    !isHex(value.envelopeId, KEY_ID_HEX_LENGTH) ||
    !isHex(value.keyId, KEY_ID_HEX_LENGTH) ||
    !isHex(value.wrappedKeyHex, WRAPPED_KEY_BYTES * 2) ||
    !isRecord(value.wrapping)
  ) {
    return false;
  }

  const wrapping = value.wrapping;
  if (wrapping.kind === "passphrase") {
    if (
      wrapping.kdf !== "scrypt" ||
      !isHex(wrapping.saltHex, SALT_BYTES * 2) ||
      !isRecord(wrapping.params)
    ) {
      return false;
    }
    const params = wrapping.params;
    return (
      params.n === SCRYPT_N &&
      params.r === SCRYPT_R &&
      params.p === SCRYPT_P &&
      params.dkLen === SCRYPT_DK_LEN
    );
  }
  return wrapping.kind === "recovery" && wrapping.kdf === "direct-256";
}

/** Check an untrusted IndexedDB value without running a KDF or allocating large buffers. */
export function isKeyEnvelope(value: unknown): value is KeyEnvelope {
  return isCurrentEnvelope(value);
}

function keySessionFromBytes(dataKey: Uint8Array): DataKeySession {
  const sessionKey = new Uint8Array(dataKey);
  const activeCopies = new Set<Uint8Array>();
  let unlocked = true;
  let useCount = 0;

  return {
    get isUnlocked(): boolean {
      return unlocked;
    },
    async withKey<T>(useKey: (key: Uint8Array) => T | Promise<T>): Promise<T> {
      if (!unlocked) throw new Error("Data-key session is locked.");
      if (useCount >= DATA_KEY_SESSION_MAX_USES) {
        throw new Error("Data-key session reached its cryptographic use limit; rotate the key.");
      }
      // Count every use, including decryptions, as a conservative bound on encryptions.
      useCount += 1;
      const copy = new Uint8Array(sessionKey);
      activeCopies.add(copy);
      try {
        return await useKey(copy);
      } finally {
        copy.fill(0);
        activeCopies.delete(copy);
      }
    },
    lock(): void {
      if (!unlocked) return;
      unlocked = false;
      sessionKey.fill(0);
      for (const copy of activeCopies) copy.fill(0);
      activeCopies.clear();
    },
  };
}

/** Create an in-memory-only session from a 256-bit DEK. */
export function createDataKeySession(dataKey: Uint8Array): DataKeySession | null {
  return validDataKey(dataKey) ? keySessionFromBytes(dataKey) : null;
}

/** Generate a 256-bit recovery credential; callers must deliver and clear it safely. */
export function generateRecoveryKey(): KeyMaterialResult<Uint8Array> {
  if (!secureCryptoAvailable()) {
    return failure(
      "crypto-unavailable",
      "key-envelope.recovery.crypto-unavailable",
      "Selaimen suojattua kryptografiaa ei voi käyttää tässä ympäristössä.",
    );
  }
  try {
    return { ok: true, value: randomBytes(DATA_ENCRYPTION_KEY_BYTES) };
  } catch {
    return failure(
      "crypto-unavailable",
      "key-envelope.recovery.random-failed",
      "Palautusavainta ei voitu luoda turvallisesti.",
    );
  }
}

async function derivePassphraseKey(passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
  const passphraseBytes = textEncoder.encode(passphrase.normalize("NFC"));
  try {
    return await scryptAsync(passphraseBytes, salt, {
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      dkLen: SCRYPT_DK_LEN,
    });
  } finally {
    passphraseBytes.fill(0);
  }
}

/** Wrap an existing DEK. Supply `keyId` when adding another credential for the same DEK. */
export async function createKeyEnvelope(input: {
  readonly dataKey: Uint8Array;
  readonly credential: KeyWrappingCredential;
  readonly keyId?: string;
}): Promise<KeyMaterialResult<KeyEnvelope>> {
  if (!validDataKey(input.dataKey)) {
    return failure(
      "invalid-key",
      "key-envelope.wrap.invalid-key",
      "Data-avaimen pituus ei kelpaa.",
    );
  }
  if (!validCredential(input.credential)) {
    return failure(
      "invalid-credential",
      "key-envelope.wrap.invalid-credential",
      "Avaimen suojaustiedot eivät kelpaa.",
    );
  }
  if (!secureCryptoAvailable()) {
    return failure(
      "crypto-unavailable",
      "key-envelope.wrap.crypto-unavailable",
      "Selaimen suojattua kryptografiaa ei voi käyttää tässä ympäristössä.",
    );
  }
  if (input.keyId !== undefined && !isHex(input.keyId, KEY_ID_HEX_LENGTH)) {
    return failure(
      "invalid-key",
      "key-envelope.wrap.invalid-key-id",
      "Avaimen tunniste ei kelpaa.",
    );
  }

  let dataKeyCopy: Uint8Array | undefined;
  let wrappingKey: Uint8Array | undefined;
  let salt: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let wrappedBytes: Uint8Array | undefined;
  try {
    const envelopeId = randomId();
    const keyId = input.keyId ?? randomId();
    let wrapping: KeyEnvelope["wrapping"];
    if (input.credential.kind === "passphrase") {
      salt = randomBytes(SALT_BYTES);
      wrapping = {
        kind: "passphrase",
        kdf: "scrypt",
        saltHex: bytesToHex(salt),
        params: { n: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, dkLen: SCRYPT_DK_LEN },
      };
      wrappingKey = await derivePassphraseKey(input.credential.passphrase, salt);
    } else {
      wrapping = { kind: "recovery", kdf: "direct-256" };
      wrappingKey = new Uint8Array(input.credential.recoveryKey);
    }

    const envelopeMetadata = {
      format: KEY_ENVELOPE_FORMAT,
      version: KEY_ENVELOPE_VERSION,
      envelopeId,
      keyId,
      cipher: KEY_ENVELOPE_CIPHER,
      wrapping,
    } satisfies Omit<KeyEnvelope, "wrappedKeyHex">;
    aad = envelopeAssociatedData(envelopeMetadata);
    dataKeyCopy = new Uint8Array(input.dataKey);
    wrappedBytes = await managedGcm(wrappingKey, aad).encrypt(dataKeyCopy);

    if (wrappedBytes.length !== WRAPPED_KEY_BYTES) {
      return failure("wrap-failed", "key-envelope.wrap.failed", "Data-avainta ei voitu suojata.");
    }

    return {
      ok: true,
      value: { ...envelopeMetadata, wrappedKeyHex: bytesToHex(wrappedBytes) },
    };
  } catch {
    return failure("wrap-failed", "key-envelope.wrap.failed", "Data-avainta ei voitu suojata.");
  } finally {
    dataKeyCopy?.fill(0);
    wrappingKey?.fill(0);
    salt?.fill(0);
    aad?.fill(0);
    wrappedBytes?.fill(0);
  }
}

/** Create a fresh random DEK, wrap it, and retain plaintext only in its memory session. */
export async function createWrappedDataKey(
  credential: KeyWrappingCredential,
): Promise<
  KeyMaterialResult<{ readonly envelope: KeyEnvelope; readonly session: DataKeySession }>
> {
  if (!validCredential(credential)) {
    return failure(
      "invalid-credential",
      "key-envelope.create.invalid-credential",
      "Avaimen suojaustiedot eivät kelpaa.",
    );
  }
  if (!secureCryptoAvailable()) {
    return failure(
      "crypto-unavailable",
      "key-envelope.create.crypto-unavailable",
      "Selaimen suojattua kryptografiaa ei voi käyttää tässä ympäristössä.",
    );
  }

  let dataKey: Uint8Array | undefined;
  try {
    dataKey = randomBytes(DATA_ENCRYPTION_KEY_BYTES);
    const wrapped = await createKeyEnvelope({ dataKey, credential });
    if (!wrapped.ok) return wrapped;
    return {
      ok: true,
      value: { envelope: wrapped.value, session: keySessionFromBytes(dataKey) },
    };
  } catch {
    return failure("wrap-failed", "key-envelope.create.failed", "Data-avainta ei voitu luoda.");
  } finally {
    dataKey?.fill(0);
  }
}

/** Unlock directly into a session; the decrypted temporary byte array is cleared before return. */
export async function unlockDataKeySession(input: {
  readonly envelope: unknown;
  readonly credential: KeyWrappingCredential;
}): Promise<KeyMaterialResult<DataKeySession>> {
  if (!isCurrentEnvelope(input.envelope)) {
    const unsupported =
      isRecord(input.envelope) &&
      input.envelope.format === KEY_ENVELOPE_FORMAT &&
      input.envelope.version !== KEY_ENVELOPE_VERSION;
    return unsupported
      ? failure(
          "unsupported-envelope",
          "key-envelope.unlock.unsupported-version",
          "Tallennetun avaimen versiota ei tueta.",
        )
      : failure(
          "invalid-envelope",
          "key-envelope.unlock.invalid-envelope",
          "Tallennettu avainkuori on virheellinen.",
        );
  }
  if (
    !validCredential(input.credential) ||
    input.credential.kind !== input.envelope.wrapping.kind
  ) {
    return failure(
      "invalid-credential",
      "key-envelope.unlock.invalid-credential",
      "Avaimen avausmenetelmä ei kelpaa.",
    );
  }
  const envelope = input.envelope;
  const credential = input.credential;
  if (!secureCryptoAvailable()) {
    return failure(
      "crypto-unavailable",
      "key-envelope.unlock.crypto-unavailable",
      "Selaimen suojattua kryptografiaa ei voi käyttää tässä ympäristössä.",
    );
  }

  let wrappingKey: Uint8Array | undefined;
  let salt: Uint8Array | undefined;
  let aad: Uint8Array | undefined;
  let wrappedBytes: Uint8Array | undefined;
  let openedKey: Uint8Array | undefined;
  try {
    if (envelope.wrapping.kind === "passphrase" && credential.kind === "passphrase") {
      salt = hexToBytes(envelope.wrapping.saltHex);
      wrappingKey = await derivePassphraseKey(credential.passphrase, salt);
    } else {
      if (credential.kind !== "recovery") {
        return failure(
          "invalid-credential",
          "key-envelope.unlock.invalid-credential",
          "Avaimen avausmenetelmä ei kelpaa.",
        );
      }
      wrappingKey = new Uint8Array(credential.recoveryKey);
    }
    const envelopeMetadata = {
      format: envelope.format,
      version: envelope.version,
      envelopeId: envelope.envelopeId,
      keyId: envelope.keyId,
      cipher: envelope.cipher,
      wrapping: envelope.wrapping,
    } satisfies Omit<KeyEnvelope, "wrappedKeyHex">;
    aad = envelopeAssociatedData(envelopeMetadata);
    wrappedBytes = hexToBytes(envelope.wrappedKeyHex);
    openedKey = await managedGcm(wrappingKey, aad).decrypt(wrappedBytes);
    if (!validDataKey(openedKey)) {
      return failure("unlock-failed", "key-envelope.unlock.failed", "Data-avainta ei voitu avata.");
    }
    return { ok: true, value: keySessionFromBytes(openedKey) };
  } catch {
    return failure("unlock-failed", "key-envelope.unlock.failed", "Data-avainta ei voitu avata.");
  } finally {
    wrappingKey?.fill(0);
    salt?.fill(0);
    aad?.fill(0);
    wrappedBytes?.fill(0);
    openedKey?.fill(0);
  }
}
