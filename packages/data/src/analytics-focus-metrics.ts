// T262: fokusminuutit, valmiit istunnot ja niiden päivittäinen trendi.

import type { FocusSession } from "@lifeos/domain";
import { isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";

export interface FocusDayMetric {
  readonly localDate: string;
  readonly completedSessionCount: number;
  /** Toteutunut aktiivinen aika sekunteina; tauot eivät sisälly. */
  readonly focusedSeconds: number | null;
  /** Pyöristetty lähimpään minuuttiin kuten fokusnäkymän viikkotilastossa. */
  readonly focusedMinutes: number | null;
}

export interface FocusMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly completedSessionCount: number;
  readonly focusedSeconds: number;
  readonly focusedMinutes: number;
  readonly trend: readonly FocusDayMetric[];
}

export interface FocusMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Kutsujan paikallinen arviointipäivä; tulevat päivät eivät saa nollapisteitä. */
  readonly asOfLocalDate: string;
  readonly sessions: readonly FocusSession[];
}

function invalidFocusMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.focus.invalid-input", message),
  };
}

function activeSeconds(session: FocusSession): number | null {
  const seconds = session.activeElapsedSeconds ?? session.durationSeconds;
  if (seconds === null || !Number.isFinite(seconds)) return null;
  return Math.max(0, Math.floor(seconds));
}

function roundedMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

/**
 * Laskee vain valmiit istunnot. Toteutunut aktiivinen aika käyttää
 * activeElapsedSeconds-arvoa (tauot poistettu) ja vanhan datan varana
 * durationSeconds-arvoa. Istunto kohdistetaan sen paikalliseen aloituspäivään,
 * kuten TodayFocus- ja FocusWeeklyStats-näkymissä.
 */
export function calculateFocusMetrics(input: FocusMetricsInput): DataResult<FocusMetrics> {
  if (!isValidLocalDateKey(input.asOfLocalDate)) {
    return invalidFocusMetrics("Arviointipäivän pitää olla kelvollinen paikallispäivä.");
  }

  const projected = buildAnalyticsProjection({
    period: input.period,
    entries: input.sessions,
    occurredAt: (session) =>
      session.phase === "completed" && activeSeconds(session) !== null ? session.startedAt : null,
    includeEntry: (session) => session.phase === "completed",
  });
  if (!projected.ok) return projected;

  const trend = projected.value.days.map((day): FocusDayMetric => {
    if (day.localDate > input.asOfLocalDate) {
      return {
        localDate: day.localDate,
        completedSessionCount: 0,
        focusedSeconds: null,
        focusedMinutes: null,
      };
    }

    const focusedSeconds = day.entries.reduce(
      (total, session) => total + (activeSeconds(session) ?? 0),
      0,
    );
    return {
      localDate: day.localDate,
      completedSessionCount: day.entries.length,
      focusedSeconds,
      focusedMinutes: roundedMinutes(focusedSeconds),
    };
  });

  const evaluatedDays = trend.filter((day) => day.focusedSeconds !== null);
  const completedSessionCount = evaluatedDays.reduce(
    (total, day) => total + day.completedSessionCount,
    0,
  );
  const focusedSeconds = evaluatedDays.reduce((total, day) => total + (day.focusedSeconds ?? 0), 0);

  return {
    ok: true,
    value: {
      period: projected.value.period,
      asOfLocalDate: input.asOfLocalDate,
      completedSessionCount,
      focusedSeconds,
      focusedMinutes: roundedMinutes(focusedSeconds),
      trend,
    },
  };
}
