// T263: goals, routines and momentum are projected from local domain history.

import type {
  Goal,
  GoalDay,
  HabitRule,
  Routine,
  RoutineRun,
  RoutineSchedule,
  XPTransaction,
} from "@lifeos/domain";
import {
  isGoalActiveOnLocalDate,
  isRoutineScheduledOnLocalDate,
  isValidLocalDateKey,
  toLocalDateKey,
} from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";
import { evaluateGoalDayState } from "./goal-day-state.ts";
import { addDaysIso } from "./recurrence.ts";
import { calculateMomentumScoreFromActiveDates, type MomentumScore } from "./momentum.ts";
import { weekStartLocalDate } from "./goal-weekly.ts";

export interface DailyGoalConsistencyMetric {
  readonly successfulDays: number;
  /** Päivä arvioidaan vasta kun se on kirjattu tai mennyt. */
  readonly eligibleDays: number;
  readonly successRate: number | null;
}

export interface WeeklyGoalPeriodMetric {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly observed: number;
  readonly target: number;
  /** Viikon edistyminen, katkaistuna välille 0–1. */
  readonly progressRatio: number;
  /** Avoimella viikolla tulos jätetään arvioimatta. */
  readonly achieved: boolean | null;
  /** Sisältyikö koko ISO-viikko valittuun aikaväliin? */
  readonly fullySelected: boolean;
}

export interface WeeklyGoalConsistencyMetric {
  readonly successfulWeeks: number;
  /** Vain kokonaan valitut ja jo päättyneet viikot. */
  readonly evaluatedWeeks: number;
  readonly successRate: number | null;
  readonly periods: readonly WeeklyGoalPeriodMetric[];
}

export interface CumulativeGoalProgressMetric {
  readonly completedCount: number;
  readonly targetCount: number;
  /** Valitun aikavälin loppuun mennessä kertynyt edistyminen, välille 0–1 rajattuna. */
  readonly progressRatio: number;
}

export interface GoalConsistencyMetric {
  readonly goalId: string;
  readonly title: string;
  readonly cadence: HabitRule["cadence"] | null;
  /** Päivittäinen tavoite, jatkuva tapa tai sääntötön päiväseuranta. */
  readonly daily: DailyGoalConsistencyMetric | null;
  /** Viikkotavoite arvioidaan ISO-viikko kerrallaan. */
  readonly weekly: WeeklyGoalConsistencyMetric | null;
  /** custom-rytmin tavoite, jossa tavoitemäärä on suurempi kuin yksi. */
  readonly cumulative: CumulativeGoalProgressMetric | null;
}

export interface RoutineConsistencyMetric {
  readonly routineId: string;
  readonly title: string;
  readonly completedDays: number;
  /** Vain aikataulun mukaiset, jo kirjatut tai menneet päivät. */
  readonly eligibleDays: number;
  readonly successRate: number | null;
}

export interface GoalRoutineConsistencyDayMetric {
  readonly localDate: string;
  readonly successfulGoalDays: number;
  readonly eligibleGoalDays: number;
  readonly goalSuccessRate: number | null;
  readonly completedRoutineDays: number;
  readonly eligibleRoutineDays: number;
  readonly routineSuccessRate: number | null;
}

export interface MomentumHistoryMetric {
  readonly localDate: string;
  /** Tulevan päivän historiaa ei ennusteta. */
  readonly momentum: MomentumScore | null;
}

export interface GoalRoutineConsistencyMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly goals: readonly GoalConsistencyMetric[];
  readonly routines: readonly RoutineConsistencyMetric[];
  readonly dailyGoalSuccessRate: number | null;
  readonly dailyGoalEligibleDays: number;
  readonly dailyGoalSuccessfulDays: number;
  readonly routineSuccessRate: number | null;
  readonly routineEligibleDays: number;
  readonly routineCompletedDays: number;
  readonly trend: readonly GoalRoutineConsistencyDayMetric[];
  readonly momentumHistory: readonly MomentumHistoryMetric[];
}

export interface GoalRoutineConsistencyMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly goals: readonly Goal[];
  readonly habitRules: readonly HabitRule[];
  readonly goalDays: readonly GoalDay[];
  readonly routines: readonly Routine[];
  readonly routineSchedules: readonly RoutineSchedule[];
  readonly routineRuns: readonly RoutineRun[];
  /** Koko XP-historia tarvitaan palautumisbonuksen alkuhistorian tunnistukseen. */
  readonly xpTransactions: readonly XPTransaction[];
}

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function invalidConsistency<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.consistency.invalid-input", message),
  };
}

function successRate(successes: number, eligible: number): number | null {
  return eligible === 0 ? null : successes / eligible;
}

function validUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function xpLocalDate(
  earnedAt: string,
  timeZone: string | undefined,
  fallbackOffset: number,
): string | null {
  if (!validUtcTimestamp(earnedAt)) return null;
  let offset = fallbackOffset;
  if (timeZone !== undefined && timeZone.trim() !== "") {
    try {
      offset = timezoneOffsetMinutesAtInstant(earnedAt, timeZone) ?? fallbackOffset;
    } catch {
      offset = fallbackOffset;
    }
  }
  return toLocalDateKey(earnedAt, offset);
}

function selectedGoalDayMap(goalDays: readonly GoalDay[]): Map<string, GoalDay> {
  const byGoalAndDate = new Map<string, GoalDay>();
  for (const goalDay of goalDays) {
    if (!isValidLocalDateKey(goalDay.localDate)) continue;
    const key = `${goalDay.goalId}\u0000${goalDay.localDate}`;
    const existing = byGoalAndDate.get(key);
    if (existing === undefined || goalDay.updatedAt > existing.updatedAt) {
      byGoalAndDate.set(key, goalDay);
    }
  }
  return byGoalAndDate;
}

function goalDayFor(
  goalDays: ReadonlyMap<string, GoalDay>,
  goalId: string,
  localDate: string,
): GoalDay | null {
  return goalDays.get(`${goalId}\u0000${localDate}`) ?? null;
}

function countCompletedGoalDaysThrough(
  goal: Goal,
  goalDays: ReadonlyMap<string, GoalDay>,
  endLocalDate: string,
  asOfLocalDate: string,
): number {
  const throughDate = endLocalDate < asOfLocalDate ? endLocalDate : asOfLocalDate;
  let completedCount = 0;
  for (const goalDay of goalDays.values()) {
    if (
      goalDay.goalId === goal.id &&
      goalDay.localDate <= throughDate &&
      goalDay.completed &&
      isGoalActiveOnLocalDate(goal, goalDay.localDate)
    ) {
      completedCount += 1;
    }
  }
  return completedCount;
}

function buildWeeklyMetric(
  goal: Goal,
  rule: HabitRule,
  goalDays: ReadonlyMap<string, GoalDay>,
  period: AnalyticsProjectionPeriod,
  asOfLocalDate: string,
): WeeklyGoalConsistencyMetric {
  const firstWeek = weekStartLocalDate(period.startLocalDate);
  const lastWeek = weekStartLocalDate(period.endLocalDate);
  if (firstWeek === null || lastWeek === null) {
    return { successfulWeeks: 0, evaluatedWeeks: 0, successRate: null, periods: [] };
  }

  const periods: WeeklyGoalPeriodMetric[] = [];
  let successfulWeeks = 0;
  let evaluatedWeeks = 0;
  for (let weekStart = firstWeek; weekStart <= lastWeek; weekStart = addDaysIso(weekStart, 7)) {
    const weekEnd = addDaysIso(weekStart, 6);
    const activeDates: string[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = addDaysIso(weekStart, offset);
      if (isGoalActiveOnLocalDate(goal, date)) activeDates.push(date);
    }
    if (activeDates.length === 0) continue;

    const observed = activeDates.reduce((count, date) => {
      if (date < period.startLocalDate || date > period.endLocalDate || date > asOfLocalDate) {
        return count;
      }
      return count + (goalDayFor(goalDays, goal.id, date)?.completed === true ? 1 : 0);
    }, 0);
    const fullySelected = weekStart >= period.startLocalDate && weekEnd <= period.endLocalDate;
    const evaluationEnd =
      goal.activeUntil !== undefined && goal.activeUntil !== null
        ? goal.activeUntil < weekEnd
          ? goal.activeUntil
          : weekEnd
        : weekEnd;
    const achieved = evaluationEnd > asOfLocalDate ? null : observed >= rule.targetPerPeriod;
    if (fullySelected && achieved !== null) {
      evaluatedWeeks += 1;
      if (achieved) successfulWeeks += 1;
    }
    periods.push({
      weekStart,
      weekEnd,
      observed,
      target: rule.targetPerPeriod,
      progressRatio: Math.min(1, observed / rule.targetPerPeriod),
      achieved,
      fullySelected,
    });
  }

  return {
    successfulWeeks,
    evaluatedWeeks,
    successRate: successRate(successfulWeeks, evaluatedWeeks),
    periods,
  };
}

/** Laskee goal-/routine-consistency-mittarit ja T184-säännön mukaisen momentum-historian. */
export function calculateGoalRoutineConsistencyMetrics(
  input: GoalRoutineConsistencyMetricsInput,
): DataResult<GoalRoutineConsistencyMetrics> {
  if (!isValidLocalDateKey(input.asOfLocalDate)) {
    return invalidConsistency("Arviointipäivän pitää olla kelvollinen paikallispäivä.");
  }
  for (const goal of input.goals) {
    if (
      (goal.activeFrom !== undefined &&
        goal.activeFrom !== null &&
        !isValidLocalDateKey(goal.activeFrom)) ||
      (goal.activeUntil !== undefined &&
        goal.activeUntil !== null &&
        !isValidLocalDateKey(goal.activeUntil))
    ) {
      return invalidConsistency("Tavoitteen aktiivisuusalueessa on virheellinen päiväavain.");
    }
  }
  for (const rule of input.habitRules) {
    if (!Number.isInteger(rule.targetPerPeriod) || rule.targetPerPeriod < 1) {
      return invalidConsistency("Tavan rytmi tai tavoitemäärä ei kelpaa.");
    }
  }

  const projected = buildAnalyticsProjection({
    period: input.period,
    entries: [] as readonly unknown[],
    occurredAt: () => null,
  });
  if (!projected.ok) return projected;
  const days = projected.value.days.map((day) => day.localDate);
  const goalDayMap = selectedGoalDayMap(input.goalDays);
  const activeGoals = input.goals.filter(
    (goal) => goal.deletedAt === null && goal.archivedAt === null,
  );
  const activeRules = input.habitRules.filter(
    (rule) => rule.deletedAt === null && rule.goalId !== null,
  );
  const rulesByGoal = new Map<string, HabitRule[]>();
  for (const rule of activeRules) {
    const rules = rulesByGoal.get(rule.goalId as string) ?? [];
    rules.push(rule);
    rulesByGoal.set(rule.goalId as string, rules);
  }

  const dailyGoalContexts: { goal: Goal; cadence: HabitRule["cadence"] | null }[] = [];
  const goalMetrics: GoalConsistencyMetric[] = [];
  for (const goal of activeGoals) {
    const matchingRules = (rulesByGoal.get(goal.id) ?? [])
      .slice()
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
    const rule = matchingRules[0] ?? null;
    if (rule?.cadence === "weekly") {
      const weekly = buildWeeklyMetric(
        goal,
        rule,
        goalDayMap,
        projected.value.period,
        input.asOfLocalDate,
      );
      goalMetrics.push({
        goalId: goal.id,
        title: goal.title,
        cadence: rule.cadence,
        daily: null,
        weekly,
        cumulative: null,
      });
      continue;
    }
    if (rule?.cadence === "custom" && rule.targetPerPeriod > 1) {
      const completedCount = countCompletedGoalDaysThrough(
        goal,
        goalDayMap,
        projected.value.period.endLocalDate,
        input.asOfLocalDate,
      );
      goalMetrics.push({
        goalId: goal.id,
        title: goal.title,
        cadence: rule.cadence,
        daily: null,
        weekly: null,
        cumulative: {
          completedCount,
          targetCount: rule.targetPerPeriod,
          progressRatio: Math.min(1, completedCount / rule.targetPerPeriod),
        },
      });
      continue;
    }

    const cadence = rule?.cadence ?? null;
    const context = { goal, cadence };
    dailyGoalContexts.push(context);
    let successfulDays = 0;
    let eligibleDays = 0;
    for (const localDate of days) {
      if (localDate > input.asOfLocalDate || !isGoalActiveOnLocalDate(goal, localDate)) continue;
      const evaluated = evaluateGoalDayState({
        goal,
        localDate,
        todayKey: input.asOfLocalDate,
        goalDay: goalDayFor(goalDayMap, goal.id, localDate),
      });
      if (!evaluated.ok) return evaluated;
      if (evaluated.value.status === "success") {
        successfulDays += 1;
        eligibleDays += 1;
      } else if (evaluated.value.status === "fail") {
        eligibleDays += 1;
      }
    }
    goalMetrics.push({
      goalId: goal.id,
      title: goal.title,
      cadence,
      daily: {
        successfulDays,
        eligibleDays,
        successRate: successRate(successfulDays, eligibleDays),
      },
      weekly: null,
      cumulative: null,
    });
  }

  const activeRoutines = input.routines.filter(
    (routine) => routine.deletedAt === null && routine.archivedAt === null,
  );
  const activeRoutineIds = new Set(activeRoutines.map((routine) => routine.id));
  const schedules = input.routineSchedules.filter(
    (schedule) => schedule.deletedAt === null && activeRoutineIds.has(schedule.routineId),
  );
  const schedulesByRoutine = new Map<string, RoutineSchedule[]>();
  for (const schedule of schedules) {
    const matching = schedulesByRoutine.get(schedule.routineId) ?? [];
    matching.push(schedule);
    schedulesByRoutine.set(schedule.routineId, matching);
  }
  const completedRoutineDates = new Set<string>();
  const explicitlySkippedRoutineDates = new Set<string>();
  for (const run of input.routineRuns) {
    if (!activeRoutineIds.has(run.routineId) || !isValidLocalDateKey(run.localDate)) continue;
    const key = `${run.routineId}\u0000${run.localDate}`;
    if (run.status === "completed") completedRoutineDates.add(key);
    if (run.status === "skipped") explicitlySkippedRoutineDates.add(key);
  }

  const routineCounts = new Map<string, { completedDays: number; eligibleDays: number }>();
  const trend = days.map((localDate): GoalRoutineConsistencyDayMetric => {
    let successfulGoalDays = 0;
    let eligibleGoalDays = 0;
    if (localDate <= input.asOfLocalDate) {
      for (const { goal } of dailyGoalContexts) {
        if (!isGoalActiveOnLocalDate(goal, localDate)) continue;
        const evaluated = evaluateGoalDayState({
          goal,
          localDate,
          todayKey: input.asOfLocalDate,
          goalDay: goalDayFor(goalDayMap, goal.id, localDate),
        });
        if (!evaluated.ok) continue;
        if (evaluated.value.status === "success") {
          successfulGoalDays += 1;
          eligibleGoalDays += 1;
        } else if (evaluated.value.status === "fail") {
          eligibleGoalDays += 1;
        }
      }
    }

    let completedRoutineDays = 0;
    let eligibleRoutineDays = 0;
    if (localDate <= input.asOfLocalDate) {
      for (const routine of activeRoutines) {
        const matchingSchedules = schedulesByRoutine.get(routine.id) ?? [];
        if (
          !matchingSchedules.some((schedule) => isRoutineScheduledOnLocalDate(schedule, localDate))
        ) {
          continue;
        }
        const key = `${routine.id}\u0000${localDate}`;
        const completed = completedRoutineDates.has(key);
        const explicitlySkipped = explicitlySkippedRoutineDates.has(key);
        if (completed || explicitlySkipped || localDate < input.asOfLocalDate) {
          eligibleRoutineDays += 1;
          if (completed) completedRoutineDays += 1;
          const counts = routineCounts.get(routine.id) ?? { completedDays: 0, eligibleDays: 0 };
          counts.eligibleDays += 1;
          if (completed) counts.completedDays += 1;
          routineCounts.set(routine.id, counts);
        }
      }
    }

    return {
      localDate,
      successfulGoalDays,
      eligibleGoalDays,
      goalSuccessRate: successRate(successfulGoalDays, eligibleGoalDays),
      completedRoutineDays,
      eligibleRoutineDays,
      routineSuccessRate: successRate(completedRoutineDays, eligibleRoutineDays),
    };
  });

  const routines: RoutineConsistencyMetric[] = activeRoutines.map((routine) => {
    const counts = routineCounts.get(routine.id) ?? { completedDays: 0, eligibleDays: 0 };
    return {
      routineId: routine.id,
      title: routine.title,
      completedDays: counts.completedDays,
      eligibleDays: counts.eligibleDays,
      successRate: successRate(counts.completedDays, counts.eligibleDays),
    };
  });
  const dailyGoalSuccessfulDays = trend.reduce((total, day) => total + day.successfulGoalDays, 0);
  const dailyGoalEligibleDays = trend.reduce((total, day) => total + day.eligibleGoalDays, 0);
  const routineCompletedDays = trend.reduce((total, day) => total + day.completedRoutineDays, 0);
  const routineEligibleDays = trend.reduce((total, day) => total + day.eligibleRoutineDays, 0);

  const activeXpDates = new Set<string>();
  for (const transaction of input.xpTransactions) {
    const date = xpLocalDate(
      transaction.earnedAt,
      projected.value.period.timeZone,
      projected.value.period.timezoneOffsetMinutes,
    );
    if (date !== null) activeXpDates.add(date);
  }
  const momentumHistory = days.map((localDate): MomentumHistoryMetric => ({
    localDate,
    momentum:
      localDate > input.asOfLocalDate
        ? null
        : calculateMomentumScoreFromActiveDates(localDate, activeXpDates),
  }));

  return {
    ok: true,
    value: {
      period: projected.value.period,
      asOfLocalDate: input.asOfLocalDate,
      goals: goalMetrics,
      routines,
      dailyGoalSuccessRate: successRate(dailyGoalSuccessfulDays, dailyGoalEligibleDays),
      dailyGoalEligibleDays,
      dailyGoalSuccessfulDays,
      routineSuccessRate: successRate(routineCompletedDays, routineEligibleDays),
      routineEligibleDays,
      routineCompletedDays,
      trend,
      momentumHistory,
    },
  };
}
