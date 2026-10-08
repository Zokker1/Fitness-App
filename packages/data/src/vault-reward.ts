// T192: Reward Vault (§9: "käyttäjä voi määrittää omia oikean elämän
// palkintojaan pistekynnyksille, esim. 1000 XP → elokuvailta. Sovellus ei
// oleta palkinnon rahallista arvoa."; §30 palaute, §51 reiluus).
// Kriteeri: käyttäjä voi määrittää oman palkinnon ja XP-kynnyksen.
// - VaultReward (domain): otsikko + vapaaehtoinen muistutus + xpThreshold.
//   Ei rahakenttää, ei valmiita palkintoja — käyttäjän oma (§9).
// - createVaultRewardService: validoi ja tallentaa (otsikko 1–200, kynnys
//   positiivinen kokonaisluku). Ei automaattista key-deduplointia: käyttäjä
//   saa määrittää kaksi samannimistä palkintoa eri kynnyksin (kuten tehtävät).
// - updateVaultRewardService: muokkaa otsikkoa/muistutusta/kynnystä
//   version kera (T188-versionointi). Kynnys saa vain kasvaa? Ei — käyttäjä
//   hallitsee omaa palkintoaan, voi myös laskea kynnystä (§51: ei rangaistua).
// - isVaultRewardReached: puhdas kysymys "onko kynnys täyttynyt" (kokonais-XP
//   yltää kynnykseen). Lunastus/claim on T193; tässä vain ehto.
// §57.14: odottava palkinto ei ole häpeä vaan tuleva palkinto.

import type { EntityId, VaultReward } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

const TITLE_MAX = 200;
const NOTE_MAX = 500;

export interface VaultRewardDeps {
  readonly clock: Clock;
  readonly vaultRewards: EntityRepository<VaultReward>;
}

export interface CreateVaultRewardInput {
  readonly title: string;
  readonly note?: string | null | undefined;
  readonly xpThreshold: number;
}

function validateVaultRewardValues(input: {
  readonly title: string;
  readonly note: string | null;
  readonly xpThreshold: number;
}): DataResult<{
  readonly title: string;
  readonly note: string | null;
  readonly xpThreshold: number;
}> {
  const title = input.title.trim();
  if (title.length < 1 || title.length > TITLE_MAX) {
    return {
      ok: false,
      error: invalidInput(
        "data.vault-reward.validation.bad-title",
        "Palkinnon otsikon on oltava 1–200 merkkiä.",
      ),
    };
  }
  const note = input.note === null ? null : input.note.trim();
  if (note !== null && note.length > NOTE_MAX) {
    return {
      ok: false,
      error: invalidInput(
        "data.vault-reward.validation.bad-note",
        "Muistutus on liian pitkä (enintään 500 merkkiä).",
      ),
    };
  }
  if (!Number.isSafeInteger(input.xpThreshold) || input.xpThreshold < 1) {
    return {
      ok: false,
      error: invalidInput(
        "data.vault-reward.validation.bad-threshold",
        "XP-kynnyksen on oltava vähintään 1.",
      ),
    };
  }
  return {
    ok: true,
    value: { title, note: note === "" ? null : note, xpThreshold: input.xpThreshold },
  };
}

/** Luo käyttäjän oman palkinnon XP-kynnykselle. */
export async function createVaultRewardService(
  deps: VaultRewardDeps,
  input: CreateVaultRewardInput,
): Promise<DataResult<VaultReward>> {
  const validated = validateVaultRewardValues({
    title: input.title,
    note: input.note ?? null,
    xpThreshold: input.xpThreshold,
  });
  if (!validated.ok) {
    return validated;
  }
  return deps.vaultRewards.create({
    title: validated.value.title,
    note: validated.value.note,
    xpThreshold: validated.value.xpThreshold,
  });
}

export interface UpdateVaultRewardInput {
  readonly rewardId: EntityId;
  readonly title?: string | undefined;
  readonly note?: string | null | undefined;
  readonly xpThreshold?: number | undefined;
}

/**
 * Muokkaa palkintoa (version kera). Kynnystä voi muuttaa suuntaan tahansa —
 * käyttäjä hallitsee omaa palkintoaan (§51 ei rangaistua).
 */
export async function updateVaultRewardService(
  deps: VaultRewardDeps,
  input: UpdateVaultRewardInput,
): Promise<DataResult<VaultReward>> {
  const existing = await deps.vaultRewards.getById(input.rewardId);
  if (!existing.ok) {
    return { ok: false, error: notFound("vault-reward") };
  }
  const validated = validateVaultRewardValues({
    title: input.title ?? existing.value.title,
    note: input.note === undefined ? existing.value.note : input.note,
    xpThreshold: input.xpThreshold ?? existing.value.xpThreshold,
  });
  if (!validated.ok) {
    return validated;
  }
  return deps.vaultRewards.update(input.rewardId, validated.value);
}

/**
 * Palkinnon ehto: kokonais-XP yltää kynnykseen (§9 pistekynnys).
 * Lunastus/claim on erillinen mekanismi (T193).
 */
export function isVaultRewardReached(reward: VaultReward, totalXp: number): boolean {
  return totalXp >= reward.xpThreshold;
}

export type VaultRewardStatus = "reached" | "waiting";

/** Palkinnon tila sana keinoin (§31): kynnys täyttyi tai odottaa. */
export function vaultRewardStatus(reward: VaultReward, totalXp: number): VaultRewardStatus {
  return isVaultRewardReached(reward, totalXp) ? "reached" : "waiting";
}

/** Vientiä varten: palkinnon avauspiste (kynnyksen jälkeinen tila-avain). */
export function vaultRewardEventId(rewardId: EntityId): EntityId {
  return `vault-${rewardId}`;
}
