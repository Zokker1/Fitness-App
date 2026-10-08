// T141: määräaikaisen tavoitteen päivä- ja progress-kooste.
// Paikalliset päivät käsitellään ordinal-arvoina; UTC-tunteja ei käytetä
// progressin laskentaan, jotta DST ei muuta kalenteripäivien lukumäärää.
import type { Goal, GoalDay } from "@lifeos/domain";
import { isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";

export interface GoalProgress {
  readonly goalId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly todayKey: string;
  readonly totalDays: number;
  /** Alusta tähän päivään, tai koko alue jos todayKey on alueen jälkeen. */
  readonly elapsedDays: number;
  readonly remainingDays: number;
  /** Valmiit päivätilat koko määräaikaan suhteutettuna. */
  readonly completedDays: number;
  readonly progressRatio: number;
  /** Valmiit päivätilat kuluneisiin päiviin suhteutettuna. */
  readonly elapsedCompletionRatio: number;
}

function dayOrdinal(localDate: string): number | null {
  if (!isValidLocalDateKey(localDate)) {
    return null;
  }
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1) / 86_400_000;
}

export function summarizeGoalProgress(input: {
  readonly goal: Pick<Goal, "id" | "activeFrom" | "activeUntil">;
  readonly goalDays: readonly GoalDay[];
  readonly todayKey: string;
}): DataResult<GoalProgress> {
  const startDate = input.goal.activeFrom ?? null;
  const endDate = input.goal.activeUntil ?? null;
  const start = startDate === null ? null : dayOrdinal(startDate);
  const end = endDate === null ? null : dayOrdinal(endDate);
  const today = dayOrdinal(input.todayKey);
  if (startDate === null || endDate === null || start === null || end === null || today === null) {
    return invalidProgress("Määräaikainen tavoite tarvitsee kelvollisen alku- ja loppupäivän.");
  }
  if (start > end) {
    return invalidProgress("Tavoitteen alkupäivä ei voi olla loppupäivän jälkeen.");
  }
  const totalDays = end - start + 1;
  const elapsedEnd = Math.min(Math.max(today, start - 1), end);
  const elapsedDays = Math.max(0, elapsedEnd - start + 1);
  const completedDates = new Set(
    input.goalDays
      .filter(
        (day) =>
          day.goalId === input.goal.id &&
          day.completed &&
          dayOrdinal(day.localDate) !== null &&
          (dayOrdinal(day.localDate) ?? 0) >= start &&
          (dayOrdinal(day.localDate) ?? 0) <= end &&
          (dayOrdinal(day.localDate) ?? 0) <= today,
      )
      .map((day) => day.localDate),
  );
  const completedDays = completedDates.size;
  return {
    ok: true,
    value: {
      goalId: input.goal.id,
      startDate,
      endDate,
      todayKey: input.todayKey,
      totalDays,
      elapsedDays,
      remainingDays: totalDays - elapsedDays,
      completedDays,
      progressRatio: completedDays / totalDays,
      elapsedCompletionRatio: elapsedDays === 0 ? 0 : completedDays / elapsedDays,
    },
  };
}

function invalidProgress(message: string): DataResult<GoalProgress> {
  return {
    ok: false,
    error: invalidInput("data.goal.progress.invalid-range", message),
  };
}
