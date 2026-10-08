// T096: GlobalSearch unit-testit (web-paketti, happy-dom + muisti-indeksi).
// Kriteeri: haku toimii keyboardilla ja kosketuksella, ryhmittelee tulokset
// tyypeittäin. Todistaa: ohjeteksti tyhjällä, ryhmät + osumat haulla,
// tyhjätila ilman osumia, keyboard-navigointi (ArrowDown/Enter → onSelect),
// kosketusvalinta (click → onSelect).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { buildSearchIndex } from "@lifeos/data";
import type { Task } from "@lifeos/domain";
import { GlobalSearch } from "../src/search/GlobalSearch.tsx";

const AT = "2026-09-18T09:00:00.000Z";

function task(id: string, title: string): Task {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
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

const index = buildSearchIndex({
  tasks: [task("t-1", "Osta maitoa"), task("t-2", "Osta leipää")],
  projects: [],
  tags: [],
  goals: [],
  routines: [],
  routineSteps: [],
  journalEntries: [],
  foods: [],
  recipes: [],
  measurements: [],
});

function renderSearch(onSelect: (kind: string, id: string) => void = () => undefined) {
  return render(
    <GlobalSearch index={index} open={true} onOpenChange={() => undefined} onSelect={onSelect} />,
  );
}

describe("GlobalSearch (T096)", () => {
  it("tyhjä kysely näyttää ohjeen (ei tuloksia, ei vuotoa)", () => {
    const { unmount } = renderSearch();
    try {
      expect(screen.getByTestId("search-hint")).toBeInTheDocument();
      expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
    } finally {
      unmount();
    }
  });

  it("ryhmittelee osumat tyypeittäin otsikoilla", () => {
    const { unmount } = renderSearch();
    try {
      fireEvent.change(screen.getByLabelText("Hakusana"), { target: { value: "osta" } });
      expect(screen.getByTestId("search-results")).toBeInTheDocument();
      expect(screen.getByTestId("search-count")).toHaveTextContent("2 osumaa");
      const group = screen.getByTestId("search-group-task");
      expect(within(group).getByText("Tehtävät")).toBeInTheDocument();
      expect(screen.getByTestId("search-hit-task-t-1")).toHaveTextContent("Osta maitoa");
      expect(screen.getByTestId("search-hit-task-t-2")).toHaveTextContent("Osta leipää");
    } finally {
      unmount();
    }
  });

  it("ei osumia → rehellinen tyhjätila kyselyllä", () => {
    const { unmount } = renderSearch();
    try {
      fireEvent.change(screen.getByLabelText("Hakusana"), { target: { value: "avaruusraketti" } });
      expect(screen.getByTestId("search-empty")).toHaveTextContent("Ei osumia");
      expect(screen.queryByTestId("search-results")).not.toBeInTheDocument();
    } finally {
      unmount();
    }
  });

  it("keyboard: ArrowDown + Enter valitsee toisen osuman", () => {
    const onSelect = vi.fn();
    const { unmount } = renderSearch(onSelect);
    try {
      const input = screen.getByLabelText("Hakusana");
      fireEvent.change(input, { target: { value: "osta" } });
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith("task", "t-2");
    } finally {
      unmount();
    }
  });

  it("kosketus: click rivillä kutsuu onSelectin (kind+id)", () => {
    const onSelect = vi.fn();
    const { unmount } = renderSearch(onSelect);
    try {
      fireEvent.change(screen.getByLabelText("Hakusana"), { target: { value: "maitoa" } });
      fireEvent.click(screen.getByTestId("search-hit-task-t-1"));
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect).toHaveBeenCalledWith("task", "t-1");
    } finally {
      unmount();
    }
  });
});
