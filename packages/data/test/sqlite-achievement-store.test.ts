import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Achievement, UserReward } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteAchievementStore,
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
  relationalRewardAchievementIds: readonly string[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const achievements = new Map<string, Record<string, unknown>>();
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
        } else if (
          request.kind === "query" &&
          request.op === "getAchievementRewardReference" &&
          relationalRewardAchievementIds.includes(sqlText(request.params?.id))
        ) {
          rows = [{ id: "relational-reward" }];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextAchievements = new Map(achievements);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
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
            } else if (write.op === "deleteAchievement") {
              nextAchievements.delete(id);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          achievements.clear();
          for (const [id, achievement] of nextAchievements) achievements.set(id, achievement);
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
  return { worker: worker as unknown as Worker, docs, achievements };
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

describe("SQLite Achievement relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const achievement: Achievement = {
    id: "ach-first-task",
    key: "first-task",
    title: "Ensimmäinen tehtävä",
    description: "",
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("migrates legacy content and preserves nullable text while updating", async () => {
    const fixture = createWorker([legacyDoc("achievement", achievement)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteAchievementStore();

    expect(await store.list()).toEqual({ ok: true, value: [achievement] });
    expect(fixture.docs.has(achievement.id)).toBe(false);
    expect(fixture.achievements.get(achievement.id)?.description).toBe("");

    const updated: Achievement = {
      ...achievement,
      description: null,
      title: "Ensimmäinen valmis tehtävä",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(achievement.id)).toEqual({ ok: true, value: updated });
    expect(fixture.achievements.get(achievement.id)?.created_at).toBe(at);
    expect(await store.remove(achievement.id)).toEqual({ ok: true, value: true });
  });

  it("preserves achievements referenced by legacy user rewards", async () => {
    const reward: UserReward = {
      id: "reward-first-task",
      achievementId: achievement.id,
      collectibleId: null,
      earnedAt: at,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([
      legacyDoc("achievement", achievement),
      legacyDoc("user-reward", reward),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteAchievementStore();

    expect(await store.remove(achievement.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.achievement.earned" },
    });
    expect(fixture.docs.has(achievement.id)).toBe(true);
    expect(fixture.docs.has(reward.id)).toBe(true);
  });

  it("preserves achievements referenced by relational user rewards", async () => {
    const fixture = createWorker([], [achievement.id]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteAchievementStore();
    await store.save(achievement);

    expect(await store.remove(achievement.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.achievement.earned" },
    });
    expect(fixture.achievements.has(achievement.id)).toBe(true);
  });

  it("rejects duplicate keys in legacy documents without deleting them", async () => {
    const duplicate: Achievement = { ...achievement, id: "ach-first-task-duplicate" };
    const fixture = createWorker([
      legacyDoc("achievement", achievement),
      legacyDoc("achievement", duplicate),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteAchievementStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.achievement.invalid" },
    });
    expect(fixture.docs.size).toBe(2);
    expect(fixture.achievements.size).toBe(0);
  });
});
