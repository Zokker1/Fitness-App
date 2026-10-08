// T148: usean tavan tiivis kalenterimatriisi. Todistaa, että rivit tulevat
// HabitRuleista, sarakkeet paikallisista päivistä ja tulevaa ei voi rastittaa.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { InMemoryStore, addDaysIso } from "@lifeos/data";
import type { Goal, GoalDay, HabitRule } from "@lifeos/domain";
import { DataProvider } from "../src/dataContext.tsx";
import { GoalsRoute } from "../src/views/goals/GoalsRoute.tsx";

const NOW = "2026-09-21T12:00:00.000Z";

function localTodayKey(): string {
  const offset = -new Date().getTimezoneOffset();
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
}

function goal(id: string, title: string, today: string): Goal {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    title,
    description: null,
    activeFrom: addDaysIso(today, -6),
    activeUntil: addDaysIso(today, 7),
    archivedAt: null,
    deletedAt: null,
  };
}

function rule(id: string, goalId: string, title: string, cadence: HabitRule["cadence"]): HabitRule {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    goalId,
    title,
    cadence,
    targetPerPeriod: cadence === "weekly" ? 3 : 1,
    deletedAt: null,
  };
}

function goalDay(id: string, goalId: string, localDate: string): GoalDay {
  return {
    id,
    createdAt: NOW,
    updatedAt: NOW,
    version: 1,
    goalId,
    localDate,
    completed: true,
  };
}

describe("HabitTracker (T148)", () => {
  it("näyttää useat tavat matriisina ja kirjaa tämän päivän", async () => {
    const today = localTodayKey();
    const firstGoal = goal("goal-morning", "Aamun rauha", today);
    const secondGoal = goal("goal-training", "Viikon liike", today);
    const goalStore = new InMemoryStore<Goal>("goal", [firstGoal, secondGoal]);
    const habitRuleStore = new InMemoryStore<HabitRule>("habit-rule", [
      rule("rule-morning", firstGoal.id, "Aamuvenyttely", "daily"),
      rule("rule-training", secondGoal.id, "Treeni", "weekly"),
    ]);
    const goalDayStore = new InMemoryStore<GoalDay>("goal-day", [
      goalDay("goal-day-yesterday", firstGoal.id, addDaysIso(today, -1)),
    ]);

    render(
      <MemoryRouter initialEntries={["/goals"]}>
        <DataProvider
          goalStore={goalStore}
          habitRuleStore={habitRuleStore}
          goalDayStore={goalDayStore}
        >
          <GoalsRoute />
        </DataProvider>
      </MemoryRouter>,
    );

    const tracker = await screen.findByTestId("habit-tracker");
    expect(within(tracker).getByText("Aamuvenyttely")).toBeInTheDocument();
    expect(within(tracker).getByText("Treeni")).toBeInTheDocument();
    expect(within(tracker).getAllByRole("columnheader")).toHaveLength(15);
    expect(tracker.querySelectorAll('td[data-state="future"]')).not.toHaveLength(0);
    expect(
      [...tracker.querySelectorAll('td[data-state="future"]')].every(
        (cell) => cell.querySelector("button") === null,
      ),
    ).toBe(true);

    const todayButton = within(tracker).getByRole("button", {
      name: /Aamuvenyttely.*ei vielä kirjattu/,
    });
    fireEvent.click(todayButton);

    await waitFor(async () => {
      const storedDays = await goalDayStore.list();
      expect(storedDays.ok).toBe(true);
      if (!storedDays.ok) return;
      expect(storedDays.value).toContainEqual(
        expect.objectContaining({ goalId: firstGoal.id, localDate: today, completed: true }),
      );
    });
    expect(
      tracker.querySelector('td[data-state="done"][data-today="true"] button'),
    ).toHaveAttribute("aria-pressed", "true");
  });
});
