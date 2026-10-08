// T190: Collectible-malli (§9: "suoritukset avaavat tähtiä, alueita tai pieniä
// collectible-kortteja", keräily ei vaadi rahaa; §30 palaute, §51 reiluus).
// Kriteeri: virtuaalinen keräilyesine voidaan avata saavutuksesta/levelistä.
// - Katalogi (Collectible): rekisteröinti idempotentti KEY:n mukaan
//   (deterministinen id `col-<key>`, T181-henki); sisältömuutos bumpaa versiota
//   (T188-malli). `unlocksThemeKey` on myöhäinen sidonta teeman avaukseen.
// - Avaussääntö (CollectibleUnlockRule): saavutusavaimella TAI levelikynnyksellä
//   (level tulee T182-käyrästä). Sääntö on dataa, ei koodia — sama mallisto
//   toimii constellation/journey-teeman kanssa (§9 suositus).
// - Avaus (UserReward + collectibleId): esine avataan VERRAN kerran (§51).
//   Palkkioavain = collectibleId → id `reward-col-<collectibleId>`; jo
//   saavutuksen mukana avattu esine (T188:n rivi) tunnistetaan listaskannilla.
//   Kolikkokoriste ei siis palkitse kahdesti.

import type { Collectible, EntityId, UserReward, UtcTimestamp } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export type CollectibleUnlockRule =
  | { readonly kind: "achievement"; readonly achievementKey: string }
  | { readonly kind: "level"; readonly level: number };

export interface CollectibleDefinition {
  readonly key: string;
  readonly title: string;
  readonly unlocksThemeKey: string | null;
  readonly unlockedBy: CollectibleUnlockRule;
}

/**
 * Constellation/journey-teeman aloitusmallisto (§9 suositeltu teema):
 * suoritukset avaavat tähtiä, level-kynnykset alueita. Ei rahaa, ei aikarajoja.
 */
export const COLLECTIBLE_DEFINITIONS: readonly CollectibleDefinition[] = [
  {
    key: "star-first-light",
    title: "Ensimmäinen tähti",
    unlocksThemeKey: null,
    unlockedBy: { kind: "achievement", achievementKey: "first-task" },
  },
  {
    key: "star-streak",
    title: "Seitsentähti",
    unlocksThemeKey: null,
    unlockedBy: { kind: "achievement", achievementKey: "week-streak" },
  },
  {
    key: "star-focus",
    title: "Kirkas tähti",
    unlocksThemeKey: null,
    unlockedBy: { kind: "achievement", achievementKey: "focus-hour" },
  },
  {
    key: "region-aurora",
    title: "Revontulialue",
    unlocksThemeKey: "aurora",
    unlockedBy: { kind: "level", level: 5 },
  },
];

export function collectibleEntityId(key: string): EntityId {
  return `col-${key}`;
}

export function collectibleRewardId(collectibleId: EntityId): EntityId {
  return `reward-col-${collectibleId}`;
}

function validateDefinition(definition: CollectibleDefinition): boolean {
  const key = definition.key.trim();
  const title = definition.title.trim();
  if (key.length < 1 || key.length > 100 || title.length < 1 || title.length > 200) {
    return false;
  }
  if (definition.unlockedBy.kind === "achievement") {
    return definition.unlockedBy.achievementKey.trim().length >= 1;
  }
  return Number.isInteger(definition.unlockedBy.level) && definition.unlockedBy.level >= 1;
}

function sameContent(existing: Collectible, definition: CollectibleDefinition): boolean {
  return (
    existing.title === definition.title && existing.unlocksThemeKey === definition.unlocksThemeKey
  );
}

async function findByKey(
  collectibles: EntityRepository<Collectible>,
  key: string,
): Promise<DataResult<Collectible | null>> {
  const byId = await collectibles.getById(collectibleEntityId(key));
  if (byId.ok) {
    return { ok: true, value: byId.value };
  }
  if (byId.error.code !== "not-found") {
    return { ok: false, error: byId.error };
  }
  const listed = await collectibles.list();
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }
  return {
    ok: true,
    value: listed.value.find((collectible) => collectible.key === key) ?? null,
  };
}

export type RegisterCollectibleResult =
  | { readonly kind: "created"; readonly collectible: Collectible }
  | { readonly kind: "updated"; readonly collectible: Collectible }
  | { readonly kind: "unchanged"; readonly collectible: Collectible };

/** Rekisteröi (tai päivittää) keräilyesineen idempotentisti ja versioiden. */
export async function registerCollectibleService(
  collectibles: EntityRepository<Collectible>,
  definition: CollectibleDefinition,
): Promise<DataResult<RegisterCollectibleResult>> {
  if (!validateDefinition(definition)) {
    return {
      ok: false,
      error: invalidInput(
        "data.collectible.register.bad-definition",
        "Keräilyesineen avaimen ja otsikon on oltava 1–100/200 merkkiä.",
      ),
    };
  }
  const existing = await findByKey(collectibles, definition.key);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value !== null) {
    if (sameContent(existing.value, definition)) {
      return { ok: true, value: { kind: "unchanged", collectible: existing.value } };
    }
    const updated = await collectibles.update(existing.value.id, {
      title: definition.title,
      unlocksThemeKey: definition.unlocksThemeKey,
    });
    if (!updated.ok) {
      return updated;
    }
    return { ok: true, value: { kind: "updated", collectible: updated.value } };
  }
  const created = await collectibles.createWithId(collectibleEntityId(definition.key), {
    key: definition.key,
    title: definition.title,
    unlocksThemeKey: definition.unlocksThemeKey,
  });
  if (created.ok) {
    return { ok: true, value: { kind: "created", collectible: created.value } };
  }
  if (created.error.code === "already-exists") {
    const raced = await collectibles.getById(collectibleEntityId(definition.key));
    if (raced.ok) {
      return { ok: true, value: { kind: "unchanged", collectible: raced.value } };
    }
  }
  return { ok: false, error: created.error };
}

export interface CollectibleUnlockState {
  /** Ansaittujen saavutusten avaimet (T188: listEarnedAchievementIds → key). */
  readonly earnedAchievementKeys: ReadonlySet<string>;
  /** Tämänhetkinen level (T182: levelForTotalXp). */
  readonly level: number;
}

/**
 * Mitkä esineet ovat avattavissa tässä tilassa (puhdas laskenta).
 * Jo avattu ei tule mukaan — siitä vastaa unlock-palvelu (idempotenssi).
 */
export function evaluateCollectibleUnlocks(
  definitions: readonly CollectibleDefinition[],
  state: CollectibleUnlockState,
): readonly CollectibleDefinition[] {
  return definitions.filter((definition) => {
    const rule = definition.unlockedBy;
    return rule.kind === "achievement"
      ? state.earnedAchievementKeys.has(rule.achievementKey)
      : state.level >= rule.level;
  });
}

export interface CollectibleEngineDeps {
  readonly clock: Clock;
  readonly collectibles: EntityRepository<Collectible>;
  readonly userRewards: EntityRepository<UserReward>;
}

export interface UnlockCollectibleInput {
  readonly collectibleId: EntityId;
  /** Valinnainen rinnakkaissaavutus (T188: saavutuksen mukana tuleva esine). */
  readonly achievementId?: EntityId | null | undefined;
  readonly at?: UtcTimestamp | undefined;
}

export type UnlockCollectibleResult =
  | { readonly kind: "unlocked"; readonly reward: UserReward }
  | { readonly kind: "duplicate"; readonly reward: UserReward };

/** Löytää jo avatun esineen palkinnon (myös saavutusrivin sivukentästä). */
export function findCollectedReward(
  rewards: readonly UserReward[],
  collectibleId: EntityId,
): UserReward | undefined {
  return rewards.find((reward) => reward.collectibleId === collectibleId);
}

/** Avaa keräilyesineen kerran — saavutuksesta, levelistä tai suoraan. */
export async function unlockCollectibleService(
  deps: CollectibleEngineDeps,
  input: UnlockCollectibleInput,
): Promise<DataResult<UnlockCollectibleResult>> {
  const collectible = await deps.collectibles.getById(input.collectibleId);
  if (!collectible.ok) {
    return { ok: false, error: notFound("collectible") };
  }
  const rewardId = collectibleRewardId(input.collectibleId);
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
  const existing = findCollectedReward(listed.value, input.collectibleId);
  if (existing !== undefined) {
    return { ok: true, value: { kind: "duplicate", reward: existing } };
  }
  const created = await deps.userRewards.createWithId(rewardId, {
    achievementId: input.achievementId ?? null,
    collectibleId: input.collectibleId,
    earnedAt: input.at ?? deps.clock.nowIso(),
  });
  if (created.ok) {
    return { ok: true, value: { kind: "unlocked", reward: created.value } };
  }
  if (created.error.code === "already-exists") {
    const raced = await deps.userRewards.getById(rewardId);
    if (raced.ok) {
      return { ok: true, value: { kind: "duplicate", reward: raced.value } };
    }
  }
  return { ok: false, error: created.error };
}

export interface UnlockEligibleInput {
  readonly definitions?: readonly CollectibleDefinition[] | undefined;
  readonly state: CollectibleUnlockState;
  readonly at?: UtcTimestamp | undefined;
}

export interface UnlockedCollectible {
  readonly definition: CollectibleDefinition;
  readonly reward: UserReward;
}

export interface UnlockEligibleResult {
  /** Tällä kerralla avatut (jo avatut jäävät pois — idempotenssi §51). */
  readonly unlocked: readonly UnlockedCollectible[];
}

/**
 * Avaa automaattisesti kaikki tilaan täsmäävät esineet (saavutus/level).
 * Ajetaan saavutuksen tai levelin muuttuessa; uudelleenajo on tyhjä.
 */
export async function unlockEligibleCollectiblesService(
  deps: CollectibleEngineDeps,
  input: UnlockEligibleInput,
): Promise<DataResult<UnlockEligibleResult>> {
  const definitions = input.definitions ?? COLLECTIBLE_DEFINITIONS;
  const eligible = evaluateCollectibleUnlocks(definitions, input.state);
  const listed = await deps.userRewards.list();
  if (!listed.ok) {
    return { ok: false, error: listed.error };
  }
  const unlocked: UnlockedCollectible[] = [];
  for (const definition of eligible) {
    const collectible = await findByKey(deps.collectibles, definition.key);
    if (!collectible.ok) {
      return { ok: false, error: collectible.error };
    }
    if (collectible.value === null) {
      continue;
    }
    if (findCollectedReward(listed.value, collectible.value.id) !== undefined) {
      continue;
    }
    const result = await unlockCollectibleService(deps, {
      collectibleId: collectible.value.id,
      at: input.at,
    });
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (result.value.kind === "unlocked") {
      unlocked.push({ definition, reward: result.value.reward });
    }
  }
  return { ok: true, value: { unlocked } };
}

/** Keräyksen avaamat teemat (§9: esineitä/merkkejä/teemoja). */
export function listUnlockedThemeKeys(
  collectibles: readonly Collectible[],
  rewards: readonly UserReward[],
): ReadonlySet<string> {
  const themes = new Set<string>();
  for (const reward of rewards) {
    if (reward.collectibleId === null) {
      continue;
    }
    const collectible = collectibles.find((item) => item.id === reward.collectibleId);
    if (collectible !== undefined && collectible.unlocksThemeKey !== null) {
      themes.add(collectible.unlocksThemeKey);
    }
  }
  return themes;
}
