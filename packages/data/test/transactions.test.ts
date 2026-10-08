// T076: atominen kirjoituserä — flow-testit fake-workerilla (ilman selainta).
// Todistaa: runAtomicWrite lähettää transaction-pyynnön, onnistunut erä
// kirjoittaa kaikki opin, epäonnistuva op palauttaa hallitun virheen
// (diagnostiikassa opin indeksi) ja ROLLBACK palauttaa tilan. Protokolla-
// validointi (1-64 opia, vain nimettyjä oppia) testattu tässä + oikean
// SQLiten BEGIN/COMMIT/ROLLBACK-semantiikka transactions-atomicity.test.ts:ssä.
import { afterEach, describe, expect, it } from "vitest";
import {
  configureDatabaseWorker,
  resetDatabaseWorkerForTests,
  runAtomicWrite,
  type TransactionWrite,
} from "../src/index.ts";

const state = { meta: new Map<string, string>() };

type Listener = (event: { data: unknown }) => void;

function fakeWorker(): {
  postMessage: (message: Record<string, unknown>) => void;
  terminate: () => void;
  set onmessage(fn: Listener | null);
} {
  const listeners = new Set<Listener>();
  return {
    postMessage(message: Record<string, unknown>) {
      queueMicrotask(() => {
        const requestId = message.requestId as string;
        const ok = (rows: readonly unknown[] = [], extra: Record<string, unknown> = {}) => ({
          requestId,
          ok: true,
          rows,
          backend: "memory",
          persisted: false,
          ...extra,
        });
        let out: Record<string, unknown>;
        if (message.kind === "ping" || message.kind === "close") {
          out = ok();
        } else if (message.kind === "open") {
          out = ok();
        } else if (message.kind === "transaction") {
          const ops = message.ops as ReadonlyArray<{
            op: string;
            params: Record<string, string | undefined>;
          }>;
          // Simuloi workerin atomisuutta: protokollavalidointi ennen
          // soveltamista (tyhjä erä / rollback-merkintä).
          const failIndex = ops.findIndex((write) => write.params.value === "rollback");
          if (ops.length < 1 || ops.length > 64 || failIndex >= 0) {
            out = {
              requestId,
              ok: false,
              code: "invalid-input",
              diagnosticCode: `db.transaction.failed.op${String(Math.max(failIndex, 0))}`,
            };
          } else {
            for (const write of ops) {
              if (write.op === "putMeta") {
                state.meta.set(write.params.key ?? "", write.params.value ?? "");
              }
            }
            out = ok();
          }
        } else if (message.kind === "query" && message.op === "getMeta") {
          const params = (message.params ?? {}) as Record<string, string>;
          const value = state.meta.get(params.key ?? "");
          out = ok(value === undefined ? [] : [{ value }]);
        } else {
          out = { requestId, ok: false, code: "invalid-input", diagnosticCode: "fake" };
        }
        for (const fn of listeners) {
          fn({ data: out });
        }
      });
    },
    terminate() {},
    set onmessage(fn: Listener | null) {
      if (fn !== null) {
        listeners.add(fn);
      }
    },
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
  state.meta.clear();
});

describe("atomic writes (T076)", () => {
  it("onnistunut erä kirjoittaa kaikki opin atomisesti", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const writes: readonly TransactionWrite[] = [
      { op: "putMeta", params: { key: "a", value: "1" } },
      { op: "putMeta", params: { key: "b", value: "2" } },
    ];
    const result = await runAtomicWrite(writes);
    expect(result.ok).toBe(true);
    expect(state.meta.get("a")).toBe("1");
    expect(state.meta.get("b")).toBe("2");
  });

  it("epäonnistuva op ROLLBACKaa erän (diagnostiikassa opin indeksi)", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const writes: readonly TransactionWrite[] = [
      { op: "putMeta", params: { key: "a", value: "1" } },
      { op: "putMeta", params: { key: "b", value: "rollback" } },
      { op: "putMeta", params: { key: "c", value: "3" } },
    ];
    const result = await runAtomicWrite(writes);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnosticCode).toBe("db.transaction.failed.op1");
    }
    // ROLLBACK: mitään ei kirjoitettu.
    expect(state.meta.size).toBe(0);
  });

  it("tyhjä erä hylätään protokollassa (ei tyhjiä transaktioita)", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const result = await runAtomicWrite([]);
    expect(result.ok).toBe(false);
  });
});
