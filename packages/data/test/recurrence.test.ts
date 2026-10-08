// T110: recurring task -sääntöjen unit-testit (data-paketti).
// Kriteeri: päivä/viikko/kuukausi/custom recurrence luo seuraavan instanssin
// deterministisesti.
// - daily every N; weekly weekday-wrap + everyWeeks (epookiviikkoankkuri);
// - monthly clamp (31.1. → 28.2., karkausvuosi 29.2.);
// - custom day/week/month; epävalidit säännöt → null;
// - nextRecurrenceDueAt säilyttää paikallisen kelloajan (offset annettu).
import { describe, expect, it } from "vitest";
import type { Task, TaskRecurrence } from "@lifeos/domain";
import { hasRecurrence, isoWeekday, nextRecurrenceDate, nextRecurrenceDueAt } from "@lifeos/data";

describe("nextRecurrenceDate — daily (T110)", () => {
  it("daily 1: seuraava päivä", () => {
    expect(nextRecurrenceDate({ kind: "daily", everyDays: 1 }, "2026-09-18")).toBe("2026-09-19");
  });

  it("daily 3: hyppää yli kahden päivän", () => {
    expect(nextRecurrenceDate({ kind: "daily", everyDays: 3 }, "2026-09-18")).toBe("2026-09-21");
  });

  it("kuukauden yli: 30.9. + 1 → 1.10.", () => {
    expect(nextRecurrenceDate({ kind: "daily", everyDays: 1 }, "2026-09-30")).toBe("2026-10-01");
  });
});

describe("nextRecurrenceDate — weekly (T110)", () => {
  it("viikonpäiväkääre: pe 18.9. → ma 21.9. (ma,ke,pe)", () => {
    const rule: TaskRecurrence = { kind: "weekly", everyWeeks: 1, weekdays: [1, 3, 5] };
    expect(nextRecurrenceDate(rule, "2026-09-18")).toBe("2026-09-21");
  });

  it("viikonloppu → maanantai (la,su pois listalta)", () => {
    const rule: TaskRecurrence = { kind: "weekly", everyWeeks: 1, weekdays: [1] };
    expect(nextRecurrenceDate(rule, "2026-09-19")).toBe("2026-09-21");
  });

  it("everyWeeks 2: epookiviikkoankkuri deterministinen (ei arvaa)", () => {
    const rule: TaskRecurrence = { kind: "weekly", everyWeeks: 2, weekdays: [1] };
    const first = nextRecurrenceDate(rule, "2026-09-18");
    expect(first).not.toBeNull();
    // Determinismi: sama syöte → sama tulos; tulos on pyydetty viikonpäivä.
    expect(nextRecurrenceDate(rule, "2026-09-18")).toBe(first);
    if (first !== null) {
      expect(isoWeekday(first)).toBe(1);
      const days =
        (Date.parse(`${first}T00:00:00Z`) - Date.parse("2026-09-18T00:00:00Z")) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(1);
      // Ankkurisääntö: kandidaatin epookiviikko jaollinen everyWeeksilla.
      const candidate = first;
      const weekIndex = Math.floor(Date.parse(`${candidate}T00:00:00Z`) / (7 * 86_400_000));
      expect(Math.abs(weekIndex) % 2).toBe(0);
    }
  });

  it("epävalidi: tyhjä weekdays → null", () => {
    expect(nextRecurrenceDate({ kind: "weekly", everyWeeks: 1, weekdays: [] }, "2026-09-18")).toBe(
      null,
    );
  });
});

describe("nextRecurrenceDate — monthly (T110)", () => {
  it("31.1. monthly 1 → 28.2.2026 (clamp, ei karkausvuosi)", () => {
    const rule: TaskRecurrence = { kind: "monthly", everyMonths: 1, dayOfMonth: 31 };
    expect(nextRecurrenceDate(rule, "2026-01-31")).toBe("2026-02-28");
  });

  it("31.1.2024 monthly 1 → 29.2.2024 (karkauskuukausi)", () => {
    const rule: TaskRecurrence = { kind: "monthly", everyMonths: 1, dayOfMonth: 31 };
    expect(nextRecurrenceDate(rule, "2024-01-31")).toBe("2024-02-29");
  });

  it("sama kuukausi jos päivä vielä edessä: 5.9. dayOfMonth 20 → 20.9.", () => {
    const rule: TaskRecurrence = { kind: "monthly", everyMonths: 1, dayOfMonth: 20 };
    expect(nextRecurrenceDate(rule, "2026-09-05")).toBe("2026-09-20");
  });

  it("everyMonths 3: 31.1. → 30.4. (clamp)", () => {
    const rule: TaskRecurrence = { kind: "monthly", everyMonths: 3, dayOfMonth: 31 };
    expect(nextRecurrenceDate(rule, "2026-01-31")).toBe("2026-04-30");
  });
});

describe("nextRecurrenceDate — custom (T110)", () => {
  it("custom 3 päivää", () => {
    expect(nextRecurrenceDate({ kind: "custom", every: 3, unit: "day" }, "2026-09-18")).toBe(
      "2026-09-21",
    );
  });

  it("custom 2 viikkoa", () => {
    expect(nextRecurrenceDate({ kind: "custom", every: 2, unit: "week" }, "2026-09-18")).toBe(
      "2026-10-02",
    );
  });

  it("custom 1 kuukausi clamp", () => {
    expect(nextRecurrenceDate({ kind: "custom", every: 1, unit: "month" }, "2026-01-31")).toBe(
      "2026-02-28",
    );
  });
});

describe("epävalidit säännöt (T110)", () => {
  it("every < 1 → null kaikissa lajeissa", () => {
    expect(nextRecurrenceDate({ kind: "daily", everyDays: 0 }, "2026-09-18")).toBeNull();
    expect(nextRecurrenceDate({ kind: "weekly", everyWeeks: 0, weekdays: [1] }, "2026-09-18")).toBe(
      null,
    );
    expect(
      nextRecurrenceDate({ kind: "monthly", everyMonths: 0, dayOfMonth: 5 }, "2026-09-18"),
    ).toBe(null);
    expect(nextRecurrenceDate({ kind: "custom", every: 0, unit: "day" }, "2026-09-18")).toBeNull();
  });

  it("dayOfMonth 0 tai 32 → null", () => {
    expect(
      nextRecurrenceDate({ kind: "monthly", everyMonths: 1, dayOfMonth: 0 }, "2026-09-18"),
    ).toBe(null);
    expect(
      nextRecurrenceDate({ kind: "monthly", everyMonths: 1, dayOfMonth: 32 }, "2026-09-18"),
    ).toBeNull();
  });
});

describe("nextRecurrenceDueAt (T110)", () => {
  it("säilyttää paikallisen kelloajan: pe 18.9. 14:30 (+180) → la 19.9. 14:30", () => {
    // 2026-09-18T11:30Z = 14:30 paikallista (+180); daily 1 → 19.9. klo 14:30
    // = 11:30Z.
    const dueAt = nextRecurrenceDueAt(
      { kind: "daily", everyDays: 1 },
      "2026-09-18T11:30:00.000Z",
      180,
    );
    expect(dueAt).toBe("2026-09-19T11:30:00.000Z");
  });

  it("ei deadlinea → seuraavalla ei deadlinea (deterministinen)", () => {
    expect(nextRecurrenceDueAt({ kind: "daily", everyDays: 1 }, null, 180)).toBeNull();
  });
});

describe("hasRecurrence (T110)", () => {
  function task(recurrence?: Task["recurrence"]): Task {
    const base: Task = {
      id: "t1",
      createdAt: "2026-09-10T08:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      version: 1,
      title: "t",
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
    // exactOptionalPropertyTypes: undefined ei kirjoiteta kenttään.
    return recurrence === undefined ? base : { ...base, recurrence };
  }

  it("sääntö → true; null ja puuttuva kenttä → false (vanha data)", () => {
    expect(hasRecurrence(task({ kind: "daily", everyDays: 1 }))).toBe(true);
    expect(hasRecurrence(task(null))).toBe(false);
    expect(hasRecurrence(task())).toBe(false);
  });
});
