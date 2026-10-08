// T184: momentum score (§9 liukuva 7/14 suoritusaste, §57.14 palkinto ei
// rangaistus). Kriteeri: 7/14 päivän jatkuvuus painottaa paluuta eikä
// nollaudu yhdestä päivästä.
// - liukuva paino: viimeiset 7 pv painavat enemmän kuin 8.–14. pv;
// - yksi nollapäivä menettää vain oman painonsa (ei nollaa);
// - ≥2 pv tauon jälkeinen paluu saa painobonuksen (aloitus ei);
// - yli ikkunan tauon jälkeinen paluu tunnistetaan historiasta.
import { describe, expect, it } from "vitest";
import type { XPTransaction } from "@lifeos/domain";
import { calculateMomentumScore } from "../src/momentum.ts";

const TODAY = "2026-09-18";
const OFFSET = 0;

function txOn(localDate: string, id: string): XPTransaction {
  return {
    id,
    createdAt: `${localDate}T08:00:00.000Z`,
    updatedAt: `${localDate}T08:00:00.000Z`,
    version: 1,
    source: "task",
    sourceEntityId: null,
    amount: 10,
    earnedAt: `${localDate}T08:00:00.000Z`,
    reason: null,
  };
}

/** Päivät taaksepäin tänästä (0 = tänään). */
function txOnAges(ages: readonly number[], prefix = "m"): XPTransaction[] {
  return ages.map((age, index) => {
    const date = new Date(Date.parse(`${TODAY}T12:00:00.000Z`) - age * 86_400_000)
      .toISOString()
      .slice(0, 10);
    return txOn(date, `${prefix}-${String(index)}`);
  });
}

function scoreOf(transactions: readonly XPTransaction[], localDate = TODAY) {
  return calculateMomentumScore({
    localDate,
    timezoneOffsetMinutes: OFFSET,
    xpTransactions: transactions,
  });
}

describe("calculateMomentumScore (T184)", () => {
  it("täysi ikkuna → 100, tyhjä → 0", () => {
    expect(scoreOf(txOnAges(Array.from({ length: 14 }, (_, i) => i))).score).toBe(100);
    expect(scoreOf([])).toEqual({
      score: 0,
      activeDaysLast7: 0,
      activeDaysLast14: 0,
      returnedAfterGap: false,
    });
  });

  it("liukuva paino: viimeiset 7 pv painavat enemmän kuin vanhemmat", () => {
    const recent = scoreOf(txOnAges([0, 1, 2, 3, 4, 5, 6]));
    const older = scoreOf(txOnAges([7, 8, 9, 10, 11, 12, 13]));
    expect(recent.score).toBeGreaterThan(older.score);
    expect(recent.activeDaysLast7).toBe(7);
    expect(older.activeDaysLast7).toBe(0);
  });

  it("yksi nollapäivä ei nollaa — menettää vain oman painonsa", () => {
    const full = scoreOf(txOnAges(Array.from({ length: 14 }, (_, i) => i)));
    const oneOff = scoreOf(
      txOnAges(Array.from({ length: 14 }, (_, i) => i).filter((age) => age !== 3)),
    );
    expect(full.score).toBe(100);
    expect(oneOff.score).toBe(90);
    expect(oneOff.score).toBeGreaterThan(0);
  });

  it("paluu ≥2 pv tauon jälkeen painottuu (sama määrä aktiivisia päiviä)", () => {
    // A: yhtenäinen tauko (2 pv) ja heti paluu → bonus.
    const returnAfterGap = scoreOf(
      txOnAges(Array.from({ length: 14 }, (_, i) => i).filter((age) => age !== 3 && age !== 2)),
    );
    // B: kaksi yksittäistä lipsahdusta → ei taukoa, ei bonusta.
    const scattered = scoreOf(
      txOnAges(Array.from({ length: 14 }, (_, i) => i).filter((age) => age !== 3 && age !== 5)),
    );
    expect(returnAfterGap.activeDaysLast14).toBe(scattered.activeDaysLast14);
    expect(returnAfterGap.returnedAfterGap).toBe(true);
    expect(scattered.returnedAfterGap).toBe(false);
    expect(returnAfterGap.score).toBeGreaterThan(scattered.score);
  });

  it("aloitus ei ole paluu — ensimmäinen suoritus ilman bonusta", () => {
    const freshStart = scoreOf(txOnAges([0]));
    expect(freshStart.returnedAfterGap).toBe(false);
    // 2 pt (tänään, ei bonusta) / 21 → 10.
    expect(freshStart.score).toBe(10);
  });

  it("yli ikkunan tauon jälkeinen paluu tunnistetaan historiasta", () => {
    const longBreak = scoreOf([txOn("2026-08-01", "old-1"), txOn("2026-09-18", "new-1")]);
    expect(longBreak.returnedAfterGap).toBe(true);
    // 2 pt + 2 pt paluubonus = 4 / 21 → 19.
    expect(longBreak.score).toBe(19);
    const fresh = scoreOf(txOnAges([0]));
    expect(longBreak.score).toBeGreaterThan(fresh.score);
  });
});
