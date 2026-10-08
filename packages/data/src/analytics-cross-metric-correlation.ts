// T270: descriptive Pearson correlation for selected local-day metric series.

import { isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  ANALYTICS_PROJECTION_MAX_DAYS,
  ANALYTICS_TIMEZONE_OFFSET_MINUTES_MAX,
  ANALYTICS_TIMEZONE_OFFSET_MINUTES_MIN,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";

const DAY_MILLISECONDS = 86_400_000;
export const CROSS_METRIC_CORRELATION_MINIMUM_PAIRED_DAYS = 3;

export interface CrossMetricDailyPoint {
  readonly localDate: string;
  /** Null means the metric was not measured that day; zero remains a real value. */
  readonly value: number | null;
}

export interface CrossMetricSeriesInput {
  /** Stable key selected by the caller. The two compared keys must differ. */
  readonly key: string;
  readonly label: string;
  readonly unit: string | null;
  /** At most one daily value per local date; pre-aggregate within-day events. */
  readonly points: readonly CrossMetricDailyPoint[];
}

export interface CrossMetricCorrelationInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Local evaluation date; values from later dates are excluded. */
  readonly asOfLocalDate: string;
  readonly first: CrossMetricSeriesInput;
  readonly second: CrossMetricSeriesInput;
}

export interface CrossMetricPairedDay {
  readonly localDate: string;
  readonly firstValue: number;
  readonly secondValue: number;
}

export type CrossMetricCorrelationStatus = "computed" | "insufficient-data" | "constant-series";

export interface CrossMetricCorrelation {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly first: Pick<CrossMetricSeriesInput, "key" | "label" | "unit">;
  readonly second: Pick<CrossMetricSeriesInput, "key" | "label" | "unit">;
  /** Pearson r for matched local days; null when a useful value cannot be computed. */
  readonly pearsonR: number | null;
  readonly pairedDayCount: number;
  readonly status: CrossMetricCorrelationStatus;
  /** Aligned daily values support inspection and scatter plots. */
  readonly pairedDays: readonly CrossMetricPairedDay[];
  /** Correlation describes co-movement; it does not infer cause or significance. */
  readonly interpretation: "descriptive-correlation-only";
}

function invalidCorrelation<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.cross-metric.invalid-input", message),
  };
}

function dateOrdinal(localDate: string): number {
  return Date.parse(`${localDate}T00:00:00.000Z`);
}

function validPeriod(period: AnalyticsProjectionPeriod): boolean {
  if (
    !isValidLocalDateKey(period.startLocalDate) ||
    !isValidLocalDateKey(period.endLocalDate) ||
    period.startLocalDate > period.endLocalDate ||
    !Number.isInteger(period.timezoneOffsetMinutes) ||
    period.timezoneOffsetMinutes < ANALYTICS_TIMEZONE_OFFSET_MINUTES_MIN ||
    period.timezoneOffsetMinutes > ANALYTICS_TIMEZONE_OFFSET_MINUTES_MAX
  ) {
    return false;
  }
  const dayCount =
    (dateOrdinal(period.endLocalDate) - dateOrdinal(period.startLocalDate)) / DAY_MILLISECONDS + 1;
  return dayCount <= ANALYTICS_PROJECTION_MAX_DAYS;
}

function valuesByDate(
  series: CrossMetricSeriesInput,
  period: AnalyticsProjectionPeriod,
  asOfLocalDate: string,
): Map<string, number> | null {
  if (
    series.key.trim().length === 0 ||
    series.label.trim().length === 0 ||
    !Array.isArray(series.points)
  ) {
    return null;
  }
  const values = new Map<string, number>();
  const seenDates = new Set<string>();
  const rawPoints: readonly unknown[] = series.points;
  for (const rawPoint of rawPoints) {
    if (typeof rawPoint !== "object" || rawPoint === null || Array.isArray(rawPoint)) return null;
    const point = rawPoint as Record<string, unknown>;
    const localDate = point.localDate;
    const value = point.value;
    if (
      typeof localDate !== "string" ||
      !isValidLocalDateKey(localDate) ||
      (value !== null && (typeof value !== "number" || !Number.isFinite(value))) ||
      seenDates.has(localDate)
    ) {
      return null;
    }
    seenDates.add(localDate);
    if (
      value !== null &&
      localDate >= period.startLocalDate &&
      localDate <= period.endLocalDate &&
      localDate <= asOfLocalDate
    ) {
      values.set(localDate, value);
    }
  }
  return values;
}

function pearsonCorrelation(pairs: readonly CrossMetricPairedDay[]): number | null {
  if (pairs.length < CROSS_METRIC_CORRELATION_MINIMUM_PAIRED_DAYS) return null;

  // Scaling first keeps sums and products in a stable range without changing r.
  let firstScale = 0;
  let secondScale = 0;
  for (const pair of pairs) {
    firstScale = Math.max(firstScale, Math.abs(pair.firstValue));
    secondScale = Math.max(secondScale, Math.abs(pair.secondValue));
  }
  if (firstScale === 0 || secondScale === 0) return null;

  const firstValues = pairs.map((pair) => pair.firstValue / firstScale);
  const secondValues = pairs.map((pair) => pair.secondValue / secondScale);
  const firstMean = firstValues.reduce((sum, value) => sum + value, 0) / pairs.length;
  const secondMean = secondValues.reduce((sum, value) => sum + value, 0) / pairs.length;
  let covariance = 0;
  let firstVariance = 0;
  let secondVariance = 0;
  for (let index = 0; index < pairs.length; index += 1) {
    const firstDeviation = (firstValues[index] ?? 0) - firstMean;
    const secondDeviation = (secondValues[index] ?? 0) - secondMean;
    covariance += firstDeviation * secondDeviation;
    firstVariance += firstDeviation * firstDeviation;
    secondVariance += secondDeviation * secondDeviation;
  }
  if (firstVariance === 0 || secondVariance === 0) return null;
  return Math.max(-1, Math.min(1, covariance / Math.sqrt(firstVariance * secondVariance)));
}

/** Vertaa kahta valittua paikallispäivien aikasarjaa Pearsonin korrelaatiolla. */
export function calculateCrossMetricCorrelation(
  input: CrossMetricCorrelationInput,
): DataResult<CrossMetricCorrelation> {
  if (!validPeriod(input.period)) {
    return invalidCorrelation("Valittu aikaväli tai aikavyöhyke ei kelpaa.");
  }
  if (!isValidLocalDateKey(input.asOfLocalDate)) {
    return invalidCorrelation("Arviointipäivän pitää olla kelvollinen paikallispäivä.");
  }
  if (input.first.key === input.second.key) {
    return invalidCorrelation("Valitse kaksi eri mittaria vertailuun.");
  }

  const firstValues = valuesByDate(input.first, input.period, input.asOfLocalDate);
  const secondValues = valuesByDate(input.second, input.period, input.asOfLocalDate);
  if (firstValues === null || secondValues === null) {
    return invalidCorrelation(
      "Mittarisarjojen avaimen, nimen, yksikön ja päiväarvojen pitää olla kelvollisia ilman päivätuplikaatteja.",
    );
  }

  const pairedDays: CrossMetricPairedDay[] = [...firstValues.entries()]
    .filter(([localDate]) => secondValues.has(localDate))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([localDate, firstValue]) => ({
      localDate,
      firstValue,
      secondValue: secondValues.get(localDate) ?? 0,
    }));
  const pearsonR = pearsonCorrelation(pairedDays);
  const status: CrossMetricCorrelationStatus =
    pairedDays.length < CROSS_METRIC_CORRELATION_MINIMUM_PAIRED_DAYS
      ? "insufficient-data"
      : pearsonR === null
        ? "constant-series"
        : "computed";

  return {
    ok: true,
    value: {
      period: input.period,
      asOfLocalDate: input.asOfLocalDate,
      first: { key: input.first.key, label: input.first.label, unit: input.first.unit },
      second: { key: input.second.key, label: input.second.label, unit: input.second.unit },
      pearsonR,
      pairedDayCount: pairedDays.length,
      status,
      pairedDays,
      interpretation: "descriptive-correlation-only",
    },
  };
}
