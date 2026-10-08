import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Collectible, UserReward } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteCollectibleStore,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface StoredDoc {
  readonly entity_type: string;
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

interface Write {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

interface Request {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly Write[];
  readonly params?: Record<string, unknown>;
}

function createWorker(
  initialDocs: readonly StoredDoc[],
  relationalRewardCollectibleIds: readonly string[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const collectibles = new Map<string, Record<string, unknown>>();
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listCollectibles") {
          rows = [...collectibles.values()];
        } else if (request.kind === "query" && request.op === "getCollectible") {
          const row = collectibles.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (
          request.kind === "query" &&
          request.op === "getCollectibleRewardReference" &&
          relationalRewardCollectibleIds.includes(sqlText(request.params?.id))
        ) {
          rows = [{ id: "relational-reward" }];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextCollectibles = new Map(collectibles);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putCollectible") {
              const params = write.params;
              const existing = nextCollectibles.get(id);
              nextCollectibles.set(id, {
                id,
                key: params.key,
                title: params.title,
                unlocks_theme_key: params.unlocks_theme_key_is_null
                  ? null
                  : params.unlocks_theme_key,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteCollectible") {
              nextCollectibles.delete(id);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          collectibles.clear();
          for (const [id, collectible] of nextCollectibles) collectibles.set(id, collectible);
        }
        onmessage?.({
          data: {
            requestId: request.requestId,
            ok: true,
            rows,
            backend: "memory",
            persisted: false,
          },
        } as MessageEvent);
      });
    },
    terminate() {},
    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      onmessage = listener;
    },
    set onerror(_listener: ((event: ErrorEvent) => void) | null) {},
  };
  return { worker: worker as unknown as Worker, docs, collectibles };
}

function legacyDoc(
  entityType: string,
  entity: { readonly id: string; readonly createdAt: string; readonly updatedAt: string },
): StoredDoc {
  return {
    entity_type: entityType,
    id: entity.id,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    doc_version: 0,
    value: JSON.stringify(entity),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite Collectible relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const collectible: Collectible = {
    id: "collectible-aurora",
    key: "aurora",
    title: "Revontuliteema",
    unlocksThemeKey: "",
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates legacy content and preserves nullable theme keys while updating", async () => {
    const fixture = createWorker([legacyDoc("collectible", collectible)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteCollectibleStore();

    expect(await store.list()).toEqual({ ok: true, value: [collectible] });
    expect(fixture.docs.has(collectible.id)).toBe(false);
    expect(fixture.collectibles.get(collectible.id)?.unlocks_theme_key).toBe("");

    const updated: Collectible = {
      ...collectible,
      unlocksThemeKey: null,
      title: "Revontuliteema avattu",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(collectible.id)).toEqual({ ok: true, value: updated });
    expect(fixture.collectibles.get(collectible.id)?.created_at).toBe(at);
    expect(await store.remove(collectible.id)).toEqual({ ok: true, value: true });
  });

  it("preserves collectibles referenced by legacy user rewards", async () => {
    const reward: UserReward = {
      id: "reward-aurora",
      achievementId: null,
      collectibleId: collectible.id,
      earnedAt: at,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([
      legacyDoc("collectible", collectible),
      legacyDoc("user-reward", reward),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteCollectibleStore();

    expect(await store.remove(collectible.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.collectible.earned" },
    });
    expect(fixture.docs.has(collectible.id)).toBe(true);
    expect(fixture.docs.has(reward.id)).toBe(true);
  });

  it("preserves collectibles referenced by relational user rewards", async () => {
    const fixture = createWorker([], [collectible.id]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteCollectibleStore();
    await store.save(collectible);

    expect(await store.remove(collectible.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.collectible.earned" },
    });
    expect(fixture.collectibles.has(collectible.id)).toBe(true);
  });

  it("rejects duplicate keys in legacy documents without deleting them", async () => {
    const duplicate: Collectible = { ...collectible, id: "collectible-aurora-duplicate" };
    const fixture = createWorker([
      legacyDoc("collectible", collectible),
      legacyDoc("collectible", duplicate),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteCollectibleStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.collectible.invalid" },
    });
    expect(fixture.docs.size).toBe(2);
    expect(fixture.collectibles.size).toBe(0);
  });
});
