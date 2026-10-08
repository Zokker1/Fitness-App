// T185: quest engine (§9 rajatut haasteet aktivoiduista ominaisuuksista,
// §30 palaute, §51 reiluus). Kriteeri: questilla on ehto, ajanjakso, progress
// ja claim/completion.
// - ehto (QuestCondition): tapahtumamäärä (event-count, esim. "Tee 3
//   fokus-sessiota") tai aktiivisten päivien määrä (active-day-count, esim.
//   "Kirjaa vettä 5 päivänä"); valinnainen minimimäärä suodattaa tapahtumat.
// - ajanjakso (QuestWindow): vain ikkunan sisällä syntyneet suoritukset
//   täyttävät ehdon — tulevia päiviä ei merkitä (§50).
// - progress: derivoitu tapahtumista deterministisesti. Sama suoritus
//   (eventId) lasketaan kerran, joten retry ja synkka eivät tuplaa (T181-henki).
//   Snapshot tallennetaan QuestProgress-riviin (compute on totuus).
// - claim/completion: maaliin päästy quest merkitään completedAt:lla
//   idempotentisti. §57.14: myöhäinen claim sallitaan, ei rankaista.

import type { EntityId, Quest, QuestCondition, QuestProgress, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";

export type { QuestCondition, QuestConditionKind } from "@lifeos/domain";

export interface QuestEventSample {
  /** Suorituksen pysyvä tunniste (retry/synkka ei laske samaa kahdesti). */
  readonly eventId: EntityId;
  readonly at: UtcTimestamp;
  /** Tapahtuman koko (esim. fokussekunnit); oletus 1. */
  readonly amount?: number | undefined;
}

export interface QuestWindow {
  readonly activeFrom: UtcTimestamp | null;
  readonly activeUntil: UtcTimestamp | null;
}

export interface QuestProgressSnapshot {
  readonly progress: number;
  readonly goal: number;
  readonly complete: boolean;
}

export interface ComputeQuestProgressOptions {
  readonly window?: QuestWindow | undefined;
  readonly timezoneOffsetMinutes?: number | undefined;
  /** T264: tapahtumakohtainen offset pitää active-day-countin DST-oikeana. */
  readonly timeZone?: string | undefined;
}

export type QuestStatus = "upcoming" | "active" | "claimable" | "completed" | "expired";

export interface QuestStateInput {
  readonly window: QuestWindow;
  readonly progress: number;
  readonly goal: number;
  readonly completedAt: UtcTimestamp | null;
  readonly now: UtcTimestamp;
}

function assertCondition(condition: QuestCondition): void {
  if (!Number.isInteger(condition.goal) || condition.goal < 1) {
    throw new RangeError("Questin tavoitteen on oltava vähintään 1.");
  }
  if (
    condition.minimumAmount !== undefined &&
    (!Number.isFinite(condition.minimumAmount) || condition.minimumAmount <= 0)
  ) {
    throw new RangeError("Questin minimimäärän on oltava positiivinen.");
  }
}

/**
 * Derivoi questin etenemän tapahtumista. eventId-deduplointi tekee
 * laskennasta idempotenttinen: sama suoritus retryllä/synkalla kerran.
 */
export function computeQuestProgress(
  condition: QuestCondition,
  events: readonly QuestEventSample[],
  options: ComputeQuestProgressOptions = {},
): QuestProgressSnapshot {
  assertCondition(condition);
  const offset = options.timezoneOffsetMinutes ?? 0;
  const seenEvents = new Set<EntityId>();
  const seenDays = new Set<string>();
  for (const event of events) {
    if (seenEvents.has(event.eventId)) {
      continue;
    }
    const amount = event.amount ?? 1;
    if (condition.minimumAmount !== undefined && amount < condition.minimumAmount) {
      continue;
    }
    const window = options.window;
    if (window !== undefined) {
      if (window.activeFrom !== null && event.at < window.activeFrom) {
        continue;
      }
      if (window.activeUntil !== null && event.at > window.activeUntil) {
        continue;
      }
    }
    seenEvents.add(event.eventId);
    let eventOffset = offset;
    if (options.timeZone !== undefined && options.timeZone.trim() !== "") {
      try {
        eventOffset = timezoneOffsetMinutesAtInstant(event.at, options.timeZone) ?? offset;
      } catch {
        eventOffset = offset;
      }
    }
    seenDays.add(toLocalDateKey(event.at, eventOffset));
  }
  const count = condition.kind === "event-count" ? seenEvents.size : seenDays.size;
  const progress = Math.min(count, condition.goal);
  return { progress, goal: condition.goal, complete: count >= condition.goal };
}

/** Questin tila ehdosta, ajankohdasta ja claim-tilasta (§50: ei tulevaisuutta). */
export function evaluateQuestState(input: QuestStateInput): QuestStatus {
  if (input.completedAt !== null) {
    return "completed";
  }
  const reached = input.progress >= input.goal;
  if (input.window.activeFrom !== null && input.now < input.window.activeFrom) {
    return "upcoming";
  }
  if (input.window.activeUntil !== null && input.now > input.window.activeUntil && !reached) {
    return "expired";
  }
  // §57.14: maaliin ehditty myös ikkunan jälkeen on claimattavissa.
  return reached ? "claimable" : "active";
}

export interface QuestEngineDeps {
  readonly clock: Clock;
  readonly quests: EntityRepository<Quest>;
  readonly questProgress: EntityRepository<QuestProgress>;
}

export interface UpdateQuestProgressInput {
  readonly progressId: EntityId;
  /** Vanhan questin sääntö voidaan antaa siirtymävaiheen fallbackina. */
  readonly condition?: QuestCondition | undefined;
  readonly events: readonly QuestEventSample[];
  readonly timezoneOffsetMinutes?: number | undefined;
}

/** Päivittää QuestProgress-snapshotin derivoidusta etenemästä (totuus: compute). */
export async function updateQuestProgressService(
  deps: QuestEngineDeps,
  input: UpdateQuestProgressInput,
): Promise<DataResult<QuestProgress>> {
  const stored = await deps.questProgress.getById(input.progressId);
  if (!stored.ok) {
    return stored;
  }
  const quest = await deps.quests.getById(stored.value.questId);
  if (!quest.ok) {
    return quest;
  }
  const condition = quest.value.condition ?? input.condition;
  if (condition === undefined) {
    return {
      ok: false,
      error: invalidInput("data.quest.condition.missing", "Haasteen ehtoa ei ole määritetty."),
    };
  }
  const snapshot = computeQuestProgress(condition, input.events, {
    window: { activeFrom: quest.value.activeFrom, activeUntil: quest.value.activeUntil },
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
  });
  if (stored.value.progress === snapshot.progress && stored.value.goal === snapshot.goal) {
    return stored;
  }
  return deps.questProgress.update(input.progressId, {
    progress: snapshot.progress,
    goal: snapshot.goal,
  });
}

export interface ClaimQuestInput {
  readonly progressId: EntityId;
  readonly at?: UtcTimestamp | undefined;
}

export type ClaimQuestResult =
  | { readonly kind: "claimed"; readonly progress: QuestProgress }
  | { readonly kind: "duplicate"; readonly progress: QuestProgress };

/** Claim/completion idempotentisti: jo claimattu quest palauttaa duplicate:n. */
export async function claimQuestService(
  deps: QuestEngineDeps,
  input: ClaimQuestInput,
): Promise<DataResult<ClaimQuestResult>> {
  const at = input.at ?? deps.clock.nowIso();
  const stored = await deps.questProgress.getById(input.progressId);
  if (!stored.ok) {
    return stored;
  }
  const quest = await deps.quests.getById(stored.value.questId);
  if (!quest.ok) {
    return quest;
  }
  const status = evaluateQuestState({
    window: { activeFrom: quest.value.activeFrom, activeUntil: quest.value.activeUntil },
    progress: stored.value.progress,
    goal: stored.value.goal,
    completedAt: stored.value.completedAt,
    now: at,
  });
  if (status === "completed") {
    return { ok: true, value: { kind: "duplicate", progress: stored.value } };
  }
  if (status !== "claimable") {
    return {
      ok: false,
      error: invalidInput(
        `data.quest.claim.${status}`,
        status === "upcoming"
          ? "Questi ei ole vielä alkanut."
          : status === "expired"
            ? "Questi päättyi ennen tavoitetta."
            : "Tavoite ei ole vielä täyttynyt.",
      ),
    };
  }
  const claimed = await deps.questProgress.update(input.progressId, { completedAt: at });
  if (!claimed.ok) {
    return claimed;
  }
  return { ok: true, value: { kind: "claimed", progress: claimed.value } };
}
