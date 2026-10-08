// T157: historian haku, yhdistetty aikajana ja vientitoimintojen näkyvyys.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type {
  Goal,
  GoalDay,
  Routine,
  RoutineRun,
  RoutineStep,
  RoutineStepRun,
} from "@lifeos/domain";
import { InMemoryStore, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { GoalsRoute } from "../src/views/goals/GoalsRoute.tsx";

const AT = "2026-09-21T07:00:00.000Z";

function renderHistory(): void {
  const goal: Goal = {
    id: "goal-history",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Liiku joka päivä",
    description: null,
    activeFrom: "2026-09-01",
    activeUntil: null,
    archivedAt: null,
    deletedAt: null,
  };
  const goalDay: GoalDay = {
    id: "goal-day-history",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    goalId: goal.id,
    localDate: "2026-09-21",
    completed: true,
  };
  const routine: Routine = {
    id: "routine-history",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Aamun rauhallinen alku",
    archivedAt: null,
    deletedAt: null,
  };
  const step: RoutineStep = {
    id: "routine-step-history",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: routine.id,
    title: "Juo vettä",
    sortOrder: 0,
    optional: false,
    deletedAt: null,
  };
  const run: RoutineRun = {
    id: "routine-run-history",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: routine.id,
    localDate: "2026-09-20",
    status: "completed",
    dayMode: "minimum",
    startedAt: AT,
    completedAt: "2026-09-20T07:05:00.000Z",
    skipReason: null,
  };
  const stepRun: RoutineStepRun = {
    id: "routine-step-run-history",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineRunId: run.id,
    routineStepId: step.id,
    status: "completed",
    completedAt: "2026-09-20T07:05:00.000Z",
    skipReason: null,
  };

  render(
    <MemoryRouter initialEntries={["/goals?history=1"]}>
      <DataProvider
        ids={sequentialIdGenerator("history-test")}
        goalStore={new InMemoryStore<Goal>("goal", [goal])}
        goalDayStore={new InMemoryStore<GoalDay>("goal-day", [goalDay])}
        routineStore={new InMemoryStore<Routine>("routine", [routine])}
        routineStepStore={new InMemoryStore<RoutineStep>("routine-step", [step])}
        routineRunStore={new InMemoryStore<RoutineRun>("routine-run", [run])}
        routineStepRunStore={new InMemoryStore<RoutineStepRun>("routine-step-run", [stepRun])}
      >
        <GoalsRoute />
      </DataProvider>
    </MemoryRouter>,
  );
}

describe("GoalRoutineHistory (T157)", () => {
  afterEach(() => {
    cleanup();
  });

  it("näyttää yhdistetyn historian ja viennit", async () => {
    renderHistory();

    await screen.findByTestId("goal-routine-history");
    expect(screen.getByRole("heading", { name: "Historia" })).toBeInTheDocument();
    expect(screen.getByTestId("history-row-goal-day-history")).toHaveTextContent(
      "Liiku joka päivä",
    );
    expect(screen.getByTestId("history-row-routine-run-history")).toHaveTextContent(
      "Aamun rauhallinen alku",
    );
    expect(screen.getByRole("button", { name: "Vie historia JSON" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Vie historia CSV" })).toBeEnabled();
    expect(screen.getByTestId("goal-routine-history")).toHaveTextContent(
      "Näytetään 2 / 2 merkintää.",
    );
  });

  it("suodattaa historian hakukentällä", async () => {
    renderHistory();
    await screen.findByTestId("goal-routine-history");

    fireEvent.change(screen.getByLabelText("Hae historiasta"), {
      target: { value: "aamu" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("goal-routine-history")).toHaveTextContent(
        "Näytetään 1 / 2 merkintää.",
      );
    });
    expect(screen.getByTestId("history-row-routine-run-history")).toBeInTheDocument();
    expect(screen.queryByTestId("history-row-goal-day-history")).toBeNull();
  });

  it("palaa tavoite- ja rutiininäkymään historia-tilasta", async () => {
    renderHistory();
    await screen.findByTestId("goal-routine-history");

    fireEvent.click(screen.getByRole("button", { name: "Palaa tavoitteisiin" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Tavoitteet ja rutiinit" })).toBeInTheDocument();
    });
    expect(screen.getByTestId("goal-history-link")).toBeInTheDocument();
  });
});
