import { afterEach, describe, expect, it } from "vitest";
import {
  createDataKeySession,
  createWrappedDataKey,
  DATA_ENCRYPTION_KEY_BYTES,
  unlockDataKeySession,
} from "../src/index.ts";

const PASSPHRASE = "correct horse battery staple";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("local passphrase key envelope", () => {
  const sessions: { lock: () => void }[] = [];

  afterEach(() => {
    for (const session of sessions.splice(0)) session.lock();
  });

  it("persists only a versioned wrapped DEK and unlocks it with the right passphrase", async () => {
    const created = await createWrappedDataKey({ kind: "passphrase", passphrase: PASSPHRASE });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    sessions.push(created.value.session);

    const envelope = created.value.envelope;
    expect(envelope).toMatchObject({
      format: "lifeos-key-envelope",
      version: 1,
      cipher: "aes-256-gcm",
      wrapping: {
        kind: "passphrase",
        kdf: "scrypt",
        params: { n: 65_536, r: 8, p: 1, dkLen: DATA_ENCRYPTION_KEY_BYTES },
      },
    });
    expect(envelope.wrapping.kind === "passphrase" && envelope.wrapping.saltHex).toMatch(
      /^[0-9a-f]{32}$/,
    );
    expect(JSON.stringify(envelope)).not.toContain(PASSPHRASE);

    let originalKey = new Uint8Array();
    await created.value.session.withKey((key) => {
      originalKey = new Uint8Array(key);
    });
    expect(originalKey).toHaveLength(DATA_ENCRYPTION_KEY_BYTES);
    expect(envelope.wrappedKeyHex).not.toContain(toHex(originalKey));

    const opened = await unlockDataKeySession({
      envelope,
      credential: { kind: "passphrase", passphrase: PASSPHRASE },
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      sessions.push(opened.value);
      let reopenedKey = new Uint8Array();
      await opened.value.withKey((key) => {
        reopenedKey = new Uint8Array(key);
      });
      expect(reopenedKey).toEqual(originalKey);
      reopenedKey.fill(0);
    }

    const wrongPassphrase = await unlockDataKeySession({
      envelope,
      credential: { kind: "passphrase", passphrase: "different horse battery" },
    });
    expect(wrongPassphrase).toMatchObject({
      ok: false,
      error: { code: "unlock-failed", diagnosticCode: "key-envelope.unlock.failed" },
    });
    originalKey.fill(0);
  });

  it("rejects empty and weak passphrases before generating or opening key material", async () => {
    const empty = await createWrappedDataKey({ kind: "passphrase", passphrase: "" });
    const weak = await createWrappedDataKey({ kind: "passphrase", passphrase: "too-short" });

    expect(empty).toMatchObject({ ok: false, error: { code: "invalid-credential" } });
    expect(weak).toMatchObject({ ok: false, error: { code: "invalid-credential" } });
  });

  it("zeroes the session and active callback copies immediately on lock", async () => {
    const dataKey = new Uint8Array(DATA_ENCRYPTION_KEY_BYTES).fill(3);
    const session = createDataKeySession(dataKey);
    expect(session).not.toBeNull();
    if (session === null) return;
    sessions.push(session);
    dataKey.fill(0);

    let callbackCopy: Uint8Array | null = null;
    let finishCallback: () => void = () => {};
    const callbackGate = new Promise<void>((resolve) => {
      finishCallback = resolve;
    });
    const activeUse = session.withKey(async (key) => {
      callbackCopy = key;
      await callbackGate;
    });

    expect(session.isUnlocked).toBe(true);
    session.lock();
    expect(session.isUnlocked).toBe(false);
    expect(callbackCopy).not.toBeNull();
    expect(callbackCopy).toEqual(new Uint8Array(DATA_ENCRYPTION_KEY_BYTES));
    await expect(session.withKey(() => undefined)).rejects.toThrow("Data-key session is locked.");

    finishCallback();
    await activeUse;
    expect(callbackCopy).toEqual(new Uint8Array(DATA_ENCRYPTION_KEY_BYTES));
  });
});
