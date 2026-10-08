// T200: terveysosion overview-projektio (§10, §14–§15, §20, §29, §52).
// Moduuli näkyy vasta, kun käyttäjä on kirjannut tai ottanut käyttöön siihen
// liittyvää dataa. Tässä ei tulkita mittausten lääketieteellistä merkitystä.

import type {
  HydrationEntry,
  Measurement,
  MoodCheckin,
  SleepEntry,
  Supplement,
  SupplementLog,
  UtcTimestamp,
  WeightTarget,
  WeightUnit,
} from "@lifeos/domain";
import {
  calculateBmi,
  CUSTOM_METRIC_NAME_MAX_LENGTH,
  containsControlCharacters,
  getMeasurementUnitDefinition,
  MEASUREMENT_UNIT_MAX_LENGTH,
  normalizeBodyMeasureName,
  normalizeMeasurementMetricName,
  toLocalDateKey,
} from "@lifeos/domain";
import { calculateWeightTrend } from "./weight-trend.ts";
import type { WeightTrend } from "./weight-trend.ts";
import { summarizeHydrationDay } from "./hydration-service.ts";
import { getSupplementLogActivityAt, getSupplementLogStatus } from "./supplement-log-service.ts";
import { estimateSupplementStock } from "./supplement-stock-service.ts";
import type { SupplementStockEstimate } from "./supplement-stock-service.ts";

export interface HealthOverviewInput {
  readonly now: UtcTimestamp;
  readonly timezoneOffsetMinutes: number;
  readonly timeZone?: string | undefined;
  readonly measurements: readonly Measurement[];
  readonly weightTarget: WeightTarget | null;
  readonly heightCm: number | null;
  readonly sleepEntries: readonly SleepEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly hydrationTargetMl?: number | null | undefined;
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
}

export interface HealthOverviewWeightCard {
  readonly id: "weight";
  readonly measurement: Measurement;
}

export interface HealthOverviewWeightSummary {
  readonly start: Measurement | null;
  readonly current: Measurement | null;
  readonly target: WeightTarget | null;
  readonly unit: WeightUnit | null;
  readonly change: number | null;
  readonly minimum: number | null;
  readonly maximum: number | null;
  readonly changePerWeek: number | null;
  readonly sampleCount: number;
}

export interface HealthOverviewBloodPressureCard {
  readonly id: "blood-pressure";
  readonly measurement: Measurement;
}

export interface HealthOverviewSleepCard {
  readonly id: "sleep";
  readonly entry: SleepEntry;
}

export interface HealthOverviewMoodCard {
  readonly id: "mood";
  readonly entry: MoodCheckin;
}

export interface HealthOverviewHydrationCard {
  readonly id: "hydration";
  readonly todayMilliliters: number;
  readonly todayEntryCount: number;
  readonly targetMilliliters: number | null;
  readonly progressPercent: number | null;
  readonly latestEntry: HydrationEntry | null;
}

export interface HealthOverviewSupplementsCard {
  readonly id: "supplements";
  readonly supplements: readonly Supplement[];
  readonly stockEstimates: readonly {
    readonly supplementId: string;
    readonly estimate: SupplementStockEstimate;
  }[];
  readonly todayLogCount: number;
  readonly todayLogStatusCounts: Readonly<Record<"taken" | "skipped" | "pending", number>>;
  readonly latestLogAt: UtcTimestamp | null;
}

export type HealthOverviewCard =
  | HealthOverviewWeightCard
  | HealthOverviewBloodPressureCard
  | HealthOverviewSleepCard
  | HealthOverviewMoodCard
  | HealthOverviewHydrationCard
  | HealthOverviewSupplementsCard;

export type HealthOverviewMeasurementCard =
  HealthOverviewWeightCard | HealthOverviewBloodPressureCard;

export interface HealthOverviewSummary {
  readonly cards: readonly HealthOverviewCard[];
  readonly weight: HealthOverviewWeightSummary;
  /** Validit kg- ja lb-painomittaukset uusimmasta vanhimpaan. */
  readonly weightHistory: readonly Measurement[];
  /** Verenpainemittaukset uusimmasta vanhimpaan graafin ja historian käyttöön. */
  readonly bloodPressureHistory: readonly Measurement[];
  /** Lämpötilamittaukset uusimmasta vanhimpaan. Yksikkö säilyy mittauskohtaisena. */
  readonly temperatureHistory: readonly Measurement[];
  /** SpO₂-mittaukset uusimmasta vanhimpaan. */
  readonly spo2History: readonly Measurement[];
  /** Verensokerimittaukset uusimmasta vanhimpaan, yksikkö mittauskohtaisena. */
  readonly bloodSugarHistory: readonly Measurement[];
  /** Käyttäjän omat numeeriset mittarit ryhmiteltyinä nimen ja yksikön mukaan. */
  readonly customMetricHistories: readonly CustomMetricHistory[];
  /** Uusimmat arvot nimetyistä kehon mitoista, yksi per mitan nimi. */
  readonly bodyMeasurements: readonly Measurement[];
  /** Painon raakakirjauksista erillinen seitsemän päivän trendi. */
  readonly weightTrend: WeightTrend;
  readonly bmi: number | null;
}

export interface CustomMetricHistory {
  readonly metricName: string;
  readonly unit: string;
  readonly measurements: readonly Measurement[];
}

function newest<T>(items: readonly T[], timestamp: (item: T) => UtcTimestamp): T | undefined {
  return [...items].sort((left, right) =>
    timestamp(left) < timestamp(right) ? 1 : timestamp(left) > timestamp(right) ? -1 : 0,
  )[0];
}

/** Kokoaa vain moduulit, joilla on käyttäjän omia kirjauksia tai tietoja. */
export function summarizeHealthOverview(input: HealthOverviewInput): HealthOverviewSummary {
  const cards: HealthOverviewCard[] = [];
  const nowMs = Date.parse(input.now);
  const isNotFuture = (value: UtcTimestamp): boolean => Date.parse(value) <= nowMs;

  const weights = input.measurements.filter(
    (item) => item.type === "weight" && isNotFuture(item.measuredAt),
  );
  const bodyMeasurementCandidates = input.measurements
    .filter((item) => item.type === "body-measure" && isNotFuture(item.measuredAt))
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt));
  const latestBodyMeasurements = new Map<string, Measurement>();
  for (const item of bodyMeasurementCandidates) {
    const metricName = normalizeBodyMeasureName(item.metricName ?? "") || "Nimeämätön mitta";
    const metricKey = metricName.toLocaleLowerCase("fi-FI");
    if (!latestBodyMeasurements.has(metricKey)) {
      latestBodyMeasurements.set(metricKey, item);
    }
  }
  const bodyMeasurements = [...latestBodyMeasurements.values()];
  const weight = newest(weights, (item) => item.measuredAt);
  const startWeight = [...weights].sort((left, right) =>
    left.measuredAt < right.measuredAt ? -1 : left.measuredAt > right.measuredAt ? 1 : 0,
  )[0];
  const comparableWeights = weights.filter(
    (item) => Number.isFinite(item.value) && (item.unit === "kg" || item.unit === "lb"),
  );
  const weightHistory = [...comparableWeights].sort(
    (left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt),
  );
  const latestComparableWeight = newest(comparableWeights, (item) => item.measuredAt);
  const weightUnit: WeightUnit | null =
    latestComparableWeight?.unit === "kg" || latestComparableWeight?.unit === "lb"
      ? latestComparableWeight.unit
      : null;
  const sameUnitWeights = comparableWeights
    .filter((item) => item.unit === weightUnit)
    .sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt));
  const firstComparableWeight = sameUnitWeights[0];
  const lastComparableWeight = sameUnitWeights[sameUnitWeights.length - 1];
  const change =
    firstComparableWeight === undefined || lastComparableWeight === undefined
      ? null
      : lastComparableWeight.value - firstComparableWeight.value;
  const elapsedMilliseconds =
    firstComparableWeight === undefined || lastComparableWeight === undefined
      ? 0
      : Date.parse(lastComparableWeight.measuredAt) - Date.parse(firstComparableWeight.measuredAt);
  const changePerWeek =
    change === null || elapsedMilliseconds <= 0
      ? null
      : (change / elapsedMilliseconds) * (7 * 24 * 60 * 60 * 1000);
  const weightValues = sameUnitWeights.map((item) => item.value);
  const weightBounds = weightValues.reduce<{
    readonly minimum: number;
    readonly maximum: number;
  } | null>(
    (bounds, value) =>
      bounds === null
        ? { minimum: value, maximum: value }
        : { minimum: Math.min(bounds.minimum, value), maximum: Math.max(bounds.maximum, value) },
    null,
  );
  let bmiWeight: { readonly value: number; readonly unit: "kg" | "lb" } | null = null;
  if (weight !== undefined) {
    if (weight.unit === "kg" || weight.unit === "lb") {
      bmiWeight = { value: weight.value, unit: weight.unit };
    }
  }
  if (weight !== undefined) {
    cards.push({ id: "weight", measurement: weight });
  }

  const bloodPressureHistory = input.measurements
    .filter(
      (item) =>
        item.type === "blood-pressure" &&
        item.unit === "mmHg" &&
        Number.isFinite(item.value) &&
        item.secondaryValue !== null &&
        Number.isFinite(item.secondaryValue) &&
        isNotFuture(item.measuredAt),
    )
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt));
  const bloodPressure = bloodPressureHistory[0];
  if (bloodPressure !== undefined) {
    cards.push({ id: "blood-pressure", measurement: bloodPressure });
  }

  const temperatureHistory = input.measurements
    .filter((item) => {
      if (
        item.type !== "temperature" ||
        item.secondaryValue !== null ||
        !isNotFuture(item.measuredAt)
      ) {
        return false;
      }
      const unitDefinition = getMeasurementUnitDefinition("temperature", item.unit);
      return (
        unitDefinition !== null &&
        Number.isFinite(item.value) &&
        item.value >= unitDefinition.minimum &&
        item.value <= unitDefinition.maximum
      );
    })
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt));

  const spo2History = input.measurements
    .filter((item) => {
      if (item.type !== "spo2" || item.secondaryValue !== null || !isNotFuture(item.measuredAt)) {
        return false;
      }
      const unitDefinition = getMeasurementUnitDefinition("spo2", item.unit);
      return (
        unitDefinition !== null &&
        Number.isFinite(item.value) &&
        item.value >= unitDefinition.minimum &&
        item.value <= unitDefinition.maximum
      );
    })
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt));

  const bloodSugarHistory = input.measurements
    .filter((item) => {
      if (
        item.type !== "blood-sugar" ||
        item.secondaryValue !== null ||
        !isNotFuture(item.measuredAt)
      ) {
        return false;
      }
      const unitDefinition = getMeasurementUnitDefinition("blood-sugar", item.unit);
      return (
        unitDefinition !== null &&
        Number.isFinite(item.value) &&
        item.value >= unitDefinition.minimum &&
        item.value <= unitDefinition.maximum
      );
    })
    .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt));

  const customMetricGroups = new Map<
    string,
    { metricName: string; unit: string; rows: Measurement[] }
  >();
  for (const item of input.measurements) {
    if (
      item.type !== "custom" ||
      item.secondaryValue !== null ||
      !Number.isFinite(item.value) ||
      !isNotFuture(item.measuredAt) ||
      typeof item.metricName !== "string" ||
      typeof item.unit !== "string"
    ) {
      continue;
    }
    const metricName = normalizeMeasurementMetricName(item.metricName);
    const unit = item.unit.normalize("NFKC").trim();
    if (
      metricName.length === 0 ||
      metricName.length > CUSTOM_METRIC_NAME_MAX_LENGTH ||
      containsControlCharacters(metricName) ||
      unit.length === 0 ||
      unit.length > MEASUREMENT_UNIT_MAX_LENGTH ||
      containsControlCharacters(unit)
    ) {
      continue;
    }
    const key = `${metricName.toLocaleLowerCase("fi-FI")}\u0000${unit}`;
    const group = customMetricGroups.get(key);
    if (group === undefined) {
      customMetricGroups.set(key, { metricName, unit, rows: [item] });
    } else {
      group.rows.push(item);
    }
  }
  const customMetricHistories: CustomMetricHistory[] = [...customMetricGroups.values()]
    .map((group) => ({
      metricName: group.metricName,
      unit: group.unit,
      measurements: group.rows.sort(
        (left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt),
      ),
    }))
    .sort((left, right) => {
      const leftAt = left.measurements[0]?.measuredAt ?? "";
      const rightAt = right.measurements[0]?.measuredAt ?? "";
      return rightAt.localeCompare(leftAt);
    });

  const latestSleep = newest(
    input.sleepEntries.filter(
      (item) =>
        item.deletedAt === null && item.sleepEnd >= item.sleepStart && isNotFuture(item.sleepEnd),
    ),
    (item) => item.sleepEnd,
  );
  if (latestSleep !== undefined) {
    cards.push({ id: "sleep", entry: latestSleep });
  }

  const latestMood = newest(
    input.moodCheckins.filter((item) => isNotFuture(item.checkedAt)),
    (item) => item.checkedAt,
  );
  if (latestMood !== undefined) {
    cards.push({ id: "mood", entry: latestMood });
  }

  const latestHydration = newest(
    input.hydrationEntries.filter((item) => isNotFuture(item.drunkAt)),
    (item) => item.drunkAt,
  );
  if (latestHydration !== undefined || (input.hydrationTargetMl ?? null) !== null) {
    const localDate = toLocalDateKey(input.now, input.timezoneOffsetMinutes);
    const hydrationToday = summarizeHydrationDay({
      entries: input.hydrationEntries,
      localDate,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      targetMilliliters: input.hydrationTargetMl,
      now: input.now,
    });
    cards.push({
      id: "hydration",
      todayMilliliters: hydrationToday.milliliters,
      todayEntryCount: hydrationToday.entryCount,
      targetMilliliters: hydrationToday.targetMilliliters,
      progressPercent: hydrationToday.progressPercent,
      latestEntry: latestHydration ?? null,
    });
  }

  const activeSupplements = input.supplements.filter((item) => item.deletedAt === null);
  if (activeSupplements.length > 0) {
    const activeIds = new Set(activeSupplements.map((item) => item.id));
    const activeLogs = input.supplementLogs.filter(
      (item) => activeIds.has(item.supplementId) && isNotFuture(getSupplementLogActivityAt(item)),
    );
    const localDate = toLocalDateKey(input.now, input.timezoneOffsetMinutes);
    const todayLogs = activeLogs.filter(
      (item) =>
        toLocalDateKey(getSupplementLogActivityAt(item), input.timezoneOffsetMinutes) === localDate,
    );
    const todayLogStatusCounts = { taken: 0, skipped: 0, pending: 0 };
    for (const log of todayLogs) {
      todayLogStatusCounts[getSupplementLogStatus(log)] += 1;
    }
    const latestLog = newest(activeLogs, getSupplementLogActivityAt);
    cards.push({
      id: "supplements",
      supplements: activeSupplements,
      stockEstimates: activeSupplements.map((supplement) => ({
        supplementId: supplement.id,
        estimate: estimateSupplementStock(supplement, input.supplementLogs, input.now),
      })),
      todayLogCount: todayLogs.length,
      todayLogStatusCounts,
      latestLogAt: latestLog === undefined ? null : getSupplementLogActivityAt(latestLog),
    });
  }

  const displayOrder: Readonly<Record<HealthOverviewCard["id"], number>> = {
    sleep: 0,
    mood: 1,
    hydration: 2,
    weight: 3,
    "blood-pressure": 4,
    supplements: 5,
  };
  cards.sort((left, right) => displayOrder[left.id] - displayOrder[right.id]);
  return {
    cards,
    weightHistory,
    bloodPressureHistory,
    temperatureHistory,
    spo2History,
    bloodSugarHistory,
    customMetricHistories,
    weight: {
      start: startWeight ?? null,
      current: weight ?? null,
      target: input.weightTarget,
      unit: weightUnit,
      change,
      minimum: weightBounds?.minimum ?? null,
      maximum: weightBounds?.maximum ?? null,
      changePerWeek,
      sampleCount: sameUnitWeights.length,
    },
    bodyMeasurements,
    weightTrend: calculateWeightTrend({
      now: input.now,
      timezoneOffsetMinutes: input.timezoneOffsetMinutes,
      ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      measurements: input.measurements,
    }),
    bmi: calculateBmi(bmiWeight, input.heightCm),
  };
}
