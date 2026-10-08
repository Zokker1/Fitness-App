// T266: period-based nutrition and hydration summaries from local entries.

import type {
  HydrationEntry,
  HydrationTargetMl,
  MacroTargets,
  NutritionEntry,
  UtcTimestamp,
} from "@lifeos/domain";
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
const NUTRIENT_KEYS = ["caloriesKcal", "proteinG", "carbsG", "fatG", "fiberG"] as const;
type NutrientKey = (typeof NUTRIENT_KEYS)[number];

export interface NutritionDailyTotals {
  /** Null jos päivän kirjauksissa ei ole kaikkien rivien ravintoarvoa. */
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly fiberG: number | null;
}

export interface NutritionTargetStatus {
  readonly caloriesKcal: boolean | null;
  readonly proteinG: boolean | null;
  readonly carbsG: boolean | null;
  readonly fatG: boolean | null;
  readonly fiberG: boolean | null;
}

export interface NutritionDailyMetric {
  readonly entryCount: number;
  /** Päivätotalit jätetään nulliksi, jos yksikin päivän rivi on kyseisen ravinteen osalta puutteellinen. */
  readonly totals: NutritionDailyTotals;
  /** Tavoite täyttyy, kun täydellinen päiväsumma on vähintään käyttäjän tavoite. */
  readonly targetMet: NutritionTargetStatus;
}

export interface HydrationDailyMetric {
  readonly entryCount: number;
  readonly milliliters: number | null;
  readonly targetMilliliters: number | null;
  readonly targetMet: boolean | null;
}

export interface NutritionHydrationDayMetric {
  readonly localDate: string;
  /** Tulevaa päivää ei ennusteta; arvot ovat null. */
  readonly nutrition: NutritionDailyMetric | null;
  readonly hydration: HydrationDailyMetric | null;
}

export interface NutrientPeriodMetric {
  readonly averagePerTrackedDay: number | null;
  /** Vain kirjatuista päivistä, joilla kyseisen ravinteen kaikki arvot tunnetaan. */
  readonly trackedDayCount: number;
  readonly target: number | null;
  readonly targetMetDayCount: number;
  readonly targetEligibleDayCount: number;
  readonly targetHitRate: number | null;
}

export interface NutritionPeriodMetric {
  readonly entryCount: number;
  readonly daysWithEntries: number;
  readonly caloriesKcal: NutrientPeriodMetric;
  readonly proteinG: NutrientPeriodMetric;
  readonly carbsG: NutrientPeriodMetric;
  readonly fatG: NutrientPeriodMetric;
  readonly fiberG: NutrientPeriodMetric;
}

export interface HydrationPeriodMetric {
  readonly entryCount: number;
  readonly daysWithEntries: number;
  readonly averageMillilitersPerTrackedDay: number | null;
  readonly trackedDayCount: number;
  readonly targetMilliliters: number | null;
  readonly targetMetDayCount: number;
  readonly targetEligibleDayCount: number;
  readonly targetHitRate: number | null;
}

export interface NutritionHydrationWeekMetric {
  readonly weekStart: string;
  readonly weekEnd: string;
  /** True kun kaikki valitun ISO-viikon päivät ovat tulevaisuudessa. */
  readonly future: boolean;
  readonly nutrition: NutritionPeriodMetric;
  readonly hydration: HydrationPeriodMetric;
}

export interface NutritionHydrationMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly nutrition: NutritionPeriodMetric;
  readonly hydration: HydrationPeriodMetric;
  readonly weeks: readonly NutritionHydrationWeekMetric[];
  readonly trend: readonly NutritionHydrationDayMetric[];
}

export interface NutritionHydrationMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Tarkka UTC-hetki sulkee pois myös saman päivän tulevat kirjaukset. */
  readonly now: UtcTimestamp;
  readonly nutritionEntries: readonly NutritionEntry[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly macroTargets?: MacroTargets | null | undefined;
  readonly hydrationTargetMl?: HydrationTargetMl | undefined;
}

function invalidMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.nutrition-hydration.invalid-input", message),
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

function valueFor(entry: NutritionEntry, key: NutrientKey): number | null {
  if (key === "caloriesKcal") return entry.calories;
  if (key === "proteinG") return entry.proteinG;
  if (key === "carbsG") return entry.carbsG;
  if (key === "fatG") return entry.fatG;
  return entry.fiberG ?? null;
}

function sumNutrient(entries: readonly NutritionEntry[], key: NutrientKey): number | null {
  if (entries.length === 0) return null;
  let total = 0;
  for (const entry of entries) {
    const value = valueFor(entry, key);
    if (value === null || !Number.isFinite(value) || value < 0) return null;
    total += value;
  }
  return total;
}

function targetMet(amount: number | null, target: number | null): boolean | null {
  return amount === null || target === null ? null : amount >= target;
}

function validNutritionEntry(entry: NutritionEntry): boolean {
  const nutrients = [
    entry.calories,
    entry.proteinG,
    entry.carbsG,
    entry.fatG,
    entry.fiberG ?? null,
  ];
  return nutrients.every(
    (value) =>
      value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0),
  );
}

function validHydrationEntry(entry: HydrationEntry): boolean {
  return Number.isInteger(entry.milliliters) && entry.milliliters >= 0;
}

function emptyNutritionDay(
  entries: readonly NutritionEntry[],
  targets: MacroTargets,
): NutritionDailyMetric {
  const totals: NutritionDailyTotals = {
    caloriesKcal: sumNutrient(entries, "caloriesKcal"),
    proteinG: sumNutrient(entries, "proteinG"),
    carbsG: sumNutrient(entries, "carbsG"),
    fatG: sumNutrient(entries, "fatG"),
    fiberG: sumNutrient(entries, "fiberG"),
  };
  return {
    entryCount: entries.length,
    totals,
    targetMet: {
      caloriesKcal: targetMet(totals.caloriesKcal, targets.caloriesKcal),
      proteinG: targetMet(totals.proteinG, targets.proteinG),
      carbsG: targetMet(totals.carbsG, targets.carbsG),
      fatG: targetMet(totals.fatG, targets.fatG),
      fiberG: targetMet(totals.fiberG, targets.fiberG),
    },
  };
}

function summarizeNutrition(
  days: readonly NutritionDailyMetric[],
  targets: MacroTargets,
): NutritionPeriodMetric {
  const entryCount = days.reduce((sum, day) => sum + day.entryCount, 0);
  const daysWithEntries = days.filter((day) => day.entryCount > 0).length;
  const metrics = Object.fromEntries(
    NUTRIENT_KEYS.map((key) => {
      const values = days
        .map((day) => day.totals[key])
        .filter((value): value is number => value !== null);
      const target = targets[key];
      const targetEligibleDayCount = target === null ? 0 : values.length;
      const targetMetDayCount =
        target === null ? 0 : values.filter((value) => value >= target).length;
      return [
        key,
        {
          averagePerTrackedDay: mean(values),
          trackedDayCount: values.length,
          target,
          targetMetDayCount,
          targetEligibleDayCount,
          targetHitRate:
            targetEligibleDayCount === 0 ? null : targetMetDayCount / targetEligibleDayCount,
        } satisfies NutrientPeriodMetric,
      ];
    }),
  ) as Record<NutrientKey, NutrientPeriodMetric>;
  return {
    entryCount,
    daysWithEntries,
    caloriesKcal: metrics.caloriesKcal,
    proteinG: metrics.proteinG,
    carbsG: metrics.carbsG,
    fatG: metrics.fatG,
    fiberG: metrics.fiberG,
  };
}

function summarizeHydration(
  days: readonly HydrationDailyMetric[],
  targetMilliliters: number | null,
): HydrationPeriodMetric {
  const trackedDays = days.filter((day) => day.entryCount > 0);
  const targetMetDayCount =
    targetMilliliters === null
      ? 0
      : trackedDays.filter(
          (day) => day.milliliters !== null && day.milliliters >= targetMilliliters,
        ).length;
  const targetEligibleDayCount = targetMilliliters === null ? 0 : trackedDays.length;
  return {
    entryCount: trackedDays.reduce((sum, day) => sum + day.entryCount, 0),
    daysWithEntries: trackedDays.length,
    averageMillilitersPerTrackedDay: mean(
      trackedDays.map((day) => day.milliliters).filter((value): value is number => value !== null),
    ),
    trackedDayCount: trackedDays.length,
    targetMilliliters,
    targetMetDayCount,
    targetEligibleDayCount,
    targetHitRate: targetEligibleDayCount === 0 ? null : targetMetDayCount / targetEligibleDayCount,
  };
}

/** Laskee ravinto- ja nestekirjausten päivä-/viikkokeskiarvot ja tavoiteosuudet. */
export function calculateNutritionHydrationMetrics(
  input: NutritionHydrationMetricsInput,
): DataResult<NutritionHydrationMetrics> {
  if (!validUtcTimestamp(input.now)) {
    return invalidMetrics("Arviointihetken pitää olla kelvollinen UTC-aikaleima.");
  }
  const targets: MacroTargets = input.macroTargets ?? {
    caloriesKcal: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
  };
  if (
    NUTRIENT_KEYS.some((key) => {
      const value = targets[key];
      return value !== null && (!Number.isFinite(value) || value < 0);
    })
  ) {
    return invalidMetrics("Ravintotavoitteiden pitää olla nollaa suurempia tai yhtä suuria.");
  }
  const hydrationTarget = input.hydrationTargetMl ?? null;
  if (
    hydrationTarget !== null &&
    (!Number.isInteger(hydrationTarget) || hydrationTarget < 1 || hydrationTarget > 20_000)
  ) {
    return invalidMetrics("Nestetavoitteen pitää olla 1–20 000 ml tai tyhjä.");
  }

  const nutritionProjection = buildAnalyticsProjection({
    period: input.period,
    entries: input.nutritionEntries,
    occurredAt: (entry) => entry.eatenAt,
    includeEntry: (entry) => entry.deletedAt === null && validNutritionEntry(entry),
  });
  if (!nutritionProjection.ok) return nutritionProjection;
  const hydrationProjection = buildAnalyticsProjection({
    period: input.period,
    entries: input.hydrationEntries,
    occurredAt: (entry) => entry.drunkAt,
    includeEntry: validHydrationEntry,
  });
  if (!hydrationProjection.ok) return hydrationProjection;

  const period = nutritionProjection.value.period;
  const nowMs = Date.parse(input.now);
  const asOfLocalDate = dateAt(input.now, period);
  const nutritionByDate = new Map<string, NutritionEntry[]>();
  for (const day of nutritionProjection.value.days) {
    if (day.localDate > asOfLocalDate) continue;
    const entries = day.entries.filter((entry) => Date.parse(entry.eatenAt) <= nowMs);
    if (entries.length > 0) nutritionByDate.set(day.localDate, entries);
  }
  const hydrationByDate = new Map<string, HydrationEntry[]>();
  for (const day of hydrationProjection.value.days) {
    if (day.localDate > asOfLocalDate) continue;
    const entries = day.entries.filter((entry) => Date.parse(entry.drunkAt) <= nowMs);
    if (entries.length > 0) hydrationByDate.set(day.localDate, entries);
  }

  const trend: NutritionHydrationDayMetric[] = nutritionProjection.value.days.map((day) => {
    if (day.localDate > asOfLocalDate) {
      return { localDate: day.localDate, nutrition: null, hydration: null };
    }
    const nutritionEntries = nutritionByDate.get(day.localDate) ?? [];
    const hydrationEntries = hydrationByDate.get(day.localDate) ?? [];
    const hydrationMilliliters = hydrationEntries.reduce(
      (sum, entry) => sum + entry.milliliters,
      0,
    );
    return {
      localDate: day.localDate,
      nutrition: emptyNutritionDay(nutritionEntries, targets),
      hydration: {
        entryCount: hydrationEntries.length,
        milliliters: hydrationEntries.length === 0 ? null : hydrationMilliliters,
        targetMilliliters: hydrationTarget,
        targetMet:
          hydrationEntries.length === 0 || hydrationTarget === null
            ? null
            : hydrationMilliliters >= hydrationTarget,
      },
    };
  });

  const observedTrend = trend.filter(
    (
      day,
    ): day is NutritionHydrationDayMetric & {
      readonly nutrition: NutritionDailyMetric;
      readonly hydration: HydrationDailyMetric;
    } => day.nutrition !== null && day.hydration !== null,
  );
  const weeksByStart = new Map<string, NutritionHydrationDayMetric[]>();
  for (const day of trend) {
    const weekStart = weekStartLocalDate(day.localDate);
    if (weekStart === null) continue;
    const days = weeksByStart.get(weekStart) ?? [];
    days.push(day);
    weeksByStart.set(weekStart, days);
  }
  const weeks = [...weeksByStart.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([weekStart, weekDays]): NutritionHydrationWeekMetric => {
      const measuredNutritionDays = weekDays.flatMap((day) =>
        day.nutrition !== null && day.nutrition.entryCount > 0 ? [day.nutrition] : [],
      );
      const measuredHydrationDays = weekDays.flatMap((day) =>
        day.hydration !== null && day.hydration.entryCount > 0 ? [day.hydration] : [],
      );
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        future: weekDays.every((day) => day.localDate > asOfLocalDate),
        nutrition: summarizeNutrition(measuredNutritionDays, targets),
        hydration: summarizeHydration(measuredHydrationDays, hydrationTarget),
      };
    });

  const measuredNutritionDays = observedTrend.flatMap((day) =>
    day.nutrition.entryCount > 0 ? [day.nutrition] : [],
  );
  const measuredHydrationDays = observedTrend.flatMap((day) =>
    day.hydration.entryCount > 0 ? [day.hydration] : [],
  );
  return {
    ok: true,
    value: {
      period,
      asOfLocalDate,
      nutrition: summarizeNutrition(measuredNutritionDays, targets),
      hydration: summarizeHydration(measuredHydrationDays, hydrationTarget),
      weeks,
      trend,
    },
  };
}
