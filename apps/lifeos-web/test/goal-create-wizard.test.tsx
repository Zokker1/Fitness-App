// T147: tavoitteen luontiwizard valitsee tavoitetyypin selkokielisesti ja
// tallentaa valitun viikkorytmin Goal + HabitRule -pareina.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@lifeos/data";
import type { Goal, HabitRule } from "@lifeos/domain";
import { DataProvider } from "../src/dataContext.tsx";
import { GoalsRoute } from "../src/views/goals/GoalsRoute.tsx";

function renderGoals(goalStore: InMemoryStore<Goal>, habitRuleStore: InMemoryStore<HabitRule>) {
  return render(
    <MemoryRouter initialEntries={["/goals"]}>
      <DataProvider goalStore={goalStore} habitRuleStore={habitRuleStore}>
        <GoalsRoute />
      </DataProvider>
    </MemoryRouter>,
  );
}

describe("GoalsRoute (T147)", () => {
  it("avaa selkokielisen wizardin ja tallentaa viikkotavoitteen rytmineen", async () => {
    const goalStore = new InMemoryStore<Goal>("goal");
    const habitRuleStore = new InMemoryStore<HabitRule>("habit-rule");
    renderGoals(goalStore, habitRuleStore);

    fireEvent.click(await screen.findByTestId("goal-create-open"));
    expect(screen.getByTestId("goal-create-wizard")).toBeInTheDocument();
    expect(screen.getByText("Millainen muutos sopii sinulle nyt?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: /Kertoja viikossa/ }));
    fireEvent.click(screen.getByRole("button", { name: "Jatka" }));
    expect(screen.getByLabelText("Tavoite viikossa")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Tavoite viikossa"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Jatka" }));
    fireEvent.change(screen.getByLabelText("Tavoitteen nimi"), {
      target: { value: "Viikon treenit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tallenna tavoite" }));

    await waitFor(async () => {
      const goals = await goalStore.list();
      expect(goals.ok).toBe(true);
      if (!goals.ok) return;
      expect(goals.value).toHaveLength(1);
      expect(goals.value[0]?.title).toBe("Viikon treenit");
    });
    const rules = await habitRuleStore.list();
    expect(rules.ok).toBe(true);
    if (!rules.ok) return;
    expect(rules.value).toHaveLength(1);
    expect(rules.value[0]).toMatchObject({
      title: "Viikon treenit",
      cadence: "weekly",
      targetPerPeriod: 3,
    });
    expect(await screen.findByTestId("goal-list")).toHaveTextContent("Viikon treenit");
  });

  it("ei etene ilman ymmärrettävää tavoitetyypin valintaa", async () => {
    renderGoals(new InMemoryStore<Goal>("goal"), new InMemoryStore<HabitRule>("habit-rule"));

    fireEvent.click(await screen.findByTestId("goal-create-open"));
    fireEvent.click(screen.getByRole("button", { name: "Jatka" }));

    expect(within(screen.getByTestId("goal-create-wizard")).getByRole("status")).toHaveTextContent(
      "Valitse ensin tavoitteen tyyppi.",
    );
    expect(screen.getByText("Millainen muutos sopii sinulle nyt?")).toBeInTheDocument();
  });
});
