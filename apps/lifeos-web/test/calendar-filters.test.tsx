// T136: kalenterisuodattimien UI-kytkentä.
// Yksi valinta rajaa näkyvyyttä, mutta raw blockit säilyvät ja tyhjennys
// palauttaa kaikki näkymään.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { render } from "./renderWithLanguage.tsx";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { InMemoryStore } from "@lifeos/data";
import type { CalendarBlock, Project, Tag, Task } from "@lifeos/domain";
import { DataProvider } from "../src/dataContext.tsx";
import { CalendarDayView } from "../src/views/calendar/CalendarDayView.tsx";

const DATE = "2026-09-21";

function task(id: string, title: string, projectId: string, tagIds: readonly string[]): Task {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    title,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId,
    tagIds,
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
  };
}

function project(id: string, name: string): Project {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    name,
    colorKey: null,
    archivedAt: null,
    deletedAt: null,
  };
}

function tag(id: string, name: string): Tag {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    name,
    colorKey: null,
    deletedAt: null,
  };
}

function block(id: string, title: string, linkedTaskId: string | null): CalendarBlock {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    kind: linkedTaskId === null ? "event" : "task",
    title,
    startsAt: "2026-09-21T08:00:00.000Z",
    endsAt: "2026-09-21T09:00:00.000Z",
    linkedTaskId,
    linkedRoutineId: null,
    deletedAt: null,
  };
}

describe("CalendarDayView filters (T136)", () => {
  it("projektisuodatin rajaa näkymän ja tyhjennys palauttaa kaikki blockit", async () => {
    const calendarBlocks = [
      block("block-a", "Projekti A - tehtävä", "task-a"),
      block("block-b", "Projekti B - tehtävä", "task-b"),
      block("block-event", "Linkittämätön tapahtuma", null),
    ];
    render(
      <MemoryRouter initialEntries={[`/calendar?date=${DATE}`]}>
        <DataProvider
          taskStore={
            new InMemoryStore<Task>("task", [
              task("task-a", "Tehtävä A", "project-a", ["tag-a"]),
              task("task-b", "Tehtävä B", "project-b", ["tag-b"]),
            ])
          }
          projectStore={
            new InMemoryStore<Project>("project", [
              project("project-a", "Projekti A"),
              project("project-b", "Projekti B"),
            ])
          }
          tagStore={new InMemoryStore<Tag>("tag", [tag("tag-a", "Tagi A"), tag("tag-b", "Tagi B")])}
          calendarBlockStore={new InMemoryStore<CalendarBlock>("calendar-block", calendarBlocks)}
        >
          <CalendarDayView />
        </DataProvider>
      </MemoryRouter>,
    );

    const day = await screen.findByTestId("calendar-day-grid");
    expect(day).toHaveTextContent("Tehtävä A");
    expect(day).toHaveTextContent("Tehtävä B");
    expect(day).toHaveTextContent("Linkittämätön tapahtuma");

    fireEvent.change(screen.getByLabelText("Projekti"), { target: { value: "project-a" } });
    await waitFor(() => {
      expect(screen.getByTestId("calendar-filter-summary")).toHaveTextContent("1 / 3");
    });
    expect(day).toHaveTextContent("Tehtävä A");
    expect(day).not.toHaveTextContent("Tehtävä B");
    expect(day).not.toHaveTextContent("Linkittämätön tapahtuma");

    fireEvent.click(screen.getByTestId("calendar-filter-reset"));
    await waitFor(() => {
      expect(screen.getByTestId("calendar-filter-summary")).toHaveTextContent(
        "Kaikki timeboxit näkyvät.",
      );
    });
    expect(within(day).getByText("Tehtävä B")).toBeInTheDocument();
    expect(within(day).getByText("Linkittämätön tapahtuma")).toBeInTheDocument();
  });
});
