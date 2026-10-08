import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Achievement, Collectible, UserReward } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteUserRewardStore,
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

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const achievements = new Map<string, Record<string, unknown>>();
  const collectibles = new Map<string, Record<string, unknown>>();
  const rewards = new Map<string, Record<string, unknown>>();
  const writeOrder: string[] = [];
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
        } else if (request.kind === "query" && request.op === "listAchievements") {
          rows = [...achievements.values()];
        } else if (request.kind === "query" && request.op === "getAchievement") {
          const row = achievements.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listCollectibles") {
          rows = [...collectibles.values()];
        } else if (request.kind === "query" && request.op === "getCollectible") {
          const row = collectibles.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listUserRewards") {
          rows = [...rewards.values()];
        } else if (request.kind === "query" && request.op === "getUserReward") {
          const row = rewards.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextAchievements = new Map(achievements);
          const nextCollectibles = new Map(collectibles);
          const nextRewards = new Map(rewards);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            writeOrder.push(write.op);
            if (write.op === "putAchievement") {
              const params = write.params;
              const existing = nextAchievements.get(id);
              nextAchievements.set(id, {
                id,
                key: params.key,
                title: params.title,
                description: params.description_is_null ? null : params.description,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "putCollectible") {
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
            } else if (write.op === "putUserReward") {
              const params = write.params;
              nextRewards.set(id, {
                id,
                achievement_id: params.achievement_id_is_null ? null : params.achievement_id,
                collectible_id: params.collectible_id_is_null ? null : params.collectible_id,
                earned_at: params.earned_at,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          achievements.clear();
          for (const [id, value] of nextAchievements) achievements.set(id, value);
          collectibles.clear();
          for (const [id, value] of nextCollectibles) collectibles.set(id, value);
          rewards.clear();
          for (const [id, value] of nextRewards) rewards.set(id, value);
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
  return {
    worker: worker as unknown as Worker,
    docs,
    achievements,
    collectibles,
    rewards,
    writeOrder,
  };
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

describe("SQLite UserReward relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const achievement: Achievement = {
    id: "ach-first-task",
    key: "first-task",
    title: "Ensimmäinen tehtävä",
    description: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
  const collectible: Collectible = {
    id: "collectible-aurora",
    key: "aurora",
    title: "Revontuliteema",
    unlocksThemeKey: "aurora",
    createdAt: at,
    updatedAt: at,
    version: 1,
  };
  const reward: UserReward = {
    id: "reward-first-task",
    achievementId: achievement.id,
    collectibleId: collectible.id,
    earnedAt: at,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates both parent catalogs before legacy reward rows", async () => {
    const fixture = createWorker([
      legacyDoc("achievement", achievement),
      legacyDoc("collectible", collectible),
      legacyDoc("user-reward", reward),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteUserRewardStore();

    expect(await store.list()).toEqual({ ok: true, value: [reward] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.rewards.get(reward.id)).toMatchObject({
      achievement_id: achievement.id,
      collectible_id: collectible.id,
    });
    expect(fixture.writeOrder.indexOf("putAchievement")).toBeLessThan(
      fixture.writeOrder.indexOf("putUserReward"),
    );
    expect(fixture.writeOrder.indexOf("putCollectible")).toBeLessThan(
      fixture.writeOrder.indexOf("putUserReward"),
    );
  });

  it("keeps an orphaned legacy reward untouched when a parent is missing", async () => {
    const orphan: UserReward = { ...reward, achievementId: "missing-achievement" };
    const fixture = createWorker([legacyDoc("user-reward", orphan)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteUserRewardStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.user-reward.invalid" },
    });
    expect(fixture.docs.has(orphan.id)).toBe(true);
    expect(fixture.rewards.size).toBe(0);
  });

  it("adds immutable reward history and rejects duplicate IDs and removal", async () => {
    const fixture = createWorker([
      legacyDoc("achievement", achievement),
      legacyDoc("collectible", collectible),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteUserRewardStore();

    expect(await store.save(reward)).toEqual({ ok: true, value: reward });
    expect(await store.getById(reward.id)).toEqual({ ok: true, value: reward });
    expect(await store.save({ ...reward, earnedAt: "2026-09-02T08:00:00.000Z" })).toMatchObject({
      ok: false,
      error: { code: "already-exists" },
    });
    expect(await store.remove(reward.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.user-reward.append-only" },
    });
    expect(fixture.rewards.size).toBe(1);
  });

  it("rejects rewards without a catalog reference or with a missing parent", async () => {
    const fixture = createWorker([legacyDoc("achievement", achievement)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteUserRewardStore();

    expect(await store.save({ ...reward, achievementId: null, collectibleId: null })).toMatchObject(
      {
        ok: false,
        error: { diagnosticCode: "data.user-reward.invalid" },
      },
    );
    expect(await store.save({ ...reward, achievementId: "missing-achievement" })).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.user-reward.parent-missing" },
    });
    expect(fixture.rewards.size).toBe(0);
  });
});
