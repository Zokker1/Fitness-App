// T084: summarizeTodayRoutines unit-testit (data-paketti, ei IO:ta).
// - Vain aktiiviset (ei poistettuja/arkistoituja); askeleet sortOrderissa,
//   poistetut askeleet pois; progressPercent aina null (ei suoritusdataa);
//   tyhjä joukko → tyhjät listat, ei 0 %-harhaa.
import { describe, expect, it } from "vitest";
import type { Routine, RoutineRun, RoutineStep, RoutineStepRun } from "@lifeos/domain";
import { summarizeTodayRoutines } from "@lifeos/data";

const AT = "2026-09-18T09:00:00.000Z";

function routine(id: string, overrides: Partial<Routine> = {}): Routine {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: id,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function step(id: string, routineId: string, overrides: Partial<RoutineStep> = {}): RoutineStep {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId,
    title: id,
    sortOrder: 0,
    deletedAt: null,
    ...overrides,
  };
}

describe("summarizeTodayRoutines (T084)", () => {
  it("tyhjä joukko → tyhjät listat, ei progress-harhaa", () => {
    const summary = summarizeTodayRoutines([], []);
    expect(summary.routines).toEqual([]);
    expect(summary.progressPercent).toBeNull();
    expect(summary.routineCount).toBe(0);
    expect(summary.totalSteps).toBe(0);
  });

  it("vain aktiiviset; askeleet sortOrderissa; poistetut pois", () => {
    const summary = summarizeTodayRoutines(
      [
        routine("r-aamu"),
        routine("r-arkisto", { archivedAt: AT }),
        routine("r-poisto", { deletedAt: AT }),
      ],
      [
        step("s-2", "r-aamu", { sortOrder: 1 }),
        step("s-1", "r-aamu", { sortOrder: 0 }),
        step("s-del", "r-aamu", { sortOrder: 2, deletedAt: AT }),
        step("s-other", "r-arkisto", { sortOrder: 0 }),
      ],
    );
    expect(summary.routines.map((view) => view.routine.id)).toEqual(["r-aamu"]);
    expect(summary.routines[0]?.steps.map((row) => row.id)).toEqual(["s-1", "s-2"]);
    expect(summary.routineCount).toBe(1);
    expect(summary.totalSteps).toBe(2);
    expect(summary.progressPercent).toBeNull();
  });

  it("rutiini ilman askelia näkyy rakenteena (ei 0 %-väitettä)", () => {
    const summary = summarizeTodayRoutines([routine("r-tyhja")], []);
    expect(summary.routines).toHaveLength(1);
    expect(summary.routines[0]?.steps).toEqual([]);
    expect(summary.totalSteps).toBe(0);
    expect(summary.progressPercent).toBeNull();
  });

  it("liittää saman päivän suorituksen ja palauttaa seuraavan vaiheen", () => {
    const currentRoutine = routine("r-aamu");
    const currentSteps = [
      step("s-1", currentRoutine.id, { title: "Venyttele", sortOrder: 0 }),
      step("s-2", currentRoutine.id, { title: "Vesi", sortOrder: 1 }),
    ];
    const run = {
      id: "run-aamu",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
      routineId: currentRoutine.id,
      localDate: "2026-09-18",
      status: "running",
      startedAt: AT,
      completedAt: null,
      skipReason: null,
    } satisfies RoutineRun;
    const stepRuns = [
      {
        id: "step-run-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        routineRunId: run.id,
        routineStepId: "s-1",
        status: "completed",
        completedAt: AT,
        skipReason: null,
      },
      {
        id: "step-run-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        routineRunId: run.id,
        routineStepId: "s-2",
        status: "pending",
        completedAt: null,
        skipReason: null,
      },
    ] satisfies readonly RoutineStepRun[];

    const summary = summarizeTodayRoutines(
      [currentRoutine],
      currentSteps,
      [run],
      stepRuns,
      "2026-09-18",
    );
    const view = summary.routines[0];
    expect(view?.todayRun?.status).toBe("running");
    expect(view?.completedSteps).toBe(1);
    expect(view?.currentStep?.title).toBe("Vesi");
    expect(view?.progressPercent).toBe(50);
    expect(summary.progressPercent).toBe(50);
  });
});
