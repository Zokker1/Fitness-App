// T143: viikkofrekvenssi toimii maanantain ja sunnuntain yli.
import { describe, expect, it } from "vitest";
import type { Goal, HabitRule } from "@lifeos/domain";
import { evaluateWeeklyFrequencyGoal, weekStartLocalDate } from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";
const goal: Goal = {
  id: "goal-weekly",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  title: "Viikkotavoite",
  description: null,
  activeFrom: "2026-09-01",
  activeUntil: "2026-10-31",
  archivedAt: null,
  deletedAt: null,
};
const rule: HabitRule = {
  id: "rule-weekly",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  goalId: goal.id,
  title: "Kolme kertaa viikossa",
  cadence: "weekly",
  targetPerPeriod: 3,
  deletedAt: null,
};

describe("weekly frequency goal (T143)", () => {
  it("ankkuroi viikon maanantaihin myös sunnuntaina", () => {
    expect(weekStartLocalDate("2026-09-20")).toBe("2026-09-14");
    expect(weekStartLocalDate("2026-09-21")).toBe("2026-09-21");
  });

  it("ei sekoita sunnuntaita seuraavan viikon maanantaihin", () => {
    const previousWeek = evaluateWeeklyFrequencyGoal({
      goal,
      rule,
      weekContaining: "2026-09-20",
      todayKey: "2026-09-21",
      observations: [
        { localDate: "2026-09-14" },
        { localDate: "2026-09-20" },
        { localDate: "2026-09-21" },
      ],
    });
    expect(previousWeek.ok).toBe(true);
    if (previousWeek.ok) {
      expect(previousWeek.value.weekStart).toBe("2026-09-14");
      expect(previousWeek.value.weekEnd).toBe("2026-09-20");
      expect(previousWeek.value.observed).toBe(2);
      expect(previousWeek.value.completed).toBe(false);
    }
    const currentWeek = evaluateWeeklyFrequencyGoal({
      goal,
      rule,
      weekContaining: "2026-09-21",
      todayKey: "2026-09-21",
      observations: [
        { localDate: "2026-09-20" },
        { localDate: "2026-09-21" },
        { localDate: "2026-09-22" },
      ],
    });
    expect(currentWeek.ok).toBe(true);
    if (currentWeek.ok) {
      expect(currentWeek.value.observed).toBe(1);
      expect(currentWeek.value.remainingOccurrences).toBe(2);
    }
  });

  it("sallii nykyviikon täyttymisen mutta ei tulevan viikon automaattista onnistumista", () => {
    const current = evaluateWeeklyFrequencyGoal({
      goal,
      rule,
      weekContaining: "2026-09-21",
      todayKey: "2026-09-23",
      observations: [
        { localDate: "2026-09-21" },
        { localDate: "2026-09-22" },
        { localDate: "2026-09-23" },
        { localDate: "2026-09-30" },
      ],
    });
    expect(current.ok && current.value.completed).toBe(true);
    const future = evaluateWeeklyFrequencyGoal({
      goal,
      rule,
      weekContaining: "2026-09-28",
      todayKey: "2026-09-23",
      observations: [
        { localDate: "2026-09-28" },
        { localDate: "2026-09-29" },
        { localDate: "2026-09-30" },
      ],
    });
    expect(future.ok).toBe(true);
    if (future.ok) {
      expect(future.value.futureWeek).toBe(true);
      expect(future.value.observed).toBe(0);
      expect(future.value.completed).toBe(false);
    }
  });

  it("rajaa osittaisen aktiivisuusalueen päivät ja hylkää väärän rytmin", () => {
    const partial = evaluateWeeklyFrequencyGoal({
      goal: { ...goal, activeUntil: "2026-09-16" },
      rule,
      weekContaining: "2026-09-14",
      todayKey: "2026-09-16",
      observations: [{ localDate: "2026-09-16" }, { localDate: "2026-09-17" }],
    });
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.value.observed).toBe(1);
    }
    expect(
      evaluateWeeklyFrequencyGoal({
        goal,
        rule: { ...rule, cadence: "daily" },
        weekContaining: "2026-09-21",
        todayKey: "2026-09-21",
        observations: [],
      }).ok,
    ).toBe(false);
  });
});
