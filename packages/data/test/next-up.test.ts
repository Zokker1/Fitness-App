// T082: selectNextUp unit-testit (data-paketti, ei IO:ta). Kriteeri:
// valinta on selitettävä (reason aina mukana) eikä peitä käyttäjän omia
// valintoja (se on EHDOTUS, UI ei auto-suorita). Järjestys: myöhässä →
// käynnissä oleva timebox → tänään erääntyvä → tuleva timebox → avoin.
// Tyhjä joukko → null (UI näyttää tyhjätilan).
import { describe, expect, it } from "vitest";
import type { CalendarBlock, Task } from "@lifeos/domain";
import { selectNextUp, type NextUpInput } from "@lifeos/data";

const NOW = "2026-09-18T09:00:00.000Z";
const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;
const AT = NOW;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Tehtävä",
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

function block(overrides: Partial<CalendarBlock> = {}): CalendarBlock {
  return {
    id: "b-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    kind: "task",
    title: "Blokki",
    startsAt: "2026-09-18T08:00:00.000Z",
    endsAt: "2026-09-18T10:00:00.000Z",
    linkedTaskId: null,
    linkedRoutineId: null,
    deletedAt: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<NextUpInput> = {}): NextUpInput {
  return {
    now: NOW,
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    tasks: [],
    timeboxes: [],
    ...overrides,
  };
}

describe("selectNextUp (T082)", () => {
  it("tyhjä joukko → null (ei keksittyä ehdotusta)", () => {
    expect(selectNextUp(baseInput())).toBeNull();
    // Valmiit ja poistetut eivät kelpaa.
    expect(
      selectNextUp(
        baseInput({
          tasks: [
            task({ id: "t-done", status: "done", completedAt: NOW }),
            task({ id: "t-deleted", deletedAt: AT }),
          ],
        }),
      ),
    ).toBeNull();
  });

  it("myöhässä oleva voittaa; vanhin ensin + syy mukana", () => {
    const result = selectNextUp(
      baseInput({
        tasks: [
          task({ id: "t-due", dueAt: "2026-09-18T15:00:00.000Z", priority: "high" }),
          task({ id: "t-old", dueAt: "2026-09-16T10:00:00.000Z", priority: "low" }),
          task({ id: "t-older", dueAt: "2026-09-15T10:00:00.000Z", priority: "normal" }),
        ],
      }),
    );
    expect(result?.kind).toBe("overdue-task");
    // Huom: 16.9. klo 10 UTC = 13:00 paikallista → paikallispäivä 16.9 (< 18.9).
    expect(result?.taskId).toBe("t-older");
    expect(result?.reason).toContain("Myöhässä 2");
  });

  it("käynnissä oleva timebox voittaa tänään erääntyvän", () => {
    const result = selectNextUp(
      baseInput({
        tasks: [task({ id: "t-due", dueAt: "2026-09-18T15:00:00.000Z" })],
        timeboxes: [block({ id: "b-now" })],
      }),
    );
    expect(result?.kind).toBe("timebox-now");
    expect(result?.timeboxId).toBe("b-now");
  });

  it("tänään erääntyvä: tärkein ensin, lukumäärä syyssä", () => {
    const result = selectNextUp(
      baseInput({
        tasks: [
          task({ id: "t-normal", priority: "normal", dueAt: "2026-09-18T15:00:00.000Z" }),
          task({ id: "t-high", priority: "high", dueAt: "2026-09-18T16:00:00.000Z" }),
        ],
      }),
    );
    expect(result?.kind).toBe("due-task");
    expect(result?.taskId).toBe("t-high");
    expect(result?.reason).toContain("Tänään 2");
  });

  it("tuleva timebox ennen deadlineittomia; event-blokit ohitetaan", () => {
    const result = selectNextUp(
      baseInput({
        tasks: [task({ id: "t-open" })],
        timeboxes: [
          block({
            id: "b-event",
            kind: "event",
            startsAt: "2026-09-18T10:00:00.000Z",
            endsAt: "2026-09-18T11:00:00.000Z",
          }),
          block({
            id: "b-next",
            startsAt: "2026-09-18T12:00:00.000Z",
            endsAt: "2026-09-18T13:00:00.000Z",
          }),
        ],
      }),
    );
    expect(result?.kind).toBe("timebox-next");
    expect(result?.timeboxId).toBe("b-next");
  });

  it("deadlineiton avoin kelpaa viimeisenä; menneet timeboxit ohitetaan", () => {
    const result = selectNextUp(
      baseInput({
        tasks: [task({ id: "t-open", priority: "high" })],
        timeboxes: [
          block({
            id: "b-past",
            startsAt: "2026-09-18T06:00:00.000Z",
            endsAt: "2026-09-18T07:00:00.000Z",
          }),
        ],
      }),
    );
    expect(result?.kind).toBe("open-task");
    expect(result?.taskId).toBe("t-open");
    expect(result?.reason).toContain("vapaa valinta");
  });

  it("vyöhykeraja: 21:00 UTC +180 on paikallista seuraavaa päivää (ei overdue)", () => {
    const result = selectNextUp(
      baseInput({ tasks: [task({ id: "t-late", dueAt: "2026-09-17T21:00:00.000Z" })] }),
    );
    // 17.9. klo 21 UTC = 18.9. klo 00:00 paikallista → dueToday, ei overdue.
    expect(result?.kind).toBe("due-task");
    expect(result?.taskId).toBe("t-late");
  });
});
