// T269: descriptive mood and self-reported scale trends.

import {
  MOOD_CHECKIN_SCALE_MAXIMUM,
  MOOD_CHECKIN_SCALE_MINIMUM,
  toLocalDateKey,
} from "@lifeos/domain";
import type { MoodCheckin, MoodCheckinScales, UtcTimestamp } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";
import { weekStartLocalDate } from "./goal-weekly.ts";
import { addDaysIso } from "./recurrence.ts";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
type MoodScaleKey = keyof MoodCheckinScales;

export interface MoodScaleStatistics {
  readonly entryCount: number;
  readonly average: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface MoodScaleSummary {
  readonly mood: MoodScaleStatistics;
  readonly stress: MoodScaleStatistics | null;
  readonly energy: MoodScaleStatistics | null;
  readonly motivation: MoodScaleStatistics | null;
  readonly focus: MoodScaleStatistics | null;
}

export interface MoodEnergyPeriodSummary {
  readonly checkinCount: number;
  readonly daysWithCheckins: number;
  readonly scales: MoodScaleSummary | null;
}

export interface MoodEnergyDayMetric {
  readonly localDate: string;
  readonly future: boolean;
  /** Null only for a future date; zero marks a past day without check-ins. */
  readonly checkinCount: number | null;
  /** Per-scale statistics are null when no check-in or no value exists. */
  readonly scales: MoodScaleSummary | null;
}

export interface MoodEnergyWeekMetric extends MoodEnergyPeriodSummary {
  readonly weekStart: string;
  readonly weekEnd: string;
  /** True when every selected day in this ISO week is in the future. */
  readonly future: boolean;
}

export interface MoodEnergyMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly summary: MoodEnergyPeriodSummary;
  readonly weeks: readonly MoodEnergyWeekMetric[];
  readonly trend: readonly MoodEnergyDayMetric[];
}

export interface MoodEnergyMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Exact UTC time excludes check-ins later on the current local day. */
  readonly now: UtcTimestamp;
  readonly checkins: readonly MoodCheckin[];
}

function invalidMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.mood-energy.invalid-input", message),
  };
}

function validUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function localDateForInstant(timestamp: UtcTimestamp, period: AnalyticsProjectionPeriod): string {
  let offset = period.timezoneOffsetMinutes;
  if (period.timeZone !== undefined && period.timeZone.trim() !== "") {
    try {
      offset = timezoneOffsetMinutesAtInstant(timestamp, period.timeZone) ?? offset;
    } catch {
      offset = period.timezoneOffsetMinutes;
    }
  }
  return toLocalDateKey(timestamp, offset);
}

function isValidScale(value: unknown, nullable: boolean): boolean {
  if (nullable && (value === null || value === undefined)) return true;
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MOOD_CHECKIN_SCALE_MINIMUM &&
    value <= MOOD_CHECKIN_SCALE_MAXIMUM
  );
}

function validMoodCheckin(checkin: MoodCheckin): boolean {
  return (
    isValidScale(checkin.mood, false) &&
    isValidScale(checkin.stress, true) &&
    isValidScale(checkin.energy, true) &&
    isValidScale(checkin.motivation, true) &&
    isValidScale(checkin.focus, true)
  );
}

function scaleValue(checkin: MoodCheckin, key: MoodScaleKey): number | null {
  const value: MoodCheckinScales[MoodScaleKey] = checkin[key];
  return typeof value === "number" ? value : null;
}

function statistics(values: readonly number[]): MoodScaleStatistics | null {
  if (values.length === 0) return null;
  let total = 0;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    total += value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  return {
    entryCount: values.length,
    average: total / values.length,
    minimum,
    maximum,
  };
}

function summarizeScales(checkins: readonly MoodCheckin[]): MoodScaleSummary | null {
  if (checkins.length === 0) return null;
  const getStatistics = (key: MoodScaleKey) =>
    statistics(
      checkins
        .map((checkin) => scaleValue(checkin, key))
        .filter((value): value is number => value !== null),
    );
  const mood = getStatistics("mood");
  if (mood === null) return null;
  return {
    mood,
    stress: getStatistics("stress"),
    energy: getStatistics("energy"),
    motivation: getStatistics("motivation"),
    focus: getStatistics("focus"),
  };
}

function summarizePeriod(
  checkins: readonly MoodCheckin[],
  daysWithCheckins: number,
): MoodEnergyPeriodSummary {
  return {
    checkinCount: checkins.length,
    daysWithCheckins,
    scales: summarizeScales(checkins),
  };
}

/** Laskee käyttäjän omat mieliala- ja itsearvioasteikot ilman tulkintaa. */
export function calculateMoodEnergyMetrics(
  input: MoodEnergyMetricsInput,
): DataResult<MoodEnergyMetrics> {
  if (!validUtcTimestamp(input.now)) {
    return invalidMetrics("Arviointihetken pitää olla kelvollinen UTC-aikaleima.");
  }
  const projected = buildAnalyticsProjection({
    period: input.period,
    entries: input.checkins,
    occurredAt: (checkin) => checkin.checkedAt,
    includeEntry: validMoodCheckin,
  });
  if (!projected.ok) return projected;

  const period = projected.value.period;
  const asOfLocalDate = localDateForInstant(input.now, period);
  const nowMs = Date.parse(input.now);
  const checkinsByDate = new Map<string, MoodCheckin[]>();
  for (const day of projected.value.days) {
    if (day.localDate > asOfLocalDate) continue;
    const entries = day.entries.filter((checkin) => Date.parse(checkin.checkedAt) <= nowMs);
    if (entries.length > 0) checkinsByDate.set(day.localDate, entries);
  }

  const trend: MoodEnergyDayMetric[] = projected.value.days.map((day) => {
    if (day.localDate > asOfLocalDate) {
      return { localDate: day.localDate, future: true, checkinCount: null, scales: null };
    }
    const checkins = checkinsByDate.get(day.localDate) ?? [];
    return {
      localDate: day.localDate,
      future: false,
      checkinCount: checkins.length,
      scales: summarizeScales(checkins),
    };
  });

  const weeksByStart = new Map<string, MoodEnergyDayMetric[]>();
  for (const day of trend) {
    const weekStart = weekStartLocalDate(day.localDate);
    if (weekStart === null) continue;
    const days = weeksByStart.get(weekStart) ?? [];
    days.push(day);
    weeksByStart.set(weekStart, days);
  }
  const weeks = [...weeksByStart.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, days]): MoodEnergyWeekMetric => {
      const checkins = days.flatMap((day) =>
        day.checkinCount === null ? [] : (checkinsByDate.get(day.localDate) ?? []),
      );
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        future: days.every((day) => day.future),
        ...summarizePeriod(checkins, days.filter((day) => (day.checkinCount ?? 0) > 0).length),
      };
    });

  const allCheckins = trend.flatMap((day) =>
    day.checkinCount === null ? [] : (checkinsByDate.get(day.localDate) ?? []),
  );
  const summary = summarizePeriod(
    allCheckins,
    trend.filter((day) => (day.checkinCount ?? 0) > 0).length,
  );
  return {
    ok: true,
    value: { period, asOfLocalDate, summary, weeks, trend },
  };
}
