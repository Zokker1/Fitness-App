// T126: rutiinilinkityksen unit-testit (web-paketti, happy-dom + muististore).
// Kriteeri: "Rutiini voidaan näyttää suunniteltuna blokkina."
// - Rutiinilinkitys-valinta täyttää nimen rutiinin otsikosta (jos tyhjä);
// - block luodaan kind "routine" + linkedRoutineId (ei datan duplikaattia);
// - block näyttää rutiinin NYKYISEN otsikon lookupilla + "Rutiini"-merkin;
// - mutual exclusivity: task-linkityksen valinta tyhjentää rutiinilinkityksen
//   (yksi blockki = yksi suunnitelma, §6).
import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "./renderWithLanguage.tsx";
import { MemoryRouter } from "react-router";
import { InMemoryStore } from "@lifeos/data";
import type { CalendarBlock, Routine, Task } from "@lifeos/domain";
import { DataProvider } from "../src/dataContext.tsx";
import { CalendarDayView } from "../src/views/calendar/CalendarDayView.tsx";

const ROUTINE_ID = "r1";
const TASK_ID = "t1";

function routine(id: string, title: string): Routine {
  return {
    id,
    createdAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-14T08:00:00.000Z",
    version: 1,
    title,
    archivedAt: null,
    deletedAt: null,
  };
}

function task(id: string, title: string): Task {
  return {
    id,
    createdAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-14T08:00:00.000Z",
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
  };
}

function renderCalendar(
  seedRoutines: readonly Routine[],
  seedTasks: readonly Task[] = [],
): {
  unmount: () => void;
} {
  const { unmount } = render(
    <MemoryRouter initialEntries={["/calendar"]}>
      <DataProvider
        routineStore={new InMemoryStore<Routine>("routine", seedRoutines)}
        taskStore={new InMemoryStore<Task>("task", seedTasks)}
        calendarBlockStore={new InMemoryStore<CalendarBlock>("calendar-block")}
      >
        <CalendarDayView />
      </DataProvider>
    </MemoryRouter>,
  );
  return { unmount };
}

describe("CalendarDayView rutiinilinkitys (T126)", () => {
  it("rutiinin valinta esitäyttää nimen ja luo routine-blockin", async () => {
    const { unmount } = renderCalendar([routine(ROUTINE_ID, "T126-aamulenkki")]);
    try {
      await waitFor(() => {
        expect(screen.getByTestId("calendar-day-grid")).toBeInTheDocument();
      });
      fireEvent.change(screen.getByLabelText("Rutiinilinkitys (valinnainen)"), {
        target: { value: ROUTINE_ID },
      });
      // Esitäyttö: nimi = rutiinin otsikko (koska kenttä oli tyhjä).
      expect(screen.getByLabelText("Timeboxin nimi")).toHaveValue("T126-aamulenkki");
      fireEvent.change(screen.getByLabelText("Aloitusaika"), {
        target: { value: "07:00" },
      });
      fireEvent.change(screen.getByLabelText("Kesto"), { target: { value: "30" } });
      fireEvent.click(screen.getByTestId("calendar-block-create"));
      await waitFor(() => {
        const grid = screen.getByTestId("calendar-day-grid");
        expect(grid.textContent).toContain("T126-aamulenkki");
        expect(grid.textContent).toContain("Rutiini");
      });
    } finally {
      unmount();
    }
  });

  it("mutual exclusivity: task-linkitys tyhjentää rutiinilinkityksen", async () => {
    const { unmount } = renderCalendar(
      [routine(ROUTINE_ID, "T126-aamulenkki")],
      [task(TASK_ID, "T126-tehtävä")],
    );
    try {
      await waitFor(() => {
        expect(screen.getByTestId("calendar-day-grid")).toBeInTheDocument();
      });
      // Valitse rutiini ensin (esitäyttö).
      fireEvent.change(screen.getByLabelText("Rutiinilinkitys (valinnainen)"), {
        target: { value: ROUTINE_ID },
      });
      expect(screen.getByLabelText("Timeboxin nimi")).toHaveValue("T126-aamulenkki");
      // Sitten valitse tehtävä — rutiinilinkitys tyhjenee, nimi ei enää
      // päivity (käyttäjä on kirjoittanut/aiempi esitäyttö voimassa).
      fireEvent.change(screen.getByLabelText("Tehtävälinkitys (valinnainen)"), {
        target: { value: TASK_ID },
      });
      expect(screen.getByLabelText("Rutiinilinkitys (valinnainen)")).toHaveValue("");
    } finally {
      unmount();
    }
  });
});
