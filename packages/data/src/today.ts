// T080: Today-projection — YKSI palvelu joka kokoaa päivän tiedot (§4).
// UI ei tee ad hoc -hakuketjuja: se antaa datan + paikallispäivän ja saa
// valmiin projektion josta kortit (T081-T089) rakentuvat.
// - Puhdas laskenta: ei IO:ta, ei selainta, ei kelloa piilossa — kutsuja
//   antaa now + timezoneOffsetMinutes + data (vrt. domain/rules).
// - Paikallispäivävertailut käyttävät domainin toLocalDateKey:tä (UI:n
//   aikavyöhyke, ei selaimen arvaus).
// - Tulevaisuuden tiloja ei fabricoida: goalDay-raportoi vain KYSERYN
//   päivän tilan (T085: ei tulevien päivien väärää completionia).
// - XP derivoidaan transaktiovirrasta (§40: snapshot on välimuisti).
// - Avoimet tehtävät prioriteettijärjestyksessä (high → normal → low),
//   sitten dueAt; overduet ensin omassa ryhmässään.

import type {
  CalendarBlock,
  FocusSession,
  Goal,
  GoalDay,
  HydrationEntry,
  Measurement,
  NutritionEntry,
  Reminder,
  Supplement,
  SupplementLog,
  Task,
  UtcTimestamp,
  XPTransaction,
} from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";
import { evaluateGoalDayState, type GoalDayStatus } from "./goal-day-state.ts";
import { summarizeHydrationDay } from "./hydration-service.ts";
import { getSupplementLogActivityAt, getSupplementLogStatus } from "./supplement-log-service.ts";

export type TodayPhase = "aamu" | "paiva" | "ilta" | "yo";

export interface TodayTaskView {
  readonly task: Task;
  readonly overdue: boolean;
  readonly checklistTotal: number;
  readonly checklistDone: number;
}

export interface TodaySupplementView {
  readonly supplement: Supplement;
  readonly takenToday: boolean;
}

export interface TodayGoalView {
  readonly goal: Goal;
  /** Tänään paikallispäivän tila; null jos ei vielä merkitty. */
  readonly day: GoalDay | null;
  readonly state: GoalDayState;
  /** T145: domainin eksplisiittinen tila, myös future/not-required. */
  readonly status: GoalDayStatus;
}

export type GoalDayState = "pending" | "completed";

export interface TodayProjection {
  readonly localDate: string;
  readonly localHour: number;
  readonly phase: TodayPhase;
  readonly tasks: {
    readonly dueToday: readonly TodayTaskView[];
    readonly overdue: readonly TodayTaskView[];
    readonly completedToday: readonly TodayTaskView[];
    readonly openTotal: number;
  };
  readonly focus: {
    readonly minutesToday: number;
    readonly sessionsToday: number;
  };
  readonly hydration: {
    readonly millilitersToday: number;
  };
  readonly nutrition: {
    readonly caloriesToday: number;
    readonly entriesToday: number;
  };
  readonly supplements: readonly TodaySupplementView[];
  readonly goalViews: readonly TodayGoalView[];
  readonly nextTimebox: CalendarBlock | null;
  readonly latestWeight: Measurement | null;
  readonly xp: {
    readonly todayXp: number;
    readonly totalXp: number;
  };
  readonly enabledReminderCount: number;
}

export interface TodayProjectionInput {
  /** Paikallinen kalenteripäivä "YYYY-MM-DD" (UI:n aikavyöhykkeestä). */
  readonly localDate: string;
  readonly now: UtcTimestamp;
  /** Aikavyöhykeoffset minuutteina (esim. Helsinki kesällä +180). */
  readonly timezoneOffsetMinutes: number;
  readonly tasks: readonly Task[];
  readonly checklistItems: readonly TaskChecklistItemLike[];
  readonly focusSessions: readonly FocusSession[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly nutritionEntries: readonly NutritionEntry[];
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
  readonly goals: readonly Goal[];
  readonly goalDays: readonly GoalDay[];
  readonly calendarBlocks: readonly CalendarBlock[];
  readonly latestWeight: Measurement | null;
  readonly reminders: readonly Reminder[];
  readonly xpTransactions: readonly XPTransaction[];
}

/** Kevyt checklist-viite (riittää progress-laskentaan). */
export interface TaskChecklistItemLike {
  readonly taskId: string;
  readonly done: boolean;
  readonly deletedAt: UtcTimestamp | null;
}

const PRIORITY_ORDER: Readonly<Record<string, number>> = { high: 0, normal: 1, low: 2 };

function isAlive(deletedAt: UtcTimestamp | null): boolean {
  return deletedAt === null;
}

function sortTasks(tasks: readonly Task[]): readonly Task[] {
  return [...tasks].sort((a, b) => {
    const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }
    if (a.dueAt !== null && b.dueAt !== null) {
      return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
    }
    if (a.dueAt !== null) {
      return -1;
    }
    if (b.dueAt !== null) {
      return 1;
    }
    return a.createdAt < b.createdAt ? -1 : 1;
  });
}

function phaseFromHour(hour: number): TodayPhase {
  if (hour >= 23 || hour < 5) {
    return "yo";
  }
  if (hour < 10) {
    return "aamu";
  }
  if (hour < 17) {
    return "paiva";
  }
  return "ilta";
}

export function buildTodayProjection(input: TodayProjectionInput): DataResult<TodayProjection> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)) {
    return {
      ok: false,
      error: invalidInput("data.today.bad-local-date", "Paikallispäivän muoto on YYYY-MM-DD."),
    };
  }

  const localDate = input.localDate;
  // Paikallinen tunti fractaalisena: siirrä hetki offsetilla ja lue UTC-kentät.
  const shiftedNow = new Date(Date.parse(input.now) + input.timezoneOffsetMinutes * 60_000);
  const localHour = shiftedNow.getUTCHours() + shiftedNow.getUTCMinutes() / 60;
  const phase = phaseFromHour(Math.floor(localHour));

  // --- Tehtävät -----------------------------------------------------------
  const aliveTasks = input.tasks.filter((task) => isAlive(task.deletedAt));
  const checklistFor = (taskId: string): { total: number; done: number } => {
    const items = input.checklistItems.filter(
      (item) => item.taskId === taskId && isAlive(item.deletedAt),
    );
    return { total: items.length, done: items.filter((item) => item.done).length };
  };
  const toView = (task: Task, overdue: boolean): TodayTaskView => {
    const checklist = checklistFor(task.id);
    return { task, overdue, checklistTotal: checklist.total, checklistDone: checklist.done };
  };
  const dueToday: Task[] = [];
  const overdue: Task[] = [];
  const completedToday: Task[] = [];
  for (const task of aliveTasks) {
    if (task.status === "done") {
      if (
        task.completedAt !== null &&
        toLocalDateKey(task.completedAt, input.timezoneOffsetMinutes) === localDate
      ) {
        completedToday.push(task);
      }
      continue;
    }
    if (task.dueAt === null) {
      continue;
    }
    const dueDate = toLocalDateKey(task.dueAt, input.timezoneOffsetMinutes);
    if (dueDate === localDate) {
      dueToday.push(task);
    } else if (dueDate < localDate) {
      overdue.push(task);
    }
  }

  // --- Fokus -----------------------------------------------------------------
  const focusToday = input.focusSessions.filter(
    (session) =>
      session.startedAt !== null &&
      toLocalDateKey(session.startedAt, input.timezoneOffsetMinutes) === localDate,
  );
  const focusMinutes = Math.round(
    focusToday.reduce((sum, session) => sum + (session.durationSeconds ?? 0), 0) / 60,
  );

  // --- Ravinto + neste ---------------------------------------------------------
  const nutritionToday = input.nutritionEntries.filter(
    (entry) =>
      isAlive(entry.deletedAt) &&
      toLocalDateKey(entry.eatenAt, input.timezoneOffsetMinutes) === localDate,
  );
  const hydrationToday = summarizeHydrationDay({
    entries: input.hydrationEntries,
    localDate,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    now: input.now,
  });

  // --- Lisäravinteet: suunnitelma vs. toteutunut (T070) --------------------------
  const supplements = input.supplements
    .filter((supplement) => isAlive(supplement.deletedAt))
    .map<TodaySupplementView>((supplement) => ({
      supplement,
      takenToday: input.supplementLogs.some(
        (log) =>
          log.supplementId === supplement.id &&
          getSupplementLogStatus(log) === "taken" &&
          toLocalDateKey(getSupplementLogActivityAt(log), input.timezoneOffsetMinutes) ===
            localDate,
      ),
    }));

  // --- Tavoitteet: vain KYSERYN päivän tila (ei tulevaisuuden täyttöä) -----------
  const goalViews: TodayGoalView[] = input.goals
    .filter((goal) => isAlive(goal.deletedAt) && goal.archivedAt === null)
    .map((goal) => {
      const day =
        input.goalDays.find(
          (candidate) => candidate.goalId === goal.id && candidate.localDate === localDate,
        ) ?? null;
      const statusEvaluation = evaluateGoalDayState({
        goal,
        localDate,
        todayKey: localDate,
        goalDay: day,
      });
      return {
        goal,
        day,
        state: day !== null && day.completed ? "completed" : "pending",
        status: statusEvaluation.ok ? statusEvaluation.value.status : "pending",
      };
    });

  // --- Seuraava timebox ---------------------------------------------------------
  const upcoming = input.calendarBlocks
    .filter((block) => isAlive(block.deletedAt) && block.startsAt >= input.now)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const nextTimebox = upcoming[0] ?? null;

  // --- XP: derivoidaan virrasta (snapshot ei ole totuus, §40) ---------------------
  const totalXp = input.xpTransactions.reduce((sum, tx) => sum + tx.amount, 0);
  const todayXp = input.xpTransactions
    .filter((tx) => toLocalDateKey(tx.earnedAt, input.timezoneOffsetMinutes) === localDate)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const enabledReminderCount = input.reminders.filter(
    (reminder) => isAlive(reminder.deletedAt) && reminder.enabled,
  ).length;

  return {
    ok: true,
    value: {
      localDate,
      localHour,
      phase,
      tasks: {
        dueToday: sortTasks(dueToday).map((task) => toView(task, false)),
        overdue: sortTasks(overdue).map((task) => toView(task, true)),
        completedToday: sortTasks(completedToday).map((task) => toView(task, false)),
        openTotal: dueToday.length + overdue.length,
      },
      focus: { minutesToday: focusMinutes, sessionsToday: focusToday.length },
      hydration: {
        millilitersToday: hydrationToday.milliliters,
      },
      nutrition: {
        caloriesToday: nutritionToday.reduce((sum, entry) => sum + (entry.calories ?? 0), 0),
        entriesToday: nutritionToday.length,
      },
      supplements,
      goalViews,
      nextTimebox,
      latestWeight: input.latestWeight,
      xp: { todayXp, totalXp },
      enabledReminderCount,
    },
  };
}
