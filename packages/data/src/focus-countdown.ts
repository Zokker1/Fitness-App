// T162: tarkka focus-countdown (puhdas timestamp-laskenta, ei interval-IO:ta).
// Jokainen snapshot lasketaan uudelleen startedAt/now-aikaleimoista. UI voi
// päivittää näyttöä millä tahansa rytmillä ilman että rytmi määrittää aikaa.

import type { UtcTimestamp } from "@lifeos/domain";

export interface FocusCountdownInput {
  readonly startedAt: UtcTimestamp | null;
  readonly durationSeconds: number | null;
  readonly now: UtcTimestamp;
  /** T162:n laajennuspiste taukojen kumulatiiviselle kestolle. */
  readonly accumulatedPauseSeconds?: number;
}

export interface FocusCountdownSnapshot {
  readonly totalSeconds: number;
  readonly elapsedSeconds: number;
  readonly remainingSeconds: number;
  /** 0–1; 1 tarkoittaa, että työvaiheen aika on täynnä. */
  readonly progress: number;
  readonly isComplete: boolean;
}

function validTimestamp(value: UtcTimestamp): boolean {
  return !Number.isNaN(Date.parse(value));
}

function validDuration(value: number | null): value is number {
  return value !== null && Number.isInteger(value) && value >= 0;
}

/**
 * Laskee yhden totuuden snapshotin. `setInterval`/renderöintikerrat eivät
 * vaikuta tulokseen; vain annetut UTC-aikaleimat ja kesto ratkaisevat.
 */
export function calculateFocusCountdown(input: FocusCountdownInput): FocusCountdownSnapshot | null {
  if (
    input.startedAt === null ||
    !validTimestamp(input.startedAt) ||
    !validTimestamp(input.now) ||
    !validDuration(input.durationSeconds)
  ) {
    return null;
  }

  const accumulatedPauseSeconds = input.accumulatedPauseSeconds ?? 0;
  if (!Number.isInteger(accumulatedPauseSeconds) || accumulatedPauseSeconds < 0) {
    return null;
  }

  const elapsedWallSeconds = Math.max(
    0,
    Math.floor((Date.parse(input.now) - Date.parse(input.startedAt)) / 1000),
  );
  const elapsedSeconds = Math.max(0, elapsedWallSeconds - accumulatedPauseSeconds);
  const remainingSeconds = Math.max(0, input.durationSeconds - elapsedSeconds);
  const progress =
    input.durationSeconds === 0 ? 1 : Math.min(1, elapsedSeconds / input.durationSeconds);

  return {
    totalSeconds: input.durationSeconds,
    elapsedSeconds,
    remainingSeconds,
    progress,
    isComplete: remainingSeconds === 0,
  };
}

/** Kevyt lukija näkymille, jotka tarvitsevat vain jäljellä olevan ajan. */
export function remainingFocusSeconds(input: FocusCountdownInput): number | null {
  return calculateFocusCountdown(input)?.remainingSeconds ?? null;
}
