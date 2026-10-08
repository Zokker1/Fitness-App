// T142: päivittäisen määrätavoitteen evaluator.
// Havainnot ovat tarkoituksella pieni adapterineutraali DTO: kutsuja voi
// syöttää tapahtumat tai mittausarvot ilman että Goal-domain tuntee lähdettä.
import type { Goal, HabitRule } from "@lifeos/domain";
import { isGoalActiveOnLocalDate, isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";

export type DailyQuantitySource = "event-count" | "measurement-sum";

export interface DailyQuantityObservation {
  readonly localDate: string;
  /** Tapahtumalähteellä arvoa ei tarvita; mittauslähteellä summa käyttää sitä. */
  readonly amount?: number;
}

export interface DailyQuantityEvaluation {
  readonly goalId: string;
  readonly localDate: string;
  readonly source: DailyQuantitySource;
  readonly target: number;
  readonly observed: number;
  readonly rawRatio: number;
  readonly completionRatio: number;
  readonly completed: boolean;
  /** Tuleva päivä ei voi täyttyä automaattisesti, vaikka havaintoja olisi. */
  readonly future: boolean;
}

export function evaluateDailyQuantityGoal(input: {
  readonly goal: Pick<Goal, "id" | "deletedAt" | "archivedAt" | "activeFrom" | "activeUntil">;
  readonly rule: Pick<HabitRule, "goalId" | "cadence" | "targetPerPeriod">;
  readonly localDate: string;
  readonly todayKey: string;
  readonly source: DailyQuantitySource;
  readonly observations: readonly DailyQuantityObservation[];
}): DataResult<DailyQuantityEvaluation> {
  if (!isValidLocalDateKey(input.localDate) || !isValidLocalDateKey(input.todayKey)) {
    return invalidDaily("Päivittäisen määrätavoitteen päiväavaimen on oltava YYYY-MM-DD.");
  }
  if (input.rule.cadence !== "daily") {
    return invalidDaily("Päivittäinen määrätavoite vaatii daily-rytmin.");
  }
  if (input.rule.goalId !== null && input.rule.goalId !== input.goal.id) {
    return invalidDaily("Tavan sääntö ei kuulu annettuun tavoitteeseen.");
  }
  if (!isGoalActiveOnLocalDate(input.goal, input.localDate)) {
    return invalidDaily("Määrätavoite ei ole aktiivinen valittuna päivänä.");
  }
  if (!Number.isInteger(input.rule.targetPerPeriod) || input.rule.targetPerPeriod < 1) {
    return invalidDaily("Päivittäisen määrätavoitteen kohteen on oltava vähintään 1.");
  }
  for (const observation of input.observations) {
    if (!isValidLocalDateKey(observation.localDate)) {
      return invalidDaily("Havainnon päiväavain on virheellinen.");
    }
    if (
      observation.amount !== undefined &&
      (!Number.isFinite(observation.amount) || observation.amount < 0)
    ) {
      return invalidDaily("Havainnon määrän on oltava nollaa suurempi tai yhtä suuri.");
    }
  }
  const future = input.localDate > input.todayKey;
  const matching = input.observations.filter(
    (observation) => observation.localDate === input.localDate,
  );
  const observed = future
    ? 0
    : input.source === "event-count"
      ? matching.length
      : matching.reduce((sum, observation) => sum + (observation.amount ?? 0), 0);
  const target = input.rule.targetPerPeriod;
  const rawRatio = observed / target;
  return {
    ok: true,
    value: {
      goalId: input.goal.id,
      localDate: input.localDate,
      source: input.source,
      target,
      observed,
      rawRatio,
      completionRatio: Math.min(1, rawRatio),
      completed: !future && observed >= target,
      future,
    },
  };
}

function invalidDaily(message: string): DataResult<DailyQuantityEvaluation> {
  return {
    ok: false,
    error: invalidInput("data.goal.daily-quantity.invalid", message),
  };
}
