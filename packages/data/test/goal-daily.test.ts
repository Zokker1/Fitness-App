// T142: daily-määrätavoite täyttyy tapahtuma- tai mittaussummasta.
import { describe, expect, it } from "vitest";
import type { Goal, HabitRule } from "@lifeos/domain";
import { evaluateDailyQuantityGoal } from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";

const goal: Goal = {
  id: "goal-1",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  title: "Päivän tavoite",
  description: null,
  activeFrom: "2026-09-01",
  activeUntil: "2026-09-30",
  archivedAt: null,
  deletedAt: null,
};

const dailyRule: HabitRule = {
  id: "rule-1",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  goalId: "goal-1",
  title: "Toistot",
  cadence: "daily",
  targetPerPeriod: 3,
  deletedAt: null,
};

describe("evaluateDailyQuantityGoal (T142)", () => {
  it("täyttää tapahtumamäärän vasta tavoitteen kohdalla", () => {
    const result = evaluateDailyQuantityGoal({
      goal,
      rule: dailyRule,
      localDate: "2026-09-21",
      todayKey: "2026-09-21",
      source: "event-count",
      observations: [
        { localDate: "2026-09-21" },
        { localDate: "2026-09-21" },
        { localDate: "2026-09-20" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.observed).toBe(2);
      expect(result.value.completed).toBe(false);
      expect(result.value.completionRatio).toBeCloseTo(2 / 3);
    }
  });

  it("summaa measurement/event-arvot ja katkaisee ration yhdestä", () => {
    const result = evaluateDailyQuantityGoal({
      goal,
      rule: { ...dailyRule, targetPerPeriod: 2500 },
      localDate: "2026-09-21",
      todayKey: "2026-09-21",
      source: "measurement-sum",
      observations: [
        { localDate: "2026-09-21", amount: 1000 },
        { localDate: "2026-09-21", amount: 1500 },
        { localDate: "2026-09-20", amount: 5000 },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.observed).toBe(2500);
      expect(result.value.rawRatio).toBe(1);
      expect(result.value.completionRatio).toBe(1);
      expect(result.value.completed).toBe(true);
    }
  });

  it("ei merkitse tulevaa päivää täyttyneeksi", () => {
    const result = evaluateDailyQuantityGoal({
      goal,
      rule: dailyRule,
      localDate: "2026-09-22",
      todayKey: "2026-09-21",
      source: "event-count",
      observations: [
        { localDate: "2026-09-22" },
        { localDate: "2026-09-22" },
        { localDate: "2026-09-22" },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.future).toBe(true);
      expect(result.value.observed).toBe(0);
      expect(result.value.completed).toBe(false);
    }
  });

  it("hylkää viikkosäännön, väärän linkin ja epäkelvon havainnon", () => {
    const base = {
      goal,
      localDate: "2026-09-21",
      todayKey: "2026-09-21",
      source: "event-count" as const,
      observations: [] as const,
    };
    expect(
      evaluateDailyQuantityGoal({ ...base, rule: { ...dailyRule, cadence: "weekly" } }).ok,
    ).toBe(false);
    expect(evaluateDailyQuantityGoal({ ...base, rule: { ...dailyRule, goalId: "other" } }).ok).toBe(
      false,
    );
    expect(
      evaluateDailyQuantityGoal({
        ...base,
        rule: dailyRule,
        observations: [{ localDate: "2026-09-21", amount: -1 }],
      }).ok,
    ).toBe(false);
  });
});
