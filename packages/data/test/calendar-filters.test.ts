// T136: kalenterisuodattimien pure unit-testit.
// Suodatus kohdistuu johdettuun näkyvyyteen; calendar blockien lähdedata ja
// linkitykset eivät muutu.
import { describe, expect, it } from "vitest";
import type { CalendarBlock, Task } from "@lifeos/domain";
import { filterCalendarBlocks, hasCalendarBlockFilters } from "@lifeos/data";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    title: id,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    ...overrides,
  };
}

function block(id: string, overrides: Partial<CalendarBlock> = {}): CalendarBlock {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    kind: "event",
    title: id,
    startsAt: "2026-09-18T07:00:00.000Z",
    endsAt: "2026-09-18T08:00:00.000Z",
    linkedTaskId: null,
    linkedRoutineId: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("filterCalendarBlocks (T136)", () => {
  it("ilman suodattimia säilyttää kaikki blockit ja alkuperäisen järjestyksen", () => {
    const blocks = [block("event"), block("task-block", { linkedTaskId: "task-1" })];
    const result = filterCalendarBlocks({ blocks, tasks: [task("task-1")] });

    expect(result.map((entry) => entry.id)).toEqual(["event", "task-block"]);
    expect(result).not.toBe(blocks);
    expect(blocks[0]?.linkedTaskId).toBeNull();
  });

  it("projektisuodatin käyttää linkitetyn tehtävän projektia", () => {
    const blocks = [
      block("project-a", { linkedTaskId: "task-a" }),
      block("project-b", { linkedTaskId: "task-b" }),
      block("event"),
    ];
    const result = filterCalendarBlocks({
      blocks,
      tasks: [
        task("task-a", { projectId: "project-a" }),
        task("task-b", { projectId: "project-b" }),
      ],
      filters: { projectId: "project-a" },
    });

    expect(result.map((entry) => entry.id)).toEqual(["project-a"]);
  });

  it("tagisuodatin hyväksyy tagin sisältävän tehtävän ja hylkää tapahtuman", () => {
    const blocks = [
      block("tagged", { linkedTaskId: "task-tagged" }),
      block("untagged", { linkedTaskId: "task-untagged" }),
      block("event"),
    ];
    const result = filterCalendarBlocks({
      blocks,
      tasks: [task("task-tagged", { tagIds: ["tag-a", "tag-b"] }), task("task-untagged")],
      filters: { tagId: "tag-b" },
    });

    expect(result.map((entry) => entry.id)).toEqual(["tagged"]);
  });

  it("rutiinisuodatin käyttää rutiinilinkkiä", () => {
    const blocks = [
      block("routine-a", { kind: "routine", linkedRoutineId: "routine-a" }),
      block("routine-b", { kind: "routine", linkedRoutineId: "routine-b" }),
      block("event"),
    ];
    const result = filterCalendarBlocks({
      blocks,
      tasks: [],
      filters: { routineId: "routine-a" },
    });

    expect(result.map((entry) => entry.id)).toEqual(["routine-a"]);
  });

  it("useampi suodatin on AND-rajaus, eikä linkitysten puuttuminen vuoda mukaan", () => {
    const blocks = [
      block("match", { linkedTaskId: "match-task" }),
      block("wrong-tag", { linkedTaskId: "wrong-tag-task" }),
      block("missing-task", { linkedTaskId: "missing-task" }),
    ];
    const result = filterCalendarBlocks({
      blocks,
      tasks: [
        task("match-task", { projectId: "project-a", tagIds: ["tag-a"] }),
        task("wrong-tag-task", { projectId: "project-a", tagIds: ["tag-b"] }),
      ],
      filters: { projectId: "project-a", tagId: "tag-a" },
    });

    expect(result.map((entry) => entry.id)).toEqual(["match"]);
  });

  it("tyhjä arvo ei ole aktiivinen suodatin", () => {
    expect(hasCalendarBlockFilters({ projectId: "", tagId: null })).toBe(false);
    expect(hasCalendarBlockFilters({ tagId: "tag-a" })).toBe(true);
  });
});
