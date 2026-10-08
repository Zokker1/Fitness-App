// T102: groupTasksForToday unit-testit (data-paketti, ei IO:ta).
// Kriteeri: due/scheduled/today-tehtävät ryhmitellään ymmärrettävästi (§5):
// - overdue: vanhin ensin (dueAt nouseva), dueToday: prioriteetti sitten
//   dueAt, scheduled: lähin ensin, completedToday: uusin ensin;
// - aikavyöhykeraja: 21:00 UTC +180 = paikallinen seuraava päivä (ei overdue);
// - valmiit tänään ei sekoitu avoimiin; poistetut eivät näy missään.
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import { groupTasksForToday } from "@lifeos/data";

const NOW = "2026-09-18T09:00:00.000Z";
const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: `2026-09-${String(10 + (id.length % 8)).padStart(2, "0")}T08:00:00.000Z`,
    updatedAt: AT_FALLBACK,
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

const AT_FALLBACK = "1970-01-01T00:00:00.000Z";

describe("groupTasksForToday (T102)", () => {
  it("ryhmittelee: overdue vanhin ensin, dueToday prioriteetilla, scheduled lähin ensin", () => {
    const result = groupTasksForToday({
      tasks: [
        task("t-sched-far", { dueAt: "2026-09-25T15:00:00.000Z" }),
        task("t-sched-near", { dueAt: "2026-09-20T15:00:00.000Z" }),
        task("t-due-normal", { dueAt: "2026-09-18T15:00:00.000Z" }),
        task("t-due-high", { dueAt: "2026-09-18T16:00:00.000Z", priority: "high" }),
        task("t-over-1", { dueAt: "2026-09-15T10:00:00.000Z" }),
        task("t-over-2", { dueAt: "2026-09-14T10:00:00.000Z" }),
      ],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
      now: NOW,
    });
    expect(result.overdue.map((row) => row.id)).toEqual(["t-over-2", "t-over-1"]);
    expect(result.dueToday.map((row) => row.id)).toEqual(["t-due-high", "t-due-normal"]);
    expect(result.scheduled.map((row) => row.id)).toEqual(["t-sched-near", "t-sched-far"]);
    expect(result.completedToday).toEqual([]);
  });

  it("completed tänään: uusin ensin, ei sekoitu avoimiin", () => {
    const result = groupTasksForToday({
      tasks: [
        task("t-done-1", {
          status: "done",
          completedAt: "2026-09-18T07:00:00.000Z",
        }),
        task("t-done-2", {
          status: "done",
          completedAt: "2026-09-18T09:00:00.000Z",
        }),
        task("t-open", {}),
      ],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
      now: NOW,
    });
    expect(result.completedToday.map((row) => row.id)).toEqual(["t-done-2", "t-done-1"]);
    expect(result.dueToday).toEqual([]);
    expect(result.overdue).toEqual([]);
  });

  it("aikavyöhykeraja: 21:00 UTC +180 kuuluu paikalliseen päivään (dueToday, ei overdue)", () => {
    // 17.9. klo 21 UTC = 18.9. klo 00:00 paikallista → dueToday.
    // (dun 17.9. paikallisena OLISI overdue, mutta tämä hetki on jo 18.9.)
    const result = groupTasksForToday({
      tasks: [task("t-late", { dueAt: "2026-09-17T21:00:00.000Z" })],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
      now: NOW,
    });
    expect(result.overdue).toEqual([]);
    expect(result.dueToday.map((row) => row.id)).toEqual(["t-late"]);
  });

  it("poistetut eivät näy missään ryhmässä", () => {
    const result = groupTasksForToday({
      tasks: [
        task("t-del", { deletedAt: "2026-09-18T08:00:00.000Z", dueAt: "2026-09-18T12:00:00.000Z" }),
        task("t-del-done", {
          status: "done",
          deletedAt: "2026-09-18T08:00:00.000Z",
          completedAt: "2026-09-18T07:00:00.000Z",
        }),
      ],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
      now: NOW,
    });
    expect(result.overdue).toEqual([]);
    expect(result.dueToday).toEqual([]);
    expect(result.scheduled).toEqual([]);
    expect(result.completedToday).toEqual([]);
  });

  it("dueAt null → ei ryhmissä (ei deadlinea, ei arvailua)", () => {
    const result = groupTasksForToday({
      tasks: [task("t-nodue")],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
      now: NOW,
    });
    expect(result.overdue).toEqual([]);
    expect(result.dueToday).toEqual([]);
    expect(result.scheduled).toEqual([]);
    expect(result.completedToday).toEqual([]);
  });
});
