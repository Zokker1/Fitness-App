// T180: XP-palkkiot ovat keskitettyä data/domain-politiikkaa, eivät UI:n
// päätöksiä. Säännöt voi korvata sovelluskonfiguraatiolla palvelurajassa.
import type { RoutineRunDayMode } from "@lifeos/domain";

export interface XpRules {
  /** Valmiin tehtävän palkkio. */
  readonly taskCompletion: number;
  /** Onnistuneen tavoitepäivän palkkio. */
  readonly goalDayCompletion: number;
  /** Täyden rutiinipäivän palkkio. */
  readonly routineCompletion: number;
  /** Kevyen minimirutiinipäivän palkkio. */
  readonly routineMinimumDay: number;
  /** Kelvollisen fokusistunnon palkkio. */
  readonly focusCompletion: number;
  /** Fokusistunnon vähimmäisaktiivinen kesto sekunteina. */
  readonly focusMinimumActiveSeconds: number;
  /** Fokusistuntojen paikallispäivän yhteinen palkkiokatto. */
  readonly focusDailyCap: number;
  /** Yhden aktiivisen terveysseurantatavan päiväpalkkio (ravinto, vesi, lisäravinne). */
  readonly supplementLog: number;
  /**
   * T194/T237: ravinnon, veden ja otetun lisäravinteen triviaali-XP:n
   * yhteinen paikallispäivän katto. Jokainen seurantatapa palkitsee enintään
   * kerran paikallispäivässä. Palkkio loppuu päiväkatteeseen; 0 kytkee sen pois.
   */
  readonly trivialDailyCap: number;
}

export type XpRuleOverrides = Partial<XpRules>;

export const DEFAULT_XP_RULES: XpRules = Object.freeze({
  taskCompletion: 10,
  goalDayCompletion: 5,
  routineCompletion: 10,
  routineMinimumDay: 5,
  focusCompletion: 15,
  focusMinimumActiveSeconds: 5 * 60,
  focusDailyCap: 45,
  supplementLog: 5,
  trivialDailyCap: 15,
});

const RULE_KEYS: readonly (keyof XpRules)[] = [
  "taskCompletion",
  "goalDayCompletion",
  "routineCompletion",
  "routineMinimumDay",
  "focusCompletion",
  "focusMinimumActiveSeconds",
  "focusDailyCap",
  "supplementLog",
  "trivialDailyCap",
];

/** Luo validoidun konfiguraation; nollalla voi kytkeä yksittäisen palkkion pois. */
export function createXpRules(overrides: XpRuleOverrides = {}): XpRules {
  const rules: XpRules = { ...DEFAULT_XP_RULES, ...overrides };
  for (const key of RULE_KEYS) {
    const value = rules[key];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`XP-säännön ${key} on oltava epänegatiivinen kokonaisluku.`);
    }
  }
  if (rules.focusMinimumActiveSeconds === 0) {
    throw new RangeError("Fokuksen vähimmäisaktiivisen ajan on oltava vähintään yksi sekunti.");
  }
  return Object.freeze(rules);
}

export type XpAwardEvent =
  | { readonly kind: "task-completed" }
  | { readonly kind: "goal-day-completed" }
  | { readonly kind: "routine-completed"; readonly dayMode: RoutineRunDayMode }
  | { readonly kind: "health-tracking-logged"; readonly earnedToday: number }
  | {
      readonly kind: "focus-completed";
      readonly activeSeconds: number;
      readonly earnedToday: number;
    }
  /** @deprecated Use health-tracking-logged. Retained for T180/T194 compatibility. */
  | { readonly kind: "supplement-logged"; readonly earnedToday: number };

/** Palauttaa pisteet tai nullin, jos tapahtuma ei täytä XP-ehtoja. */
export function calculateXpAward(
  event: XpAwardEvent,
  rules: XpRules = DEFAULT_XP_RULES,
): number | null {
  let amount: number;
  switch (event.kind) {
    case "task-completed":
      amount = rules.taskCompletion;
      break;
    case "goal-day-completed":
      amount = rules.goalDayCompletion;
      break;
    case "routine-completed":
      amount = event.dayMode === "minimum" ? rules.routineMinimumDay : rules.routineCompletion;
      break;
    case "supplement-logged":
    case "health-tracking-logged":
      // T194/T237: triviaalikirjausten palkkio vähenee kattoa lähestyessä ja
      // loppuu päiväkatteeseen (§9 anti-gaming).
      if (!Number.isSafeInteger(event.earnedToday) || event.earnedToday < 0) {
        return null;
      }
      amount = Math.min(rules.supplementLog, rules.trivialDailyCap - event.earnedToday);
      break;
    case "focus-completed":
      if (
        !Number.isSafeInteger(event.activeSeconds) ||
        event.activeSeconds < rules.focusMinimumActiveSeconds ||
        !Number.isSafeInteger(event.earnedToday) ||
        event.earnedToday < 0 ||
        rules.focusCompletion === 0 ||
        event.earnedToday + rules.focusCompletion > rules.focusDailyCap
      ) {
        return null;
      }
      amount = rules.focusCompletion;
      break;
  }
  return amount > 0 ? amount : null;
}
