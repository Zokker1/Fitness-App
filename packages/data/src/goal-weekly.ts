// T143: viikkofrekvenssin evaluator. Viikko on ISO-viikko: maanantai–
// sunnuntai. Laskenta tapahtuu local-date-avaimilla, joten viikonvaihde ja
// Europe/Helsinki-DST eivät riipu UTC-tunneista.
import type { Goal, HabitRule } from "@lifeos/domain";
import { isGoalActiveOnLocalDate, isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import { addDaysIso, isoWeekday } from "./recurrence.ts";

export interface WeeklyFrequencyObservation {
  readonly localDate: string;
}

export interface WeeklyFrequencyEvaluation {
  readonly goalId: string;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly target: number;
  readonly observed: number;
  readonly remainingOccurrences: number;
  readonly rawRatio: number;
  readonly completionRatio: number;
  readonly completed: boolean;
  readonly futureWeek: boolean;
}

export function weekStartLocalDate(localDate: string): string | null {
  if (!isValidLocalDateKey(localDate)) {
    return null;
  }
  return addDaysIso(localDate, 1 - isoWeekday(localDate));
}

export function evaluateWeeklyFrequencyGoal(input: {
  readonly goal: Pick<Goal, "id" | "deletedAt" | "archivedAt" | "activeFrom" | "activeUntil">;
  readonly rule: Pick<HabitRule, "goalId" | "cadence" | "targetPerPeriod">;
  /** Mikä tahansa kyseisen viikon local-date toimii ankkurina. */
  readonly weekContaining: string;
  readonly todayKey: string;
  readonly observations: readonly WeeklyFrequencyObservation[];
}): DataResult<WeeklyFrequencyEvaluation> {
  const weekStart = weekStartLocalDate(input.weekContaining);
  if (weekStart === null || !isValidLocalDateKey(input.todayKey)) {
    return invalidWeekly("Viikkofrekvenssin päiväavaimen on oltava YYYY-MM-DD.");
  }
  if (input.rule.cadence !== "weekly") {
    return invalidWeekly("Viikkofrekvenssi vaatii weekly-rytmin.");
  }
  if (input.rule.goalId !== null && input.rule.goalId !== input.goal.id) {
    return invalidWeekly("Tavan sääntö ei kuulu annettuun tavoitteeseen.");
  }
  if (!Number.isInteger(input.rule.targetPerPeriod) || input.rule.targetPerPeriod < 1) {
    return invalidWeekly("Viikkofrekvenssin kohteen on oltava vähintään 1.");
  }
  const weekEnd = addDaysIso(weekStart, 6);
  const activeWeekDays = new Set<string>();
  for (let offset = 0; offset < 7; offset += 1) {
    const localDate = addDaysIso(weekStart, offset);
    if (isGoalActiveOnLocalDate(input.goal, localDate)) {
      activeWeekDays.add(localDate);
    }
  }
  if (activeWeekDays.size === 0) {
    return invalidWeekly("Tavoite ei ole aktiivinen valittuna viikkona.");
  }
  for (const observation of input.observations) {
    if (!isValidLocalDateKey(observation.localDate)) {
      return invalidWeekly("Havainnon päiväavain on virheellinen.");
    }
  }
  const futureWeek = weekStart > input.todayKey;
  const observed = futureWeek
    ? 0
    : input.observations.filter(
        (observation) =>
          observation.localDate >= weekStart &&
          observation.localDate <= weekEnd &&
          observation.localDate <= input.todayKey &&
          activeWeekDays.has(observation.localDate),
      ).length;
  const target = input.rule.targetPerPeriod;
  const rawRatio = observed / target;
  return {
    ok: true,
    value: {
      goalId: input.goal.id,
      weekStart,
      weekEnd,
      target,
      observed,
      remainingOccurrences: Math.max(0, target - observed),
      rawRatio,
      completionRatio: Math.min(1, rawRatio),
      completed: !futureWeek && observed >= target,
      futureWeek,
    },
  };
}

function invalidWeekly(message: string): DataResult<WeeklyFrequencyEvaluation> {
  return {
    ok: false,
    error: invalidInput("data.goal.weekly-frequency.invalid", message),
  };
}
