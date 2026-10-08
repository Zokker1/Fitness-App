import { gcm } from "@noble/ciphers/aes.js";
import { managedNonce } from "@noble/ciphers/utils.js";

const ENVELOPE_PREFIX = "lifeos-private-v1:";
const ENVELOPE_AAD_VERSION = "lifeos-private-content-aes-256-gcm-v1";
const KEY_BYTES = 32;
const managedGcm = managedNonce(gcm);
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export interface LocalContentContext {
  readonly recordType: string;
  readonly recordId: string;
  readonly field: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)),
    );
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(encoded: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(encoded) || encoded.length % 4 === 1) return null;
  try {
    const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function validContext(context: LocalContentContext): boolean {
  return (
    typeof context.recordType === "string" &&
    context.recordType.length > 0 &&
    context.recordType.length <= 80 &&
    typeof context.recordId === "string" &&
    context.recordId.length > 0 &&
    context.recordId.length <= 256 &&
    typeof context.field === "string" &&
    context.field.length > 0 &&
    context.field.length <= 80
  );
}

function associatedData(context: LocalContentContext): Uint8Array {
  return encoder.encode(
    JSON.stringify([ENVELOPE_AAD_VERSION, context.recordType, context.recordId, context.field]),
  );
}

export function isLocalContentCiphertext(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENVELOPE_PREFIX);
}

/** Encrypt one private text field with its record identity bound as AEAD data. */
export function encryptLocalContent(
  plaintext: string,
  key: Uint8Array,
  context: LocalContentContext,
): string {
  if (typeof plaintext !== "string" || key.length !== KEY_BYTES || !validContext(context)) {
    throw new Error("local-content.invalid-input");
  }
  const keyCopy = new Uint8Array(key);
  const cleartext = encoder.encode(plaintext);
  const aad = associatedData(context);
  try {
    const sealed = managedGcm(keyCopy, aad).encrypt(cleartext);
    return ENVELOPE_PREFIX + toBase64Url(sealed);
  } finally {
    keyCopy.fill(0);
    cleartext.fill(0);
    aad.fill(0);
  }
}

/** Authenticate and decrypt a field. Rebinding it to another row/column fails. */
export function decryptLocalContent(
  envelope: string,
  key: Uint8Array,
  context: LocalContentContext,
): string {
  if (!isLocalContentCiphertext(envelope) || key.length !== KEY_BYTES || !validContext(context)) {
    throw new Error("local-content.invalid-input");
  }
  const packed = fromBase64Url(envelope.slice(ENVELOPE_PREFIX.length));
  if (packed === null || packed.length < 28) throw new Error("local-content.invalid-envelope");
  const keyCopy = new Uint8Array(key);
  const aad = associatedData(context);
  try {
    const cleartext = managedGcm(keyCopy, aad).decrypt(packed);
    try {
      return decoder.decode(cleartext);
    } finally {
      cleartext.fill(0);
    }
  } finally {
    keyCopy.fill(0);
    aad.fill(0);
    packed.fill(0);
  }
}
