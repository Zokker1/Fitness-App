// T033: UI-fixture-testi. Todistaa: DataProvider + service-raja toimivat
// renderöidyssä React-komponentissa (happy-dom), ilman domain-logiikkaa
// komponentissa. Ei navigaatiota/reititystä tässä — puhdas DI-todistus.
import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DataProvider } from "../src/dataContext.tsx";
import { FixtureTaskProbe, createFixtureStores } from "./fixtures.tsx";

describe("data provider fixture", () => {
  it("komponentti luo ja completettaa tehtävän servicen kautta", async () => {
    const { taskStore, clock, ids } = createFixtureStores();
    render(
      <DataProvider clock={clock} ids={ids} taskStore={taskStore}>
        <FixtureTaskProbe title="Fixture" />
      </DataProvider>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("fixture-task")).toHaveTextContent("valmis:Fixture:done:v2");
    });
    const listed = await taskStore.list();
    expect(listed.ok && listed.value.length).toBe(1);
  });
});
