// T182: level curve. Level lasketaan deterministisesti kokonais-XP:stä (§9):
// ei satunnaisuutta, ei kellonaikaa, ei snapshot-riippuvuutta. LevelState on
// välimuisti, transaktiovirta on totuus. §51: negatiivinen saldo (manual-
// korjaukset) ei pudota tasolta 1.
//
// Kumulatiivinen raja tasolle L: 50 * (L-1) * L
//   L1: 0, L2: 100, L3: 300, L4: 600, L5: 1000, ...
// Tasojen väli kasvaa tasaisesti: L → L+1 vaatii 100 * L XP:tä.

export interface LevelProgress {
  readonly level: number;
  /** Kumulatiivinen XP, jolla tämä taso alkaa. */
  readonly currentLevelAtXp: number;
  /** Kumulatiivinen XP, jolla seuraava taso alkaa. */
  readonly nextLevelAtXp: number;
  readonly xpIntoLevel: number;
  readonly xpToNextLevel: number;
  /** Etenemä tämän tason sisällä kokonaisena prosenttina 0–99. */
  readonly progressPercent: number;
}

const LEVEL_STEP = 50;

function clampXp(totalXp: number): number {
  return Number.isFinite(totalXp) && totalXp > 0 ? Math.floor(totalXp) : 0;
}

/** Kumulatiivinen XP, jolla taso saavutetaan (taso 1 = 0 XP). */
export function totalXpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError("Tason on oltava vähintään 1.");
  }
  return LEVEL_STEP * (level - 1) * level;
}

export function levelForTotalXp(totalXp: number): number {
  const xp = clampXp(totalXp);
  // 50·L·(L−1) ≤ xp → L ≤ (1 + √(1 + 2·xp/25)) / 2; korjataan liukuvirhe.
  const estimate = Math.floor((1 + Math.sqrt(1 + (2 * xp) / 25)) / 2);
  let level = Math.max(1, estimate);
  while (totalXpForLevel(level + 1) <= xp) {
    level += 1;
  }
  while (level > 1 && totalXpForLevel(level) > xp) {
    level -= 1;
  }
  return level;
}

export function levelProgress(totalXp: number): LevelProgress {
  const xp = clampXp(totalXp);
  const level = levelForTotalXp(xp);
  const currentLevelAtXp = totalXpForLevel(level);
  const nextLevelAtXp = totalXpForLevel(level + 1);
  const xpIntoLevel = xp - currentLevelAtXp;
  const span = nextLevelAtXp - currentLevelAtXp;
  return {
    level,
    currentLevelAtXp,
    nextLevelAtXp,
    xpIntoLevel,
    xpToNextLevel: nextLevelAtXp - xp,
    progressPercent: Math.floor((xpIntoLevel / span) * 100),
  };
}
