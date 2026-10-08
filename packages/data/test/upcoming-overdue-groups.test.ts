// T103: groupTasksUpcoming unit-testit (data-paketti, ei IO:ta).
// Kriteeri: upcoming ja overdue eivät sekoita valmistuneita tehtäviä.
// - overdue: vanhin dueAt ensin; upcoming: lähin päivä ensin, sitten
//   prioriteetti; dueAt null viimeisenä;
// - done/deleted eivät näy kummassakaan ryhmässä;
// - aikavyöhykeraja: 21:00 UTC +180 on paikallista seuraavaa päivää
//   (eli upcoming, ei overdue).
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import { groupTasksUpcoming } from "@lifeos/data";

const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: `2026-09-${String(10 + (id.length % 8)).padStart(2, "0")}T08:00:00.000Z`,
    updatedAt: "1970-01-01T00:00:00.000Z",
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

describe("groupTasksUpcoming (T103)", () => {
  it("overdue vanhin ensin; upcoming lähin päivä sitten prioriteetti", () => {
    const result = groupTasksUpcoming({
      tasks: [
        task("t-up-far", { dueAt: "2026-09-25T15:00:00.000Z" }),
        task("t-up-near", { dueAt: "2026-09-20T15:00:00.000Z" }),
        task("t-up-low", { dueAt: "2026-09-18T10:00:00.000Z", priority: "low" }),
        task("t-up-high", { dueAt: "2026-09-18T16:00:00.000Z", priority: "high" }),
        task("t-nodue-low", { priority: "low" }),
        task("t-nodue-high", { priority: "high" }),
        task("t-over-1", { dueAt: "2026-09-15T10:00:00.000Z" }),
        task("t-over-2", { dueAt: "2026-09-14T10:00:00.000Z" }),
      ],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.overdue.map((row) => row.id)).toEqual(["t-over-2", "t-over-1"]);
    // Saman päivän sisällä prioriteetti ensin (high ennen low), sitten muut:
    // 18.9. high → 18.9. low → 20.9. → 25.9. → ilman deadlinea prioriteetilla.
    expect(result.upcoming.map((row) => row.id)).toEqual([
      "t-up-high",
      "t-up-low",
      "t-up-near",
      "t-up-far",
      "t-nodue-high",
      "t-nodue-low",
    ]);
  });

  it("valmistuneet eivät sekoitu kumpaankaan ryhmään; tombstonet poissa", () => {
    const result = groupTasksUpcoming({
      tasks: [
        task("t-done", {
          status: "done",
          dueAt: "2026-09-18T10:00:00.000Z",
          completedAt: "2026-09-18T11:00:00.000Z",
        }),
        task("t-del", { deletedAt: "2026-09-18T08:00:00.000Z", dueAt: "2026-09-18T12:00:00.000Z" }),
        task("t-open", { dueAt: "2026-09-18T12:00:00.000Z" }),
      ],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.overdue).toEqual([]);
    expect(result.upcoming.map((row) => row.id)).toEqual(["t-open"]);
  });

  it("aikavyöhykeraja: 21:00 UTC +180 on paikallista seuraavaa päivää (upcoming)", () => {
    const result = groupTasksUpcoming({
      tasks: [task("t-late", { dueAt: "2026-09-17T21:00:00.000Z" })],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    // 17.9. klo 21 UTC = 18.9. klo 00:00 paikallista → upcoming-päivä.
    expect(result.overdue).toEqual([]);
    expect(result.upcoming.map((row) => row.id)).toEqual(["t-late"]);
  });
});
