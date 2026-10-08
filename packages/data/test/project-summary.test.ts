// T107: summarizeProject/summarizeProjects unit-testit (data-paketti).
// Kriteeri: tehtäväryhmällä on progress, status ja historia.
// - Progress: valmiit/kaikki (0 tehtävää → 0 %);
// - Status: archived > complete (kaikki valmiit, ≥1 tehtävä) > active;
// - Historia: uusin completedAt ensin; tombstonet pois; muut projektit pois.
import { describe, expect, it } from "vitest";
import type { Project, Task } from "@lifeos/domain";
import { summarizeProject, summarizeProjects } from "@lifeos/data";

function project(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    version: 1,
    name: id,
    colorKey: null,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function task(id: string, projectId: string | null, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: "2026-09-10T08:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    version: 1,
    title: id,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    ...overrides,
  };
}

describe("summarizeProject (T107)", () => {
  it("tyhjä projekti: 0/0, progress 0 %, status active, ei historiaa", () => {
    const summary = summarizeProject(project("p1"), [task("t1", null)]);
    expect(summary.total).toBe(0);
    expect(summary.progressPercent).toBe(0);
    expect(summary.status).toBe("active");
    expect(summary.history).toEqual([]);
  });

  it("progress lasketaan valmiiden osuutena; status complete kun kaikki valmiit", () => {
    const summary = summarizeProject(project("p1"), [
      task("t1", "p1", { status: "done", completedAt: "2026-09-18T10:00:00.000Z" }),
      task("t2", "p1", { status: "done", completedAt: "2026-09-17T10:00:00.000Z" }),
      task("t3", "p1"),
      task("t4", "p1"),
    ]);
    expect(summary.total).toBe(4);
    expect(summary.doneCount).toBe(2);
    expect(summary.openCount).toBe(2);
    expect(summary.progressPercent).toBe(50);
    expect(summary.status).toBe("active");
  });

  it("kaikki valmiit → status complete + historia uusin ensin", () => {
    const summary = summarizeProject(project("p1"), [
      task("t-vanhempi", "p1", { status: "done", completedAt: "2026-09-16T09:00:00.000Z" }),
      task("t-uudempi", "p1", { status: "done", completedAt: "2026-09-18T11:00:00.000Z" }),
    ]);
    expect(summary.status).toBe("complete");
    expect(summary.progressPercent).toBe(100);
    expect(summary.history.map((entry) => entry.taskId)).toEqual(["t-uudempi", "t-vanhempi"]);
  });

  it("arkistoitu voittaa complete-tilan (archivedAt asetettu)", () => {
    const summary = summarizeProject(project("p1", { archivedAt: "2026-09-19T00:00:00.000Z" }), [
      task("t1", "p1", { status: "done", completedAt: "2026-09-18T10:00:00.000Z" }),
    ]);
    expect(summary.status).toBe("archived");
  });

  it("tombstonetut tehtävät ja muut projektit eivät vaikuta", () => {
    const summary = summarizeProject(project("p1"), [
      task("t1", "p1", { status: "done", completedAt: "2026-09-18T10:00:00.000Z" }),
      task("t-poistettu", "p1", { deletedAt: "2026-09-18T12:00:00.000Z" }),
      task("t-muu", "p2"),
    ]);
    expect(summary.total).toBe(1);
    expect(summary.doneCount).toBe(1);
    expect(summary.status).toBe("complete");
    expect(summary.history.map((entry) => entry.taskId)).toEqual(["t1"]);
  });
});

describe("summarizeProjects (T107)", () => {
  it("palauttaa vain elävät projektit fi-aakkosissa", () => {
    const summaries = summarizeProjects(
      [
        project("p-b"),
        project("p-a"),
        project("p-poistettu", { deletedAt: "2026-09-18T08:00:00.000Z" }),
      ],
      [],
    );
    expect(summaries.map((summary) => summary.name)).toEqual(["p-a", "p-b"]);
  });
});
