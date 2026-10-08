// T140: Goal- ja HabitRule-validointi kuuluu domainiin, ei UI:hin.
import { describe, expect, it } from "vitest";
import {
  isGoalActiveOnLocalDate,
  isValidLocalDateKey,
  validateGoalValues,
  validateHabitRuleValues,
} from "../src/index.ts";

const AT = "2026-09-21T12:00:00.000Z";

describe("Goal domain (T140)", () => {
  it("trimmaa otsikon ja hyväksyy inclusive-aktiivisuusalueen", () => {
    const result = validateGoalValues({
      title: "  Syyskuu  ",
      description: "Lyhyt kuvaus",
      activeFrom: "2026-09-01",
      activeUntil: "2026-09-30",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        title: "Syyskuu",
        description: "Lyhyt kuvaus",
        activeFrom: "2026-09-01",
        activeUntil: "2026-09-30",
      },
    });
  });

  it("hylkää tyhjän otsikon, virheellisen päivän ja käänteisen alueen", () => {
    expect(validateGoalValues({ title: "   " }).ok).toBe(false);
    expect(validateGoalValues({ title: "Tavoite", activeFrom: "2026-02-30" }).ok).toBe(false);
    expect(
      validateGoalValues({
        title: "Tavoite",
        activeFrom: "2026-09-30",
        activeUntil: "2026-09-01",
      }).ok,
    ).toBe(false);
  });

  it("aktiivisuus kunnioittaa pehmeää poistoa, arkistointia ja inclusive-päiviä", () => {
    const goal = {
      deletedAt: null,
      archivedAt: null,
      activeFrom: "2026-09-10",
      activeUntil: "2026-09-20",
    };
    expect(isGoalActiveOnLocalDate(goal, "2026-09-10")).toBe(true);
    expect(isGoalActiveOnLocalDate(goal, "2026-09-20")).toBe(true);
    expect(isGoalActiveOnLocalDate(goal, "2026-09-21")).toBe(false);
    expect(isGoalActiveOnLocalDate({ ...goal, archivedAt: AT }, "2026-09-15")).toBe(false);
    expect(isGoalActiveOnLocalDate({ ...goal, deletedAt: AT }, "2026-09-15")).toBe(false);
  });

  it("tunnistaa vain oikeat paikalliset päivät", () => {
    expect(isValidLocalDateKey("2024-02-29")).toBe(true);
    expect(isValidLocalDateKey("2026-02-29")).toBe(false);
    expect(isValidLocalDateKey("2026-9-1")).toBe(false);
  });
});

describe("HabitRule domain (T140)", () => {
  it("hyväksyy cadencen ja normalisoi otsikon", () => {
    const result = validateHabitRuleValues({
      goalId: "goal-1",
      title: "  Kävely  ",
      cadence: "weekly",
      targetPerPeriod: 3,
    });
    expect(result).toEqual({
      ok: true,
      value: { goalId: "goal-1", title: "Kävely", cadence: "weekly", targetPerPeriod: 3 },
    });
  });

  it("hylkää tuntemattoman rytmin ja epäkelvon tavoitemäärän", () => {
    expect(
      validateHabitRuleValues({ title: "Tapa", cadence: "monthly", targetPerPeriod: 1 }).ok,
    ).toBe(false);
    expect(
      validateHabitRuleValues({ title: "Tapa", cadence: "daily", targetPerPeriod: 0 }).ok,
    ).toBe(false);
    expect(
      validateHabitRuleValues({ title: "Tapa", cadence: "daily", targetPerPeriod: 1.5 }).ok,
    ).toBe(false);
  });
});
