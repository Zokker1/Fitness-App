// T155: GoalDay-success → rajattu, idempotentti XP.
// UI saa pyytää yhtä paikallispäivää kerrallaan; tämä palvelu pitää
// GoalDay-kirjoituksen ja gamification-kytkennän samassa data-rajassa.
import type { Goal, GoalDay, XPTransaction } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import { toggleGoalDay } from "./goal-day.ts";
import type { EntityRepository } from "./repositories.ts";
import { calculateXpAward, DEFAULT_XP_RULES, type XpRules } from "./xp-rules.ts";
import { createXpAward } from "./xp-ledger.ts";

export interface GoalDayServiceDeps {
  readonly clock: Clock;
  readonly goals: EntityRepository<Goal>;
  readonly goalDays: EntityRepository<GoalDay>;
  /** Valinnainen yhteensopivuusraja: ilman repoa tavoitepäivä silti tallentuu. */
  readonly xpTransactions?: EntityRepository<XPTransaction>;
  /** T180: injektoitavat XP-säännöt. */
  readonly xpRules?: XpRules;
}

export interface ToggleGoalDayServiceInput {
  readonly goalId: string;
  readonly localDate: string;
  readonly completed: boolean;
  readonly todayKey: string;
}

/** Tavoitepäivä on pieni, rajattu onnistuminen — ei tehtävän kokoinen palkinto. */
export const GOAL_DAY_COMPLETION_XP = DEFAULT_XP_RULES.goalDayCompletion;

export async function toggleGoalDayService(
  deps: GoalDayServiceDeps,
  input: ToggleGoalDayServiceInput,
): Promise<DataResult<GoalDay>> {
  const [listedGoals, listedDays] = await Promise.all([deps.goals.list(), deps.goalDays.list()]);
  if (!listedGoals.ok) {
    return listedGoals;
  }
  if (!listedDays.ok) {
    return listedDays;
  }

  const decided = toggleGoalDay({
    goalId: input.goalId,
    localDate: input.localDate,
    completed: input.completed,
    todayKey: input.todayKey,
    existing: listedDays.value,
    goals: listedGoals.value,
  });
  if (!decided.ok) {
    return {
      ok: false,
      error: invalidInput("data.goal-day.toggle.invalid", decided.error),
    };
  }

  let saved: DataResult<GoalDay>;
  if (decided.value.create !== null) {
    saved = await deps.goalDays.create(decided.value.create);
  } else if (decided.value.updateId !== null && decided.value.updateCompleted !== null) {
    saved = await deps.goalDays.update(decided.value.updateId, {
      completed: decided.value.updateCompleted,
    });
  } else {
    return {
      ok: false,
      error: invalidInput(
        "data.goal-day.toggle.no-write",
        "Tavoitepäivän kirjoitusohjetta ei voitu muodostaa.",
      ),
    };
  }
  if (!saved.ok) {
    return saved;
  }

  // XP syntyy vain onnistuneesta merkinnästä, ei avaamisesta. T181: palkkioavain
  // (source + sourceEntityId) sitoo palkinnon juuri tähän GoalDay-riviin, joten
  // toggle false/true, retry tai synkka eivät tuota uutta XP:tä samalle päivälle.
  if (saved.value.completed && deps.xpTransactions !== undefined) {
    const amount = calculateXpAward({ kind: "goal-day-completed" }, deps.xpRules);
    if (amount !== null) {
      await createXpAward(deps.xpTransactions, {
        source: "habit",
        sourceEntityId: saved.value.id,
        amount,
        earnedAt: deps.clock.nowIso(),
        reason: "Tavoitepäivä valmis.",
      });
    }
  }

  return saved;
}
