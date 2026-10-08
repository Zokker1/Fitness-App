// T265: period-based weight insight metrics from append-only measurements.

import type { Measurement, UtcTimestamp } from "@lifeos/domain";
import { isValidLocalDateKey, toLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";

const DAY_MILLISECONDS = 86_400_000;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface WeightInsightDayMetric {
  readonly localDate: string;
  readonly measurementCount: number | null;
  /** Päivän saman yksikön mittausten keskiarvo; puuttuvaa havaintoa ei täytetä. */
  readonly dailyAverage: number | null;
  /** Enintään seitsemän paikallispäivän havaittujen päiväkeskiarvojen keskiarvo. */
  readonly trendValue: number | null;
  readonly trendSampleDayCount: number | null;
}

export interface WeightInsightMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  /** Valitun jakson uusimman kelvollisen mittauksen yksikkö. */
  readonly unit: "kg" | "lb" | null;
  readonly measurementCount: number;
  readonly measurementDayCount: number;
  /** Mittaukset toisessa yksikössä jätetään laskennasta pois, ei muunneta. */
  readonly excludedUnitMeasurementCount: number;
  readonly firstDailyAverage: number | null;
  readonly lastDailyAverage: number | null;
  readonly change: number | null;
  /** Päiväkeskiarvojen muutoksesta laskettu paikallisten kalenteripäivien viikkovauhti. */
  readonly changePerWeek: number | null;
  readonly meanDailyAverage: number | null;
  readonly minimumDailyAverage: number | null;
  readonly maximumDailyAverage: number | null;
  /** Päiväkeskiarvojen populaatiokeskihajonta; kuvaileva vaihteluluku. */
  readonly standardDeviation: number | null;
  readonly trend: readonly WeightInsightDayMetric[];
}

export interface WeightInsightMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Tarkka UTC-hetki sulkee pois myös myöhemmät mittaukset samalta päivältä. */
  readonly now: UtcTimestamp;
  readonly measurements: readonly Measurement[];
}

function invalidWeightMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.weight.invalid-input", message),
  };
}

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
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

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dateOrdinal(localDate: string): number {
  return Date.parse(`${localDate}T00:00:00.000Z`);
}

/** Laskee neutraalit painotrendi-, viikkovauhti- ja vaihteluluvut valitulle jaksolle. */
export function calculateWeightInsightMetrics(
  input: WeightInsightMetricsInput,
): DataResult<WeightInsightMetrics> {
  if (!isValidUtcTimestamp(input.now)) {
    return invalidWeightMetrics("Arviointihetken pitää olla kelvollinen UTC-aikaleima.");
  }
  if (
    !isValidLocalDateKey(input.period.startLocalDate) ||
    !isValidLocalDateKey(input.period.endLocalDate)
  ) {
    return invalidWeightMetrics("Valitse kelvollinen alku- ja loppupäivä.");
  }

  const projected = buildAnalyticsProjection({
    period: input.period,
    entries: input.measurements,
    occurredAt: (measurement) => measurement.measuredAt,
    includeEntry: (measurement) =>
      measurement.type === "weight" &&
      Number.isFinite(measurement.value) &&
      (measurement.unit === "kg" || measurement.unit === "lb"),
  });
  if (!projected.ok) return projected;

  const nowMs = Date.parse(input.now);
  const asOfLocalDate = localDateForInstant(input.now, projected.value.period);
  const periodMeasurements = projected.value.days
    .filter((day) => day.localDate <= asOfLocalDate)
    .flatMap((day) => day.entries)
    .filter((measurement) => Date.parse(measurement.measuredAt) <= nowMs);
  const latest = [...periodMeasurements].sort(
    (left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt),
  )[0];
  const unit = latest?.unit === "kg" || latest?.unit === "lb" ? latest.unit : null;
  const comparable = unit === null ? [] : periodMeasurements.filter((item) => item.unit === unit);
  const excludedUnitMeasurementCount = periodMeasurements.length - comparable.length;

  const dailyValues = new Map<string, number[]>();
  const dailyMeasurementCounts = new Map<string, number>();
  for (const measurement of comparable) {
    const localDate = localDateForInstant(measurement.measuredAt, projected.value.period);
    const values = dailyValues.get(localDate) ?? [];
    values.push(measurement.value);
    dailyValues.set(localDate, values);
    dailyMeasurementCounts.set(localDate, (dailyMeasurementCounts.get(localDate) ?? 0) + 1);
  }

  const dailyAverages = new Map<string, number | null>(
    projected.value.days.map((day) => [day.localDate, mean(dailyValues.get(day.localDate) ?? [])]),
  );
  const trend: WeightInsightDayMetric[] = projected.value.days.map((day, index) => {
    if (day.localDate > asOfLocalDate) {
      return {
        localDate: day.localDate,
        measurementCount: null,
        dailyAverage: null,
        trendValue: null,
        trendSampleDayCount: null,
      };
    }
    const windowStartIndex = Math.max(0, index - 6);
    const windowAverages: number[] = [];
    for (let windowIndex = windowStartIndex; windowIndex <= index; windowIndex += 1) {
      const windowDate = projected.value.days[windowIndex]?.localDate;
      if (windowDate === undefined || windowDate > asOfLocalDate) continue;
      const value = dailyAverages.get(windowDate);
      if (value !== null && value !== undefined) windowAverages.push(value);
    }
    return {
      localDate: day.localDate,
      measurementCount: dailyMeasurementCounts.get(day.localDate) ?? 0,
      dailyAverage: dailyAverages.get(day.localDate) ?? null,
      trendValue: mean(windowAverages),
      trendSampleDayCount: windowAverages.length,
    };
  });

  const observedDailyAverages = projected.value.days
    .filter((day) => day.localDate <= asOfLocalDate)
    .map((day) => dailyAverages.get(day.localDate) ?? null)
    .filter((value): value is number => value !== null);
  const firstDailyAverage = observedDailyAverages[0] ?? null;
  const lastDailyAverage = observedDailyAverages[observedDailyAverages.length - 1] ?? null;
  const firstDate =
    projected.value.days.find(
      (day) =>
        day.localDate <= asOfLocalDate && (dailyAverages.get(day.localDate) ?? null) !== null,
    )?.localDate ?? null;
  let lastDate: string | null = null;
  for (const day of projected.value.days) {
    if (day.localDate <= asOfLocalDate && (dailyAverages.get(day.localDate) ?? null) !== null) {
      lastDate = day.localDate;
    }
  }
  const elapsedDays =
    firstDate === null || lastDate === null
      ? 0
      : (dateOrdinal(lastDate) - dateOrdinal(firstDate)) / DAY_MILLISECONDS;
  const change =
    firstDailyAverage === null || lastDailyAverage === null
      ? null
      : lastDailyAverage - firstDailyAverage;
  const changePerWeek = change === null || elapsedDays <= 0 ? null : (change / elapsedDays) * 7;
  const meanDailyAverage = mean(observedDailyAverages);
  const standardDeviation =
    meanDailyAverage === null
      ? null
      : Math.sqrt(
          observedDailyAverages.reduce((sum, value) => sum + (value - meanDailyAverage) ** 2, 0) /
            observedDailyAverages.length,
        );

  return {
    ok: true,
    value: {
      period: projected.value.period,
      asOfLocalDate,
      unit,
      measurementCount: comparable.length,
      measurementDayCount: observedDailyAverages.length,
      excludedUnitMeasurementCount,
      firstDailyAverage,
      lastDailyAverage,
      change,
      changePerWeek,
      meanDailyAverage,
      minimumDailyAverage:
        observedDailyAverages.length === 0 ? null : Math.min(...observedDailyAverages),
      maximumDailyAverage:
        observedDailyAverages.length === 0 ? null : Math.max(...observedDailyAverages),
      standardDeviation,
      trend,
    },
  };
}
