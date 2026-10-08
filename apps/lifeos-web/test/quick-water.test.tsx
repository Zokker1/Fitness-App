// T092: QuickWaterPanel unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: yksi napautus = 250 ml NYT, saldo päivittyy samassa sessiossa,
// onLogged saa rivin. Virhepolku: repo-virhe → rehellinen viesti (ei feikkiä).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { HydrationEntry } from "@lifeos/domain";
import { createEntityRepository } from "@lifeos/data";
import { createFixtureStores } from "./fixtures.tsx";
import { QuickWaterPanel } from "../src/quickadd/QuickWaterPanel.tsx";

function renderPanel(options?: {
  readonly todayMilliliters?: number;
  readonly onLogged?: (entry: HydrationEntry) => void;
}) {
  const { hydrationStore, clock, ids } = createFixtureStores();
  const hydrationEntries = createEntityRepository(hydrationStore, { clock, ids });
  const onLogged = options?.onLogged ?? vi.fn();
  const view = render(
    <QuickWaterPanel
      hydrationEntries={hydrationEntries}
      todayMilliliters={options?.todayMilliliters ?? 500}
      onLogged={onLogged}
    />,
  );
  return { store: hydrationStore, onLogged, ...view };
}

describe("QuickWaterPanel", () => {
  it("yksi napautus kirjaa 250 ml NYT ja saldo kasvaa", async () => {
    const onLogged = vi.fn();
    const { store, unmount } = renderPanel({ todayMilliliters: 500, onLogged });
    try {
      expect(screen.getByTestId("quick-water-balance")).toHaveTextContent("Tänään 500 ml");
      fireEvent.click(screen.getByRole("button", { name: "Kirjaa 250 ml" }));
      await waitFor(() => {
        expect(onLogged).toHaveBeenCalledTimes(1);
      });
      const logged = onLogged.mock.calls[0]?.[0] as HydrationEntry;
      expect(logged.milliliters).toBe(250);
      expect(Date.parse(logged.drunkAt)).toBeLessThanOrEqual(Date.now());
      await waitFor(() => {
        expect(screen.getByTestId("quick-water-balance")).toHaveTextContent("Tänään 750 ml");
      });
      expect(screen.getByTestId("quick-water-confirmation")).toHaveTextContent("Kirjattu 250 ml.");
      const listed = await store.list();
      expect(listed.ok && listed.value.length).toBe(1);
    } finally {
      unmount();
    }
  });

  it("toinen napautus kirjaa toisen lasillisen (sama sessio)", async () => {
    const onLogged = vi.fn();
    const { unmount } = renderPanel({ todayMilliliters: 0, onLogged });
    try {
      const button = screen.getByRole("button", { name: "Kirjaa 250 ml" });
      fireEvent.click(button);
      await waitFor(() => {
        expect(onLogged).toHaveBeenCalledTimes(1);
      });
      fireEvent.click(button);
      await waitFor(() => {
        expect(onLogged).toHaveBeenCalledTimes(2);
      });
      await waitFor(() => {
        expect(screen.getByTestId("quick-water-balance")).toHaveTextContent("Tänään 500 ml");
      });
      expect(screen.getByTestId("quick-water-confirmation")).toHaveTextContent("Kirjattu 250 ml.");
    } finally {
      unmount();
    }
  });
});
