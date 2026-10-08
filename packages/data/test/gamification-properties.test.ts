// T198: toistettavat ominaisuustestit XP-saldolle, tasokäyrälle, aikavyöhykkeille
// sekä rinnakkaisten replikoiden idempotentille ledger-yhdistämiselle.
import { describe, expect, it } from "vitest";
import type { XPTransaction, XpSource } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import {
  InMemoryStore,
  createEntityRepository,
  createXpAward,
  fixedClock,
  levelForTotalXp,
  levelProgress,
  sequentialIdGenerator,
  summarizeTodayGamification,
  totalXpForLevel,
  type CreateXpAwardInput,
} from "../src/index.ts";

const SEED = 0x198_2026;
const LOCAL_DATE = "2026-09-24";
const AT = "2026-09-24T12:00:00.000Z";
const XP_SOURCES: readonly XpSource[] = [
  "task",
  "routine",
  "focus",
  "habit",
  "health",
  "quest",
  "manual",
];

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function integerBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function transaction(id: string, amount: number, earnedAt: string): XPTransaction {
  return {
    id,
    createdAt: earnedAt,
    updatedAt: earnedAt,
    version: 1,
    source: "task",
    sourceEntityId: null,
    amount,
    earnedAt,
    reason: null,
  };
}

function utcAtLocalMinute(localDate: string, offsetMinutes: number, localMinute: number): string {
  const [year, month, day] = localDate.split("-");
  const localMillis = Date.UTC(Number(year), Number(month) - 1, Number(day)) + localMinute * 60_000;
  return new Date(localMillis - offsetMinutes * 60_000).toISOString();
}

function summaryFor(transactions: readonly XPTransaction[], offsetMinutes: number) {
  return summarizeTodayGamification({
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: offsetMinutes,
    xpTransactions: transactions,
    achievements: [],
    earnedAchievementIds: new Set<string>(),
  });
}

function ledgerReplica(prefix: string) {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  const store = new InMemoryStore<XPTransaction>("xp-transaction");
  const repository = createEntityRepository<XPTransaction>(store, { clock, ids });
  return { store, repository };
}

function unionById(transactions: readonly XPTransaction[]): Map<string, XPTransaction> {
  const merged = new Map<string, XPTransaction>();
  for (const item of transactions) {
    merged.set(item.id, item);
  }
  return merged;
}

describe("gamification properties (T198; seed 0x1982026)", () => {
  it("tasorajat ovat tarkat ja etenemä säilyy tason sisällä", () => {
    const random = seededRandom(SEED);
    const levels = new Set<number>(Array.from({ length: 400 }, (_, index) => index + 1));
    for (let sample = 0; sample < 160; sample += 1) {
      levels.add(integerBetween(random, 1, 8_000));
    }

    for (const level of levels) {
      const start = totalXpForLevel(level);
      const next = totalXpForLevel(level + 1);
      expect(levelForTotalXp(start)).toBe(level);
      expect(levelForTotalXp(next)).toBe(level + 1);
      if (level > 1) {
        expect(levelForTotalXp(start - 1)).toBe(level - 1);
      }

      const xp = integerBetween(random, start, next - 1);
      const progress = levelProgress(xp);
      expect(progress.level).toBe(level);
      expect(progress.currentLevelAtXp).toBe(start);
      expect(progress.nextLevelAtXp).toBe(next);
      expect(progress.xpIntoLevel + progress.xpToNextLevel).toBe(next - start);
      expect(progress.progressPercent).toBeGreaterThanOrEqual(0);
      expect(progress.progressPercent).toBeLessThan(100);
      expect(levelForTotalXp(xp + 1)).toBeGreaterThanOrEqual(level);
    }
  });

  it("kelvoton ja negatiivinen kokonais-XP pysyy ensimmäisellä tasolla", () => {
    for (const xp of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, -0.5]) {
      expect(levelForTotalXp(xp)).toBe(1);
      expect(levelProgress(xp)).toEqual({
        level: 1,
        currentLevelAtXp: 0,
        nextLevelAtXp: 100,
        xpIntoLevel: 0,
        xpToNextLevel: 100,
        progressPercent: 0,
      });
    }
    expect(levelProgress(100.9).level).toBe(2);
    expect(levelProgress(100.9).xpIntoLevel).toBe(0);
  });

  it("saldo ja tänään kirjattu XP eivät riipu ledger-rivien järjestyksestä", () => {
    const random = seededRandom(SEED ^ 0x51);
    for (let sample = 0; sample < 100; sample += 1) {
      const offsetMinutes = integerBetween(random, -720, 840);
      const count = integerBetween(random, 1, 32);
      const items = Array.from({ length: count }, (_, index) => {
        const localMinute = integerBetween(random, -5 * 1_440, 5 * 1_440);
        const earnedAt = utcAtLocalMinute(LOCAL_DATE, offsetMinutes, localMinute);
        return transaction(
          `balance-${String(sample)}-${String(index)}`,
          integerBetween(random, -50, 60),
          earnedAt,
        );
      });
      const expectedTotal = items.reduce((sum, item) => sum + item.amount, 0);
      const expectedToday = items
        .filter((item) => toLocalDateKey(item.earnedAt, offsetMinutes) === LOCAL_DATE)
        .reduce((sum, item) => sum + item.amount, 0);

      const forward = summaryFor(items, offsetMinutes);
      const reversed = summaryFor([...items].reverse(), offsetMinutes);
      expect(forward.totalXp).toBe(expectedTotal);
      expect(forward.todayXp).toBe(expectedToday);
      expect(forward.level).toBe(levelForTotalXp(expectedTotal));
      expect(forward.levelProgress).toEqual(levelProgress(expectedTotal));
      expect(reversed.totalXp).toBe(forward.totalXp);
      expect(reversed.todayXp).toBe(forward.todayXp);
      expect(reversed.levelProgress).toEqual(forward.levelProgress);
    }
  });

  it("paikallispäivän rajat pysyvät oikeina eri UTC-offseteilla", () => {
    const boundaries = [-1, 0, 1_439, 1_440];
    const expectedDates = ["2026-09-23", LOCAL_DATE, LOCAL_DATE, "2026-09-25"];
    for (let offsetMinutes = -720; offsetMinutes <= 840; offsetMinutes += 15) {
      const items = boundaries.map((minute, index) => {
        const earnedAt = utcAtLocalMinute(LOCAL_DATE, offsetMinutes, minute);
        expect(toLocalDateKey(earnedAt, offsetMinutes)).toBe(expectedDates[index]);
        return transaction(
          `boundary-${String(offsetMinutes)}-${String(index)}`,
          [3, 5, 7, -2][index] ?? 0,
          earnedAt,
        );
      });
      const summary = summaryFor(items, offsetMinutes);
      expect(summary.todayXp).toBe(12);
      expect(summary.totalXp).toBe(13);
      expect(summary.level).toBe(1);
    }
  });

  it("retryt ja kahden replikan yhdistäminen säilyttävät yhden tapahtuman per avain", async () => {
    const random = seededRandom(SEED ^ 0x181);
    const replicaA = ledgerReplica("replica-a");
    const replicaB = ledgerReplica("replica-b");
    const canonicalEvents: CreateXpAwardInput[] = [];

    for (let index = 0; index < 96; index += 1) {
      const source = XP_SOURCES[integerBetween(random, 0, XP_SOURCES.length - 1)] ?? "task";
      const magnitude = integerBetween(random, 1, 40);
      const event: CreateXpAwardInput = {
        source,
        sourceEntityId: `entity-${String(index)}`,
        amount: source === "manual" && index % 2 === 0 ? -magnitude : magnitude,
        earnedAt: utcAtLocalMinute(
          LOCAL_DATE,
          integerBetween(random, -720, 840),
          integerBetween(random, 0, 1_439),
        ),
        reason: source === "manual" ? "Property test -kirjaus" : null,
      };
      canonicalEvents.push(event);

      const firstA = await createXpAward(replicaA.repository, event);
      const firstB = await createXpAward(replicaB.repository, event);
      const retryA = await createXpAward(replicaA.repository, {
        ...event,
        amount: event.amount + 999,
      });
      if (!firstA.ok || !firstB.ok || !retryA.ok) {
        throw new Error("XP-ledgerin property setup epäonnistui.");
      }
      if (
        firstA.value.kind !== "awarded" ||
        firstB.value.kind !== "awarded" ||
        retryA.value.kind !== "duplicate"
      ) {
        throw new Error("XP-ledgerin retryn pitäisi palauttaa alkuperäinen tapahtuma.");
      }
      expect(firstA.value.kind).toBe("awarded");
      expect(firstB.value.kind).toBe("awarded");
      expect(retryA.value.kind).toBe("duplicate");
      expect(firstA.value.transaction.id).toBe(firstB.value.transaction.id);
    }

    const [listedA, listedB] = await Promise.all([
      replicaA.repository.list(),
      replicaB.repository.list(),
    ]);
    if (!listedA.ok || !listedB.ok) {
      throw new Error("XP-ledgerin replikoita ei voitu lukea.");
    }
    const merged = unionById([...listedA.value, ...listedB.value]);
    const mergedAgain = unionById([...merged.values(), ...listedA.value, ...listedB.value]);
    const expectedTotal = canonicalEvents.reduce((sum, event) => sum + event.amount, 0);
    const mergedTotal = [...merged.values()].reduce((sum, event) => sum + event.amount, 0);
    expect(listedA.value).toHaveLength(canonicalEvents.length);
    expect(listedB.value).toHaveLength(canonicalEvents.length);
    expect(merged.size).toBe(canonicalEvents.length);
    expect(mergedAgain.size).toBe(merged.size);
    expect(mergedTotal).toBe(expectedTotal);
    expect(levelForTotalXp(mergedTotal)).toBe(levelForTotalXp(expectedTotal));
  });
});
