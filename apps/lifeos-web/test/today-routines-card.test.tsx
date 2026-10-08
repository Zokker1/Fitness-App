// T153: Tänään-kortti näyttää oikean päivän etenemisen ja jatkolinkin.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { Routine, RoutineRun, RoutineStep, RoutineStepRun } from "@lifeos/domain";
import { summarizeTodayRoutines } from "@lifeos/data";
import { TodayRoutinesCard } from "../src/views/today/TodayRoutinesCard.tsx";

const AT = "2026-09-18T09:00:00.000Z";

const routine: Routine = {
  id: "today-routine",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  title: "Aamurutiini",
  archivedAt: null,
  deletedAt: null,
};

const steps: readonly RoutineStep[] = [
  {
    id: "today-step-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: routine.id,
    title: "Venyttele",
    sortOrder: 0,
    deletedAt: null,
  },
  {
    id: "today-step-2",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: routine.id,
    title: "Vesi",
    sortOrder: 1,
    deletedAt: null,
  },
];

const run: RoutineRun = {
  id: "today-run",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  routineId: routine.id,
  localDate: "2026-09-18",
  status: "running",
  startedAt: AT,
  completedAt: null,
  skipReason: null,
};

const stepRuns: readonly RoutineStepRun[] = [
  {
    id: "today-step-run-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineRunId: run.id,
    routineStepId: steps[0]?.id ?? "",
    status: "completed",
    completedAt: AT,
    skipReason: null,
  },
  {
    id: "today-step-run-2",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineRunId: run.id,
    routineStepId: steps[1]?.id ?? "",
    status: "pending",
    completedAt: null,
    skipReason: null,
  },
];

describe("TodayRoutinesCard (T153)", () => {
  it("näyttää progressin, seuraavan vaiheen ja jatkaa käynnissä olevaa rutiinia", () => {
    const summary = summarizeTodayRoutines([routine], steps, [run], stepRuns, "2026-09-18");
    render(
      <MemoryRouter>
        <TodayRoutinesCard summary={summary} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("progressbar", { name: /1 \/ 2 vaihetta/ })).toBeInTheDocument();
    expect(screen.getByText("1 / 2 vaihetta käsitelty")).toBeInTheDocument();
    expect(screen.getByText("Seuraavaksi: Vesi")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Jatka rutiinia Aamurutiini" })).toHaveTextContent(
      "Jatka",
    );
  });
});
