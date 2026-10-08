// T131: unscheduled-paneeli + veto kalenteriin — unit (happy-dom,
// tuotantonäkymä, muististore). Kriteeri: "Ajastamattomat tehtävät voidaan
// vetää kalenteriin." (§6)
// - Avoin tehtävä näkyy paneelissa (muististoren tasks);
// - Ajasta-nappi luo kind:"task"-blockin valitulle tunnille (Aloitusaika-
//   kenttä) + linkin (linkedTaskId) — tehtävän otsikko näkyy gridissä,
//   paneeli tyhjenee (ei duplikaattia: yksi totuus tasks-repossa T125);
// - Linkitetty tehtävä ei palaa paneeliin; blockin poisto palauttaa sen.
// Data elää muistissa (InMemoryStore); ei PII:tä: synteettiset tekstit.
// Näkymällä on kaksi samaa data-testid-osioa (kalenteri + ruudukko):
// haut rajataan ladattuun sisältöön findAllByTestId:n viimeisellä
// osumalla (afterEach unmount siivoaa edellisen testin DOM:in).
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./renderWithLanguage.tsx";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { CalendarBlock, Task } from "@lifeos/domain";
import { InMemoryStore } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { CalendarDayView } from "../src/views/calendar/CalendarDayView.tsx";

async function seedTask(taskStore: InMemoryStore<Task>, id: string, title: string): Promise<void> {
  await taskStore.save({
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    title,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
  });
}

function renderCalendar(input: {
  readonly taskStore: InMemoryStore<Task>;
  readonly calendarBlockStore: InMemoryStore<CalendarBlock>;
}): void {
  render(
    <MemoryRouter initialEntries={["/calendar"]}>
      <DataProvider taskStore={input.taskStore} calendarBlockStore={input.calendarBlockStore}>
        <CalendarDayView />
      </DataProvider>
    </MemoryRouter>,
  );
}

/** Päivänäkymän ladattu sisältöosio (viimeinen, latausosion jälkeen). */
async function loadedDaySection(): Promise<HTMLElement> {
  const sections = await screen.findAllByTestId("calendar-day");
  const last = sections[sections.length - 1];
  if (last === undefined) {
    throw new Error("päiväosiota ei löytynyt");
  }
  return last;
}

/** Päiväruudukon sisältöosio (viimeinen, latausosion jälkeen). */
async function loadedDayGrid(): Promise<HTMLElement> {
  const grids = await screen.findAllByTestId("calendar-day-grid");
  const last = grids[grids.length - 1];
  if (last === undefined) {
    throw new Error("päiväruudukkoa ei löytynyt");
  }
  return last;
}

describe("T131 unscheduled-paneeli (unit)", () => {
  it("avoin tehtävä paneelissa → Ajasta luo linkitetyn blockin, paneeli tyhjenee", async () => {
    const user = userEvent.setup();
    const taskStore = new InMemoryStore<Task>("task");
    const calendarBlockStore = new InMemoryStore<CalendarBlock>("calendar-block");
    await seedTask(taskStore, "t-unsched", "T131-ajastamaton");
    renderCalendar({ taskStore, calendarBlockStore });

    const day = await loadedDaySection();
    const list = within(day).getByTestId("calendar-unscheduled-list");
    expect(list).toHaveTextContent("T131-ajastamaton");

    // Ajasta-nappi: luo blockin Aloitusaika-kentän tunnille (oletus 09:00).
    await user.click(within(list).getByTestId("calendar-unscheduled-schedule-t-unsched"));
    const grid = await loadedDayGrid();
    await waitFor(() => {
      expect(grid).toHaveTextContent("T131-ajastamaton");
    });
    expect(grid).toHaveTextContent("09.00");
    expect(grid).toHaveTextContent("Tehtävä");
    // Paneeli tyhjenee (linkitetty ei ole enää ajastamaton).
    await waitFor(() => {
      expect(within(day).queryByTestId("calendar-unscheduled-list")).toBeNull();
    });
    expect(within(day).getByText("Kaikki avoimet tehtävät on ajastettu.")).toBeVisible();
  });

  it("linkitetty tehtävä ei näy paneelissa; blockin poisto palauttaa sen", async () => {
    const user = userEvent.setup();
    const taskStore = new InMemoryStore<Task>("task");
    const calendarBlockStore = new InMemoryStore<CalendarBlock>("calendar-block");
    await seedTask(taskStore, "t-linked", "T131-linkitetty");
    // Blockki TÄLLE päivälle (paikallinen keskipäivä → aina DayGridissä,
    // ei aikavyöhykeriippuvainen kuten kiinteä 09-18 UTC-seed).
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, "0");
    const localKey = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? "+" : "-";
    const abs = Math.abs(offset);
    const suffix = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    const startsAt = `${localKey}T12:00:00.000${suffix}`;
    const endsAt = `${localKey}T13:00:00.000${suffix}`;
    await calendarBlockStore.save({
      id: "b-linked",
      createdAt: "2026-09-18T08:00:00.000Z",
      updatedAt: "2026-09-18T08:00:00.000Z",
      version: 1,
      kind: "task",
      title: "T131-linkitetty",
      startsAt,
      endsAt,
      linkedTaskId: "t-linked",
      linkedRoutineId: null,
      deletedAt: null,
    });
    renderCalendar({ taskStore, calendarBlockStore });

    // Linkitetty ei ole paneelissa (mutta blockki näkyy gridissä).
    const day = await loadedDaySection();
    await waitFor(() => {
      expect(within(day).queryByTestId("calendar-unscheduled-list")).toBeNull();
    });
    expect(within(day).getByRole("button", { name: /T131-linkitetty/ })).toBeVisible();

    // Poista blockki → tehtävä palaa paneeliin (tombstone ei pidä ajastettuna).
    await user.click(within(day).getByRole("button", { name: /T131-linkitetty/ }));
    await user.click(screen.getByTestId("calendar-block-delete"));
    const list = await within(day).findByTestId("calendar-unscheduled-list");
    expect(list).toHaveTextContent("T131-linkitetty");
  });
});

describe("T134 calendar quick add (unit)", () => {
  it("tyhjän ruutukohdan klikkaus snapataan ja tavallinen block syntyy valittuun aikaan", async () => {
    const user = userEvent.setup();
    const taskStore = new InMemoryStore<Task>("task");
    const calendarBlockStore = new InMemoryStore<CalendarBlock>("calendar-block");
    renderCalendar({ taskStore, calendarBlockStore });

    const day = await loadedDaySection();
    const gridSection = await loadedDayGrid();
    const grid = gridSection.querySelector('[data-ui="calendar-day-grid"]');
    if (!(grid instanceof HTMLElement)) {
      throw new Error("kalenteriruudukkoa ei löytynyt");
    }
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 960 });
    Object.defineProperty(grid, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, right: 640, bottom: 960, left: 0, width: 640, height: 960 }),
    });

    // 06:00 + 270 px / 60 px per tunti = 10:30.
    fireEvent.click(grid, { clientY: 270 });
    expect(within(day).getByLabelText("Aloitusaika")).toHaveValue("10:30");
    expect(
      within(day).getByText("Napsauta päiväruudukosta tyhjää kohtaa valitaksesi aloitusajan."),
    ).toBeVisible();

    await user.type(within(day).getByLabelText("Timeboxin nimi"), "T134-valittu aika");
    await user.click(within(day).getByTestId("calendar-block-create"));
    await waitFor(() => {
      expect(gridSection).toHaveTextContent("T134-valittu aika");
      expect(gridSection).toHaveTextContent("10.30");
    });
  });

  it("valittu aika + tehtävälinkitys luo task-blockin", async () => {
    const user = userEvent.setup();
    const taskStore = new InMemoryStore<Task>("task");
    const calendarBlockStore = new InMemoryStore<CalendarBlock>("calendar-block");
    await seedTask(taskStore, "t-t134", "T134-linkitetty tehtävä");
    renderCalendar({ taskStore, calendarBlockStore });

    const day = await loadedDaySection();
    const gridSection = await loadedDayGrid();
    const grid = gridSection.querySelector('[data-ui="calendar-day-grid"]');
    if (!(grid instanceof HTMLElement)) {
      throw new Error("kalenteriruudukkoa ei löytynyt");
    }
    Object.defineProperty(grid, "clientHeight", { configurable: true, value: 960 });
    Object.defineProperty(grid, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ top: 0, right: 640, bottom: 960, left: 0, width: 640, height: 960 }),
    });

    // 06:00 + 390 px / 60 px per tunti = 12:30.
    fireEvent.click(grid, { clientY: 390 });
    expect(within(day).getByLabelText("Aloitusaika")).toHaveValue("12:30");
    fireEvent.change(within(day).getByLabelText("Tehtävälinkitys (valinnainen)"), {
      target: { value: "t-t134" },
    });
    expect(within(day).getByLabelText("Timeboxin nimi")).toHaveValue("T134-linkitetty tehtävä");
    await user.click(within(day).getByTestId("calendar-block-create"));
    await waitFor(() => {
      expect(gridSection).toHaveTextContent("T134-linkitetty tehtävä");
      expect(gridSection).toHaveTextContent("12.30");
      expect(gridSection).toHaveTextContent("Tehtävä");
    });
  });
});
