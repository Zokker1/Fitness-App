// T033: worker-factory-flow fake-workerilla. Todistaa database.ts-kerroksen
// (open→migrate→integrity + meta-read/write + bad-target) ilman selainta.
// Oikea Worker+OPFS ajetaan Playwright-E2E:ssä (T038).
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  configureDatabaseWorker,
  getSchemaVersion,
  migrateDatabase,
  openDatabase,
  readMeta,
  resetDatabaseWorkerForTests,
  writeMeta,
} from "../src/index.ts";

const state = { version: 0, meta: new Map<string, string>() };

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
        const ok = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
          requestId,
          ok: true,
          rows: [],
          backend: "memory",
          persisted: false,
          ...extra,
        });
        let out: Record<string, unknown>;
        if (message.kind === "ping" || message.kind === "close") {
          out = ok();
        } else if (message.kind === "open") {
          out = ok({ schemaVersion: state.version });
        } else if (message.kind === "migrate") {
          const target = message.targetVersion as number;
          if (target > CURRENT_SCHEMA_VERSION) {
            out = {
              requestId,
              ok: false,
              code: "invalid-input",
              diagnosticCode: "db.migrate.migration-target-too-new",
            };
          } else {
            state.version = target;
            out = ok({ schemaVersion: state.version });
          }
        } else if (message.kind === "exec") {
          const params = message.params as Record<string, string>;
          state.meta.set(params.key ?? "", params.value ?? "");
          out = ok();
        } else if (message.kind === "query") {
          const params = (message.params ?? {}) as Record<string, string>;
          if (message.op === "getMeta") {
            const value = state.meta.get(params.key ?? "");
            out = ok({ rows: value === undefined ? [] : [{ value }] });
          } else if (message.op === "getSchemaVersion") {
            out = ok({ rows: [{ version: state.version }] });
          } else if (message.op === "integrityCheck") {
            out = ok({ rows: [{ integrity_check: "ok" }] });
          } else {
            out = ok();
          }
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
  state.version = 0;
  state.meta.clear();
});

describe("database factory flow", () => {
  it("open migroi v0->v1 ja write/read toimii", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const before = await getSchemaVersion();
    expect(before.ok && before.value).toBe(0);
    const opened = await openDatabase();
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(opened.value.integrity).toBe("ok");
    const written = await writeMeta("t033", "flow");
    expect(written.ok).toBe(true);
    const read = await readMeta("t033");
    expect(read.ok && read.value).toBe("flow");
    const missing = await readMeta("puuttuu");
    expect(missing.ok && missing.value).toBeNull();
  });

  it("reopen on idempotentti; bad-target hylätään", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    await openDatabase();
    const reopened = await openDatabase();
    expect(reopened.ok && reopened.value.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect((await migrateDatabase(0)).ok).toBe(false);
    expect((await migrateDatabase(99)).ok).toBe(false);
  });

  it("ilman tehdasta capability failure on hallittu", async () => {
    resetDatabaseWorkerForTests();
    const result = await openDatabase();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("storage-unavailable");
    }
  });
});
