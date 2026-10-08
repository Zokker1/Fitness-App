// T130: overlap-esityksen unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: "Päällekkäiset blokit eivät peitä toisiaan epäselvästi."
// - Yli 3 samanaikaista → 3 kaistaa + "N lisää" -indikaattori (ei peittoa);
// - laajennus paljastaa KAIKKI jäsenet täydellä kaistamäärällä (kapeampi);
// - "Piilota" tiivistää takaisin 3 kaistaan + indikaattoriin.
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./renderWithLanguage.tsx";
import { MemoryRouter } from "react-router";
import { InMemoryStore } from "@lifeos/data";
import type { CalendarBlock } from "@lifeos/domain";
import { DataProvider } from "../src/dataContext.tsx";
import { CalendarDayView } from "../src/views/calendar/CalendarDayView.tsx";

const NAMES = ["T130-a", "T130-b", "T130-c", "T130-d"] as const;
// Täysin samanaikaiset (10:00–10:30) → 4 kaistaa → tiivistys + indikaattori.
const STARTS = ["10:00", "10:00", "10:00", "10:00"] as const;

function renderCalendar(): { unmount: () => void } {
  const { unmount } = render(
    <MemoryRouter initialEntries={["/calendar"]}>
      <DataProvider calendarBlockStore={new InMemoryStore<CalendarBlock>("calendar-block")}>
        <CalendarDayView />
      </DataProvider>
    </MemoryRouter>,
  );
  return { unmount };
}

async function createFourOverlappingBlocks(): Promise<void> {
  for (let index = 0; index < NAMES.length; index += 1) {
    const name = NAMES[index];
    if (name === undefined) {
      throw new Error("puuttuu");
    }
    const start = STARTS[index];
    if (start === undefined) {
      throw new Error("puuttuu");
    }
    fireEvent.change(screen.getByLabelText("Timeboxin nimi"), {
      target: { value: name },
    });
    fireEvent.change(screen.getByLabelText("Aloitusaika"), {
      target: { value: start },
    });
    fireEvent.change(screen.getByLabelText("Kesto"), { target: { value: "30" } });
    fireEvent.click(screen.getByTestId("calendar-block-create"));
    if (index < NAMES.length - 1) {
      await waitFor(() => {
        expect(screen.getByTestId("calendar-day-grid").textContent).toContain(name);
      });
    }
  }
  // 4. blockki syntyy jo piilossa → valmistumisen todistaa indikaattori.
  await waitFor(() => {
    expect(screen.getByTestId("calendar-overflow-1-more")).toBeInTheDocument();
  });
}

describe("CalendarDayView overlap (T130)", () => {
  it("yli 3 samanaikaista → 3 kaistaa + '1 lisää'; laajennus näyttää kaikki", async () => {
    const { unmount } = renderCalendar();
    try {
      await waitFor(() => {
        expect(screen.getByTestId("calendar-day-grid")).toBeInTheDocument();
      });
      await createFourOverlappingBlocks();

      // Tiivistys: 4. blockki PILOTETTU (ei renderöidä), indikaattori kertoo.
      const grid = screen.getByTestId("calendar-day-grid");
      const more = screen.getByTestId("calendar-overflow-1-more");
      expect(more.textContent).toContain("1 lisää");
      expect(grid.textContent).not.toContain("T130-d");
      // Näkyvät blockit jakavat leveyden 3 kaistaan (≈33.3 % kpl).
      const shown = grid.querySelectorAll('button[data-testid^="calendar-block-"]');
      expect(shown).toHaveLength(3);
      expect(shown[0]?.getAttribute("style")).toContain("33.33");

      // Laajennus: KAIKKI 4 näkyvät täydellä kaistamäärällä (≈25 % kpl).
      fireEvent.click(more);
      await waitFor(() => {
        expect(grid.textContent).toContain("T130-d");
      });
      expect(more.textContent).toContain("Piilota");
      const expanded = grid.querySelectorAll('button[data-testid^="calendar-block-"]');
      expect(expanded).toHaveLength(4);
      expect(expanded[0]?.getAttribute("style")).toContain("width: 25%");

      // Piilota: takaisin tiivistettyyn (3 kaistaa + indikaattori).
      fireEvent.click(more);
      await waitFor(() => {
        expect(grid.textContent).not.toContain("T130-d");
      });
      expect(more.textContent).toContain("1 lisää");
    } finally {
      unmount();
    }
  });
});
