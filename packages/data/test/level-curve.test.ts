// T182: level curve — level lasketaan deterministisesti kokonais-XP:stä (§9).
// - rajat: L1 = 0 XP, L2 = 100, L3 = 300, L4 = 600, L5 = 1000 (50 * (L-1) * L);
// - levelForTotalXp on monotoninen ja tarkka rajoilla;
// - negatiivinen/kelvoton kokonais-XP ei pudota tasolta 1 (§51);
// - levelProgress kertoo etenemän tason sisällä ja seuraavaan rajaan.
import { describe, expect, it } from "vitest";
import { levelForTotalXp, levelProgress, totalXpForLevel } from "../src/level-curve.ts";

describe("totalXpForLevel (T182)", () => {
  it("kumulatiiviset rajat: 0, 100, 300, 600, 1000", () => {
    expect([1, 2, 3, 4, 5].map(totalXpForLevel)).toEqual([0, 100, 300, 600, 1000]);
  });

  it("hylkää kelvottoman tason", () => {
    expect(() => totalXpForLevel(0)).toThrow(RangeError);
    expect(() => totalXpForLevel(1.5)).toThrow(RangeError);
    expect(() => totalXpForLevel(-2)).toThrow(RangeError);
  });
});

describe("levelForTotalXp (T182)", () => {
  it("tarkat rajat: ennen raja-alueelta seuraava taso", () => {
    expect(levelForTotalXp(0)).toBe(1);
    expect(levelForTotalXp(99)).toBe(1);
    expect(levelForTotalXp(100)).toBe(2);
    expect(levelForTotalXp(299)).toBe(2);
    expect(levelForTotalXp(300)).toBe(3);
    expect(levelForTotalXp(599)).toBe(3);
    expect(levelForTotalXp(600)).toBe(4);
    expect(levelForTotalXp(1000)).toBe(5);
    expect(levelForTotalXp(1001)).toBe(5);
    expect(levelForTotalXp(1500)).toBe(6);
  });

  it("monotoninen laajalla alueella", () => {
    let previous = 0;
    for (let xp = 0; xp <= 5000; xp += 37) {
      const level = levelForTotalXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      expect(totalXpForLevel(level)).toBeLessThanOrEqual(xp);
      previous = level;
    }
  });

  it("negatiivinen ja kelvoton XP pysyy tasolla 1", () => {
    expect(levelForTotalXp(-50)).toBe(1);
    expect(levelForTotalXp(Number.NaN)).toBe(1);
  });
});

describe("levelProgress (T182)", () => {
  it("tason alku: 0 % etenemä, koko väli jäljellä", () => {
    expect(levelProgress(300)).toEqual({
      level: 3,
      currentLevelAtXp: 300,
      nextLevelAtXp: 600,
      xpIntoLevel: 0,
      xpToNextLevel: 300,
      progressPercent: 0,
    });
  });

  it("tason loppu: lähes 100 % ja vähän jäljellä", () => {
    const progress = levelProgress(555);
    expect(progress.level).toBe(3);
    expect(progress.xpIntoLevel).toBe(255);
    expect(progress.xpToNextLevel).toBe(45);
    expect(progress.progressPercent).toBe(85);
  });

  it("ensimmäinen taso: raja 100 XP", () => {
    const progress = levelProgress(0);
    expect(progress.level).toBe(1);
    expect(progress.nextLevelAtXp).toBe(100);
    expect(progress.xpToNextLevel).toBe(100);
    expect(progress.progressPercent).toBe(0);
  });
});
