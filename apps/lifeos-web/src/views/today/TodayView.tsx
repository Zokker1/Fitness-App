// T089: Tänään-näkymän runko — header + muokattavassa järjestyksessä
// renderöidyt kortit (useCardOrder-hook, localStorage-persistenssi).
// Korttisisällöt ladataan yhä kerralla (ei hakuketjuja komponenteissa);
// piilotettuja KORTTEJA EI RENDERÖIDÄ lainkaan (ei piilotettua DOM:ia).
import { t } from "../../language.tsx";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Button, Card, EmptyState } from "@lifeos/ui";
import type { Routine, RoutineStep, Task } from "@lifeos/domain";
import {
  buildTodayProjection,
  completeTaskService,
  groupTasksForToday,
  reopenTaskService,
  selectNextUp,
  summarizeTodayFocus,
  summarizeTodayGamification,
  summarizeTodayHealth,
  summarizeTodayRoutines,
  systemClock,
  toggleGoalDayService,
  type NextUpInput,
  type NextUpItem,
  type TodayFocusSummary,
  type TodayGamificationSummary,
  type TodayGoalView,
  type TodayHealthSummary,
  type TodayRoutinesSummary,
  type TodayTaskGroups,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { CardOrderEditor } from "./CardOrderEditor.tsx";
import { NextUpCard } from "./NextUpCard.tsx";
import { TodayFocusCard } from "./TodayFocusCard.tsx";
import { TodayGamificationCard } from "./TodayGamificationCard.tsx";
import { TodayGoalsCard } from "./TodayGoalsCard.tsx";
import { TodayHeader } from "./TodayHeader.tsx";
import { TodayHealthCard } from "./TodayHealthCard.tsx";
import { TodayRoutinesCard } from "./TodayRoutinesCard.tsx";
import { TodayTasksGroupsCard } from "./TodayTasksGroupsCard.tsx";
import { useCardOrder } from "./useCardOrder.ts";
import { useGamificationVisibility } from "../../preferences/GamificationVisibilityContext.tsx";
import { useHydrationTarget } from "../../preferences/HydrationTargetContext.tsx";

function localDateKey(nowIso: string, timezoneOffsetMinutes: number): string {
  return new Date(Date.parse(nowIso) + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function toInput(
  nowIso: string,
  tasks: readonly Task[],
  routines: readonly Routine[],
  routineSteps: readonly RoutineStep[],
): NextUpInput & {
  readonly routines: readonly Routine[];
  readonly routineSteps: readonly RoutineStep[];
} {
  const offsetMinutes = -new Date(nowIso).getTimezoneOffset();
  return {
    now: nowIso,
    localDate: localDateKey(nowIso, offsetMinutes),
    timezoneOffsetMinutes: offsetMinutes,
    tasks,
    timeboxes: [],
    routines,
    routineSteps,
  };
}

export function TodayView(): React.JSX.Element {
  const { order, moveUp, moveDown, hide, show } = useCardOrder();
  const { visible: gamificationVisible } = useGamificationVisibility();
  const hydrationTarget = useHydrationTarget();
  const [editing, setEditing] = useState(false);
  const {
    tasks,
    routines,
    routineSteps,
    routineRuns,
    routineStepRuns,
    goals,
    goalDays,
    sleepEntries,
    moodCheckins,
    supplements,
    supplementLogs,
    hydrationEntries,
    focusSessions,
    xpTransactions,
    achievements,
  } = useData();
  const [nextUp, setNextUp] = useState<NextUpItem | undefined>(undefined);
  // T102: ryhmitelty tehtäväkortti (§5 näkymät yhdessä).
  const [taskGroups, setTaskGroups] = useState<TodayTaskGroups | undefined>(undefined);
  const [routineSummary, setRoutineSummary] = useState<TodayRoutinesSummary | undefined>(undefined);
  const [goalViews, setGoalViews] = useState<readonly TodayGoalView[] | undefined>(undefined);
  const [healthSummary, setHealthSummary] = useState<TodayHealthSummary | undefined>(undefined);
  const [focusSummary, setFocusSummary] = useState<TodayFocusSummary | undefined>(undefined);
  const [gamificationSummary, setGamificationSummary] = useState<
    TodayGamificationSummary | undefined
  >(undefined);
  const [todayKey, setTodayKey] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const nowIso = new Date().toISOString();
    const [
      listed,
      listedRoutines,
      listedSteps,
      listedRoutineRuns,
      listedRoutineStepRuns,
      listedGoals,
      listedDays,
      listedSleep,
      listedMood,
      listedSupplements,
      listedSupplementLogs,
      listedHydration,
      listedFocus,
      listedXp,
      listedAchievements,
    ] = await Promise.all([
      tasks.list(),
      routines.list(),
      routineSteps.list(),
      routineRuns.list(),
      routineStepRuns.list(),
      goals.list(),
      goalDays.list(),
      sleepEntries.list(),
      moodCheckins.list(),
      supplements.list(),
      supplementLogs.list(),
      hydrationEntries.list(),
      focusSessions.list(),
      xpTransactions.list(),
      achievements.list(),
    ]);
    if (
      !listed.ok ||
      !listedRoutines.ok ||
      !listedSteps.ok ||
      !listedRoutineRuns.ok ||
      !listedRoutineStepRuns.ok ||
      !listedGoals.ok ||
      !listedDays.ok ||
      !listedSleep.ok ||
      !listedMood.ok ||
      !listedSupplements.ok ||
      !listedSupplementLogs.ok ||
      !listedHydration.ok ||
      !listedFocus.ok ||
      !listedXp.ok ||
      !listedAchievements.ok
    ) {
      setLoading(false);
      return;
    }
    const input = toInput(nowIso, listed.value, listedRoutines.value, listedSteps.value);
    setNextUp(selectNextUp(input) ?? undefined);
    // T102: ryhmittely suoraan ladatusta listasta (ei uutta hakua).
    setTaskGroups(
      groupTasksForToday({
        tasks: listed.value,
        localDate: input.localDate,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        now: input.now,
      }),
    );
    setRoutineSummary(
      summarizeTodayRoutines(
        input.routines,
        input.routineSteps,
        listedRoutineRuns.value,
        listedRoutineStepRuns.value,
        input.localDate,
      ),
    );
    setGamificationSummary(
      summarizeTodayGamification({
        localDate: input.localDate,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        xpTransactions: listedXp.value,
        achievements: listedAchievements.value,
        earnedAchievementIds: new Set<string>(),
      }),
    );
    setFocusSummary(
      summarizeTodayFocus({
        now: input.now,
        localDate: input.localDate,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        sessions: listedFocus.value,
      }),
    );
    setHealthSummary(
      summarizeTodayHealth({
        localDate: input.localDate,
        timezoneOffsetMinutes: input.timezoneOffsetMinutes,
        now: input.now,
        sleepEntries: listedSleep.value,
        moodCheckins: listedMood.value,
        supplements: listedSupplements.value,
        supplementLogs: listedSupplementLogs.value,
        hydrationEntries: listedHydration.value,
        hydrationTargetMl: hydrationTarget.targetMilliliters,
      }),
    );
    const projection = buildTodayProjection({
      localDate: input.localDate,
      now: input.now,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      tasks: listed.value,
      checklistItems: [],
      focusSessions: [],
      hydrationEntries: [],
      nutritionEntries: [],
      supplements: [],
      supplementLogs: [],
      goals: listedGoals.value,
      goalDays: listedDays.value,
      calendarBlocks: [],
      latestWeight: null,
      reminders: [],
      xpTransactions: [],
    });
    if (projection.ok) {
      setGoalViews(projection.value.goalViews);
      setTodayKey(projection.value.localDate);
    }
    setLoading(false);
  }, [
    tasks,
    routines,
    routineSteps,
    routineRuns,
    routineStepRuns,
    goals,
    goalDays,
    sleepEntries,
    moodCheckins,
    supplements,
    supplementLogs,
    hydrationEntries,
    focusSessions,
    xpTransactions,
    achievements,
    hydrationTarget.targetMilliliters,
  ]);
  useEffect(() => {
    const guard = { cancelled: false };
    const shouldStop = (): boolean => guard.cancelled;
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (shouldStop()) {
          setLoading(false);
        }
      });
    // T091: datamuutoseventti (QuickAdd-luonti yms.) → lataa näkymä uudestaan
    // jotta luotu näkyy HETI ilman navigointia.
    const onDataChanged = (): void => {
      if (!shouldStop()) {
        void refresh().catch(() => undefined);
      }
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);
  const handleComplete = useCallback(
    async (taskId: string): Promise<void> => {
      const done = await completeTaskService(
        { clock: systemClock(), tasks, xpTransactions },
        taskId,
      );
      if (done.ok) {
        window.dispatchEvent(new Event("lifeos:data-changed"));
        await refresh().catch(() => undefined);
      }
    },
    [refresh, tasks, xpTransactions],
  );
  const handleReopen = useCallback(
    async (taskId: string): Promise<void> => {
      const opened = await reopenTaskService({ clock: systemClock(), tasks }, taskId);
      if (opened.ok) {
        await refresh().catch(() => undefined);
      }
    },
    [refresh, tasks],
  );
  const handleGoalToggle = useCallback(
    async (goalId: string, completed: boolean): Promise<void> => {
      const toggled = await toggleGoalDayService(
        { clock: systemClock(), goals, goalDays, xpTransactions },
        { goalId, localDate: todayKey, completed, todayKey },
      );
      if (toggled.ok) {
        window.dispatchEvent(new Event("lifeos:data-changed"));
        await refresh().catch(() => undefined);
      }
    },
    [goalDays, goals, refresh, todayKey, xpTransactions],
  );
  const cards: Record<
    "next-up" | "tasks" | "routines" | "goals" | "health" | "focus" | "gamification",
    React.JSX.Element | null
  > = {
    "next-up": loading ? null : <NextUpCard item={nextUp} />,
    tasks:
      loading || taskGroups === undefined ? null : (
        <TodayTasksGroupsCard
          groups={taskGroups}
          onComplete={(taskId) => void handleComplete(taskId)}
          onReopen={(taskId) => void handleReopen(taskId)}
        />
      ),
    routines:
      loading || routineSummary === undefined ? null : (
        <TodayRoutinesCard summary={routineSummary} />
      ),
    goals:
      loading || goalViews === undefined ? null : (
        <TodayGoalsCard
          views={goalViews}
          onToggle={(goalId, completed) => void handleGoalToggle(goalId, completed)}
        />
      ),
    health:
      loading || healthSummary === undefined ? null : <TodayHealthCard summary={healthSummary} />,
    focus: loading || focusSummary === undefined ? null : <TodayFocusCard summary={focusSummary} />,
    gamification:
      gamificationVisible !== true || loading || gamificationSummary === undefined ? null : (
        <TodayGamificationCard summary={gamificationSummary} />
      ),
  };
  return (
    <>
      <TodayHeader />
      <p>
        <Button
          variant="secondary"
          onClick={() => {
            setEditing((value) => !value);
          }}
          aria-expanded={editing}
          data-testid="card-order-toggle"
        >
          {editing ? t("Sulje muokkaus") : t("Muokkaa kortteja")}
        </Button>
      </p>
      {editing ? (
        <CardOrderEditor
          order={order}
          onMoveUp={moveUp}
          onMoveDown={moveDown}
          onHide={hide}
          onShow={show}
          onDone={() => {
            setEditing(false);
          }}
        />
      ) : null}
      {order.visible.map((id) => (
        <Fragment key={id}>{cards[id]}</Fragment>
      ))}
      <Card>
        <EmptyState
          title={t("Tänään-sisältö rakentuu")}
          hint={t(
            "Kortit kytketään yksi kerrallaan: kaikki T088-kortit valmiina — seuraavaksi korttien järjestys.",
          )}
        />
      </Card>
    </>
  );
}
