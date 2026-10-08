// T141: määräaikaisen tavoitteen progress käyttää kalenteripäiviä, ei tunteja.
import { describe, expect, it } from "vitest";
import type { Goal, GoalDay } from "@lifeos/domain";
import { summarizeGoalProgress } from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "14 päivän tavoite",
    description: null,
    activeFrom: "2026-09-10",
    activeUntil: "2026-09-23",
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function day(localDate: string, completed: boolean, goalId = "goal-1"): GoalDay {
  return {
    id: `day-${localDate}`,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    goalId,
    localDate,
    completed,
  };
}

describe("summarizeGoalProgress (T141)", () => {
  it("laskee määräajan inclusive-päivät ja jättää tulevat päivät pois", () => {
    const result = summarizeGoalProgress({
      goal: goal(),
      todayKey: "2026-09-15",
      goalDays: [
        day("2026-09-10", true),
        day("2026-09-12", true),
        day("2026-09-15", true),
        day("2026-09-20", true),
        day("2026-09-12", false, "other-goal"),
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        goalId: "goal-1",
        startDate: "2026-09-10",
        endDate: "2026-09-23",
        todayKey: "2026-09-15",
        totalDays: 14,
        elapsedDays: 6,
        remainingDays: 8,
        completedDays: 3,
        progressRatio: 3 / 14,
        elapsedCompletionRatio: 3 / 6,
      },
    });
  });

  it("deduplikoi päivätilat ja käsittelee DST-kauden tavallisina päivinä", () => {
    const result = summarizeGoalProgress({
      goal: goal({ activeFrom: "2026-03-22", activeUntil: "2026-03-30" }),
      todayKey: "2026-03-30",
      goalDays: [day("2026-03-29", true), day("2026-03-29", true)],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalDays).toBe(9);
      expect(result.value.completedDays).toBe(1);
      expect(result.value.elapsedDays).toBe(9);
    }
  });

  it("vaatii määräaikaisen, kelvollisen tavoitteen", () => {
    expect(
      summarizeGoalProgress({
        goal: goal({ activeUntil: null }),
        goalDays: [],
        todayKey: "2026-09-15",
      }).ok,
    ).toBe(false);
    expect(
      summarizeGoalProgress({
        goal: goal({ activeFrom: "2026-09-20", activeUntil: "2026-09-10" }),
        goalDays: [],
        todayKey: "2026-09-15",
      }).ok,
    ).toBe(false);
  });
});
