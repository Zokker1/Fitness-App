// T180: XP-palkkion laskenta on puhdas, konfiguroitava eikä riipu käyttöliittymästä.
import { describe, expect, it } from "vitest";
import { calculateXpAward, createXpRules, DEFAULT_XP_RULES } from "../src/xp-rules.ts";

describe("XP rule engine (T180)", () => {
  it("määrittää nykyiset palkkiot keskitetystä oletuskonfiguraatiosta", () => {
    expect(DEFAULT_XP_RULES).toEqual({
      taskCompletion: 10,
      goalDayCompletion: 5,
      routineCompletion: 10,
      routineMinimumDay: 5,
      focusCompletion: 15,
      focusMinimumActiveSeconds: 300,
      focusDailyCap: 45,
      supplementLog: 5,
      trivialDailyCap: 15,
    });
    expect(calculateXpAward({ kind: "task-completed" })).toBe(10);
    expect(calculateXpAward({ kind: "goal-day-completed" })).toBe(5);
    expect(calculateXpAward({ kind: "routine-completed", dayMode: "full" })).toBe(10);
    expect(calculateXpAward({ kind: "routine-completed", dayMode: "minimum" })).toBe(5);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 0 })).toBe(5);
  });

  it("yhdistää konfiguraatiomuutokset ja kytkee palkkion nollalla pois", () => {
    const rules = createXpRules({ taskCompletion: 18, routineMinimumDay: 0 });
    expect(rules.taskCompletion).toBe(18);
    expect(rules.goalDayCompletion).toBe(DEFAULT_XP_RULES.goalDayCompletion);
    expect(calculateXpAward({ kind: "task-completed" }, rules)).toBe(18);
    expect(calculateXpAward({ kind: "routine-completed", dayMode: "minimum" }, rules)).toBeNull();
  });

  it("hylkää virheelliset asetukset", () => {
    expect(() => createXpRules({ taskCompletion: -1 })).toThrow(RangeError);
    expect(() => createXpRules({ focusCompletion: 1.5 })).toThrow(RangeError);
    expect(() => createXpRules({ focusMinimumActiveSeconds: 0 })).toThrow(RangeError);
  });

  it("soveltaa fokusminimiä ja paikallispäivän kattoa rajakohdissa", () => {
    expect(
      calculateXpAward({ kind: "focus-completed", activeSeconds: 299, earnedToday: 0 }),
    ).toBeNull();
    expect(calculateXpAward({ kind: "focus-completed", activeSeconds: 300, earnedToday: 30 })).toBe(
      15,
    );
    expect(
      calculateXpAward({ kind: "focus-completed", activeSeconds: 300, earnedToday: 31 }),
    ).toBeNull();
    expect(
      calculateXpAward(
        { kind: "focus-completed", activeSeconds: 120, earnedToday: 7 },
        createXpRules({ focusCompletion: 7, focusMinimumActiveSeconds: 120, focusDailyCap: 14 }),
      ),
    ).toBe(7);
  });
});
