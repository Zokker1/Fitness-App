// T144: vältettävä tavoite ei palkitse tulevaa tyhjää historiaa.
import { describe, expect, it } from "vitest";
import type { Goal } from "@lifeos/domain";
import { evaluateAvoidanceGoal } from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";
const goal: Goal = {
  id: "goal-avoid",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  title: "Ei energiajuomia",
  description: null,
  activeFrom: "2026-09-01",
  activeUntil: "2026-09-30",
  archivedAt: null,
  deletedAt: null,
};

describe("evaluateAvoidanceGoal (T144)", () => {
  it("menneellä päivällä ei havaintoja tarkoittaa onnistumista", () => {
    const result = evaluateAvoidanceGoal({
      goal,
      localDate: "2026-09-20",
      todayKey: "2026-09-21",
      observations: [],
    });
    expect(result).toEqual({
      ok: true,
      value: {
        goalId: "goal-avoid",
        localDate: "2026-09-20",
        observedViolations: 0,
        success: true,
        future: false,
        evaluated: true,
      },
    });
  });

  it("yksi rikkomus tekee päivästä epäonnistuneen", () => {
    const result = evaluateAvoidanceGoal({
      goal,
      localDate: "2026-09-21",
      todayKey: "2026-09-21",
      observations: [{ localDate: "2026-09-21" }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.observedViolations).toBe(1);
      expect(result.value.success).toBe(false);
      expect(result.value.evaluated).toBe(true);
    }
  });

  it("tuleva tyhjä päivä ei ole onnistunut eikä arvioitu", () => {
    const result = evaluateAvoidanceGoal({
      goal,
      localDate: "2026-09-22",
      todayKey: "2026-09-21",
      observations: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.observedViolations).toBe(0);
      expect(result.value.success).toBe(false);
      expect(result.value.future).toBe(true);
      expect(result.value.evaluated).toBe(false);
    }
  });

  it("rajattu/poistettu tavoite ja virheellinen havainto hylätään", () => {
    expect(
      evaluateAvoidanceGoal({
        goal: { ...goal, activeUntil: "2026-09-19" },
        localDate: "2026-09-20",
        todayKey: "2026-09-21",
        observations: [],
      }).ok,
    ).toBe(false);
    expect(
      evaluateAvoidanceGoal({
        goal: { ...goal, deletedAt: AT },
        localDate: "2026-09-20",
        todayKey: "2026-09-21",
        observations: [],
      }).ok,
    ).toBe(false);
    expect(
      evaluateAvoidanceGoal({
        goal,
        localDate: "2026-09-20",
        todayKey: "2026-09-21",
        observations: [{ localDate: "20.9.2026" }],
      }).ok,
    ).toBe(false);
  });
});
