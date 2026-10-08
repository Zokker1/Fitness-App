// T206: painomittausten raakadata ja siitä erillään laskettu 7 päivän trendi.

import type { Measurement, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";

export const WEIGHT_TREND_WINDOW_DAYS = 7;

export interface WeightTrendPoint {
  /** Käyttäjän paikallispäivä muodossa YYYY-MM-DD. */
  readonly dateKey: string;
  /** Edeltävien enintään seitsemän päivän päivittäisten keskiarvojen keskiarvo. */
  readonly trendValue: number | null;
  /** Kuinka monelta päivältä trendiarvoon on käytettävissä mittauksia. */
  readonly sampleDayCount: number;
}

export interface WeightTrend {
  /** Viikon trendi lasketaan uusimman mittausyksikön arvoista muuntamatta niitä. */
  readonly unit: "kg" | "lb" | null;
  /** Viimeisen seitsemän paikallispäivän alkuperäiset mittaukset aikajärjestyksessä. */
  readonly rawMeasurements: readonly Measurement[];
  /** Seitsemän paikallispäivän erillinen trendisarja. */
  readonly trendPoints: readonly WeightTrendPoint[];
}

export interface WeightTrendInput {
  readonly now: UtcTimestamp;
  /** Käytetään, jos IANA-aikavyöhykettä ei anneta tai offsetia ei saada. */
  readonly timezoneOffsetMinutes: number;
  readonly timeZone?: string | undefined;
  readonly measurements: readonly Measurement[];
}

function offsetFor(
  timestamp: UtcTimestamp,
  fallbackOffset: number,
  timeZone: string | undefined,
): number {
  if (timeZone === undefined || timeZone.trim() === "") {
    return fallbackOffset;
  }
  try {
    return timezoneOffsetMinutesAtInstant(timestamp, timeZone) ?? fallbackOffset;
  } catch {
    return fallbackOffset;
  }
}

function dateKeyAt(
  timestamp: UtcTimestamp,
  fallbackOffset: number,
  timeZone: string | undefined,
): string {
  return toLocalDateKey(timestamp, offsetFor(timestamp, fallbackOffset, timeZone));
}

function shiftDateKey(dateKey: string, days: number): string {
  const [yearText, monthText, dayText] = dateKey.split("-");
  const shifted = new Date(
    Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText) + days),
  );
  const year = String(shifted.getUTCFullYear()).padStart(4, "0");
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Laskee seitsemän paikallispäivän raakamittojen ja erillisen trendisarjan. */
export function calculateWeightTrend(input: WeightTrendInput): WeightTrend {
  const nowMs = Date.parse(input.now);
  const validWeights = input.measurements.filter(
    (measurement) =>
      measurement.type === "weight" &&
      Date.parse(measurement.measuredAt) <= nowMs &&
      Number.isFinite(measurement.value) &&
      (measurement.unit === "kg" || measurement.unit === "lb"),
  );
  const latestWeight = [...validWeights].sort(
    (left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt),
  )[0];
  const unit =
    latestWeight?.unit === "kg" || latestWeight?.unit === "lb" ? latestWeight.unit : null;

  if (unit === null) {
    return { unit: null, rawMeasurements: [], trendPoints: [] };
  }

  const todayKey = dateKeyAt(input.now, input.timezoneOffsetMinutes, input.timeZone);
  const dateKeys = Array.from({ length: WEIGHT_TREND_WINDOW_DAYS }, (_, index) =>
    shiftDateKey(todayKey, index - (WEIGHT_TREND_WINDOW_DAYS - 1)),
  );
  const dateKeySet = new Set(dateKeys);
  const rawMeasurements = validWeights
    .filter(
      (measurement) =>
        measurement.unit === unit &&
        dateKeySet.has(
          dateKeyAt(measurement.measuredAt, input.timezoneOffsetMinutes, input.timeZone),
        ),
    )
    .sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt));

  const dailyValues = new Map<string, number[]>();
  for (const measurement of rawMeasurements) {
    const dateKey = dateKeyAt(measurement.measuredAt, input.timezoneOffsetMinutes, input.timeZone);
    const dayValues = dailyValues.get(dateKey) ?? [];
    dayValues.push(measurement.value);
    dailyValues.set(dateKey, dayValues);
  }
  const dailyAverages = new Map(
    dateKeys.map((dateKey) => {
      const values = dailyValues.get(dateKey) ?? [];
      return [
        dateKey,
        values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length,
      ] as const;
    }),
  );

  const trendPoints = dateKeys.map((dateKey, index): WeightTrendPoint => {
    const windowKeys = dateKeys.slice(
      Math.max(0, index - (WEIGHT_TREND_WINDOW_DAYS - 1)),
      index + 1,
    );
    const samples = windowKeys
      .map((key) => dailyAverages.get(key) ?? null)
      .filter((value): value is number => value !== null);
    return {
      dateKey,
      trendValue:
        samples.length === 0
          ? null
          : samples.reduce((sum, value) => sum + value, 0) / samples.length,
      sampleDayCount: samples.length,
    };
  });

  return { unit, rawMeasurements, trendPoints };
}
