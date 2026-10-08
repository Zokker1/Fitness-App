// T135: kalenterin desktop-oikotiet — nuolinavigointi, T=tänään ja N=uusi
// timebox. Kentät ja modifier-yhdistelmät eivät saa kaapata oikotietä.
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./renderWithLanguage.tsx";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { DataProvider } from "../src/dataContext.tsx";
import { CalendarDayView } from "../src/views/calendar/CalendarDayView.tsx";

function renderCalendar(): void {
  render(
    <MemoryRouter initialEntries={["/calendar"]}>
      <DataProvider>
        <CalendarDayView />
      </DataProvider>
    </MemoryRouter>,
  );
}

describe("T135 calendar shortcuts", () => {
  afterEach(() => {
    cleanup();
  });

  it("nuolet siirtävät päivää, T palaa tähän ja N fokusoi uuden timeboxin", async () => {
    renderCalendar();
    const datePicker = await screen.findByTestId("calendar-date-picker");
    const today = (datePicker as HTMLInputElement).value;

    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => {
      expect(datePicker).not.toHaveValue(today);
    });
    fireEvent.keyDown(document.body, { key: "t" });
    await waitFor(() => {
      expect(datePicker).toHaveValue(today);
    });

    fireEvent.keyDown(document.body, { key: "n" });
    const title = screen.getByLabelText("Timeboxin nimi");
    await waitFor(() => {
      expect(title).toHaveFocus();
    });
    expect(title).toHaveValue("");
  });

  it("lomakekenttä ja modifier-yhdistelmä eivät kaappaa selaimen normaalia toimintaa", async () => {
    const user = userEvent.setup();
    renderCalendar();
    const datePicker = await screen.findByTestId("calendar-date-picker");
    const today = (datePicker as HTMLInputElement).value;
    const title = screen.getByLabelText("Timeboxin nimi");

    await user.click(title);
    await user.keyboard("x");
    expect(title).toHaveValue("x");
    fireEvent.keyDown(title, { key: "ArrowRight" });
    expect(datePicker).toHaveValue(today);

    fireEvent.keyDown(document.body, { key: "ArrowRight", ctrlKey: true });
    expect(datePicker).toHaveValue(today);
  });
});
