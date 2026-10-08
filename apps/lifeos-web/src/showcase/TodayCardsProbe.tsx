// T058-tukimuutos: "Tänään"-osion E2E-näyte (kehitysnäkymä, vain ?e2e=1).
// Todistaa NextUpCardin+TodayTasksCardin+TodayRoutinesCardin+TodayGoalsCardin+
// TodayHealthCardin+TodayFocusCardin aidon datan tilat E2E:ssä
// (tuotantokanta on tyhjä).
// T102: ryhmäkortti (TodayTasksGroupsCard) korvaa TodayTasksCardin probessa
// (tuotanto vaihtoi samaan); vanha summary-kooste jää TodayTasksCardin
// käyttöön muissa näkymissä.
import { MetricCard } from "@lifeos/ui";
import {
  buildTodayProjection,
  groupTasksForToday,
  selectNextUp,
  summarizeTodayFocus,
  summarizeTodayGamification,
  summarizeTodayHealth,
  summarizeTodayRoutines,
} from "@lifeos/data";
import type { NextUpInput } from "@lifeos/data";
import type {
  Achievement,
  FocusSession,
  Goal,
  GoalDay,
  HydrationEntry,
  MoodCheckin,
  Routine,
  RoutineRun,
  RoutineStep,
  RoutineStepRun,
  SleepEntry,
  Supplement,
  SupplementLog,
  Task,
  XPTransaction,
} from "@lifeos/domain";
import { NextUpCard } from "../views/today/NextUpCard.tsx";
import { TodayFocusCard } from "../views/today/TodayFocusCard.tsx";
import { TodayGamificationCard } from "../views/today/TodayGamificationCard.tsx";
import { TodayGoalsCard } from "../views/today/TodayGoalsCard.tsx";
import { TodayHealthCard } from "../views/today/TodayHealthCard.tsx";
import { TodayRoutinesCard } from "../views/today/TodayRoutinesCard.tsx";
import { TodayTasksGroupsCard } from "../views/today/TodayTasksGroupsCard.tsx";

const AT = "2026-09-18T09:00:00.000Z";
const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: `Näyte ${id}`,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    ...overrides,
  };
}

const TASKS: readonly Task[] = [
  task("nx-over", { dueAt: "2026-09-17T10:00:00.000Z", priority: "high" }),
  task("nx-due-1", { dueAt: "2026-09-18T12:00:00.000Z" }),
  task("nx-due-2", { dueAt: "2026-09-18T14:00:00.000Z" }),
  task("nx-due-3", { dueAt: "2026-09-18T16:00:00.000Z" }),
  task("nx-nodue"),
];

function nextUpInput(): NextUpInput {
  return {
    now: AT,
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    tasks: TASKS,
    timeboxes: [],
  };
}

export function TodayCardsProbe(): React.JSX.Element {
  const nextUp = selectNextUp(nextUpInput());
  // Projektio-ryhmät suoraan probessa (UI State sama kuin TodayView).
  const groups = groupTasksForToday({
    tasks: TASKS,
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    now: AT,
  });
  const routine = routineFixture("nx-routine", "Aamurutiini");
  const routineSteps = [
    routineStepFixture("nx-step-1", routine.id, "Venyttele", 0),
    routineStepFixture("nx-step-2", routine.id, "Vesi", 1),
  ];
  const routineSummary = summarizeTodayRoutines(
    [routine],
    routineSteps,
    [
      {
        id: "nx-run",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        routineId: routine.id,
        localDate: LOCAL_DATE,
        status: "running",
        startedAt: "2026-09-18T08:00:00.000Z",
        completedAt: null,
        skipReason: null,
      } satisfies RoutineRun,
    ],
    [
      {
        id: "nx-step-run-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        routineRunId: "nx-run",
        routineStepId: "nx-step-1",
        status: "completed",
        completedAt: "2026-09-18T08:10:00.000Z",
        skipReason: null,
      },
      {
        id: "nx-step-run-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        routineRunId: "nx-run",
        routineStepId: "nx-step-2",
        status: "pending",
        completedAt: null,
        skipReason: null,
      },
    ] satisfies readonly RoutineStepRun[],
    LOCAL_DATE,
  );
  const goalA: Goal = {
    id: "nx-goal-a",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Liiku päivittäin",
    description: null,
    archivedAt: null,
    deletedAt: null,
  };
  const goalB: Goal = {
    id: "nx-goal-b",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Lue iltaisin",
    description: null,
    archivedAt: null,
    deletedAt: null,
  };
  const goalDayDone: GoalDay = {
    id: "nx-gd-a",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    goalId: "nx-goal-a",
    localDate: LOCAL_DATE,
    completed: true,
  };
  const projection = buildTodayProjection({
    localDate: LOCAL_DATE,
    now: AT,
    timezoneOffsetMinutes: OFFSET,
    tasks: [],
    checklistItems: [],
    focusSessions: [],
    hydrationEntries: [],
    nutritionEntries: [],
    supplements: [],
    supplementLogs: [],
    goals: [goalA, goalB],
    goalDays: [goalDayDone],
    calendarBlocks: [],
    latestWeight: null,
    reminders: [],
    xpTransactions: [],
  });
  const goalViews = projection.ok ? projection.value.goalViews : [];
  const focusSummary = summarizeTodayFocus({
    now: AT,
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    sessions: [
      {
        id: "nx-focus-done",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        taskId: null,
        routineId: null,
        phase: "completed",
        startedAt: "2026-09-18T08:00:00.000Z",
        endedAt: "2026-09-18T08:25:00.000Z",
        durationSeconds: 1500,
      } satisfies FocusSession,
      {
        id: "nx-focus-run",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        taskId: null,
        routineId: null,
        phase: "running",
        startedAt: "2026-09-18T08:45:00.000Z",
        endedAt: null,
        durationSeconds: null,
      } satisfies FocusSession,
    ],
  });
  const healthSummary = summarizeTodayHealth({
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    sleepEntries: [
      {
        id: "nx-sleep-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        sleepStart: "2026-09-17T22:30:00.000Z",
        sleepEnd: "2026-09-18T06:00:00.000Z",
        quality: 4,
        deletedAt: null,
      } satisfies SleepEntry,
    ],
    moodCheckins: [
      {
        id: "nx-mood-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        checkedAt: "2026-09-18T08:00:00.000Z",
        mood: 4,
        stress: 2,
        energy: 3,
        motivation: 4,
        focus: 3,
        note: null,
      } satisfies MoodCheckin,
    ],
    supplements: [
      {
        id: "nx-supp-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        name: "D-vitamiini",
        doseLabel: "50 µg",
        deletedAt: null,
      } satisfies Supplement,
      {
        id: "nx-supp-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        name: "Magnesium",
        doseLabel: null,
        deletedAt: null,
      } satisfies Supplement,
    ],
    supplementLogs: [
      {
        id: "nx-slog-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        supplementId: "nx-supp-1",
        status: "taken",
        takenAt: "2026-09-18T08:00:00.000Z",
      } satisfies SupplementLog,
    ],
    hydrationEntries: [
      {
        id: "nx-hyd-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        drunkAt: "2026-09-18T07:00:00.000Z",
        milliliters: 250,
      } satisfies HydrationEntry,
    ],
  });
  return (
    <section data-testid="today-cards-probe" aria-label="Tänään-kortit (E2E)">
      <h2>Tänään-kortit</h2>
      <NextUpCard item={nextUp ?? undefined} />
      <TodayTasksGroupsCard
        groups={groups}
        onComplete={() => undefined}
        onReopen={() => undefined}
      />
      <TodayRoutinesCard summary={routineSummary} />
      <TodayGoalsCard views={goalViews} onToggle={() => undefined} />
      <TodayHealthCard summary={healthSummary} />
      <TodayFocusCard summary={focusSummary} />
      <TodayGamificationCard summary={gamificationSummaryFixture()} />
      <MetricCard
        heading="Probe-laskuri"
        value="ok"
        valueLabel="Probe toimii"
        data-testid="today-cards-sentinel"
      />
    </section>
  );
}

function gamificationSummaryFixture() {
  const fixture = gamificationFixture();
  return summarizeTodayGamification({
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    xpTransactions: fixture.xp,
    achievements: fixture.achievements,
    earnedAchievementIds: new Set(["nx-ach-1"]),
  });
}

function gamificationFixture(): {
  readonly xp: readonly XPTransaction[];
  readonly achievements: readonly Achievement[];
} {
  const xp: XPTransaction[] = [
    {
      id: "nx-xp-1",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      source: "task",
      sourceEntityId: null,
      amount: 10,
      earnedAt: "2026-09-18T07:00:00.000Z",
      reason: null,
    },
    {
      id: "nx-xp-2",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      source: "focus",
      sourceEntityId: null,
      amount: 15,
      earnedAt: "2026-09-17T08:00:00.000Z",
      reason: null,
    },
    {
      // T182/T183: historiaa ikkunan ulkopuolella → kokonais-XP 450 = taso 3
      // puolivälissä (150/300 XP), momentum pysyy 2/7 (vain 17.–18.9. aktiivisia).
      id: "nx-xp-3",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      source: "routine",
      sourceEntityId: null,
      amount: 425,
      earnedAt: "2026-09-01T08:00:00.000Z",
      reason: null,
    },
  ];
  const achievements: Achievement[] = [
    {
      id: "nx-ach-1",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      key: "first-task",
      title: "Ensimmäinen",
      description: null,
    },
    {
      id: "nx-ach-2",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      key: "week-streak",
      title: "Viikon putki",
      description: null,
    },
  ];
  return { xp, achievements };
}

function routineFixture(id: string, title: string): Routine {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title,
    archivedAt: null,
    deletedAt: null,
  };
}

function routineStepFixture(
  id: string,
  routineId: string,
  title: string,
  sortOrder: number,
): RoutineStep {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId,
    title,
    sortOrder,
    deletedAt: null,
  };
}
