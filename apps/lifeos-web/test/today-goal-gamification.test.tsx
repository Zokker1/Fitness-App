// T155: tavoitepäivän onnistuminen näkyy heti Tänään-näkymän XP-kortissa.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type { Goal, XPTransaction } from "@lifeos/domain";
import { InMemoryStore } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { TodayView } from "../src/views/today/TodayView.tsx";

vi.mock("../src/storage/StorageStatusContext.tsx", () => ({
  useAppStorageStatus: () => ({ status: { backend: "memory" } }),
}));

const AT = "2026-09-21T12:00:00.000Z";

function goal(): Goal {
  return {
    id: "today-goal-t155",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Aamun rauha",
    description: null,
    activeFrom: null,
    activeUntil: null,
    archivedAt: null,
    deletedAt: null,
  };
}

describe("TodayView goal gamification (T155)", () => {
  it("kirjaa tavoitepäivän ja päivittää Edistyminen-kortin", async () => {
    const goalStore = new InMemoryStore<Goal>("goal", [goal()]);
    const xpStore = new InMemoryStore<XPTransaction>("xp-transaction");

    render(
      <MemoryRouter initialEntries={["/"]}>
        <DataProvider goalStore={goalStore} xpStore={xpStore}>
          <TodayView />
        </DataProvider>
      </MemoryRouter>,
    );

    const goalsCard = await screen.findByTestId("today-goals-card");
    fireEvent.click(within(goalsCard).getByRole("checkbox"));

    await waitFor(async () => {
      const listed = await xpStore.list();
      expect(listed.ok && listed.value).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId("today-gamification-card")).toHaveTextContent("5 XP");
    });
  });
});
