import { describe, expect, it } from "vitest";
import { createSyncCryptoAdapter, type SyncPayloadContext } from "../src/index.ts";

const CONTEXT: SyncPayloadContext = {
  operationId: "op-123",
  installationId: "install-abc",
  entityType: "journal-entry",
  entityId: "entry-456",
  operation: "update",
  entityVersion: 4,
  occurredAt: "2026-10-03T12:00:00.000Z",
};
const KEY = new Uint8Array(32).fill(9);
const PLAINTEXT = new TextEncoder().encode("sensitive synchronized note");

describe("sync ciphertext authentication boundary", () => {
  it("decrypts for the bound operation and rejects a changed operation context", async () => {
    const crypto = createSyncCryptoAdapter();
    const encrypted = await crypto.encrypt({ plaintext: PLAINTEXT, key: KEY, context: CONTEXT });
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const opened = await crypto.decrypt({
      ciphertext: encrypted.value,
      key: KEY,
      context: CONTEXT,
    });
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value).toEqual(PLAINTEXT);

    const replayedForDifferentEntity = await crypto.decrypt({
      ciphertext: encrypted.value,
      key: KEY,
      context: { ...CONTEXT, entityId: "different-entry" },
    });
    expect(replayedForDifferentEntity).toMatchObject({
      ok: false,
      error: { code: "authentication-failed" },
    });
    const replayedForDifferentOperation = await crypto.decrypt({
      ciphertext: encrypted.value,
      key: KEY,
      context: { ...CONTEXT, operationId: "different-op" },
    });
    expect(replayedForDifferentOperation).toMatchObject({
      ok: false,
      error: { code: "authentication-failed" },
    });
  });

  it("rejects tampered, truncated, and version-swapped envelopes", async () => {
    const crypto = createSyncCryptoAdapter();
    const encrypted = await crypto.encrypt({ plaintext: PLAINTEXT, key: KEY, context: CONTEXT });
    expect(encrypted.ok).toBe(true);
    if (!encrypted.ok) return;

    const tampered = new Uint8Array(encrypted.value);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    await expect(
      crypto.decrypt({ ciphertext: tampered, key: KEY, context: CONTEXT }),
    ).resolves.toMatchObject({ ok: false, error: { code: "authentication-failed" } });

    await expect(
      crypto.decrypt({ ciphertext: encrypted.value.slice(0, 10), key: KEY, context: CONTEXT }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid-input" } });

    const unsupportedVersion = new Uint8Array(encrypted.value);
    unsupportedVersion[5] = 2;
    await expect(
      crypto.decrypt({ ciphertext: unsupportedVersion, key: KEY, context: CONTEXT }),
    ).resolves.toMatchObject({ ok: false, error: { code: "unsupported-version" } });
  });
});
