// T188: Achievement engine (§9 Achievement-käsite, §30 palaute, §51 reiluus).
// Kriteeri: kertasaavutukset ovat idempotentteja ja versionoitavia.
// - Katalogi (Achievement): rekisteröinti on idempotentti KEY:n mukaan
//   (deterministinen id `ach-<key>` → retry/synkka ei luo kaksoiskappaleita,
//   T181-henki). Sisältömuutos päivittää rivin version kera (versionointi);
//   sama sisältö → "unchanged" ilman turhaa versiobumpia. Ansaitut palkinnot
//   säilyvät määrittelypäivitysten yli (avain on vakaa).
// - Kertasaavutus (UserReward + achievementId): ansaitaan VERRAN kerran.
//   Palkkioavain = achievementId → deterministinen id `reward-<achievementId>`.
//   Retry/synkka → "duplicate", ei toista riviä (§51: ei tuplapalkintoja).
// - Legacy-rivit (satunnainen id, sama achievementId) tunnistetaan listaskannilla.

import type { Achievement, EntityId, UserReward, UtcTimestamp } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export interface AchievementDefinition {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
}

export function achievementEntityId(key: string): EntityId {
  return `ach-${key}`;
}

export function achievementRewardId(achievementId: EntityId): EntityId {
  return `reward-${achievementId}`;
}

function validateDefinition(definition: AchievementDefinition): boolean {
  const key = definition.key.trim();
  const title = definition.title.trim();
  return key.length >= 1 && key.length <= 100 && title.length >= 1 && title.length <= 200;
}

export type RegisterAchievementResult =
  | { readonly kind: "created"; readonly achievement: Achievement }
  | { readonly kind: "updated"; readonly achievement: Achievement }
  | { readonly kind: "unchanged"; readonly achievement: Achievement };

function sameContent(existing: Achievement, definition: AchievementDefinition): boolean {
  return existing.title === definition.title && existing.description === definition.description;
}

async function findByKey(
  achievements: EntityRepository<Achievement>,
  key: string,
): Promise<DataResult<Achievement | null>> {
  const byId = await achievements.getById(achievementEntityId(key));
  if (byId.ok) {
    return { ok: true, value: byId.value };
  }
  if (byId.error.code !== "not-found") {
    return { ok: false, error: byId.error };
  }
  const listed = await achievements.list();
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }
  return {
    ok: true,
    value: listed.value.find((achievement) => achievement.key === key) ?? null,
  };
}

/**
 * Rekisteröi (tai päivittää) saavutusmäärittelyn idempotentisti.
 * Versiointi: sisältömuutos bumpaa BaseEntity.versionia; sama sisältö ei.
 */
export async function registerAchievementService(
  achievements: EntityRepository<Achievement>,
  definition: AchievementDefinition,
): Promise<DataResult<RegisterAchievementResult>> {
  if (!validateDefinition(definition)) {
    return {
      ok: false,
      error: invalidInput(
        "data.achievement.register.bad-definition",
        "Saavutuksen avaimen ja otsikon on oltava 1–100/200 merkkiä.",
      ),
    };
  }
  const existing = await findByKey(achievements, definition.key);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value !== null) {
    if (sameContent(existing.value, definition)) {
      return { ok: true, value: { kind: "unchanged", achievement: existing.value } };
    }
    const updated = await achievements.update(existing.value.id, {
      title: definition.title,
      description: definition.description,
    });
    if (!updated.ok) {
      return updated;
    }
    return { ok: true, value: { kind: "updated", achievement: updated.value } };
  }
  const created = await achievements.createWithId(achievementEntityId(definition.key), {
    key: definition.key,
    title: definition.title,
    description: definition.description,
  });
  if (created.ok) {
    return { ok: true, value: { kind: "created", achievement: created.value } };
  }
  if (created.error.code !== "already-exists") {
    return created;
  }
  // Retry-rasitus: toinen kirjoittaja ehti samaan id:seen.
  const raced = await achievements.getById(achievementEntityId(definition.key));
  if (raced.ok) {
    return { ok: true, value: { kind: "unchanged", achievement: raced.value } };
  }
  return { ok: false, error: raced.error };
}

export interface EarnAchievementInput {
  readonly achievementId: EntityId;
  /** Valinnainen rinnakkaispalkinto (esim. saavutuksen mukana tuleva kolikko). */
  readonly collectibleId?: EntityId | null | undefined;
  readonly at?: UtcTimestamp | undefined;
}

export type EarnAchievementResult =
  | { readonly kind: "awarded"; readonly reward: UserReward }
  | { readonly kind: "duplicate"; readonly reward: UserReward };

export interface AchievementEngineDeps {
  readonly clock: Clock;
  readonly achievements: EntityRepository<Achievement>;
  readonly userRewards: EntityRepository<UserReward>;
}

/** Löytää aiemmin ansaitun palkinnon (myös legacy-satunnais-id:llä). */
export function findEarnedReward(
  rewards: readonly UserReward[],
  achievementId: EntityId,
): UserReward | undefined {
  return rewards.find((reward) => reward.achievementId === achievementId);
}

/**
 * Ansaitsee kertasaavutuksen idempotentisti: sama saavutus ei palkitse
 * kahdesti retryllä eikä synkkauksella (§51).
 */
export async function earnAchievementService(
  deps: AchievementEngineDeps,
  input: EarnAchievementInput,
): Promise<DataResult<EarnAchievementResult>> {
  const achievement = await deps.achievements.getById(input.achievementId);
  if (!achievement.ok) {
    return { ok: false, error: notFound("achievement") };
  }
  const rewardId = achievementRewardId(input.achievementId);
  const byId = await deps.userRewards.getById(rewardId);
  if (byId.ok) {
    return { ok: true, value: { kind: "duplicate", reward: byId.value } };
  }
  if (byId.error.code !== "not-found") {
    return { ok: false, error: byId.error };
  }
  const listed = await deps.userRewards.list();
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }
  const legacy = findEarnedReward(listed.value, input.achievementId);
  if (legacy !== undefined) {
    return { ok: true, value: { kind: "duplicate", reward: legacy } };
  }
  const created = await deps.userRewards.createWithId(rewardId, {
    achievementId: input.achievementId,
    collectibleId: input.collectibleId ?? null,
    earnedAt: input.at ?? deps.clock.nowIso(),
  });
  if (created.ok) {
    return { ok: true, value: { kind: "awarded", reward: created.value } };
  }
  if (created.error.code === "already-exists") {
    const raced = await deps.userRewards.getById(rewardId);
    if (raced.ok) {
      return { ok: true, value: { kind: "duplicate", reward: raced.value } };
    }
  }
  return { ok: false, error: created.error };
}

/** Ansaittujen saavutusten id:t (T189-gallerian ja yhteenvedon lähteeksi). */
export function listEarnedAchievementIds(rewards: readonly UserReward[]): ReadonlySet<EntityId> {
  const ids = new Set<EntityId>();
  for (const reward of rewards) {
    if (reward.achievementId !== null) {
      ids.add(reward.achievementId);
    }
  }
  return ids;
}
