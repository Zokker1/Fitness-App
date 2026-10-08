import type { Achievement, Collectible, EntityId, UserReward } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteAchievementStore } from "./sqliteAchievementStore.ts";
import { createSqliteCollectibleStore } from "./sqliteCollectibleStore.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "user-reward";
const LEGACY_BATCH_SIZE = 32;

interface UserRewardRow {
  readonly id?: unknown;
  readonly achievement_id?: unknown;
  readonly collectible_id?: unknown;
  readonly earned_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedUserReward(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua palkintohistoriaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.user-reward.invalid",
    },
  };
}

export function validUserReward(reward: UserReward): boolean {
  return (
    typeof reward.id === "string" &&
    reward.id.length > 0 &&
    (reward.achievementId === null ||
      (typeof reward.achievementId === "string" && reward.achievementId.length > 0)) &&
    (reward.collectibleId === null ||
      (typeof reward.collectibleId === "string" && reward.collectibleId.length > 0)) &&
    (reward.achievementId !== null || reward.collectibleId !== null) &&
    typeof reward.earnedAt === "string" &&
    reward.earnedAt.length > 0 &&
    typeof reward.createdAt === "string" &&
    reward.createdAt.length > 0 &&
    typeof reward.updatedAt === "string" &&
    reward.updatedAt.length > 0 &&
    Number.isInteger(reward.version) &&
    reward.version >= 1
  );
}

export function putUserRewardOp(reward: UserReward): DbTransactionOp {
  return {
    op: "putUserReward",
    params: {
      id: reward.id,
      achievement_id: reward.achievementId ?? "",
      achievement_id_is_null: reward.achievementId === null,
      collectible_id: reward.collectibleId ?? "",
      collectible_id_is_null: reward.collectibleId === null,
      earned_at: reward.earnedAt,
      created_at: reward.createdAt,
      updated_at: reward.updatedAt,
      version: reward.version,
    },
  };
}

function parseUserRewards(rows: readonly unknown[]): DataResult<readonly UserReward[]> {
  const rewards: UserReward[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedUserReward();
    }
    const row = value as UserRewardRow;
    if (
      typeof row.id !== "string" ||
      (row.achievement_id !== null && typeof row.achievement_id !== "string") ||
      (row.collectible_id !== null && typeof row.collectible_id !== "string") ||
      typeof row.earned_at !== "string" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedUserReward();
    }
    const reward: UserReward = {
      id: row.id,
      achievementId: row.achievement_id,
      collectibleId: row.collectible_id,
      earnedAt: row.earned_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validUserReward(reward)) return corruptedUserReward();
    rewards.push(reward);
  }
  return { ok: true, value: rewards };
}

function missingParent(): DataResult<never> {
  return {
    ok: false,
    error: invalidInput(
      "data.user-reward.parent-missing",
      "Palkintoon viitattu saavutus tai keräilyesine ei ole tallennettu.",
    ),
  };
}

async function migrateLegacyUserRewards(
  achievementStore: EntityStore<Achievement>,
  collectibleStore: EntityStore<Collectible>,
): Promise<DataResult<true>> {
  // M014 user_rewards has FKs to both catalog tables. Finish both parent
  // migrations first, then validate every legacy reference before any writes.
  const achievements = await achievementStore.list();
  if (!achievements.ok) return achievements;
  const collectibles = await collectibleStore.list();
  if (!collectibles.ok) return collectibles;
  const achievementIds = new Set(achievements.value.map((achievement) => achievement.id));
  const collectibleIds = new Set(collectibles.value.map((collectible) => collectible.id));

  const legacy = await createSqliteEntityDocStore<UserReward>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const rewards = legacy.value;
  const legacyIds = new Set<string>();
  for (const reward of rewards) {
    if (
      !validUserReward(reward) ||
      legacyIds.has(reward.id) ||
      (reward.achievementId !== null && !achievementIds.has(reward.achievementId)) ||
      (reward.collectibleId !== null && !collectibleIds.has(reward.collectibleId))
    ) {
      return corruptedUserReward();
    }
    legacyIds.add(reward.id);
  }

  const currentResponse = await sendDbRequest({
    kind: "query",
    op: "listUserRewards",
    params: {},
  });
  if (!currentResponse.ok) return toDataResult(currentResponse, () => true as const);
  const current = parseUserRewards(currentResponse.rows);
  if (!current.ok) return current;
  const currentIds = new Set(current.value.map((reward) => reward.id));
  if (rewards.some((reward) => currentIds.has(reward.id))) return corruptedUserReward();

  for (let offset = 0; offset < rewards.length; offset += LEGACY_BATCH_SIZE) {
    const batch = rewards.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const reward of batch) {
      ops.push(putUserRewardOp(reward));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: reward.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteUserRewardStore(): EntityStore<UserReward> {
  const achievementStore = createSqliteAchievementStore();
  const collectibleStore = createSqliteCollectibleStore();
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyUserRewards(achievementStore, collectibleStore);
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<UserReward> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly UserReward[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listUserRewards", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseUserRewards(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<UserReward>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getUserReward", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as UserReward);
      const parsed = parseUserRewards(response.rows);
      if (!parsed.ok) return parsed;
      const reward = parsed.value[0];
      return reward === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: reward };
    },
    async save(value: UserReward): Promise<DataResult<UserReward>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validUserReward(value)) {
        return {
          ok: false,
          error: invalidInput("data.user-reward.invalid", "Palkintotietueen tiedot eivät kelpaa."),
        };
      }

      const existing = await store.getById(value.id);
      if (existing.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      if (existing.error.code !== "not-found") return existing;

      if (value.achievementId !== null) {
        const achievement = await achievementStore.getById(value.achievementId);
        if (!achievement.ok) {
          if (achievement.error.code !== "not-found") return achievement;
          return missingParent();
        }
      }
      if (value.collectibleId !== null) {
        const collectible = await collectibleStore.getById(value.collectibleId);
        if (!collectible.ok) {
          if (collectible.error.code !== "not-found") return collectible;
          return missingParent();
        }
      }

      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putUserRewardOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      if (!result.ok) {
        const raced = await store.getById(value.id);
        if (raced.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
        return result;
      }
      return { ok: true, value };
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      return {
        ok: false,
        error: invalidInput(
          "data.user-reward.append-only",
          "Palkintohistoriaa ei voi muuttaa tai poistaa.",
        ),
      };
    },
  };
  return store;
}
