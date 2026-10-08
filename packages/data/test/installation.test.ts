// T061: BrowserInstallation-palvelun flow-testit fake-workerilla (ilman
// selainta). Todistaa: ensure luo rivin pysyvällä satunnaisella
// installationId:llä (v1), toinen ensure palauttaa saman id:n (ei duplikaattia,
// ei version hyppyä kun app-versio ennallaan), app-versiomuutos päivittää
// lastSeenin (version + 1), revokaatio estää sync-merkinnän (invalid-transition
// domain-säännöstä) ja rikki rivi palauttaa hallitun virheen. Oikea worker+
// OPFS ajetaan Playwright-E2E:ssä (persistenssi-tab).
import { afterEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  configureDatabaseWorker,
  createDataKeySession,
  createSyncCryptoAdapter,
  ensureInstallation,
  fixedClock,
  listSyncOperations,
  listInstallations,
  markInstallationSynced,
  renameInstallation,
  revokeOtherInstallation,
  resetDatabaseWorkerForTests,
  revokeInstallationService,
  sequentialIdGenerator,
  writeInstallationSyncSnapshot,
  readInstallationSyncSnapshot,
} from "../src/index.ts";

const state = {
  row: null as Record<string, unknown> | null,
  remoteRows: new Map<string, Record<string, unknown>>(),
  operations: new Map<string, Record<string, unknown>>(),
  version: 0,
};

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
          out = ok([], { schemaVersion: state.version });
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
            out = ok([], { schemaVersion: state.version });
          }
        } else if (message.kind === "exec" && message.op === "putInstallation") {
          // Simuloi workerin bindiä: tyhjä merkkijono -> SQL NULL.
          const raw = message.params as Record<string, unknown>;
          const saved = {
            ...raw,
            last_sync_at: raw.last_sync_at === "" ? null : raw.last_sync_at,
            revoked_at: raw.revoked_at === "" ? null : raw.revoked_at,
          };
          if (raw.is_local === false) {
            state.remoteRows.set(String(raw.installation_id), saved);
          } else {
            state.row = saved;
          }
          out = ok();
        } else if (message.kind === "transaction") {
          for (const write of message.ops as readonly {
            op: string;
            params: Record<string, unknown>;
          }[]) {
            if (write.op === "putInstallation") {
              const raw = write.params;
              const saved = {
                ...raw,
                last_sync_at: raw.last_sync_at === "" ? null : raw.last_sync_at,
                revoked_at: raw.revoked_at === "" ? null : raw.revoked_at,
              };
              if (raw.is_local === false) {
                state.remoteRows.set(String(raw.installation_id), saved);
              } else {
                state.row = saved;
              }
            } else if (write.op === "putSyncOperation") {
              state.operations.set(String(write.params.operation_id), write.params);
            }
          }
          out = ok();
        } else if (message.kind === "query" && message.op === "getActiveInstallation") {
          out = ok(state.row === null ? [] : [state.row]);
        } else if (message.kind === "query" && message.op === "listInstallations") {
          out = ok([...(state.row === null ? [] : [state.row]), ...state.remoteRows.values()]);
        } else if (message.kind === "query" && message.op === "listSyncOperations") {
          out = ok([...state.operations.values()]);
        } else if (message.kind === "query" && message.op === "getSchemaVersion") {
          out = ok([{ version: state.version }]);
        } else if (message.kind === "query") {
          out = ok();
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

const deps = {
  clock: fixedClock("2026-09-17T14:00:00.000Z"),
  ids: sequentialIdGenerator(),
};

afterEach(() => {
  resetDatabaseWorkerForTests();
  state.row = null;
  state.remoteRows.clear();
  state.operations.clear();
  state.version = 0;
});

describe("installation service", () => {
  it("ensure luo rivin pysyvällä installationId:llä ja palauttaa saman uudelleen", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const first = await ensureInstallation(deps, "0.1.0");
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.value.version).toBe(1);
    expect(first.value.installationId.length).toBeGreaterThan(0);
    expect(first.value.installationName).toBe("Tämä selain");
    expect(first.value.lastSeenAppVersion).toBe("0.1.0");
    expect(first.value.lastSyncAt).toBeNull();
    expect(first.value.revokedAt).toBeNull();

    const listed = await listInstallations();
    expect(listed).toEqual({ ok: true, value: [first.value] });

    // Toinen ensure samalla app-versiolla: ei duplikaattia, ei version hyppyä.
    const second = await ensureInstallation(deps, "0.1.0");
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.installationId).toBe(first.value.installationId);
    expect(second.value.version).toBe(1);

    // App-versio muuttui: lastSeen päivittyy (version + 1).
    const upgraded = await ensureInstallation(deps, "0.2.0");
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) {
      return;
    }
    expect(upgraded.value.installationId).toBe(first.value.installationId);
    expect(upgraded.value.lastSeenAppVersion).toBe("0.2.0");
    expect(upgraded.value.version).toBe(2);
  });

  it("sync-merkintä päivittyy aktiiviselle asennukselle", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    await ensureInstallation(deps, "0.1.0");
    const synced = await markInstallationSynced(deps, "2026-09-17T15:00:00.000Z");
    expect(synced.ok).toBe(true);
    if (!synced.ok) {
      return;
    }
    expect(synced.value.lastSyncAt).toBe("2026-09-17T15:00:00.000Z");
    expect(synced.value.version).toBe(2);
  });

  it("revokoitu asennus ei ota sync-merkintää eikä toista revokaatiota", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    await ensureInstallation(deps, "0.1.0");
    const revoked = await revokeInstallationService(deps);
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) {
      return;
    }
    expect(revoked.value.revokedAt).toBe("2026-09-17T14:00:00.000Z");
    expect(revoked.value.version).toBe(2);

    const blocked = await markInstallationSynced(deps, "2026-09-17T16:00:00.000Z");
    expect(blocked.ok).toBe(false);
    const again = await revokeInstallationService(deps);
    expect(again.ok).toBe(false);
  });

  it("rikki tallennettu rivi palauttaa hallitun virheen, ei poikkeusta", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    state.row = {
      id: "",
      installation_id: "",
      installation_name: "x",
      last_seen_app_version: "0.1.0",
      last_sync_at: null,
      revoked_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      version: 1,
    };
    const result = await ensureInstallation(deps, "0.1.0");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnosticCode).toBe("data.installation.corrupt");
    }
  });

  it("uudelleennimeäminen säilyttää installationId:n ja tallentaa salatun synkronointitapahtuman", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const installation = await ensureInstallation(deps, "0.1.0");
    expect(installation.ok).toBe(true);
    if (!installation.ok) return;
    const keySession = createDataKeySession(new Uint8Array(32).fill(9));
    expect(keySession).not.toBeNull();
    if (keySession === null) return;

    const renamed = await renameInstallation({
      deps,
      installationId: installation.value.installationId,
      name: "Työläppäri",
      keySession,
      crypto: createSyncCryptoAdapter(),
    });

    expect(renamed).toMatchObject({
      ok: true,
      value: {
        id: installation.value.id,
        installationId: installation.value.installationId,
        installationName: "Työläppäri",
        version: installation.value.version + 1,
      },
    });
    expect(state.row?.installation_id).toBe(installation.value.installationId);
    expect(state.row?.is_local).toBe(true);
    const operations = await listSyncOperations();
    expect(operations.ok && operations.value).toHaveLength(1);
    expect(operations.ok && operations.value[0]).toMatchObject({
      operation: "create",
      entityType: "browser-installation",
      entityId: installation.value.installationId,
    });
    if (operations.ok) {
      expect(operations.value[0]?.encryptedPayloadRef).not.toContain("Työläppäri");
    }
    keySession.lock();
  });

  it("tallentaa toisen profiilin synkatun asennuksen muuttamatta paikallista tunnistetta", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const local = await ensureInstallation(deps, "0.1.0");
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    const remoteId = "another-browser-installation";
    const received = await writeInstallationSyncSnapshot(remoteId, {
      id: remoteId,
      installationId: remoteId,
      installationName: "Kotiselain",
      lastSeenAppVersion: "0.2.0",
      lastSyncAt: "2026-09-17T15:00:00.000Z",
      revokedAt: null,
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-17T15:00:00.000Z",
      version: 2,
    });

    expect(received).toEqual({ ok: true, value: true });
    const listed = await listInstallations();
    expect(listed.ok && listed.value.map((item) => item.installationId).sort()).toEqual(
      [local.value.installationId, remoteId].sort(),
    );
    const current = await ensureInstallation(deps, "0.1.0");
    expect(current.ok && current.value.installationId).toBe(local.value.installationId);
    const snapshot = await readInstallationSyncSnapshot(remoteId);
    expect(snapshot).toMatchObject({
      ok: true,
      value: { id: remoteId, installationId: remoteId, installationName: "Kotiselain" },
    });
    const corrupt = await writeInstallationSyncSnapshot(remoteId, {
      id: local.value.installationId,
      installationId: local.value.installationId,
      installationName: "Väärä",
      lastSeenAppVersion: "0.2.0",
      lastSyncAt: null,
      revokedAt: null,
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-17T15:00:00.000Z",
      version: 3,
    });
    expect(corrupt.ok).toBe(false);
    const afterCorrupt = await readInstallationSyncSnapshot(remoteId);
    expect(afterCorrupt).toMatchObject({
      ok: true,
      value: { id: remoteId, installationName: "Kotiselain" },
    });
  });

  it("peruu toisen selaimen salatusti mutta estää itseperumisen", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const local = await ensureInstallation(deps, "0.1.0");
    expect(local.ok).toBe(true);
    if (!local.ok) return;
    const remoteId = "another-browser-installation";
    const remote = await writeInstallationSyncSnapshot(remoteId, {
      id: remoteId,
      installationId: remoteId,
      installationName: "Kotiselain",
      lastSeenAppVersion: "0.2.0",
      lastSyncAt: null,
      revokedAt: null,
      createdAt: "2026-09-16T10:00:00.000Z",
      updatedAt: "2026-09-17T15:00:00.000Z",
      version: 1,
    });
    expect(remote.ok).toBe(true);
    const keySession = createDataKeySession(new Uint8Array(32).fill(4));
    expect(keySession).not.toBeNull();
    if (keySession === null) return;

    const deniedSelfRevoke = await revokeOtherInstallation({
      deps,
      actingInstallationId: local.value.installationId,
      targetInstallationId: local.value.installationId,
      keySession,
      crypto: createSyncCryptoAdapter(),
    });
    expect(deniedSelfRevoke.ok).toBe(false);

    const revoked = await revokeOtherInstallation({
      deps,
      actingInstallationId: local.value.installationId,
      targetInstallationId: remoteId,
      keySession,
      crypto: createSyncCryptoAdapter(),
    });
    expect(revoked).toMatchObject({
      ok: true,
      value: {
        id: remoteId,
        installationId: remoteId,
        revokedAt: deps.clock.nowIso(),
        version: 2,
      },
    });
    expect(state.row?.installation_id).toBe(local.value.installationId);
    expect(state.remoteRows.get(remoteId)?.revoked_at).toBe(deps.clock.nowIso());
    if (revoked.ok) {
      const clearRevocation = await writeInstallationSyncSnapshot(remoteId, {
        ...revoked.value,
        revokedAt: null,
        updatedAt: "2026-09-18T15:00:00.000Z",
        version: revoked.value.version + 1,
      });
      expect(clearRevocation.ok).toBe(false);
      expect(state.remoteRows.get(remoteId)?.revoked_at).toBe(deps.clock.nowIso());
    }
    const operations = await listSyncOperations();
    expect(operations.ok && operations.value).toHaveLength(1);
    expect(operations.ok && operations.value[0]).toMatchObject({
      installationId: local.value.installationId,
      entityType: "browser-installation",
      entityId: remoteId,
      operation: "update",
    });
    keySession.lock();
  });
});
