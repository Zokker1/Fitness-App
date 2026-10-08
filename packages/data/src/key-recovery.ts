// T306: portable recovery artifact; the recovery credential travels separately.

import { DATA_ENCRYPTION_KEY_BYTES, isKeyEnvelope, type KeyEnvelope } from "./key-material.ts";

export const KEY_RECOVERY_BUNDLE_FORMAT = "lifeos-key-recovery" as const;
export const KEY_RECOVERY_BUNDLE_VERSION = 1 as const;
export const KEY_RECOVERY_BUNDLE_MAX_BYTES = 8 * 1024;
export const RECOVERY_KEY_HEX_LENGTH = DATA_ENCRYPTION_KEY_BYTES * 2;

export type RecoveryWrappedEnvelope = KeyEnvelope & {
  readonly wrapping: { readonly kind: "recovery"; readonly kdf: "direct-256" };
};

/** This bundle contains only the recovery-wrapped DEK; the recovery key is never included. */
export interface KeyRecoveryBundle {
  readonly format: typeof KEY_RECOVERY_BUNDLE_FORMAT;
  readonly version: typeof KEY_RECOVERY_BUNDLE_VERSION;
  readonly keyId: string;
  readonly envelope: RecoveryWrappedEnvelope;
}

export interface KeyRecoveryBundleError {
  readonly code: "invalid-envelope" | "unsupported-version" | "wrong-wrap-kind" | "too-large";
  readonly diagnosticCode: string;
  readonly userMessage: string;
}

export type KeyRecoveryBundleResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyRecoveryBundleError };

const textEncoder = new TextEncoder();

/** Canonical one-time display form: 64 lowercase hex characters for a 256-bit key. */
export function formatRecoveryKeyHex(recoveryKey: unknown): string | null {
  if (!(recoveryKey instanceof Uint8Array) || recoveryKey.length !== DATA_ENCRYPTION_KEY_BYTES) {
    return null;
  }
  return Array.from(recoveryKey, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Parse a recovery key from canonical hex; the returned bytes are caller-owned and must be cleared. */
export function parseRecoveryKeyHex(value: unknown): Uint8Array | null {
  if (
    typeof value !== "string" ||
    value.length !== RECOVERY_KEY_HEX_LENGTH ||
    !/^[0-9a-fA-F]+$/.test(value)
  ) {
    return null;
  }
  const recoveryKey = new Uint8Array(DATA_ENCRYPTION_KEY_BYTES);
  for (let index = 0; index < recoveryKey.length; index += 1) {
    recoveryKey[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return recoveryKey;
}

function fail<T>(
  code: KeyRecoveryBundleError["code"],
  diagnosticCode: string,
  userMessage: string,
): KeyRecoveryBundleResult<T> {
  return { ok: false, error: { code, diagnosticCode, userMessage } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: unknown, expectedKeys: readonly string[]): boolean {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecoveryWrappedEnvelope(value: unknown): value is RecoveryWrappedEnvelope {
  if (!isKeyEnvelope(value) || !isRecord(value.wrapping)) return false;
  return (
    hasOnlyKeys(value, [
      "format",
      "version",
      "envelopeId",
      "keyId",
      "cipher",
      "wrapping",
      "wrappedKeyHex",
    ]) &&
    hasOnlyKeys(value.wrapping, ["kind", "kdf"]) &&
    value.wrapping.kind === "recovery"
  );
}

function copyRecoveryEnvelope(envelope: RecoveryWrappedEnvelope): RecoveryWrappedEnvelope {
  return {
    format: envelope.format,
    version: envelope.version,
    envelopeId: envelope.envelopeId,
    keyId: envelope.keyId,
    cipher: envelope.cipher,
    wrapping: { kind: "recovery", kdf: "direct-256" },
    wrappedKeyHex: envelope.wrappedKeyHex,
  };
}

/** Serialize a recovery envelope without ever serializing its recovery credential. */
export function encodeKeyRecoveryBundle(envelope: unknown): KeyRecoveryBundleResult<string> {
  try {
    if (!isKeyEnvelope(envelope)) {
      return fail(
        "invalid-envelope",
        "key-recovery.encode.invalid-envelope",
        "Palautuskuori on virheellinen.",
      );
    }
    if (envelope.wrapping.kind !== "recovery") {
      return fail(
        "wrong-wrap-kind",
        "key-recovery.encode.wrong-wrap-kind",
        "Palautukseen tarvitaan palautusavaimella suojattu kuori.",
      );
    }
    if (!isRecoveryWrappedEnvelope(envelope)) {
      return fail(
        "invalid-envelope",
        "key-recovery.encode.invalid-envelope",
        "Palautuskuori sisältää tuntemattomia tietoja.",
      );
    }
    const bundle: KeyRecoveryBundle = {
      format: KEY_RECOVERY_BUNDLE_FORMAT,
      version: KEY_RECOVERY_BUNDLE_VERSION,
      keyId: envelope.keyId,
      envelope: copyRecoveryEnvelope(envelope),
    };
    const serialized = JSON.stringify(bundle);
    if (textEncoder.encode(serialized).byteLength > KEY_RECOVERY_BUNDLE_MAX_BYTES) {
      return fail("too-large", "key-recovery.encode.too-large", "Palautustiedosto on liian suuri.");
    }
    return { ok: true, value: serialized };
  } catch {
    return fail(
      "invalid-envelope",
      "key-recovery.encode.failed",
      "Palautuskuorta ei voitu muodostaa.",
    );
  }
}

/** Parse untrusted recovery input with strict shape/version/size checks before any key derivation. */
export function decodeKeyRecoveryBundle(
  input: unknown,
): KeyRecoveryBundleResult<KeyRecoveryBundle> {
  if (typeof input !== "string") {
    return fail(
      "invalid-envelope",
      "key-recovery.decode.invalid-input",
      "Palautustiedosto ei kelpaa.",
    );
  }
  if (input.length > KEY_RECOVERY_BUNDLE_MAX_BYTES) {
    return fail("too-large", "key-recovery.decode.too-large", "Palautustiedosto on liian suuri.");
  }
  try {
    if (textEncoder.encode(input).byteLength > KEY_RECOVERY_BUNDLE_MAX_BYTES) {
      return fail("too-large", "key-recovery.decode.too-large", "Palautustiedosto on liian suuri.");
    }
    const parsed: unknown = JSON.parse(input);
    if (!isRecord(parsed)) {
      return fail(
        "invalid-envelope",
        "key-recovery.decode.invalid-bundle",
        "Palautustiedosto ei kelpaa.",
      );
    }
    if (
      parsed.format === KEY_RECOVERY_BUNDLE_FORMAT &&
      parsed.version !== KEY_RECOVERY_BUNDLE_VERSION
    ) {
      return fail(
        "unsupported-version",
        "key-recovery.decode.unsupported-version",
        "Palautustiedoston versiota ei tueta.",
      );
    }
    if (
      parsed.format !== KEY_RECOVERY_BUNDLE_FORMAT ||
      parsed.version !== KEY_RECOVERY_BUNDLE_VERSION ||
      !hasOnlyKeys(parsed, ["format", "version", "keyId", "envelope"]) ||
      typeof parsed.keyId !== "string" ||
      !isRecoveryWrappedEnvelope(parsed.envelope) ||
      parsed.keyId !== parsed.envelope.keyId
    ) {
      return fail(
        "invalid-envelope",
        "key-recovery.decode.invalid-bundle",
        "Palautustiedosto ei kelpaa.",
      );
    }
    return {
      ok: true,
      value: {
        format: KEY_RECOVERY_BUNDLE_FORMAT,
        version: KEY_RECOVERY_BUNDLE_VERSION,
        keyId: parsed.keyId,
        envelope: copyRecoveryEnvelope(parsed.envelope),
      },
    };
  } catch {
    return fail(
      "invalid-envelope",
      "key-recovery.decode.invalid-bundle",
      "Palautustiedosto ei kelpaa.",
    );
  }
}
