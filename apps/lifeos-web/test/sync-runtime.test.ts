import { afterEach, describe, expect, it } from "vitest";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSyncCryptoAdapter,
  resetDatabaseWorkerForTests,
} from "@lifeos/data";
import {
  activateSyncWriteKey,
  getActiveSyncWriteContext,
  lockActiveSyncWriteKey,
} from "../src/sync/syncRuntime.ts";

function configureLocalKeyWorker(ok = true): void {
  const fakeWorker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    postMessage(request: unknown): void {
      const requestId = (request as { requestId: string }).requestId;
      queueMicrotask(() => {
        fakeWorker.onmessage?.({
          data: ok
            ? { requestId, ok: true, rows: [] }
            : { requestId, ok: false, code: "invalid-input", diagnosticCode: "key.invalid" },
        } as MessageEvent);
      });
    },
    terminate(): void {},
  };
  configureDatabaseWorker({ create: () => fakeWorker as unknown as Worker });
}

describe("sync write key session lifecycle", () => {
  afterEach(() => {
    lockActiveSyncWriteKey();
    resetDatabaseWorkerForTests();
  });

  it("locks the previous session on replacement and locks on pagehide", async () => {
    configureLocalKeyWorker();
    const firstSession = createDataKeySession(new Uint8Array(32).fill(1));
    const secondSession = createDataKeySession(new Uint8Array(32).fill(2));
    expect(firstSession).not.toBeNull();
    expect(secondSession).not.toBeNull();
    if (firstSession === null || secondSession === null) return;

    const crypto = createSyncCryptoAdapter();
    await activateSyncWriteKey({
      installationId: "browser-a",
      keySession: firstSession,
      crypto,
    });
    await activateSyncWriteKey({
      installationId: "browser-b",
      keySession: secondSession,
      crypto,
    });

    expect(firstSession.isUnlocked).toBe(false);
    expect(getActiveSyncWriteContext()?.keySession).toBe(secondSession);

    window.dispatchEvent(new Event("pagehide"));

    expect(secondSession.isUnlocked).toBe(false);
    expect(getActiveSyncWriteContext()).toBeNull();
  });

  it("explicit lock clears the active key session", async () => {
    configureLocalKeyWorker();
    const session = createDataKeySession(new Uint8Array(32).fill(7));
    expect(session).not.toBeNull();
    if (session === null) return;
    await activateSyncWriteKey({
      installationId: "browser-c",
      keySession: session,
      crypto: createSyncCryptoAdapter(),
    });

    lockActiveSyncWriteKey();

    expect(session.isUnlocked).toBe(false);
    expect(getActiveSyncWriteContext()).toBeNull();
  });

  it("does not activate a session when local content rejects its key", async () => {
    configureLocalKeyWorker(false);
    const session = createDataKeySession(new Uint8Array(32).fill(4));
    expect(session).not.toBeNull();
    if (session === null) return;

    await expect(
      activateSyncWriteKey({
        installationId: "browser-invalid",
        keySession: session,
        crypto: createSyncCryptoAdapter(),
      }),
    ).rejects.toThrow("key.invalid");
    expect(session.isUnlocked).toBe(true);
    expect(getActiveSyncWriteContext()).toBeNull();
    session.lock();
  });
});
