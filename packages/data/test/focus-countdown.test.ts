// T162: timestamp-countdown ei riipu interval-tickien määrästä.
import { describe, expect, it } from "vitest";
import { calculateFocusCountdown, remainingFocusSeconds } from "../src/index.ts";

const START = "2026-09-21T10:00:00.000Z";

describe("focus countdown", () => {
  it("laskee kuluneen ja jäljellä olevan ajan aikaleimoista", () => {
    expect(
      calculateFocusCountdown({
        startedAt: START,
        durationSeconds: 1500,
        now: "2026-09-21T10:03:12.900Z",
      }),
    ).toEqual({
      totalSeconds: 1500,
      elapsedSeconds: 192,
      remainingSeconds: 1308,
      progress: 192 / 1500,
      isComplete: false,
    });
  });

  it("ei driftää, vaikka seuraava renderöinti tulee myöhässä", () => {
    const snapshot = calculateFocusCountdown({
      startedAt: START,
      durationSeconds: 1500,
      now: "2026-09-21T10:37:44.250Z",
    });
    expect(snapshot?.elapsedSeconds).toBe(2264);
    expect(snapshot?.remainingSeconds).toBe(0);
    expect(snapshot?.progress).toBe(1);
    expect(snapshot?.isComplete).toBe(true);
    expect(
      remainingFocusSeconds({
        startedAt: START,
        durationSeconds: 1500,
        now: "2026-09-21T10:37:44.250Z",
      }),
    ).toBe(0);
  });

  it("vähentää tunnetun kumulatiivisen taukoajan vain kerran", () => {
    const snapshot = calculateFocusCountdown({
      startedAt: START,
      durationSeconds: 1500,
      now: "2026-09-21T10:10:00.000Z",
      accumulatedPauseSeconds: 120,
    });
    expect(snapshot?.elapsedSeconds).toBe(480);
    expect(snapshot?.remainingSeconds).toBe(1020);
  });

  it("pysyy rajoissa ennen alkua ja nollassa lopun jälkeen", () => {
    expect(
      calculateFocusCountdown({
        startedAt: START,
        durationSeconds: 1500,
        now: "2026-09-21T09:59:00.000Z",
      }),
    ).toMatchObject({ elapsedSeconds: 0, remainingSeconds: 1500, progress: 0 });
    expect(
      calculateFocusCountdown({
        startedAt: START,
        durationSeconds: 0,
        now: START,
      }),
    ).toMatchObject({ elapsedSeconds: 0, remainingSeconds: 0, progress: 1, isComplete: true });
  });

  it("palauttaa nullin puuttuvasta tai virheellisestä syötteestä", () => {
    expect(
      calculateFocusCountdown({ startedAt: null, durationSeconds: 1500, now: START }),
    ).toBeNull();
    expect(
      calculateFocusCountdown({
        startedAt: "not-a-date",
        durationSeconds: 1500,
        now: START,
      }),
    ).toBeNull();
    expect(
      calculateFocusCountdown({ startedAt: START, durationSeconds: 1.5, now: START }),
    ).toBeNull();
  });
});
