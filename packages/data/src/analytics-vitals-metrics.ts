// T268: period-based blood pressure and vital measurement statistics.

import {
  getMeasurementTypeDefinition,
  getMeasurementUnitDefinition,
  isBloodPressureContext,
  isMeasurementType,
  normalizeMeasurementMetricName,
  BLOOD_PRESSURE_PULSE_RANGE,
  containsControlCharacters,
  MEASUREMENT_UNIT_MAX_LENGTH,
} from "@lifeos/domain";
import type {
  BloodPressureContext,
  Measurement,
  MeasurementType,
  UtcTimestamp,
} from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export type VitalSeriesType = Exclude<MeasurementType, "weight">;

export interface VitalValueStatistics {
  readonly count: number;
  readonly average: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
}

export interface VitalMeasurementHistoryEntry {
  readonly localDate: string;
  readonly measuredAt: UtcTimestamp;
  readonly value: number;
  readonly secondaryValue: number | null;
  readonly pulseBpm: number | null;
  readonly context: BloodPressureContext | null;
}

export interface VitalMeasurementDayMetric {
  readonly localDate: string;
  readonly future: boolean;
  /** Null only for future dates; zero distinguishes a past day without readings. */
  readonly measurementCount: number | null;
  readonly value: VitalValueStatistics | null;
  readonly secondaryValue: VitalValueStatistics | null;
  readonly pulseBpm: VitalValueStatistics | null;
}

export interface VitalMeasurementSeriesMetric {
  readonly type: VitalSeriesType;
  /** Used only by body-measure and custom series. */
  readonly metricName: string | null;
  readonly unit: string;
  readonly measurementCount: number;
  readonly value: VitalValueStatistics;
  /** Blood-pressure diastolic statistics; null for series without a secondary value. */
  readonly secondaryValue: VitalValueStatistics | null;
  readonly pulseBpm: VitalValueStatistics | null;
  readonly days: readonly VitalMeasurementDayMetric[];
  /** Individual readings ordered by timestamp, preserving context and same-day entries. */
  readonly history: readonly VitalMeasurementHistoryEntry[];
}

export interface VitalsMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly series: readonly VitalMeasurementSeriesMetric[];
}

export interface VitalsMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Exact UTC time excludes later readings from the current local day. */
  readonly now: UtcTimestamp;
  readonly measurements: readonly Measurement[];
}

type MutableDay = {
  readonly entries: Measurement[];
};

function invalidMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.vitals.invalid-input", message),
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

function statistic(values: readonly number[]): VitalValueStatistics | null {
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
    count: values.length,
    average: total / values.length,
    minimum,
    maximum,
  };
}

function validVitalMeasurement(measurement: Measurement): boolean {
  if (
    !isMeasurementType(measurement.type) ||
    measurement.type === "weight" ||
    !Number.isFinite(measurement.value) ||
    typeof measurement.unit !== "string" ||
    measurement.unit.trim().length === 0 ||
    measurement.unit.length > MEASUREMENT_UNIT_MAX_LENGTH ||
    containsControlCharacters(measurement.unit)
  ) {
    return false;
  }
  const definition = getMeasurementTypeDefinition(measurement.type);
  const unit = measurement.unit.trim();
  const unitDefinition = getMeasurementUnitDefinition(measurement.type, unit);
  if (unitDefinition === null && !definition.allowsCustomUnit) return false;
  if (
    unitDefinition !== null &&
    (measurement.value < unitDefinition.minimum || measurement.value > unitDefinition.maximum)
  ) {
    return false;
  }

  if (measurement.type === "blood-pressure") {
    if (
      !Number.isInteger(measurement.value) ||
      typeof measurement.secondaryValue !== "number" ||
      !Number.isInteger(measurement.secondaryValue) ||
      measurement.secondaryValue < (unitDefinition?.minimum ?? Number.NEGATIVE_INFINITY) ||
      measurement.secondaryValue > (unitDefinition?.maximum ?? Number.POSITIVE_INFINITY)
    ) {
      return false;
    }
  } else if (measurement.secondaryValue !== null) {
    return false;
  }

  const metricName = measurement.metricName ?? null;
  if (
    metricName !== null &&
    (typeof metricName !== "string" ||
      metricName.trim().length === 0 ||
      (measurement.type !== "body-measure" && measurement.type !== "custom"))
  ) {
    return false;
  }
  if (
    measurement.type === "body-measure" &&
    (metricName === null || metricName.trim().length === 0)
  ) {
    return false;
  }
  const pulse = measurement.pulseBpm ?? null;
  if (
    pulse !== null &&
    (measurement.type !== "blood-pressure" ||
      !Number.isInteger(pulse) ||
      pulse < BLOOD_PRESSURE_PULSE_RANGE.minimum ||
      pulse > BLOOD_PRESSURE_PULSE_RANGE.maximum)
  ) {
    return false;
  }
  const context = measurement.context ?? null;
  if (
    context !== null &&
    (measurement.type !== "blood-pressure" || !isBloodPressureContext(context))
  ) {
    return false;
  }
  return true;
}

function normalizedMetricName(measurement: Measurement): string | null {
  const name = measurement.metricName?.trim();
  return name === undefined || name.length === 0 ? null : normalizeMeasurementMetricName(name);
}

function seriesKey(measurement: Measurement): string {
  return JSON.stringify([
    measurement.type,
    normalizedMetricName(measurement),
    measurement.unit.trim(),
  ]);
}

function collect(
  entries: readonly Measurement[],
  select: (entry: Measurement) => number | null,
): number[] {
  const values: number[] = [];
  for (const entry of entries) {
    const value = select(entry);
    if (value !== null) values.push(value);
  }
  return values;
}

function maybeStatistic(
  entries: readonly Measurement[],
  select: (entry: Measurement) => number | null,
) {
  return statistic(collect(entries, select));
}

/** Laskee BP- ja vitaalisarjat yksikkö- ja mittarinimikohtaisesti valitulle paikallisjaksolle. */
export function calculateVitalsMetrics(input: VitalsMetricsInput): DataResult<VitalsMetrics> {
  if (!validUtcTimestamp(input.now)) {
    return invalidMetrics("Arviointihetken pitää olla kelvollinen UTC-aikaleima.");
  }
  const projected = buildAnalyticsProjection({
    period: input.period,
    entries: input.measurements,
    occurredAt: (measurement) => measurement.measuredAt,
    includeEntry: validVitalMeasurement,
  });
  if (!projected.ok) return projected;

  const period = projected.value.period;
  const nowMs = Date.parse(input.now);
  const asOfLocalDate = localDateForInstant(input.now, period);
  const measurementsByKey = new Map<string, Measurement[]>();
  const datesByKey = new Map<string, Map<string, MutableDay>>();
  for (const day of projected.value.days) {
    if (day.localDate > asOfLocalDate) continue;
    for (const measurement of day.entries) {
      if (Date.parse(measurement.measuredAt) > nowMs) continue;
      const key = seriesKey(measurement);
      const seriesEntries = measurementsByKey.get(key) ?? [];
      seriesEntries.push(measurement);
      measurementsByKey.set(key, seriesEntries);
      const days = datesByKey.get(key) ?? new Map<string, MutableDay>();
      const date = localDateForInstant(measurement.measuredAt, period);
      const dayEntries = days.get(date) ?? { entries: [] };
      dayEntries.entries.push(measurement);
      days.set(date, dayEntries);
      datesByKey.set(key, days);
    }
  }

  const series = [...measurementsByKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entries]): VitalMeasurementSeriesMetric => {
      const sampleDays = datesByKey.get(key) ?? new Map<string, MutableDay>();
      const days: VitalMeasurementDayMetric[] = projected.value.days.map((projectionDay) => {
        if (projectionDay.localDate > asOfLocalDate) {
          return {
            localDate: projectionDay.localDate,
            future: true,
            measurementCount: null,
            value: null,
            secondaryValue: null,
            pulseBpm: null,
          };
        }
        const dailyEntries = sampleDays.get(projectionDay.localDate)?.entries ?? [];
        return {
          localDate: projectionDay.localDate,
          future: false,
          measurementCount: dailyEntries.length,
          value: maybeStatistic(dailyEntries, (entry) => entry.value),
          secondaryValue: maybeStatistic(dailyEntries, (entry) => entry.secondaryValue),
          pulseBpm: maybeStatistic(dailyEntries, (entry) => entry.pulseBpm ?? null),
        };
      });
      const first = entries[0];
      if (first === undefined || !isMeasurementType(first.type) || first.type === "weight") {
        throw new Error("Projected vital series must contain a vital measurement.");
      }
      const metricName = normalizedMetricName(first);
      const history = entries.map((entry): VitalMeasurementHistoryEntry => ({
        localDate: localDateForInstant(entry.measuredAt, period),
        measuredAt: entry.measuredAt,
        value: entry.value,
        secondaryValue: entry.secondaryValue,
        pulseBpm: entry.pulseBpm ?? null,
        context: entry.context ?? null,
      }));
      return {
        type: first.type,
        metricName,
        unit: first.unit.trim(),
        measurementCount: entries.length,
        value: statistic(collect(entries, (entry) => entry.value)) ?? {
          count: 0,
          average: null,
          minimum: null,
          maximum: null,
        },
        secondaryValue: maybeStatistic(entries, (entry) => entry.secondaryValue),
        pulseBpm: maybeStatistic(entries, (entry) => entry.pulseBpm ?? null),
        days,
        history,
      };
    });

  return {
    ok: true,
    value: { period, asOfLocalDate, series },
  };
}
