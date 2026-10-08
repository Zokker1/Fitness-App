// T087: summarizeTodayFocus unit-testit (data-paketti, ei IO:ta).
// - Minuutit vain completed-istunnoista (running/paused eivät ole suoritusta);
//   käynnissä raportoidaan erikseen kuluneine minuutteineen; tyhjä → nollat
//   ilman moitetta; menneet päivät eivät vuoda mukaan.
import { describe, expect, it } from "vitest";
import type { FocusSession } from "@lifeos/domain";
import { summarizeTodayFocus, type TodayFocusInput } from "@lifeos/data";

const NOW = "2026-09-18T09:30:00.000Z";
const LOCAL_DATE = "2026-09-18";
const OFFSET = 180;
const AT = NOW;

function session(id: string, overrides: Partial<FocusSession> = {}): FocusSession {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    taskId: null,
    routineId: null,
    phase: "completed",
    startedAt: "2026-09-18T08:00:00.000Z",
    endedAt: "2026-09-18T08:25:00.000Z",
    durationSeconds: 1500,
    ...overrides,
  };
}

function baseInput(overrides: Partial<TodayFocusInput> = {}): TodayFocusInput {
  return {
    now: NOW,
    localDate: LOCAL_DATE,
    timezoneOffsetMinutes: OFFSET,
    sessions: [],
    ...overrides,
  };
}

describe("summarizeTodayFocus (T087)", () => {
  it("tyhjä → nollat ilman runningia (ei moitetta)", () => {
    expect(summarizeTodayFocus(baseInput())).toEqual({
      minutesToday: 0,
      sessionsToday: 0,
      running: null,
      runningElapsedMinutes: null,
    });
  });

  it("vain completed lasketaan; running/paused erikseen; eiliset pois", () => {
    const summary = summarizeTodayFocus(
      baseInput({
        sessions: [
          session("f-done-1"),
          session("f-done-2", {
            startedAt: "2026-09-18T07:00:00.000Z",
            endedAt: "2026-09-18T07:10:00.000Z",
            durationSeconds: 600,
          }),
          session("f-run", {
            phase: "running",
            startedAt: "2026-09-18T09:00:00.000Z",
            endedAt: null,
            durationSeconds: null,
          }),
          session("f-paused", {
            phase: "paused",
            startedAt: "2026-09-18T08:30:00.000Z",
            endedAt: null,
            durationSeconds: null,
          }),
          session("f-old", {
            startedAt: "2026-09-17T08:00:00.000Z",
            endedAt: "2026-09-17T08:25:00.000Z",
          }),
        ],
      }),
    );
    // 25 + 10 min completed; running erikseen (30 min kulunut 09:00→09:30).
    expect(summary.minutesToday).toBe(35);
    expect(summary.sessionsToday).toBe(2);
    expect(summary.running?.id).toBe("f-run");
    expect(summary.runningElapsedMinutes).toBe(30);
  });

  it("useampi running → aikaisin aloitettu (data ei valehtele määrää)", () => {
    const summary = summarizeTodayFocus(
      baseInput({
        sessions: [
          session("f-late", {
            phase: "running",
            startedAt: "2026-09-18T09:10:00.000Z",
            endedAt: null,
            durationSeconds: null,
          }),
          session("f-early", {
            phase: "running",
            startedAt: "2026-09-18T08:50:00.000Z",
            endedAt: null,
            durationSeconds: null,
          }),
        ],
      }),
    );
    expect(summary.running?.id).toBe("f-early");
    expect(summary.runningElapsedMinutes).toBe(40);
    expect(summary.minutesToday).toBe(0);
  });
});
