// T187: Recovery Bonus (§9 paluun positiivinen palaute, §51 reiluus,
// §57.14 ei rankaisua). Kriteeri: tauon jälkeinen paluu palkitaan hallitusti.
// - ≥2 pv tauon jälkeinen aktiivinen päivä saa bonuksen (5 XP + 1 XP /
//   ylimääräinen taukopäivä, katto 15);
// - aloitus ja yhden päivän lipsahdus eivät saa bonusta;
// - retry/synkka palkitsee kerran (deterministinen palkkioavain);
// - viesti on positiivinen, ei katkennun putken rankaisukieltä.
import { describe, expect, it } from "vitest";
import type { XPTransaction } from "@lifeos/domain";
import {
  InMemoryStore,
  createEntityRepository,
  createXpAward,
  evaluateRecoveryReturn,
  fixedClock,
  grantRecoveryBonusService,
  recoveryReturnEventId,
  sequentialIdGenerator,
  RECOVERY_BONUS_MESSAGE,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";
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

function evaluate(localDate: string, transactions: readonly XPTransaction[]) {
  return evaluateRecoveryReturn({
    localDate,
    timezoneOffsetMinutes: OFFSET,
    xpTransactions: transactions,
  });
}

function setup(prefix = "rb") {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  const store = new InMemoryStore<XPTransaction>("xp-transaction");
  const repo = createEntityRepository<XPTransaction>(store, { clock, ids });
  return { clock, ids, store, repo, deps: { clock, xpTransactions: repo } };
}

describe("evaluateRecoveryReturn (T187)", () => {
  it("≥2 pv tauon jälkeinen paluu saa perusbonuksen", () => {
    // Su 13.9 aktiivinen, tauko 14.–15.9., paluu 16.9.
    const result = evaluate("2026-09-16", [txOn("2026-09-13", "e-1"), txOn("2026-09-16", "e-2")]);
    expect(result).toEqual({ qualifies: true, gapDays: 2, amount: 5 });
  });

  it("pidempi tauko kasvattaa bonusta asteittain kattoon", () => {
    const gap2 = evaluate("2026-09-16", [txOn("2026-09-13", "e-1"), txOn("2026-09-16", "e-2")]);
    const gap5 = evaluate("2026-09-19", [txOn("2026-09-13", "e-1"), txOn("2026-09-19", "e-2")]);
    const gap20 = evaluate("2026-10-04", [txOn("2026-09-13", "e-1"), txOn("2026-10-04", "e-2")]);
    expect(gap2.amount).toBe(5);
    expect(gap5.amount).toBe(8);
    // 5 + (20 − 2) kattuu kattoon 15.
    expect(gap20.amount).toBe(15);
  });

  it("aloitus ei ole paluu — ensimmäinen suoritus ilman bonusta", () => {
    expect(evaluate("2026-09-18", [txOn("2026-09-18", "e-1")])).toEqual({
      qualifies: false,
      gapDays: 0,
      amount: 0,
    });
  });

  it("yhden päivän lipsahdus ei saa bonusta", () => {
    // 13.9 + 15.9 aktiivisia, 14.9 tauko (1 pv).
    const result = evaluate("2026-09-15", [txOn("2026-09-13", "e-1"), txOn("2026-09-15", "e-2")]);
    expect(result.qualifies).toBe(false);
    expect(result.gapDays).toBe(1);
  });

  it("passiivinen päivä ei kelpaa paluupäiväksi", () => {
    const result = evaluate("2026-09-16", [txOn("2026-09-13", "e-1")]);
    expect(result.qualifies).toBe(false);
  });

  it("viesti on positiivinen, ei rankaisukieltä", () => {
    expect(RECOVERY_BONUS_MESSAGE).toContain("Tervetuloa takaisin");
    for (const banned of ["putki", "katkes", "epäonnistu", "häpeä", "menetit"]) {
      expect(RECOVERY_BONUS_MESSAGE.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("grantRecoveryBonusService (T187)", () => {
  it("palkitsee paluun kerran — retry duplicate, ei tupla-XP:tä", async () => {
    const { deps, store } = setup();
    await createXpAward(deps.xpTransactions, {
      source: "task",
      sourceEntityId: "task-1",
      amount: 10,
      earnedAt: "2026-09-13T08:00:00.000Z",
      reason: null,
    });
    await createXpAward(deps.xpTransactions, {
      source: "task",
      sourceEntityId: "task-2",
      amount: 10,
      earnedAt: "2026-09-16T08:00:00.000Z",
      reason: null,
    });

    const first = await grantRecoveryBonusService(deps, {
      localDate: "2026-09-16",
      timezoneOffsetMinutes: OFFSET,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("awarded");
    if (first.value.kind !== "awarded") return;
    expect(first.value.amount).toBe(5);
    expect(first.value.message).toBe(RECOVERY_BONUS_MESSAGE);
    expect(first.value.transaction.id).toBe("xp-habit-recovery-2026-09-16");
    expect(first.value.transaction.sourceEntityId).toBe(recoveryReturnEventId("2026-09-16"));

    const retry = await grantRecoveryBonusService(deps, {
      localDate: "2026-09-16",
      timezoneOffsetMinutes: OFFSET,
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.kind).toBe("duplicate");

    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(3);
  });

  it("ei paluutilannetta → none ilman kirjausta", async () => {
    const { deps, store } = setup("none");
    await createXpAward(deps.xpTransactions, {
      source: "task",
      sourceEntityId: "task-1",
      amount: 10,
      earnedAt: "2026-09-13T08:00:00.000Z",
      reason: null,
    });
    // 14.9 on passiivinen → ei paluupäivä.
    const result = await grantRecoveryBonusService(deps, {
      localDate: "2026-09-14",
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("none");
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("synkka: kaksi replikkaa tuottaa saman palkkioavaimen", async () => {
    const a = setup("rep-a");
    const b = setup("rep-b");
    for (const deps of [a.deps, b.deps]) {
      await createXpAward(deps.xpTransactions, {
        source: "task",
        sourceEntityId: "task-1",
        amount: 10,
        earnedAt: "2026-09-13T08:00:00.000Z",
        reason: null,
      });
      await createXpAward(deps.xpTransactions, {
        source: "task",
        sourceEntityId: "task-2",
        amount: 10,
        earnedAt: "2026-09-16T08:00:00.000Z",
        reason: null,
      });
    }
    const first = await grantRecoveryBonusService(a.deps, {
      localDate: "2026-09-16",
      timezoneOffsetMinutes: OFFSET,
    });
    const second = await grantRecoveryBonusService(b.deps, {
      localDate: "2026-09-16",
      timezoneOffsetMinutes: OFFSET,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    if (first.value.kind !== "awarded" || second.value.kind !== "awarded") return;
    // Molemmat "luovat" saman suorituksen → sama entiteetti-id (merge = 1 rivi).
    expect(second.value.transaction.id).toBe(first.value.transaction.id);
  });
});
