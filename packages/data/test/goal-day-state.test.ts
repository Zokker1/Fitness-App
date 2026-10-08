import { describe, expect, it } from "vitest";
import type { Goal } from "@lifeos/domain";
import { evaluateGoalDayState } from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";
const goal: Goal = {
  id: "goal-state",
  createdAt: AT,
  updatedAt: AT,
  version: 1,
  title: "Tavoite",
  description: null,
  activeFrom: "2026-09-01",
  activeUntil: "2026-09-30",
  archivedAt: null,
  deletedAt: null,
};

function statusOf(result: ReturnType<typeof evaluateGoalDayState>): string {
  expect(result.ok).toBe(true);
  if (!result.ok) {
    return "error";
  }
  return result.value.status;
}

describe("evaluateGoalDayState (T145)", () => {
  it("erottelee onnistumisen, osittaisen, epäonnistumisen ja odottavan", () => {
    expect(
      statusOf(
        evaluateGoalDayState({
          goal,
          localDate: "2026-09-21",
          todayKey: "2026-09-21",
          goalDay: null,
          evidence: { kind: "ratio", completionRatio: 0, completed: false, future: false },
        }),
      ),
    ).toBe("pending");
    const partial = evaluateGoalDayState({
      goal,
      localDate: "2026-09-21",
      todayKey: "2026-09-21",
      goalDay: null,
      evidence: { kind: "ratio", completionRatio: 0.5, completed: false, future: false },
    });
    expect(statusOf(partial)).toBe("partial");
    if (partial.ok) {
      expect(partial.value.completionRatio).toBe(0.5);
    }
    expect(
      statusOf(
        evaluateGoalDayState({
          goal,
          localDate: "2026-09-20",
          todayKey: "2026-09-21",
          goalDay: null,
          evidence: { kind: "ratio", completionRatio: 0, completed: false, future: false },
        }),
      ),
    ).toBe("fail");
    const success = evaluateGoalDayState({
      goal,
      localDate: "2026-09-21",
      todayKey: "2026-09-21",
      goalDay: { completed: true },
    });
    expect(statusOf(success)).toBe("success");
    if (success.ok) {
      expect(success.value.completionRatio).toBe(1);
    }
  });

  it("tuottaa not-requiredin ja futuren sekä käsittelee avoidance-pendingin", () => {
    expect(
      statusOf(
        evaluateGoalDayState({
          goal: { ...goal, activeUntil: "2026-09-20" },
          localDate: "2026-09-21",
          todayKey: "2026-09-21",
          goalDay: null,
        }),
      ),
    ).toBe("not-required");
    expect(
      statusOf(
        evaluateGoalDayState({
          goal,
          localDate: "2026-09-22",
          todayKey: "2026-09-21",
          goalDay: null,
        }),
      ),
    ).toBe("future");
    expect(
      statusOf(
        evaluateGoalDayState({
          goal,
          localDate: "2026-09-21",
          todayKey: "2026-09-21",
          goalDay: null,
          evidence: { kind: "avoidance", success: false, evaluated: false, future: false },
        }),
      ),
    ).toBe("pending");
  });
});
