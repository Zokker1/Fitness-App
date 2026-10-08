// T157: tavoitepäivien ja rutiinisuoritusten yhteinen historia.
import { describe, expect, it } from "vitest";
import type {
  Goal,
  GoalDay,
  Routine,
  RoutineRun,
  RoutineStep,
  RoutineStepRun,
} from "@lifeos/domain";
import {
  buildGoalRoutineHistory,
  filterGoalRoutineHistory,
  serializeGoalRoutineHistory,
} from "@lifeos/data";

const AT = "2026-09-21T07:00:00.000Z";

function entity(id: string, updatedAt = AT) {
  return { id, createdAt: AT, updatedAt, version: 1 } as const;
}

const goals: readonly Goal[] = [
  {
    ...entity("goal-health"),
    title: "Liiku joka päivä",
    description: null,
    activeFrom: "2026-09-01",
    activeUntil: null,
    archivedAt: null,
    deletedAt: null,
  },
];

const goalDays: readonly GoalDay[] = [
  {
    ...entity("day-1", "2026-09-21T08:00:00.000Z"),
    goalId: "goal-health",
    localDate: "2026-09-21",
    completed: true,
  },
  { ...entity("day-2"), goalId: "goal-health", localDate: "2026-09-20", completed: false },
];

const routines: readonly Routine[] = [
  {
    ...entity("routine-morning"),
    title: "Aamun rauhallinen alku",
    archivedAt: null,
    deletedAt: null,
  },
];

const routineSteps: readonly RoutineStep[] = [
  {
    ...entity("step-water"),
    routineId: "routine-morning",
    title: "Juo vettä",
    sortOrder: 0,
    optional: false,
    deletedAt: null,
  },
  {
    ...entity("step-stretch"),
    routineId: "routine-morning",
    title: "Venyttele",
    sortOrder: 1,
    optional: false,
    deletedAt: null,
  },
];

const routineRuns: readonly RoutineRun[] = [
  {
    ...entity("run-full", "2026-09-21T08:30:00.000Z"),
    routineId: "routine-morning",
    localDate: "2026-09-21",
    status: "completed",
    dayMode: "full",
    startedAt: "2026-09-21T08:10:00.000Z",
    completedAt: "2026-09-21T08:30:00.000Z",
    skipReason: null,
  },
  {
    ...entity("run-minimum"),
    routineId: "routine-morning",
    localDate: "2026-09-19",
    status: "completed",
    dayMode: "minimum",
    startedAt: "2026-09-19T08:10:00.000Z",
    completedAt: "2026-09-19T08:12:00.000Z",
    skipReason: null,
  },
];

const routineStepRuns: readonly RoutineStepRun[] = [
  {
    ...entity("step-run-full-1"),
    routineRunId: "run-full",
    routineStepId: "step-water",
    status: "completed",
    completedAt: "2026-09-21T08:20:00.000Z",
    skipReason: null,
  },
  {
    ...entity("step-run-full-2"),
    routineRunId: "run-full",
    routineStepId: "step-stretch",
    status: "skipped",
    completedAt: null,
    skipReason: "Aikaa ei ollut tänään",
  },
  {
    ...entity("step-run-minimum-1"),
    routineRunId: "run-minimum",
    routineStepId: "step-water",
    status: "completed",
    completedAt: "2026-09-19T08:12:00.000Z",
    skipReason: null,
  },
  {
    ...entity("step-run-minimum-2"),
    routineRunId: "run-minimum",
    routineStepId: "step-stretch",
    status: "skipped",
    completedAt: null,
    skipReason: "Minimipäivä: kevyt tavoite.",
  },
];

describe("goal/routine history (T157)", () => {
  it("yhdistää tavoitepäivät ja rutiinisuoritukset uusimmasta vanhimpaan", () => {
    const history = buildGoalRoutineHistory({
      goals,
      goalDays,
      routines,
      routineSteps,
      routineRuns,
      routineStepRuns,
    });

    expect(history.map((record) => record.id)).toEqual([
      "run-full",
      "day-1",
      "day-2",
      "run-minimum",
    ]);
    expect(history[0]).toMatchObject({
      title: "Aamun rauhallinen alku",
      status: "completed",
      detail: "2 / 2 vaihetta käsitelty",
      handledSteps: 2,
      totalSteps: 2,
      dayMode: "full",
    });
    expect(history[3]).toMatchObject({
      status: "completed",
      handledSteps: 2,
      totalSteps: 2,
      dayMode: "minimum",
    });
  });

  it("hakee nimen, tilan ja tyypin perusteella", () => {
    const history = buildGoalRoutineHistory({
      goals,
      goalDays,
      routines,
      routineSteps,
      routineRuns,
      routineStepRuns,
    });

    expect(filterGoalRoutineHistory(history, "minimipäivä")).toHaveLength(1);
    expect(filterGoalRoutineHistory(history, "ei valmis").map((record) => record.id)).toEqual([
      "day-2",
    ]);
    expect(filterGoalRoutineHistory(history, "goal-day")).toHaveLength(2);
  });

  it("tuottaa deterministisen JSON- ja CSV-viennin", () => {
    const history = buildGoalRoutineHistory({
      goals,
      goalDays,
      routines,
      routineSteps,
      routineRuns,
      routineStepRuns,
    });
    const json = serializeGoalRoutineHistory(history.slice(0, 1), "json");
    const csv = serializeGoalRoutineHistory(history.slice(0, 1), "csv");

    expect(json).toContain('"title": "Aamun rauhallinen alku"');
    expect(csv.split("\n")[0]).toBe(
      '"id","kind","localDate","title","status","detail","completedAt","dayMode","handledSteps","totalSteps"',
    );
    expect(csv).toContain('"2 / 2 vaihetta käsitelty"');
  });
});
