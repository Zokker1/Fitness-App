// T131: unscheduled-valinnan unit-testit (data-paketti).
// Kriteeri: "Ajastamattomat tehtävät voidaan vetää kalenteriin." (§6)
// - Avoin tehtävä ilman elävää blockki-linkkiä → paneelissa;
// - linkitetty (elävä blockki) → pois paneelista (ei duplikaattia);
// - valmistunut / poistettu tehtävä ei näy;
// - poistetun blockin linkki ei pidä tehtävää ajastettuna;
// - järjestys: prioriteetti high→low, sitten createdAt.
import { describe, expect, it } from "vitest";
import type { CalendarBlock, Task } from "@lifeos/domain";
import { selectUnscheduledTasks } from "@lifeos/data";

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

function block(id: string, linkedTaskId: string | null, deleted: boolean): CalendarBlock {
  return {
    id,
    createdAt: "2026-09-18T08:00:00.000Z",
    updatedAt: "2026-09-18T08:00:00.000Z",
    version: 1,
    kind: linkedTaskId === null ? "event" : "task",
    title: id,
    startsAt: "2026-09-18T07:00:00.000Z",
    endsAt: "2026-09-18T08:00:00.000Z",
    linkedTaskId,
    linkedRoutineId: null,
    deletedAt: deleted ? "2026-09-18T09:00:00.000Z" : null,
  };
}

describe("selectUnscheduledTasks (T131)", () => {
  it("avoin linkittämätön tehtävä näkyy; linkitetty ei", () => {
    const tasks = [task("a"), task("b")];
    const blocks = [block("block-1", "a", false)];
    const result = selectUnscheduledTasks({ tasks, blocks });
    expect(result.map((entry) => entry.id)).toEqual(["b"]);
  });

  it("valmistunut ja poistettu tehtävä eivät näy", () => {
    const tasks = [
      task("done-task", { status: "done", completedAt: "2026-09-18T10:00:00.000Z" }),
      task("deleted-task", { deletedAt: "2026-09-18T10:00:00.000Z" }),
      task("open-task"),
    ];
    const result = selectUnscheduledTasks({ tasks, blocks: [] });
    expect(result.map((entry) => entry.id)).toEqual(["open-task"]);
  });

  it("poistetun blockin linkki ei pidä tehtävää ajastettuna", () => {
    const tasks = [task("a")];
    const blocks = [block("block-1", "a", true)];
    const result = selectUnscheduledTasks({ tasks, blocks });
    expect(result.map((entry) => entry.id)).toEqual(["a"]);
  });

  it("järjestys: prioriteetti high→low, sitten createdAt", () => {
    const tasks = [
      task("low", { priority: "low", createdAt: "2026-09-18T07:00:00.000Z" }),
      task("high-late", { priority: "high", createdAt: "2026-09-18T09:00:00.000Z" }),
      task("high-early", { priority: "high", createdAt: "2026-09-18T08:00:00.000Z" }),
      task("normal", { priority: "normal", createdAt: "2026-09-18T06:00:00.000Z" }),
    ];
    const result = selectUnscheduledTasks({ tasks, blocks: [] });
    expect(result.map((entry) => entry.id)).toEqual(["high-early", "high-late", "normal", "low"]);
  });
});
