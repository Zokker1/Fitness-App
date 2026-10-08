import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSyncCryptoAdapter,
  resetDatabaseWorkerForTests,
} from "@lifeos/data";
import { AppLockProvider } from "../src/preferences/AppLockContext.tsx";
import { LocalContentBoundary } from "../src/security/LocalContentBoundary.tsx";
import { activateSyncWriteKey, lockActiveSyncWriteKey } from "../src/sync/syncRuntime.ts";

function configureWorker(): void {
  const worker = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    postMessage(request: unknown): void {
      const message = request as { requestId: string; kind: string; op?: string };
      const rows = message.kind === "query" && message.op === "getMeta" ? [{ value: "1" }] : [];
      queueMicrotask(() => {
        worker.onmessage?.({
          data: { requestId: message.requestId, ok: true, rows },
        } as MessageEvent);
      });
    },
    terminate(): void {},
  };
  configureDatabaseWorker({ create: () => worker as unknown as Worker });
}

describe("local content lock boundary", () => {
  afterEach(() => {
    cleanup();
    lockActiveSyncWriteKey();
    resetDatabaseWorkerForTests();
    window.localStorage.clear();
  });

  it("hides mounted application content until the local data key is active", async () => {
    configureWorker();
    render(
      <AppLockProvider persistent={false} localContentEncryptionEnabled>
        <LocalContentBoundary>
          <p>Private journal entry</p>
        </LocalContentBoundary>
      </AppLockProvider>,
    );

    expect(await screen.findByTestId("local-content-lock-screen")).toBeInTheDocument();
    expect(await screen.findByLabelText("Uusi tunnuslause")).toBeInTheDocument();
    expect(screen.queryByText("Private journal entry")).not.toBeInTheDocument();

    const keySession = createDataKeySession(new Uint8Array(32).fill(31));
    expect(keySession).not.toBeNull();
    if (keySession === null) return;
    await act(async () => {
      await activateSyncWriteKey({
        installationId: "browser-local-content-test",
        keySession,
        crypto: createSyncCryptoAdapter(),
      });
    });

    expect(await screen.findByText("Private journal entry")).toBeInTheDocument();
    expect(screen.queryByTestId("local-content-lock-screen")).not.toBeInTheDocument();

    act(() => {
      lockActiveSyncWriteKey();
    });
    await waitFor(() => {
      expect(screen.getByTestId("local-content-lock-screen")).toBeInTheDocument();
      expect(screen.queryByText("Private journal entry")).not.toBeInTheDocument();
    });
  });
});
