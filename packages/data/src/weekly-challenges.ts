// T186: weekly challenges (§9: "järjestelmä muodostaa rajattuja haasteita
// käyttäjän aktivoimista ominaisuuksista", §30 palaute, §51 reiluus).
// Kriteeri: viikkotehtävät syntyvät VAIN aktivoiduista moduuleista.
// - Moduulilähtöinen mallisto (WEEKLY_CHALLENGE_TEMPLATES): jokainen haaste
//   kuuluu johonkin pääosioon (enabledSections-avain). Osio, jota käyttäjä
//   ei ole aktivoinut, EI saa haastetta — ei tyhjiä moduuleita (§25).
// - Viikko = ma–su paikallinen kalenteriviikko (sama raja kuin T104).
//   Ajanjakso tallennetaan Quest.activeFrom/activeUntil: ikkuna rajaa
//   suoritukset (T185) — tulevia päiviä ei merkitä (§50).
// - Syntyy idempotentisti: quest- ja progress-rivin id on derivoitu
//   (viikon alku + pohja), joten retry ja kahden replikan yhdistäminen
//   eivät luo kaksoiskappaleita (T181-henki). Vanha rivi löytyy → se palautuu.

import type { BaseEntity, EntityId, Quest, QuestProgress } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import type { QuestCondition } from "./quest-engine.ts";
import { dueAtFromLocalParts } from "./due-time.ts";
import { taskPeriodRange } from "./task-period.ts";

export interface WeeklyChallengeTemplate {
  /** Pohjan pysyvä avain (myös rivin id-avaimessa). */
  readonly key: string;
  /** Pääosio, jonka aktivoituna haaste syntyy (UserPreferences.enabledSections). */
  readonly section: string;
  readonly title: string;
  readonly description: string;
  readonly condition: QuestCondition;
}

/**
 * Rajattu haastemallisto. Ehdot ja tavoitteet vastaavat §9-esimerkkejä
 * ("Tee 3 fokus-sessiota tällä viikolla", "Kirjaa vettä 5 päivänä").
 */
export const WEEKLY_CHALLENGE_TEMPLATES: readonly WeeklyChallengeTemplate[] = [
  {
    key: "focus-sessions",
    section: "focus",
    title: "Tee 3 fokus-sessiota tällä viikolla",
    description: "Kolme valmista fokusistuntoa viikon aikana.",
    condition: { kind: "event-count", goal: 3 },
  },
  {
    key: "water-days",
    section: "health",
    title: "Kirjaa vettä 5 päivänä",
    description: "Vesikirjauksia viitenä eri päivänä viikon aikana.",
    condition: { kind: "active-day-count", goal: 5 },
  },
  {
    key: "task-completions",
    section: "tasks",
    title: "Valmista 5 tehtävää tällä viikolla",
    description: "Viisi valmista tehtävää viikon aikana.",
    condition: { kind: "event-count", goal: 5 },
  },
  {
    key: "goal-days",
    section: "goals",
    title: "Merkitse 3 tavoitepäivää tällä viikolla",
    description: "Kolme merkittyä tavoitepäivää viikon aikana.",
    condition: { kind: "event-count", goal: 3 },
  },
];

export interface WeeklyChallengePlan {
  readonly weekStartLocalDate: string;
  readonly weekEndLocalDate: string;
  /** Vain aktivoiduista moduuleista syntyneet pohjat. */
  readonly templates: readonly WeeklyChallengeTemplate[];
}

/**
 * Suunnittelee viikon haasteet: mukaan vain ne pohjat, joiden pääosio on
 * käyttäjän aktivoima. Suunnittelu on puhdas (ei IO:ta).
 */
export function planWeeklyChallenges(input: {
  readonly enabledSections: readonly string[];
  readonly localDate: string;
}): WeeklyChallengePlan {
  const week = taskPeriodRange("viikko", input.localDate);
  const enabled = new Set(input.enabledSections);
  return {
    weekStartLocalDate: week.startLocalDate,
    weekEndLocalDate: week.endLocalDate,
    templates: WEEKLY_CHALLENGE_TEMPLATES.filter((template) => enabled.has(template.section)),
  };
}

export function weeklyChallengeQuestId(weekStartLocalDate: string, templateKey: string): EntityId {
  return `qw-${weekStartLocalDate}-${templateKey}`;
}

export function weeklyChallengeProgressId(
  weekStartLocalDate: string,
  templateKey: string,
): EntityId {
  return `qwp-${weekStartLocalDate}-${templateKey}`;
}

export interface WeeklyChallengeDeps {
  readonly clock: Clock;
  readonly quests: EntityRepository<Quest>;
  readonly questProgress: EntityRepository<QuestProgress>;
}

export interface EnsureWeeklyChallengesInput {
  readonly enabledSections: readonly string[];
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
}

export interface WeeklyChallengeInstance {
  readonly template: WeeklyChallengeTemplate;
  readonly quest: Quest;
  readonly progress: QuestProgress;
}

export interface EnsureWeeklyChallengesResult {
  readonly instances: readonly WeeklyChallengeInstance[];
  /** Tällä kerralla luodut quest-id:t (retryllä tyhjä). */
  readonly createdQuestIds: readonly EntityId[];
}

async function ensureRow<T extends BaseEntity>(
  repo: EntityRepository<T>,
  id: EntityId,
  input: Omit<T, "id" | "createdAt" | "updatedAt" | "version">,
): Promise<DataResult<{ readonly entity: T; readonly created: boolean }>> {
  const created = await repo.createWithId(id, input);
  if (created.ok) {
    return { ok: true, value: { entity: created.value, created: true } };
  }
  if (created.error.code !== "already-exists") {
    return created;
  }
  const existing = await repo.getById(id);
  if (!existing.ok) {
    return existing;
  }
  return { ok: true, value: { entity: existing.value, created: false } };
}

/**
 * Luo (tai palauttaa olemassa olevat) viikon haasteet idempotentisti.
 * Vain aktivoiduista moduuleista — muista ei synny mitään.
 */
export async function ensureWeeklyChallenges(
  deps: WeeklyChallengeDeps,
  input: EnsureWeeklyChallengesInput,
): Promise<DataResult<EnsureWeeklyChallengesResult>> {
  const plan = planWeeklyChallenges(input);
  const activeFrom = dueAtFromLocalParts(
    plan.weekStartLocalDate,
    "00:00",
    input.timezoneOffsetMinutes,
  );
  const activeUntil = dueAtFromLocalParts(
    plan.weekEndLocalDate,
    "23:59",
    input.timezoneOffsetMinutes,
  );
  if (activeFrom === null || activeUntil === null) {
    return {
      ok: false,
      error: invalidInput(
        "data.weekly-challenge.bad-week",
        "Viikon rajaa ei voitu laskea päivämäärästä.",
      ),
    };
  }

  const instances: WeeklyChallengeInstance[] = [];
  const createdQuestIds: EntityId[] = [];
  for (const template of plan.templates) {
    const questId = weeklyChallengeQuestId(plan.weekStartLocalDate, template.key);
    const progressId = weeklyChallengeProgressId(plan.weekStartLocalDate, template.key);
    const quest = await ensureRow(deps.quests, questId, {
      title: template.title,
      description: template.description,
      activeFrom,
      activeUntil,
      condition: template.condition,
    });
    if (!quest.ok) {
      return quest;
    }
    // Täydennä vanha deterministinen viikkoquest, jolta ehtokenttä puuttui.
    const persistedQuest =
      quest.value.entity.condition === null
        ? await deps.quests.update(questId, { condition: template.condition })
        : { ok: true as const, value: quest.value.entity };
    if (!persistedQuest.ok) {
      return persistedQuest;
    }
    const progress = await ensureRow(deps.questProgress, progressId, {
      questId,
      progress: 0,
      goal: template.condition.goal,
      completedAt: null,
    });
    if (!progress.ok) {
      return progress;
    }
    if (quest.value.created) {
      createdQuestIds.push(questId);
    }
    instances.push({
      template,
      quest: persistedQuest.value,
      progress: progress.value.entity,
    });
  }
  return { ok: true, value: { instances, createdQuestIds } };
}
