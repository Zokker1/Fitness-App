// T146: tavoitedetailin käyttöliittymätesti. Todistaa, että T141:n progress
// ja T145:n päivätilat näkyvät samassa syvälinkitettävässä näkymässä.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { InMemoryStore, addDaysIso } from "@lifeos/data";
import type { Goal, GoalDay } from "@lifeos/domain";
import { DataProvider } from "../src/dataContext.tsx";
import { GoalsRoute } from "../src/views/goals/GoalsRoute.tsx";

const NOW = "2026-09-21T12:00:00.000Z";

function localTodayKey(): string {
  const offset = -new Date().getTimezoneOffset();
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
}

function goal(id: string, startDate: string, endDate: string): Goal {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    title: "Aamun rauha",
    description: "Lyhyt, toistuva aloitus päivälle.",
    activeFrom: startDate,
    activeUntil: endDate,
    archivedAt: null,
    deletedAt: null,
  };
}

function goalDay(id: string, goalId: string, localDate: string, completed: boolean): GoalDay {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    goalId,
    localDate,
    completed,
  };
}

function renderRoute(path: string, goals: readonly Goal[], days: readonly GoalDay[]) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <DataProvider
        goalStore={new InMemoryStore<Goal>("goal", goals)}
        goalDayStore={new InMemoryStore<GoalDay>("goal-day", days)}
      >
        <GoalsRoute />
      </DataProvider>
    </MemoryRouter>,
  );
}

describe("GoalsRoute (T146)", () => {
  it("renders a deep-linked goal detail with progress and day states", async () => {
    const today = localTodayKey();
    const start = addDaysIso(today, -3);
    const end = addDaysIso(today, 3);
    const selectedGoal = goal("goal-detail", start, end);

    renderRoute(
      `/goals?goal=${selectedGoal.id}`,
      [selectedGoal],
      [goalDay("goal-day-done", selectedGoal.id, addDaysIso(today, -1), true)],
    );

    const detail = await screen.findByTestId("goal-detail");
    expect(within(detail).getByText("Aamun rauha")).toBeInTheDocument();
    expect(within(detail).getByTestId("goal-detail-progress")).toBeInTheDocument();
    expect(within(detail).getByTestId("goal-detail-calendar")).toBeInTheDocument();
    expect(within(detail).getAllByTestId("goal-detail-day")).toHaveLength(7);
    expect(within(detail).getByRole("gridcell", { name: /Onnistui/ })).toBeInTheDocument();
    expect(within(detail).getAllByRole("gridcell", { name: /Tuleva/ }).length).toBeGreaterThan(0);
    expect(within(detail).getByRole("gridcell", { name: /Kesken.*tänään/i })).toBeInTheDocument();
  });

  it("lists active goals and links each one to its detail", async () => {
    const today = localTodayKey();
    const selectedGoal = goal("goal-list", today, addDaysIso(today, 6));

    renderRoute("/goals", [selectedGoal], []);

    const list = await screen.findByTestId("goal-list");
    expect(within(list).getByTestId("goal-card-goal-list")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Avaa tavoite" })).toHaveAttribute(
      "href",
      "/goals?goal=goal-list",
    );
  });
});
