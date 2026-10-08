// T260: paikallisen analytiikan puhdas päiväprojektio.
// Kutsuja hakee domain-rivit paikallisesta tietovarastosta ja antaa ne tähän
// funktioon. Tämä moduuli ei tee IO:ta, kirjoituksia, verkkokutsuja eikä lokita
// käyttäjätietoa. Tulokset ovat uudelleenlaskettavia näkymiä, eivät totuusdataa.

import type { UtcTimestamp } from "@lifeos/domain";
import { isValidLocalDateKey, toLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";

const DAY_MILLISECONDS = 86_400_000;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export const ANALYTICS_PROJECTION_MAX_DAYS = 3_660;
export const ANALYTICS_TIMEZONE_OFFSET_MINUTES_MIN = -14 * 60;
export const ANALYTICS_TIMEZONE_OFFSET_MINUTES_MAX = 14 * 60;

/** Valittu, paikallisessa kalenterissa suljettu aikaväli. */
export interface AnalyticsProjectionPeriod {
  readonly startLocalDate: string;
  readonly endLocalDate: string;
  /** Offset toimii varana, jos IANA-aikavyöhykettä ei anneta tai saada. */
  readonly timezoneOffsetMinutes: number;
  readonly timeZone?: string | undefined;
}

export interface AnalyticsProjectionDay<T> {
  /** Paikallinen päivä; jokainen aikavälin päivä sisältyy myös ilman rivejä. */
  readonly localDate: string;
  /** Päivän tapahtumahetken mukaan järjestetyt lähderivit. */
  readonly entries: readonly T[];
}

export interface AnalyticsProjection<T> {
  readonly period: AnalyticsProjectionPeriod;
  readonly days: readonly AnalyticsProjectionDay<T>[];
  readonly includedEntryCount: number;
}

export interface AnalyticsProjectionInput<T> {
  readonly period: AnalyticsProjectionPeriod;
  readonly entries: readonly T[];
  /** Valitsee rivin merkityksellisen UTC-hetken; null/undefined ohitetaan. */
  readonly occurredAt: (entry: T) => UtcTimestamp | null | undefined;
  /** Sallii mittarikohtaiset hauta-, arkisto- ja tilasemantiikat eksplisiittisesti. */
  readonly includeEntry?: ((entry: T) => boolean) | undefined;
}

function invalidAnalyticsInput<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics-projection.invalid-input", message),
  };
}

function dateOrdinal(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00.000Z`);
}

function nextLocalDate(dateKey: string): string {
  return new Date(dateOrdinal(dateKey) + DAY_MILLISECONDS).toISOString().slice(0, 10);
}

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function offsetAt(
  timestamp: UtcTimestamp,
  timeZone: string | undefined,
  fallbackOffsetMinutes: number,
): number {
  if (timeZone === undefined || timeZone.trim() === "") return fallbackOffsetMinutes;
  try {
    return timezoneOffsetMinutesAtInstant(timestamp, timeZone) ?? fallbackOffsetMinutes;
  } catch {
    return fallbackOffsetMinutes;
  }
}

/**
 * Ryhmittelee kutsujan paikalliset domain-rivit valituille kalenteripäiville.
 * Aikavyöhyke ratkaistaan jokaiselle tapahtumalle erikseen, jotta kesä- ja
 * talviajan offset-vaihdos ei siirrä tapahtumia väärälle päivälle. Mittari itse
 * päättää tapahtumahetken ja includeEntry-predikaatin.
 */
export function buildAnalyticsProjection<T>(
  input: AnalyticsProjectionInput<T>,
): DataResult<AnalyticsProjection<T>> {
  const { period } = input;
  if (!isValidLocalDateKey(period.startLocalDate) || !isValidLocalDateKey(period.endLocalDate)) {
    return invalidAnalyticsInput("Valitse kelvollinen alku- ja loppupäivä.");
  }
  if (period.startLocalDate > period.endLocalDate) {
    return invalidAnalyticsInput("Aikavälin loppupäivän pitää olla alkupäivän jälkeen.");
  }
  if (
    !Number.isInteger(period.timezoneOffsetMinutes) ||
    period.timezoneOffsetMinutes < ANALYTICS_TIMEZONE_OFFSET_MINUTES_MIN ||
    period.timezoneOffsetMinutes > ANALYTICS_TIMEZONE_OFFSET_MINUTES_MAX
  ) {
    return invalidAnalyticsInput("Aikavyöhykkeen varasiirtymä ei kelpaa.");
  }
  if (typeof input.occurredAt !== "function") {
    return invalidAnalyticsInput("Analytiikan lähderivit eivät kelpaa.");
  }
  if (input.includeEntry !== undefined && typeof input.includeEntry !== "function") {
    return invalidAnalyticsInput("Analytiikan rivisuodatin ei kelpaa.");
  }

  const dayCount =
    (dateOrdinal(period.endLocalDate) - dateOrdinal(period.startLocalDate)) / DAY_MILLISECONDS + 1;
  if (dayCount > ANALYTICS_PROJECTION_MAX_DAYS) {
    return invalidAnalyticsInput(
      `Valittu aikaväli voi sisältää enintään ${String(ANALYTICS_PROJECTION_MAX_DAYS)} päivää.`,
    );
  }

  const buckets = new Map<
    string,
    { readonly entry: T; readonly timestamp: number; readonly order: number }[]
  >();
  for (const [order, entry] of input.entries.entries()) {
    if (input.includeEntry !== undefined && !input.includeEntry(entry)) continue;
    const occurredAt = input.occurredAt(entry);
    if (!isValidUtcTimestamp(occurredAt)) continue;

    const localDate = toLocalDateKey(
      occurredAt,
      offsetAt(occurredAt, period.timeZone, period.timezoneOffsetMinutes),
    );
    if (localDate < period.startLocalDate || localDate > period.endLocalDate) continue;
    const bucket = buckets.get(localDate) ?? [];
    bucket.push({ entry, timestamp: Date.parse(occurredAt), order });
    buckets.set(localDate, bucket);
  }

  const days: AnalyticsProjectionDay<T>[] = [];
  let localDate = period.startLocalDate;
  while (localDate <= period.endLocalDate) {
    const entries = (buckets.get(localDate) ?? [])
      .slice()
      .sort((left, right) => left.timestamp - right.timestamp || left.order - right.order)
      .map(({ entry }) => entry);
    days.push({ localDate, entries });
    localDate = nextLocalDate(localDate);
  }

  const projectedPeriod: AnalyticsProjectionPeriod = {
    startLocalDate: period.startLocalDate,
    endLocalDate: period.endLocalDate,
    timezoneOffsetMinutes: period.timezoneOffsetMinutes,
    ...(period.timeZone === undefined ? {} : { timeZone: period.timeZone }),
  };
  return {
    ok: true,
    value: {
      period: projectedPeriod,
      days,
      includedEntryCount: days.reduce((total, day) => total + day.entries.length, 0),
    },
  };
}
