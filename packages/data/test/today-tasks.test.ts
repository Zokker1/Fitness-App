// T083: summarizeTodayTasks unit-testit (data-paketti, ei IO:ta).
// - Myöhässä ensin, sitten tänään erääntyvät; katkaisu maxVisibleen ja
//   piilotettujen laskuri; progress valmiit/(kaikki) tai null tyhjällä.
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import { summarizeTodayTasks } from "@lifeos/data";
import type { TodayTaskView } from "@lifeos/data";

const AT = "2026-09-18T09:00:00.000Z";

function view(id: string, overrides: Partial<Task> = {}): TodayTaskView {
  return {
    task: {
      id,
      createdAt: AT,
      updatedAt: AT,
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
    },
    overdue: false,
    checklistTotal: 0,
    checklistDone: 0,
  };
}

describe("summarizeTodayTasks (T083)", () => {
  it("tyhjä joukko → progress null (ei 0 %-palkkia)", () => {
    const summary = summarizeTodayTasks([], [], [], 5);
    expect(summary.visible).toEqual([]);
    expect(summary.hiddenCount).toBe(0);
    expect(summary.progressPercent).toBeNull();
    expect(summary.openCount).toBe(0);
    expect(summary.doneCount).toBe(0);
  });

  it("myöhässä ensin, sitten dueToday; katkaisu laskuriin", () => {
    const summary = summarizeTodayTasks(
      [view("t-due-1"), view("t-due-2"), view("t-due-3")],
      [view("t-over-1"), view("t-over-2")],
      [view("t-done-1", { status: "done" })],
      3,
    );
    expect(summary.visible.map((row) => row.task.id)).toEqual(["t-over-1", "t-over-2", "t-due-1"]);
    expect(summary.hiddenCount).toBe(2);
    // 1 valmis / 6 yhteensä → 17 %.
    expect(summary.progressPercent).toBe(17);
    expect(summary.openCount).toBe(5);
    expect(summary.doneCount).toBe(1);
  });

  it("kaikki valmiina → 100 % ilman avoinna-laskuria", () => {
    const summary = summarizeTodayTasks([], [], [view("t-a", { status: "done" })], 5);
    expect(summary.progressPercent).toBe(100);
    expect(summary.visible).toEqual([]);
  });
});
