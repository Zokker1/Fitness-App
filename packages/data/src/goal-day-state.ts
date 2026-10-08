// T145: GoalDay-tilakone. Evaluatorit tuottavat evidence-objektin ja tämä
// raja muuttaa sen yhdeksi eksplisiittiseksi päivätilaksi.
import type { Goal, GoalDay } from "@lifeos/domain";
import { isGoalActiveOnLocalDate, isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";

export type GoalDayStatus = "success" | "partial" | "fail" | "not-required" | "future" | "pending";

export type GoalDayEvidence =
  | {
      readonly kind: "ratio";
      readonly completionRatio: number;
      readonly completed: boolean;
      readonly future: boolean;
    }
  | {
      readonly kind: "avoidance";
      readonly success: boolean;
      readonly evaluated: boolean;
      readonly future: boolean;
    };

export interface GoalDayStateEvaluation {
  readonly goalId: string;
  readonly localDate: string;
  readonly status: GoalDayStatus;
  readonly completionRatio: number;
}

export function evaluateGoalDayState(input: {
  readonly goal: Pick<Goal, "id" | "deletedAt" | "archivedAt" | "activeFrom" | "activeUntil">;
  readonly localDate: string;
  readonly todayKey: string;
  readonly goalDay: Pick<GoalDay, "completed"> | null;
  readonly evidence?: GoalDayEvidence;
}): DataResult<GoalDayStateEvaluation> {
  if (!isValidLocalDateKey(input.localDate) || !isValidLocalDateKey(input.todayKey)) {
    return invalidState("GoalDayn päiväavaimen on oltava YYYY-MM-DD.");
  }
  if (!isGoalActiveOnLocalDate(input.goal, input.localDate)) {
    return state(input, "not-required", 0);
  }
  if (input.localDate > input.todayKey || input.evidence?.future === true) {
    return state(input, "future", 0);
  }

  const evidence = input.evidence;
  if (evidence?.kind === "avoidance") {
    if (!evidence.evaluated) {
      return state(input, "pending", 0);
    }
    return state(input, evidence.success ? "success" : "fail", evidence.success ? 1 : 0);
  }
  if (evidence?.kind === "ratio") {
    if (!Number.isFinite(evidence.completionRatio) || evidence.completionRatio < 0) {
      return invalidState("GoalDayn completion-ration on oltava epänegatiivinen luku.");
    }
    if (evidence.completed) {
      return state(input, "success", Math.min(1, evidence.completionRatio));
    }
    if (evidence.completionRatio > 0) {
      return state(input, "partial", Math.min(1, evidence.completionRatio));
    }
    return state(input, input.localDate === input.todayKey ? "pending" : "fail", 0);
  }

  if (input.goalDay !== null) {
    return state(
      input,
      input.goalDay.completed ? "success" : "fail",
      input.goalDay.completed ? 1 : 0,
    );
  }
  return state(input, input.localDate === input.todayKey ? "pending" : "fail", 0);
}

function state(
  input: { readonly goal: Pick<Goal, "id">; readonly localDate: string },
  status: GoalDayStatus,
  completionRatio: number,
): DataResult<GoalDayStateEvaluation> {
  return {
    ok: true,
    value: { goalId: input.goal.id, localDate: input.localDate, status, completionRatio },
  };
}

function invalidState(message: string): DataResult<GoalDayStateEvaluation> {
  return { ok: false, error: invalidInput("data.goal-day.state.invalid", message) };
}
