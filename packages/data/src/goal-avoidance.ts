// T144: vältettävän tavoitteen evaluator.
// Onnistuminen tarkoittaa, ettei päivälle kirjattu yhtään rikkomustapahtumaa.
// Tuleva päivä ei saa muuttua onnistumiseksi pelkän tyhjän historian vuoksi.
import type { Goal } from "@lifeos/domain";
import { isGoalActiveOnLocalDate, isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";

export interface AvoidanceObservation {
  readonly localDate: string;
}

export interface AvoidanceEvaluation {
  readonly goalId: string;
  readonly localDate: string;
  readonly observedViolations: number;
  readonly success: boolean;
  readonly future: boolean;
  /** False future-positiivinen estetään: tuleva päivä ei ole arvioitavissa. */
  readonly evaluated: boolean;
}

export function evaluateAvoidanceGoal(input: {
  readonly goal: Pick<Goal, "id" | "deletedAt" | "archivedAt" | "activeFrom" | "activeUntil">;
  readonly localDate: string;
  readonly todayKey: string;
  readonly observations: readonly AvoidanceObservation[];
}): DataResult<AvoidanceEvaluation> {
  if (!isValidLocalDateKey(input.localDate) || !isValidLocalDateKey(input.todayKey)) {
    return invalidAvoidance("Vältettävän tavoitteen päiväavaimen on oltava YYYY-MM-DD.");
  }
  if (!isGoalActiveOnLocalDate(input.goal, input.localDate)) {
    return invalidAvoidance("Vältettävä tavoite ei ole aktiivinen valittuna päivänä.");
  }
  for (const observation of input.observations) {
    if (!isValidLocalDateKey(observation.localDate)) {
      return invalidAvoidance("Rikkomushavainnon päiväavain on virheellinen.");
    }
  }
  const future = input.localDate > input.todayKey;
  const observedViolations = future
    ? 0
    : input.observations.filter((observation) => observation.localDate === input.localDate).length;
  return {
    ok: true,
    value: {
      goalId: input.goal.id,
      localDate: input.localDate,
      observedViolations,
      success: !future && observedViolations === 0,
      future,
      evaluated: !future,
    },
  };
}

function invalidAvoidance(message: string): DataResult<AvoidanceEvaluation> {
  return {
    ok: false,
    error: invalidInput("data.goal.avoidance.invalid", message),
  };
}
