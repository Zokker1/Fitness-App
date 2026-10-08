// T111: timebox-ehdotuksen ja kestomuotoilun unit-testit (data-paketti).
// Kriteeri: kesto näkyy suunnittelussa ja timebox-ehdotuksessa.
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import { formatMinutes, sumEstimateMinutes, timeboxSuggestion } from "@lifeos/data";

describe("timeboxSuggestion (T111)", () => {
  it("≤ 45 min: yksi lohko, pyöristys 5 min:lle", () => {
    expect(timeboxSuggestion(25)).toEqual({ minutes: 25, chunks: 1 });
    expect(timeboxSuggestion(23)).toEqual({ minutes: 25, chunks: 1 });
    expect(timeboxSuggestion(45)).toEqual({ minutes: 45, chunks: 1 });
  });

  it("> 45 min: jaetaan 25 min pomodoro-paloihin (§8)", () => {
    expect(timeboxSuggestion(50)).toEqual({ minutes: 50, chunks: 2 });
    expect(timeboxSuggestion(90)).toEqual({ minutes: 90, chunks: 4 });
  });

  it("haaraukset: min 5 min, max 120 min", () => {
    expect(timeboxSuggestion(1)).toEqual({ minutes: 5, chunks: 1 });
    expect(timeboxSuggestion(300)).toEqual({ minutes: 120, chunks: 5 });
  });

  it("epävalidi (0, negatiivinen, NaN) → null", () => {
    expect(timeboxSuggestion(0)).toBeNull();
    expect(timeboxSuggestion(-10)).toBeNull();
    expect(timeboxSuggestion(Number.NaN)).toBeNull();
  });
});

describe("sumEstimateMinutes (T111)", () => {
  function task(estimateMinutes?: Task["estimateMinutes"]): Task {
    const base: Task = {
      id: "t",
      createdAt: "2026-09-10T08:00:00.000Z",
      updatedAt: "1970-01-01T00:00:00.000Z",
      version: 1,
      title: "t",
      notes: null,
      status: "open",
      priority: "normal",
      dueAt: null,
      projectId: null,
      tagIds: [],
      deletedAt: null,
      completedAt: null,
      reopenedAt: null,
    };
    // exactOptionalPropertyTypes: undefined ei kirjoiteta kenttään.
    return estimateMinutes === undefined ? base : { ...base, estimateMinutes };
  }

  it("summaa arviot; nullit ja epävalidit ohitetaan", () => {
    expect(sumEstimateMinutes([task(25), task(45), task(null)])).toBe(70);
    expect(sumEstimateMinutes([task(null), task()])).toBe(0);
    expect(sumEstimateMinutes([])).toBe(0);
  });
});

describe("formatMinutes (T111)", () => {
  it("fi-FI: minuutit, tunnit ja yhdistelmä", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 t");
    expect(formatMinutes(125)).toBe("2 t 5 min");
  });

  it("0 on kelvollinen; epävalidi → null", () => {
    expect(formatMinutes(0)).toBe("0 min");
    expect(formatMinutes(-5)).toBeNull();
    expect(formatMinutes(Number.NaN)).toBeNull();
  });
});
