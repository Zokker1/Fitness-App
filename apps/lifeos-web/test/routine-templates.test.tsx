// T152: mallikirjasto ei kirjoita mitään ennen käyttäjän nimenomaista valintaa.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { Routine, RoutineStep } from "@lifeos/domain";
import { InMemoryStore, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { GoalsRoute } from "../src/views/goals/GoalsRoute.tsx";

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={["/goals"]}>
      <DataProvider
        ids={sequentialIdGenerator("template")}
        routineStore={new InMemoryStore<Routine>("routine")}
        routineStepStore={new InMemoryStore<RoutineStep>("routine-step")}
      >
        <GoalsRoute />
      </DataProvider>
    </MemoryRouter>,
  );
}

describe("RoutineOverview (T152)", () => {
  afterEach(() => {
    cleanup();
  });

  it("näyttää mallit ilman automaattista luontia ja luo valitun mallin", async () => {
    renderOverview();

    await screen.findByTestId("routine-overview");
    expect(
      screen.getByText("Mallit ovat valinnaisia — mitään ei luoda ennen kuin valitset mallin."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("routine-template-morning")).toBeInTheDocument();
    expect(screen.getByTestId("routine-template-evening")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Aamun rauhallinen alku/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Luo aamurutiini" }));

    await waitFor(() => {
      expect(screen.getByRole("link", { name: /Aamun rauhallinen alku/ })).toBeInTheDocument();
      expect(screen.getByText("3 vaihetta, 1 valinnainen vaihe")).toBeInTheDocument();
    });
  });
});
