// T086: summarizeTodayHealth unit-testit (data-paketti, ei IO:ta).
// - Vain aktivoidut lajit tuottavat rivejä (tyhjä syöte → tyhjä lista;
//   UI näyttää yhden tyhjätilan); terveysneutraalit toteamukset, ei
//   diagnooseja; lisäravinteet ottamatta/kaikki-otettu; neste vain kun
//   kirjauksia tänään (eiliset eivät vuoda mukaan).
import { describe, expect, it } from "vitest";
import type {
  HydrationEntry,
  MoodCheckin,
  SleepEntry,
  Supplement,
  SupplementLog,
} from "@lifeos/domain";
import { summarizeTodayHealth, type TodayHealthInput } from "@lifeos/data";

const AT = "2026-09-18T09:00:00.000Z";
const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;

function sleep(id: string, overrides: Partial<SleepEntry> = {}): SleepEntry {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    sleepStart: "2026-09-17T22:30:00.000Z",
    sleepEnd: "2026-09-18T06:00:00.000Z",
    quality: 4,
    deletedAt: null,
    ...overrides,
  };
}

function mood(id: string, overrides: Partial<MoodCheckin> = {}): MoodCheckin {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    checkedAt: "2026-09-18T08:00:00.000Z",
    mood: 4,
    stress: null,
    energy: 3,
    motivation: null,
    focus: null,
    note: null,
    ...overrides,
  };
}

function supplement(id: string, name: string): Supplement {
  return { id, createdAt: AT, updatedAt: AT, version: 1, name, doseLabel: null, deletedAt: null };
}

function log(id: string, supplementId: string, takenAt: string): SupplementLog {
  return { id, createdAt: AT, updatedAt: AT, version: 1, supplementId, takenAt };
}

function water(id: string, drunkAt: string, milliliters: number): HydrationEntry {
  return { id, createdAt: AT, updatedAt: AT, version: 1, drunkAt, milliliters };
}

function baseInput(overrides: Partial<TodayHealthInput> = {}): TodayHealthInput {
  return {
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    sleepEntries: [],
    moodCheckins: [],
    supplements: [],
    supplementLogs: [],
    hydrationEntries: [],
    ...overrides,
  };
}

describe("summarizeTodayHealth (T086)", () => {
  it("tyhjä syöte → tyhjä lista (ei rivejä ilman dataa)", () => {
    expect(summarizeTodayHealth(baseInput()).rows).toEqual([]);
  });

  it("uni: viimeisin päättynyt, kesto + laatu neutraalisti", () => {
    const summary = summarizeTodayHealth(
      baseInput({
        sleepEntries: [
          sleep("s-old", {
            sleepStart: "2026-09-16T22:00:00.000Z",
            sleepEnd: "2026-09-17T06:00:00.000Z",
            quality: null,
          }),
          sleep("s-new"),
        ],
      }),
    );
    // 22:30 → 06:00 = 7 h 30 min, laatu 4/5.
    expect(summary.rows).toEqual([{ label: "Uni", value: "7 h 30 min, laatu 4/5" }]);
  });

  it("mieliala: viimeisin check-in, energia mukana", () => {
    const summary = summarizeTodayHealth(
      baseInput({
        moodCheckins: [
          mood("m-old", { checkedAt: "2026-09-17T08:00:00.000Z", mood: 2 }),
          mood("m-new"),
        ],
      }),
    );
    expect(summary.rows).toEqual([{ label: "Mieliala", value: "4/5, energia 3/5" }]);
  });

  it("lisäravinteet: ottamatta-lista / kaikki otettu; poistetut pois", () => {
    const partial = summarizeTodayHealth(
      baseInput({
        supplements: [supplement("s-a", "A-vitamiini"), supplement("s-b", "B-vitamiini")],
        supplementLogs: [log("l-1", "s-a", "2026-09-18T08:00:00.000Z")],
      }),
    );
    expect(partial.rows).toEqual([{ label: "Lisäravinteet", value: "Ottamatta: B-vitamiini" }]);

    const full = summarizeTodayHealth(
      baseInput({
        supplements: [supplement("s-a", "A-vitamiini")],
        supplementLogs: [log("l-1", "s-a", "2026-09-18T08:00:00.000Z")],
      }),
    );
    expect(full.rows).toEqual([{ label: "Lisäravinteet", value: "Kaikki otettu tänään" }]);

    // Eilinen kirjaus ei kelpaa täksi päiväksi.
    const stale = summarizeTodayHealth(
      baseInput({
        supplements: [supplement("s-a", "A-vitamiini")],
        supplementLogs: [log("l-1", "s-a", "2026-09-17T08:00:00.000Z")],
      }),
    );
    expect(stale.rows).toEqual([{ label: "Lisäravinteet", value: "Ottamatta: A-vitamiini" }]);
  });

  it("neste: vain tämän päivän millilitrat", () => {
    const summary = summarizeTodayHealth(
      baseInput({
        hydrationEntries: [
          water("h-1", "2026-09-18T07:00:00.000Z", 250),
          water("h-2", "2026-09-18T09:00:00.000Z", 200),
          water("h-3", "2026-09-17T09:00:00.000Z", 500),
        ],
      }),
    );
    expect(summary.rows).toEqual([{ label: "Neste", value: "450 ml tänään" }]);
  });
});
