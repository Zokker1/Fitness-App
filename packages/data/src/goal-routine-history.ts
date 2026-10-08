// T157: tavoitteiden ja rutiinien yhtenäinen historia.
// Kooste on puhdas ja vientimuodot deterministisiä, jotta UI voi näyttää,
// hakea ja viedä saman historian ilman omia rinnakkaisia laskentoja.
import type {
  Goal,
  GoalDay,
  Routine,
  RoutineRun,
  RoutineRunDayMode,
  RoutineStep,
  RoutineStepRun,
} from "@lifeos/domain";
import { serializeCsv, type CsvSchema } from "./csv-export.ts";

export type GoalRoutineHistoryKind = "goal-day" | "routine-run";
export type GoalRoutineHistoryStatus =
  "completed" | "not-completed" | "running" | "skipped" | "cancelled";

export interface GoalRoutineHistoryRecord {
  readonly id: string;
  readonly kind: GoalRoutineHistoryKind;
  readonly localDate: string;
  readonly title: string;
  readonly status: GoalRoutineHistoryStatus;
  readonly detail: string;
  readonly completedAt: string | null;
  readonly dayMode: RoutineRunDayMode | null;
  readonly handledSteps: number | null;
  readonly totalSteps: number | null;
}

export interface GoalRoutineHistoryInput {
  readonly goals: readonly Goal[];
  readonly goalDays: readonly GoalDay[];
  readonly routines: readonly Routine[];
  readonly routineSteps: readonly RoutineStep[];
  readonly routineRuns: readonly RoutineRun[];
  readonly routineStepRuns: readonly RoutineStepRun[];
}

export type GoalRoutineHistoryExportFormat = "json" | "csv";

export const GOAL_ROUTINE_HISTORY_CSV_SCHEMA: CsvSchema<GoalRoutineHistoryRecord> = {
  id: "goal-routine-history",
  version: 1,
  columns: [
    { key: "id", value: (record) => record.id },
    { key: "kind", value: (record) => record.kind },
    { key: "localDate", value: (record) => record.localDate },
    { key: "title", value: (record) => record.title },
    { key: "status", value: (record) => record.status },
    { key: "detail", value: (record) => record.detail },
    { key: "completedAt", value: (record) => record.completedAt },
    { key: "dayMode", value: (record) => record.dayMode },
    { key: "handledSteps", value: (record) => record.handledSteps },
    { key: "totalSteps", value: (record) => record.totalSteps },
  ],
};

function routineStatusLabel(status: RoutineRun["status"]): GoalRoutineHistoryStatus {
  return status;
}

/** Kokoaa päivämerkinnät ja rutiinisuoritukset yhdeksi aikajärjestykseksi. */
export function buildGoalRoutineHistory(
  input: GoalRoutineHistoryInput,
): readonly GoalRoutineHistoryRecord[] {
  const goalsById = new Map(input.goals.map((goal) => [goal.id, goal]));
  const routinesById = new Map(input.routines.map((routine) => [routine.id, routine]));
  const stepRunsByRunId = new Map<string, readonly RoutineStepRun[]>();
  for (const stepRun of input.routineStepRuns) {
    const existing = stepRunsByRunId.get(stepRun.routineRunId) ?? [];
    stepRunsByRunId.set(stepRun.routineRunId, [...existing, stepRun]);
  }

  const goalRecords: GoalRoutineHistoryRecord[] = input.goalDays.map((day) => {
    const goal = goalsById.get(day.goalId);
    return {
      id: day.id,
      kind: "goal-day",
      localDate: day.localDate,
      title: goal?.title ?? "Poistettu tavoite",
      status: day.completed ? "completed" : "not-completed",
      detail: day.completed ? "Tavoitepäivä valmis" : "Päivä kirjattu keskeneräisenä",
      completedAt: day.completed ? day.updatedAt : null,
      dayMode: null,
      handledSteps: null,
      totalSteps: null,
    };
  });

  const routineRecords: GoalRoutineHistoryRecord[] = input.routineRuns.map((run) => {
    const routine = routinesById.get(run.routineId);
    const stepRuns = stepRunsByRunId.get(run.id) ?? [];
    const totalSteps = Math.max(
      stepRuns.length,
      input.routineSteps.filter((step) => step.routineId === run.routineId).length,
    );
    const handledSteps = stepRuns.filter(
      (stepRun) => stepRun.status === "completed" || stepRun.status === "skipped",
    ).length;
    const status = routineStatusLabel(run.status);
    const detail =
      run.status === "completed"
        ? `${String(handledSteps)} / ${String(totalSteps)} vaihetta käsitelty`
        : (run.skipReason ?? `${String(handledSteps)} / ${String(totalSteps)} vaihetta käsitelty`);
    return {
      id: run.id,
      kind: "routine-run",
      localDate: run.localDate,
      title: routine?.title ?? "Poistettu rutiini",
      status,
      detail,
      completedAt: run.completedAt,
      dayMode: run.dayMode ?? "full",
      handledSteps,
      totalSteps,
    };
  });

  return [...goalRecords, ...routineRecords].sort((left, right) => {
    const dateOrder = right.localDate.localeCompare(left.localDate);
    if (dateOrder !== 0) {
      return dateOrder;
    }
    const completedAtOrder = (right.completedAt ?? "").localeCompare(left.completedAt ?? "");
    if (completedAtOrder !== 0) {
      return completedAtOrder;
    }
    return left.title.localeCompare(right.title, "fi") || left.id.localeCompare(right.id);
  });
}

export function filterGoalRoutineHistory(
  records: readonly GoalRoutineHistoryRecord[],
  query: string,
): readonly GoalRoutineHistoryRecord[] {
  const normalized = query.trim().toLocaleLowerCase("fi-FI");
  if (normalized.length === 0) {
    return records;
  }
  return records.filter((record) => {
    const readableStatus =
      record.status === "completed"
        ? "valmis"
        : record.status === "not-completed"
          ? "ei valmis"
          : record.status === "running"
            ? "kesken"
            : record.status === "skipped"
              ? "ohitettu"
              : "peruttu";
    const readableKind = record.kind === "goal-day" ? "tavoitepäivä" : "rutiinipäivä";
    const readableDayMode =
      record.dayMode === "minimum" ? "minimipäivä kevyt" : record.dayMode === "full" ? "täysi" : "";
    return [
      record.title,
      record.localDate,
      record.detail,
      record.status,
      record.kind,
      readableStatus,
      readableKind,
      readableDayMode,
    ].some((value) => value.toLocaleLowerCase("fi-FI").includes(normalized));
  });
}

export function serializeGoalRoutineHistory(
  records: readonly GoalRoutineHistoryRecord[],
  format: GoalRoutineHistoryExportFormat,
): string {
  if (format === "json") {
    return JSON.stringify(records, null, 2);
  }
  return serializeCsv(records, GOAL_ROUTINE_HISTORY_CSV_SCHEMA);
}
