// T088: summarizeTodayGamification unit-testit (data-paketti, ei IO:ta).
// - XP tänään + yhteensä virrasta; level derivoitu kokonais-XP:stä (T182-käyrä);
//   momentum 7 päivän aktiivisten osuus (1 nolla ei tyhjennä); seuraava reward
//   ansaitsemattomista aakkosissa; kaikki ansaittu / ei yhtään → null.
import { describe, expect, it } from "vitest";
import type { Achievement, XPTransaction } from "@lifeos/domain";
import { summarizeTodayGamification, type TodayGamificationInput } from "@lifeos/data";

const AT = "2026-09-18T09:00:00.000Z";
const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;

function tx(id: string, overrides: Partial<XPTransaction> = {}): XPTransaction {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    source: "task",
    sourceEntityId: null,
    amount: 10,
    earnedAt: "2026-09-18T07:00:00.000Z",
    reason: null,
    ...overrides,
  };
}

function achievement(id: string, title: string): Achievement {
  return { id, createdAt: AT, updatedAt: AT, version: 1, key: id, title, description: null };
}

function baseInput(overrides: Partial<TodayGamificationInput> = {}): TodayGamificationInput {
  return {
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    xpTransactions: [],
    achievements: [],
    earnedAchievementIds: new Set<string>(),
    ...overrides,
  };
}

describe("summarizeTodayGamification (T088)", () => {
  it("tyhjä → 0 XP, level 1, momentum 0, ei rewardia", () => {
    const summary = summarizeTodayGamification(baseInput());
    expect(summary).toMatchObject({
      todayXp: 0,
      totalXp: 0,
      level: 1,
      nextRewardTitle: null,
      earnedCount: 0,
    });
    expect(summary.levelProgress).toEqual({
      level: 1,
      currentLevelAtXp: 0,
      nextLevelAtXp: 100,
      xpIntoLevel: 0,
      xpToNextLevel: 100,
      progressPercent: 0,
    });
    expect(summary.momentum).toEqual({
      score: 0,
      activeDaysLast7: 0,
      activeDaysLast14: 0,
      returnedAfterGap: false,
    });
  });

  it("XP virrasta; level käyrältä; reward aakkosissa", () => {
    const summary = summarizeTodayGamification(
      baseInput({
        xpTransactions: [
          tx("x-1"),
          tx("x-2", { earnedAt: "2026-09-17T08:00:00.000Z", amount: 35 }),
          tx("x-3", { earnedAt: "2026-09-12T08:00:00.000Z", amount: 255 }),
        ],
        achievements: [achievement("a-2", "Viikon putki"), achievement("a-1", "Ensimmäinen")],
        earnedAchievementIds: new Set(["a-2"]),
      }),
    );
    expect(summary.todayXp).toBe(10);
    expect(summary.totalXp).toBe(300);
    // T182: 300 XP → taso 3 (raja 300), seuraava raja 600.
    expect(summary.level).toBe(3);
    expect(summary.levelProgress.nextLevelAtXp).toBe(600);
    expect(summary.levelProgress.xpToNextLevel).toBe(300);
    // Aktiiviset päivät: 18.9., 17.9., 12.9. → 3/7 viimeisessä ikkunassa.
    expect(summary.momentum.activeDaysLast7).toBe(3);
    expect(summary.momentum.activeDaysLast14).toBe(3);
    // "Ensimmäinen" < "Viikon putki" aakkosissa, a-2 ansaittu.
    expect(summary.nextRewardTitle).toBe("Ensimmäinen");
    expect(summary.earnedCount).toBe(1);
  });

  it("yksi nollapäivä ei tyhjennä momentumia; kaikki ansaittu → null", () => {
    const transactions = [
      tx("x-1"),
      tx("x-2", { earnedAt: "2026-09-17T08:00:00.000Z" }),
      tx("x-3", { earnedAt: "2026-09-16T08:00:00.000Z" }),
      tx("x-4", { earnedAt: "2026-09-14T08:00:00.000Z" }),
    ];
    const summary = summarizeTodayGamification(
      baseInput({
        xpTransactions: transactions,
        achievements: [achievement("a-1", "Ensimmäinen")],
        earnedAchievementIds: new Set(["a-1"]),
      }),
    );
    // 15.9. puuttuu mutta 4/7 aktiivista → momentum ei nollaudu.
    expect(summary.momentum.activeDaysLast7).toBe(4);
    expect(summary.momentum.score).toBeGreaterThan(0);
    expect(summary.nextRewardTitle).toBeNull();
  });
});
