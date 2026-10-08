import type { Achievement, EntityId, UserReward } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "achievement";
const USER_REWARD_ENTITY_TYPE = "user-reward";
const LEGACY_BATCH_SIZE = 32;

interface AchievementRow {
  readonly id?: unknown;
  readonly key?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedAchievement(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua saavutusta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.achievement.invalid",
    },
  };
}

export function validAchievement(achievement: Achievement): boolean {
  return (
    typeof achievement.id === "string" &&
    achievement.id.length > 0 &&
    typeof achievement.key === "string" &&
    achievement.key.trim().length > 0 &&
    achievement.key.length <= 100 &&
    typeof achievement.title === "string" &&
    achievement.title.trim().length > 0 &&
    achievement.title.length <= 200 &&
    (achievement.description === null || typeof achievement.description === "string") &&
    typeof achievement.createdAt === "string" &&
    achievement.createdAt.length > 0 &&
    typeof achievement.updatedAt === "string" &&
    achievement.updatedAt.length > 0 &&
    Number.isInteger(achievement.version) &&
    achievement.version >= 1
  );
}

export function putAchievementOp(achievement: Achievement): DbTransactionOp {
  return {
    op: "putAchievement",
    params: {
      id: achievement.id,
      key: achievement.key,
      title: achievement.title,
      description: achievement.description ?? "",
      description_is_null: achievement.description === null,
      created_at: achievement.createdAt,
      updated_at: achievement.updatedAt,
      version: achievement.version,
    },
  };
}

function parseAchievements(rows: readonly unknown[]): DataResult<readonly Achievement[]> {
  const achievements: Achievement[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedAchievement();
    }
    const row = value as AchievementRow;
    if (
      typeof row.id !== "string" ||
      typeof row.key !== "string" ||
      typeof row.title !== "string" ||
      (row.description !== null && typeof row.description !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedAchievement();
    }
    const achievement: Achievement = {
      id: row.id,
      key: row.key,
      title: row.title,
      description: row.description,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validAchievement(achievement)) return corruptedAchievement();
    achievements.push(achievement);
  }
  return { ok: true, value: achievements };
}

async function migrateLegacyAchievements(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<Achievement>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const achievements = legacy.value;
  const legacyIds = new Set<string>();
  const legacyKeys = new Set<string>();
  for (const achievement of achievements) {
    if (
      !validAchievement(achievement) ||
      legacyIds.has(achievement.id) ||
      legacyKeys.has(achievement.key)
    ) {
      return corruptedAchievement();
    }
    legacyIds.add(achievement.id);
    legacyKeys.add(achievement.key);
  }

  const currentResponse = await sendDbRequest({
    kind: "query",
    op: "listAchievements",
    params: {},
  });
  if (!currentResponse.ok) return toDataResult(currentResponse, () => true as const);
  const current = parseAchievements(currentResponse.rows);
  if (!current.ok) return current;
  const currentIds = new Set(current.value.map((achievement) => achievement.id));
  const currentKeys = new Set(current.value.map((achievement) => achievement.key));
  if (
    achievements.some(
      (achievement) => currentIds.has(achievement.id) || currentKeys.has(achievement.key),
    )
  ) {
    return corruptedAchievement();
  }

  for (let offset = 0; offset < achievements.length; offset += LEGACY_BATCH_SIZE) {
    const batch = achievements.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const achievement of batch) {
      ops.push(putAchievementOp(achievement));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: achievement.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteAchievementStore(): EntityStore<Achievement> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyAchievements();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Achievement> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Achievement[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listAchievements", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseAchievements(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Achievement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getAchievement", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as Achievement);
      const parsed = parseAchievements(response.rows);
      if (!parsed.ok) return parsed;
      const achievement = parsed.value[0];
      return achievement === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: achievement };
    },
    async save(value: Achievement): Promise<DataResult<Achievement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validAchievement(value)) {
        return {
          ok: false,
          error: invalidInput("data.achievement.invalid", "Saavutuksen tiedot eivät kelpaa."),
        };
      }
      const listed = await store.list();
      if (!listed.ok) return listed;
      if (
        listed.value.some(
          (achievement) => achievement.key === value.key && achievement.id !== value.id,
        )
      ) {
        return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putAchievementOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const legacyRewards =
        await createSqliteEntityDocStore<UserReward>(USER_REWARD_ENTITY_TYPE).list();
      if (!legacyRewards.ok) return legacyRewards;
      if (legacyRewards.value.some((reward) => reward.achievementId === id)) {
        return {
          ok: false,
          error: invalidInput(
            "data.achievement.earned",
            "Saavutusta ei voi poistaa, koska käyttäjälle annettu palkinto säilytetään.",
          ),
        };
      }
      const relationalReward = await sendDbRequest({
        kind: "query",
        op: "getAchievementRewardReference",
        params: { id },
      });
      if (!relationalReward.ok) return toDataResult(relationalReward, () => false);
      if (relationalReward.rows.length > 0) {
        return {
          ok: false,
          error: invalidInput(
            "data.achievement.earned",
            "Saavutusta ei voi poistaa, koska käyttäjälle annettu palkinto säilytetään.",
          ),
        };
      }
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteAchievement", params: { id } }],
      });
      const result = toDataResult(response, () => true as const);
      if (
        !response.ok &&
        response.code === "invalid-input" &&
        response.diagnosticCode === "db.transaction.failed.op0"
      ) {
        return {
          ok: false,
          error: invalidInput(
            "data.achievement.earned",
            "Saavutusta ei voi poistaa, koska käyttäjälle annettu palkinto säilytetään.",
          ),
        };
      }
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
