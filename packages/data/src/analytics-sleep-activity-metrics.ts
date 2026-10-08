// T267: period-based sleep and activity trends from local entries.

import type { ActivityEntry, SleepEntry, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";
import { weekStartLocalDate } from "./goal-weekly.ts";
import { addDaysIso } from "./recurrence.ts";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface SleepDayMetric {
  readonly entryCount: number;
  readonly nightCount: number;
  readonly napCount: number;
  readonly totalDurationSeconds: number;
  readonly overnightDurationSeconds: number;
  readonly napDurationSeconds: number;
  readonly averageQuality: number | null;
  readonly qualityEntryCount: number;
}

export interface ActivityKindMetric {
  readonly kind: string;
  readonly activityCount: number;
  readonly durationEntryCount: number;
  readonly recordedDurationSeconds: number | null;
  readonly distanceEntryCount: number;
  readonly recordedDistanceMeters: number | null;
}

export interface ActivityDayMetric {
  readonly entryCount: number;
  readonly durationEntryCount: number;
  /** Sum of logged duration fields; coverage is given by durationEntryCount. */
  readonly recordedDurationSeconds: number | null;
  readonly distanceEntryCount: number;
  readonly recordedDistanceMeters: number | null;
  readonly byKind: readonly ActivityKindMetric[];
}

export interface SleepActivityDayMetric {
  readonly localDate: string;
  /** Sleep is attributed to the local date on which the interval ends. */
  readonly sleep: SleepDayMetric | null;
  readonly activity: ActivityDayMetric | null;
}

export interface SleepPeriodMetric {
  readonly entryCount: number;
  readonly nightCount: number;
  readonly napCount: number;
  readonly daysWithSleep: number;
  readonly totalDurationSeconds: number;
  readonly overnightDurationSeconds: number;
  readonly napDurationSeconds: number;
  readonly averageDurationSecondsPerSleepDay: number | null;
  readonly averageOvernightSecondsPerNight: number | null;
  readonly averageQuality: number | null;
  readonly qualityEntryCount: number;
}

export interface ActivityPeriodMetric {
  readonly entryCount: number;
  readonly daysWithActivity: number;
  readonly durationEntryCount: number;
  readonly recordedDurationSeconds: number | null;
  readonly averageDurationSecondsPerRecordedEntry: number | null;
  readonly distanceEntryCount: number;
  readonly recordedDistanceMeters: number | null;
  readonly averageDistanceMetersPerRecordedEntry: number | null;
  readonly byKind: readonly ActivityKindMetric[];
}

export interface SleepActivityWeekMetric {
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly future: boolean;
  readonly sleep: SleepPeriodMetric;
  readonly activity: ActivityPeriodMetric;
}

export interface SleepActivityMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly sleep: SleepPeriodMetric;
  readonly activity: ActivityPeriodMetric;
  readonly weeks: readonly SleepActivityWeekMetric[];
  readonly trend: readonly SleepActivityDayMetric[];
}

export interface SleepActivityMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Exact UTC time excludes future-dated entries on the current local day. */
  readonly now: UtcTimestamp;
  readonly sleepEntries: readonly SleepEntry[];
  readonly activityEntries: readonly ActivityEntry[];
}

function invalidMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.sleep-activity.invalid-input", message),
  };
}

function validUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function dateAt(timestamp: UtcTimestamp, period: AnalyticsProjectionPeriod): string {
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

function mean(values: readonly number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function validSleepInterval(entry: SleepEntry, nowMs: number): boolean {
  const startMs = Date.parse(entry.sleepStart);
  const endMs = Date.parse(entry.sleepEnd);
  return (
    entry.deletedAt === null &&
    validUtcTimestamp(entry.sleepStart) &&
    validUtcTimestamp(entry.sleepEnd) &&
    endMs > startMs &&
    endMs <= nowMs
  );
}

function validActivityEntry(entry: ActivityEntry): boolean {
  return (
    entry.deletedAt === null &&
    typeof entry.kind === "string" &&
    entry.kind.trim().length > 0 &&
    (entry.durationSeconds === null ||
      (Number.isInteger(entry.durationSeconds) && entry.durationSeconds >= 0)) &&
    (entry.distanceMeters === null ||
      (Number.isFinite(entry.distanceMeters) && entry.distanceMeters >= 0))
  );
}

function summarizeSleep(
  entries: readonly SleepEntry[],
  period: AnalyticsProjectionPeriod,
): SleepPeriodMetric {
  let nightCount = 0;
  let napCount = 0;
  let totalDurationSeconds = 0;
  let overnightDurationSeconds = 0;
  let napDurationSeconds = 0;
  const qualityValues: number[] = [];
  for (const entry of entries) {
    const durationSeconds = (Date.parse(entry.sleepEnd) - Date.parse(entry.sleepStart)) / 1000;
    const isNap = entry.isNap ?? false;
    if (isNap) {
      napCount += 1;
      napDurationSeconds += durationSeconds;
    } else {
      nightCount += 1;
      overnightDurationSeconds += durationSeconds;
    }
    totalDurationSeconds += durationSeconds;
    if (
      entry.quality !== null &&
      Number.isInteger(entry.quality) &&
      entry.quality >= 1 &&
      entry.quality <= 5
    ) {
      qualityValues.push(entry.quality);
    }
  }
  const daysWithSleep = new Set(entries.map((entry) => dateAt(entry.sleepEnd, period))).size;
  return {
    entryCount: entries.length,
    nightCount,
    napCount,
    daysWithSleep,
    totalDurationSeconds,
    overnightDurationSeconds,
    napDurationSeconds,
    averageDurationSecondsPerSleepDay:
      daysWithSleep === 0 ? null : totalDurationSeconds / daysWithSleep,
    averageOvernightSecondsPerNight:
      nightCount === 0 ? null : overnightDurationSeconds / nightCount,
    averageQuality: mean(qualityValues),
    qualityEntryCount: qualityValues.length,
  };
}

function summarizeActivityDays(days: readonly ActivityDayMetric[]): ActivityPeriodMetric {
  const byKind = new Map<
    string,
    {
      activityCount: number;
      durationEntryCount: number;
      recordedDurationSeconds: number;
      distanceEntryCount: number;
      recordedDistanceMeters: number;
    }
  >();
  for (const day of days) {
    for (const kindMetric of day.byKind) {
      const aggregate = byKind.get(kindMetric.kind) ?? {
        activityCount: 0,
        durationEntryCount: 0,
        recordedDurationSeconds: 0,
        distanceEntryCount: 0,
        recordedDistanceMeters: 0,
      };
      aggregate.activityCount += kindMetric.activityCount;
      aggregate.durationEntryCount += kindMetric.durationEntryCount;
      aggregate.recordedDurationSeconds += kindMetric.recordedDurationSeconds ?? 0;
      aggregate.distanceEntryCount += kindMetric.distanceEntryCount;
      aggregate.recordedDistanceMeters += kindMetric.recordedDistanceMeters ?? 0;
      byKind.set(kindMetric.kind, aggregate);
    }
  }
  const activityCount = days.reduce((sum, day) => sum + day.entryCount, 0);
  const durationEntryCount = days.reduce((sum, day) => sum + day.durationEntryCount, 0);
  const distanceEntryCount = days.reduce((sum, day) => sum + day.distanceEntryCount, 0);
  const recordedDurationSeconds = days.reduce(
    (sum, day) => sum + (day.recordedDurationSeconds ?? 0),
    0,
  );
  const recordedDistanceMeters = days.reduce(
    (sum, day) => sum + (day.recordedDistanceMeters ?? 0),
    0,
  );
  return {
    entryCount: activityCount,
    daysWithActivity: days.filter((day) => day.entryCount > 0).length,
    durationEntryCount,
    recordedDurationSeconds: durationEntryCount === 0 ? null : recordedDurationSeconds,
    averageDurationSecondsPerRecordedEntry:
      durationEntryCount === 0 ? null : recordedDurationSeconds / durationEntryCount,
    distanceEntryCount,
    recordedDistanceMeters: distanceEntryCount === 0 ? null : recordedDistanceMeters,
    averageDistanceMetersPerRecordedEntry:
      distanceEntryCount === 0 ? null : recordedDistanceMeters / distanceEntryCount,
    byKind: [...byKind.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, values]): ActivityKindMetric => ({
        kind,
        activityCount: values.activityCount,
        durationEntryCount: values.durationEntryCount,
        recordedDurationSeconds:
          values.durationEntryCount === 0 ? null : values.recordedDurationSeconds,
        distanceEntryCount: values.distanceEntryCount,
        recordedDistanceMeters:
          values.distanceEntryCount === 0 ? null : values.recordedDistanceMeters,
      })),
  };
}

function activityDay(entries: readonly ActivityEntry[]): ActivityDayMetric | null {
  if (entries.length === 0) return null;
  const byKind = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const kind = entry.kind.trim();
    const matching = byKind.get(kind) ?? [];
    matching.push(entry);
    byKind.set(kind, matching);
  }
  const durationEntries = entries.filter((entry) => entry.durationSeconds !== null);
  const distanceEntries = entries.filter((entry) => entry.distanceMeters !== null);
  return {
    entryCount: entries.length,
    durationEntryCount: durationEntries.length,
    recordedDurationSeconds:
      durationEntries.length === 0
        ? null
        : durationEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0),
    distanceEntryCount: distanceEntries.length,
    recordedDistanceMeters:
      distanceEntries.length === 0
        ? null
        : distanceEntries.reduce((sum, entry) => sum + (entry.distanceMeters ?? 0), 0),
    byKind: [...byKind.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, kindEntries]): ActivityKindMetric => {
        const kindDurationEntries = kindEntries.filter((entry) => entry.durationSeconds !== null);
        const kindDistanceEntries = kindEntries.filter((entry) => entry.distanceMeters !== null);
        return {
          kind,
          activityCount: kindEntries.length,
          durationEntryCount: kindDurationEntries.length,
          recordedDurationSeconds:
            kindDurationEntries.length === 0
              ? null
              : kindDurationEntries.reduce((sum, entry) => sum + (entry.durationSeconds ?? 0), 0),
          distanceEntryCount: kindDistanceEntries.length,
          recordedDistanceMeters:
            kindDistanceEntries.length === 0
              ? null
              : kindDistanceEntries.reduce((sum, entry) => sum + (entry.distanceMeters ?? 0), 0),
        };
      }),
  };
}

function sleepDay(
  entries: readonly SleepEntry[],
  period: AnalyticsProjectionPeriod,
): SleepDayMetric | null {
  if (entries.length === 0) return null;
  const summary = summarizeSleep(entries, period);
  return {
    entryCount: summary.entryCount,
    nightCount: summary.nightCount,
    napCount: summary.napCount,
    totalDurationSeconds: summary.totalDurationSeconds,
    overnightDurationSeconds: summary.overnightDurationSeconds,
    napDurationSeconds: summary.napDurationSeconds,
    averageQuality: summary.averageQuality,
    qualityEntryCount: summary.qualityEntryCount,
  };
}

/** Laskee unijaksot heräämispäivälle ja aktiviteetit paikalliselle aloituspäivälle. */
export function calculateSleepActivityMetrics(
  input: SleepActivityMetricsInput,
): DataResult<SleepActivityMetrics> {
  if (!validUtcTimestamp(input.now)) {
    return invalidMetrics("Arviointihetken pitää olla kelvollinen UTC-aikaleima.");
  }
  const nowMs = Date.parse(input.now);
  const sleepProjection = buildAnalyticsProjection({
    period: input.period,
    entries: input.sleepEntries,
    occurredAt: (entry) => entry.sleepEnd,
    includeEntry: (entry) => validSleepInterval(entry, nowMs),
  });
  if (!sleepProjection.ok) return sleepProjection;
  const activityProjection = buildAnalyticsProjection({
    period: input.period,
    entries: input.activityEntries,
    occurredAt: (entry) => entry.activityAt,
    includeEntry: validActivityEntry,
  });
  if (!activityProjection.ok) return activityProjection;

  const period = sleepProjection.value.period;
  const asOfLocalDate = dateAt(input.now, period);
  const sleepsByDate = new Map<string, SleepEntry[]>();
  for (const day of sleepProjection.value.days) {
    if (day.localDate > asOfLocalDate) continue;
    const entries = day.entries.filter((entry) => Date.parse(entry.sleepEnd) <= nowMs);
    if (entries.length > 0) sleepsByDate.set(day.localDate, entries);
  }
  const activitiesByDate = new Map<string, ActivityEntry[]>();
  for (const day of activityProjection.value.days) {
    if (day.localDate > asOfLocalDate) continue;
    const entries = day.entries.filter((entry) => Date.parse(entry.activityAt) <= nowMs);
    if (entries.length > 0) activitiesByDate.set(day.localDate, entries);
  }

  const trend: SleepActivityDayMetric[] = sleepProjection.value.days.map((day) => {
    if (day.localDate > asOfLocalDate) {
      return { localDate: day.localDate, sleep: null, activity: null };
    }
    return {
      localDate: day.localDate,
      sleep: sleepDay(sleepsByDate.get(day.localDate) ?? [], period),
      activity: activityDay(activitiesByDate.get(day.localDate) ?? []),
    };
  });

  const weeksByStart = new Map<string, SleepActivityDayMetric[]>();
  for (const day of trend) {
    const weekStart = weekStartLocalDate(day.localDate);
    if (weekStart === null) continue;
    const weekDays = weeksByStart.get(weekStart) ?? [];
    weekDays.push(day);
    weeksByStart.set(weekStart, weekDays);
  }
  const weeks = [...weeksByStart.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, weekDays]): SleepActivityWeekMetric => {
      const sleepEntries = weekDays.flatMap((day) =>
        day.sleep === null ? [] : (sleepsByDate.get(day.localDate) ?? []),
      );
      const activityDays = weekDays.flatMap((day) => (day.activity === null ? [] : [day.activity]));
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        future: weekDays.every((day) => day.localDate > asOfLocalDate),
        sleep: summarizeSleep(sleepEntries, period),
        activity: summarizeActivityDays(activityDays),
      };
    });

  const allSleepEntries = trend.flatMap((day) =>
    day.sleep === null ? [] : (sleepsByDate.get(day.localDate) ?? []),
  );
  const activityDays = trend.flatMap((day) => (day.activity === null ? [] : [day.activity]));
  return {
    ok: true,
    value: {
      period,
      asOfLocalDate,
      sleep: summarizeSleep(allSleepEntries, period),
      activity: summarizeActivityDays(activityDays),
      weeks,
      trend,
    },
  };
}
