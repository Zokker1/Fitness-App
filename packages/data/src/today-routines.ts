// T084/T153: päivän rutiinien yhteenveto (pure data-funktio, ei IO:ta).
// Kriteeri: aktiivinen rutiini näkyy, progress perustuu oikean päivän
// append-only-suoritukseen ja seuraava vaihe palautuu deterministisesti.
// Ilman suoritusdataa näkymä näyttää rakenteen mutta ei keksi 0 %:ia.
import type {
  Routine,
  RoutineRun,
  RoutineStep,
  RoutineStepRun,
  UtcTimestamp,
} from "@lifeos/domain";

export interface TodayRoutineView {
  readonly routine: Routine;
  readonly steps: readonly RoutineStep[];
  readonly todayRun: RoutineRun | null;
  readonly completedSteps: number;
  readonly targetSteps: number;
  readonly currentStep: RoutineStep | null;
  readonly progressPercent: number | null;
}

export interface TodayRoutinesSummary {
  readonly routines: readonly TodayRoutineView[];
  /** Null, jos millään rutiinilla ei ole tälle päivälle suoritusta. */
  readonly progressPercent: number | null;
  readonly routineCount: number;
  readonly totalSteps: number;
}

export function summarizeTodayRoutines(
  routines: readonly Routine[],
  steps: readonly RoutineStep[],
  runs: readonly RoutineRun[] = [],
  stepRuns: readonly RoutineStepRun[] = [],
  localDate?: string,
): TodayRoutinesSummary {
  const alive = (deletedAt: UtcTimestamp | null): boolean => deletedAt === null;
  const active = routines.filter(
    (routine) => alive(routine.deletedAt) && routine.archivedAt === null,
  );
  const views = active.map((routine) => {
    const routineSteps = steps
      .filter((step) => step.routineId === routine.id && alive(step.deletedAt))
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const todayRun =
      localDate === undefined
        ? null
        : (runs
            .filter(
              (run) =>
                run.routineId === routine.id &&
                run.localDate === localDate &&
                run.status !== "cancelled",
            )
            .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null);
    const todayStepRuns =
      todayRun === null ? [] : stepRuns.filter((stepRun) => stepRun.routineRunId === todayRun.id);
    const stepRunByStepId = new Map(
      todayStepRuns.map((stepRun) => [stepRun.routineStepId, stepRun]),
    );
    const targetSteps =
      todayRun?.dayMode === "minimum" ? Math.min(1, routineSteps.length) : routineSteps.length;
    const completedSteps = routineSteps.reduce((count, step, stepIndex) => {
      if (todayRun?.dayMode === "minimum" && stepIndex > 0) {
        return count;
      }
      const stepRun = stepRunByStepId.get(step.id);
      return count + (stepRun?.status === "completed" || stepRun?.status === "skipped" ? 1 : 0);
    }, 0);
    const currentStep =
      todayRun === null || todayRun.status === "running"
        ? (routineSteps.find((step) => {
            const stepRun = stepRunByStepId.get(step.id);
            return stepRun === undefined || stepRun.status === "pending";
          }) ?? null)
        : null;
    return {
      routine,
      steps: routineSteps,
      todayRun,
      completedSteps,
      currentStep,
      progressPercent:
        todayRun === null || targetSteps === 0 ? null : (completedSteps / targetSteps) * 100,
      targetSteps,
    };
  });
  const startedViews = views.filter(
    (view) => view.progressPercent !== null && view.steps.length > 0,
  );
  const startedStepCount = startedViews.reduce((sum, view) => sum + view.steps.length, 0);
  const completedStepCount = startedViews.reduce((sum, view) => sum + view.completedSteps, 0);
  return {
    routines: views,
    progressPercent: startedStepCount === 0 ? null : (completedStepCount / startedStepCount) * 100,
    routineCount: views.length,
    totalSteps: views.reduce((sum, view) => sum + view.steps.length, 0),
  };
}
