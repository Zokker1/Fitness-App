// T150: yhden käden routine player. Todistaa syvälinkin, aloituksen,
// vaiheittaisen etenemisen ja automaattisen päättämisen viimeisen vaiheen jälkeen.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Routine, RoutineStep, XPTransaction } from "@lifeos/domain";
import { InMemoryStore, ROUTINE_COMPLETION_XP, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { GoalsRoute } from "../src/views/goals/GoalsRoute.tsx";

const AT = "2026-09-21T07:00:00.000Z";

function routine(): Routine {
  return {
    id: "routine-player",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Rauhallinen aamu",
    archivedAt: null,
    deletedAt: null,
  };
}

function step(id: string, title: string, sortOrder: number, optional = false): RoutineStep {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    routineId: "routine-player",
    title,
    sortOrder,
    optional,
    deletedAt: null,
  };
}

function renderPlayer(
  steps: readonly RoutineStep[] = [step("step-1", "Vettä", 0), step("step-2", "Venyttele", 1)],
  xpStore = new InMemoryStore<XPTransaction>("xp-transaction"),
) {
  render(
    <MemoryRouter initialEntries={["/goals?routine=routine-player"]}>
      <DataProvider
        ids={sequentialIdGenerator("player")}
        routineStore={new InMemoryStore<Routine>("routine", [routine()])}
        routineStepStore={new InMemoryStore<RoutineStep>("routine-step", steps)}
        xpStore={xpStore}
      >
        <GoalsRoute />
      </DataProvider>
    </MemoryRouter>,
  );
}

describe("RoutinePlayer (T150)", () => {
  afterEach(() => {
    cleanup();
  });

  it("aloittaa rutiinin ja vie yhden vaiheen kerrallaan valmiiksi", async () => {
    const xpStore = new InMemoryStore<XPTransaction>("xp-transaction");
    renderPlayer(undefined, xpStore);

    await screen.findByTestId("routine-player");
    expect(screen.getByText("Rauhallinen aamu")).toBeInTheDocument();
    expect(screen.getByText(/0\s*\/\s*2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aloita tämän päivän rutiini" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Aloita tämän päivän rutiini" }));
    await waitFor(() => {
      expect(screen.getByTestId("routine-step-step-1")).toHaveAttribute("data-state", "current");
    });

    fireEvent.click(screen.getByRole("button", { name: "Merkitse vaihe tehdyksi" }));
    await waitFor(() => {
      expect(screen.getByTestId("routine-step-step-1")).toHaveAttribute("data-state", "done");
      expect(screen.getByTestId("routine-step-step-2")).toHaveAttribute("data-state", "current");
    });

    fireEvent.click(screen.getByRole("button", { name: "Merkitse vaihe tehdyksi" }));
    await waitFor(async () => {
      expect(screen.getByText(/2\s*\/\s*2/)).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("rutiini on valmis");
      const listed = await xpStore.list();
      expect(listed.ok && listed.value).toHaveLength(1);
      expect(listed.ok && listed.value[0]?.amount).toBe(ROUTINE_COMPLETION_XP);
    });
  });

  it("kertoo rehellisesti, jos rutiinilla ei ole vaiheita", async () => {
    renderPlayer([]);
    await screen.findByTestId("routine-player");
    expect(screen.getByText("Rutiinilla ei ole vaiheita vielä.")).toBeInTheDocument();
    expect(screen.queryByTestId("routine-start")).toBeNull();
  });

  it("ohittaa valinnaisen vaiheen perustellusti ja päättää rutiinin valmiina", async () => {
    renderPlayer([step("step-1", "Vettä", 0), step("step-2", "Hengitä", 1, true)]);

    await screen.findByTestId("routine-player");
    fireEvent.click(screen.getByRole("button", { name: "Aloita tämän päivän rutiini" }));
    await waitFor(() => {
      expect(screen.getByTestId("routine-step-step-1")).toHaveAttribute("data-state", "current");
    });
    fireEvent.click(screen.getByRole("button", { name: "Merkitse vaihe tehdyksi" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Ohita tämä vaihe" })).toBeEnabled();
      expect(screen.getByText("Valinnainen")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Ohita tämä vaihe" }));
    const reason = screen.getByLabelText("Miksi ohitat tämän vaiheen?");
    fireEvent.change(reason, { target: { value: "Aikaa ei ollut tänään" } });
    fireEvent.click(screen.getByRole("button", { name: "Ohita vaihe" }));

    await waitFor(() => {
      expect(screen.getByTestId("routine-step-step-2")).toHaveAttribute("data-state", "skipped");
      expect(screen.getByRole("status")).toHaveTextContent("rutiini on valmis");
    });
  });

  it("käynnistää minimipäivän yhdellä vaiheella ilman epäonnistumisen tilaa", async () => {
    renderPlayer([step("step-1", "Vettä", 0), step("step-2", "Venyttele", 1)]);

    await screen.findByTestId("routine-player");
    fireEvent.click(screen.getByRole("button", { name: "Tee minimipäivä" }));
    await waitFor(() => {
      expect(screen.getByTestId("routine-step-step-1")).toHaveAttribute("data-state", "current");
      expect(screen.getByTestId("routine-step-step-2")).toHaveAttribute("data-state", "skipped");
      expect(screen.getByText(/0\s*\/\s*1/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Merkitse vaihe tehdyksi" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("minimipäivä on valmis");
      expect(screen.getByText("Ei kuulu minimipäivään")).toBeInTheDocument();
    });
  });
});
