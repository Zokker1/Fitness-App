// T194: anti-gaming caps (§9: "toistuvien triviaalien kirjausten XP pienenee
// tai on katettu. Historiallisen datan bulk-import ei tuota XP:tä", §40).
// Kriteeri: triviaalien toistojen XP-katto ja bulk-import exclusion testataan.
// - Triviaalikatto: supplement-log (tulevat logi-lähteet mukana) vähenee
//   kattoa lähestyessä ja loppuu päiväkatteeseen (trivialDailyCap);
// - Bulk-import: imported-lippu → EI XP-tapahtumaa lainkaan (ei edes nolla-
//   riviä), joten myöhempi aito suoritus palkitaan normaalisti.
import { describe, expect, it } from "vitest";
import type { XPTransaction } from "@lifeos/domain";
import {
  InMemoryStore,
  calculateXpAward,
  createEntityRepository,
  createXpAward,
  createXpRules,
  DEFAULT_XP_RULES,
  fixedClock,
  sequentialIdGenerator,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";

describe("triviaalien toistojen XP-katto (T194)", () => {
  it("toistot palkitaan täysin kunnes päiväkatto täyttyy", () => {
    // Oletus: 5 XP / kirjaus, katto 15 → kolme täyttä, neljäs ei mitään.
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 0 })).toBe(5);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 5 })).toBe(5);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 10 })).toBe(5);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 15 })).toBeNull();
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 80 })).toBeNull();
  });

  it("palkkio pienenee kattoa lähestyessä (§9) ja nollaa kelvottomat syötteet", () => {
    // Katto 12: 5 + 5 + 2 → neljäs ei mitään (pienenee + katettu).
    const rules = createXpRules({ trivialDailyCap: 12 });
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 0 }, rules)).toBe(5);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 5 }, rules)).toBe(5);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 10 }, rules)).toBe(2);
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 12 }, rules)).toBeNull();
    // Kelvoton earnedToday ei palkitse lainkaan.
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: -1 })).toBeNull();
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 1.5 })).toBeNull();
  });

  it("triviaali-XP:n voi kytkeä kokonaan pois (katto 0)", () => {
    const rules = createXpRules({ trivialDailyCap: 0 });
    expect(calculateXpAward({ kind: "supplement-logged", earnedToday: 0 }, rules)).toBeNull();
    // Muut palkkiot pysyvät ennallaan.
    expect(calculateXpAward({ kind: "task-completed" }, rules)).toBe(10);
  });

  it("katto konfiguroitavissa ja validoidaan", () => {
    expect(DEFAULT_XP_RULES.trivialDailyCap).toBe(15);
    expect(createXpRules({ trivialDailyCap: 3 }).trivialDailyCap).toBe(3);
    expect(() => createXpRules({ trivialDailyCap: -1 })).toThrow(RangeError);
    expect(() => createXpRules({ trivialDailyCap: 2.5 })).toThrow(RangeError);
  });
});

describe("bulk-import exclusion (T194)", () => {
  function ledgerSetup(prefix = "anti") {
    const clock = fixedClock(AT);
    const ids = sequentialIdGenerator(prefix);
    const store = new InMemoryStore<XPTransaction>("xp-transaction");
    const repo = createEntityRepository<XPTransaction>(store, { clock, ids });
    return { store, repo };
  }

  it("imported-tapahtuma EI tuota XP:tä eikä riviä (§40)", async () => {
    const { store, repo } = ledgerSetup();
    const result = await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-imported-1",
      amount: 10,
      earnedAt: "2025-03-01T08:00:00.000Z",
      reason: "Tuotu historiasta",
      imported: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("excluded");
    expect(result.value.transaction).toBeNull();
    // Ei riviä lainkaan — myöskään nolla-/placeholder-riviä.
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(0);
  });

  it("tuonti ei estä myöhempää aitoa palkintoa samasta kohteesta", async () => {
    const { store, repo } = ledgerSetup("later");
    // Historiallinen tuonti tuotu suoritus → ei XP:tä.
    await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-7",
      amount: 10,
      earnedAt: "2025-03-01T08:00:00.000Z",
      reason: null,
      imported: true,
    });
    // Myöhempi aito suoritus samalle kohteelle palkitaan normaalisti (T117).
    const real = await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-7",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    expect(real.ok && real.value.kind).toBe("awarded");
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("imported-lippu on valinnainen — oletus palkitsee normaalisti", async () => {
    const { store, repo } = ledgerSetup("default");
    const normal = await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-1",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    expect(normal.ok && normal.value.kind).toBe("awarded");
    const explicit = await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-2",
      amount: 10,
      earnedAt: AT,
      reason: null,
      imported: false,
    });
    expect(explicit.ok && explicit.value.kind).toBe("awarded");
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(2);
  });
});
