// T149: rutiinin sisältö, aikataulu ja suoritusrajojen puhtaat säännöt.
import { describe, expect, it } from "vitest";
import {
  isRoutineScheduledOnLocalDate,
  validateRoutineScheduleValues,
  validateRoutineStepValues,
  validateRoutineValues,
} from "../src/index.ts";

describe("Routine domain (T149)", () => {
  it("normalisoi rutiinin ja askeleen otsikot", () => {
    expect(validateRoutineValues({ title: "  Aamun alku  " })).toEqual({
      ok: true,
      value: { title: "Aamun alku" },
    });
    expect(
      validateRoutineStepValues({ routineId: "routine-1", title: "  Vettä  ", sortOrder: 2 }),
    ).toEqual({
      ok: true,
      value: { routineId: "routine-1", title: "Vettä", sortOrder: 2, optional: false },
    });
    expect(
      validateRoutineStepValues({
        routineId: "routine-1",
        title: " Hengitä ",
        sortOrder: 3,
        optional: true,
      }),
    ).toEqual({
      ok: true,
      value: { routineId: "routine-1", title: "Hengitä", sortOrder: 3, optional: true },
    });
  });

  it("hylkää virheellisen järjestyksen ja aikataulun", () => {
    expect(validateRoutineValues({ title: "   " }).ok).toBe(false);
    expect(
      validateRoutineStepValues({ routineId: "routine-1", title: "Askel", sortOrder: -1 }).ok,
    ).toBe(false);
    expect(
      validateRoutineScheduleValues({
        routineId: "routine-1",
        cadence: "weekly",
        weekdays: [1, 1],
      }).ok,
    ).toBe(false);
    expect(
      validateRoutineScheduleValues({
        routineId: "routine-1",
        cadence: "daily",
        weekdays: [1],
      }).ok,
    ).toBe(false);
    expect(
      validateRoutineScheduleValues({
        routineId: "routine-1",
        cadence: "daily",
        weekdays: [],
        localTime: "25:00",
      }).ok,
    ).toBe(false);
  });

  it("laskee daily- ja weekly-aikataulun paikallisesta päiväavaimesta", () => {
    const daily = { cadence: "daily" as const, weekdays: [], enabled: true };
    const weekdays = { cadence: "weekly" as const, weekdays: [1, 3, 5], enabled: true };
    expect(isRoutineScheduledOnLocalDate(daily, "2026-09-21")).toBe(true);
    expect(isRoutineScheduledOnLocalDate(weekdays, "2026-09-21")).toBe(true); // maanantai
    expect(isRoutineScheduledOnLocalDate(weekdays, "2026-09-22")).toBe(false); // tiistai
    expect(isRoutineScheduledOnLocalDate({ ...daily, enabled: false }, "2026-09-21")).toBe(false);
    expect(isRoutineScheduledOnLocalDate(daily, "2026-02-30")).toBe(false);
  });
});
