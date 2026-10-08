// T163: tabin taustalta paluu pakottaa timestamp-snapshotin päivityksen.
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useFocusCountdown } from "../src/focus/useFocusCountdown.ts";

const START = "2026-09-21T10:00:00.000Z";
const originalVisibility = document.visibilityState;

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  setVisibility(originalVisibility);
});

describe("useFocusCountdown", () => {
  it("päivittää heti kun välilehti palaa taustalta", () => {
    let currentNow = START;
    const { result } = renderHook(() =>
      useFocusCountdown({
        startedAt: START,
        durationSeconds: 1500,
        now: () => currentNow,
      }),
    );

    expect(result.current.snapshot?.remainingSeconds).toBe(1500);
    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isVisible).toBe(false);

    currentNow = "2026-09-21T10:08:20.000Z";
    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current.isVisible).toBe(true);
    expect(result.current.snapshot).toMatchObject({
      elapsedSeconds: 500,
      remainingSeconds: 1000,
      progress: 1 / 3,
      isComplete: false,
    });
  });

  it("intervalin viive ei muuta timestamp-totuutta", () => {
    let currentNow = START;
    const { result } = renderHook(() =>
      useFocusCountdown({
        startedAt: START,
        durationSeconds: 1500,
        now: () => currentNow,
      }),
    );

    currentNow = "2026-09-21T10:01:37.900Z";
    act(() => {
      result.current.refresh();
    });
    expect(result.current.snapshot?.elapsedSeconds).toBe(97);
    expect(result.current.snapshot?.remainingSeconds).toBe(1403);
  });

  it("ei käynnistä countdownia ilman validia session lähtöä", () => {
    const { result } = renderHook(() =>
      useFocusCountdown({
        startedAt: null,
        durationSeconds: null,
        now: () => START,
      }),
    );
    expect(result.current.snapshot).toBeNull();
  });
});
