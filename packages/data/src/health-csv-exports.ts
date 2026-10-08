// T274: paikallisten terveyskirjausten vakaat, moduulikohtaiset CSV-skeemat.
import type {
  ActivityEntry,
  BreathingSession,
  HydrationEntry,
  Measurement,
  MoodCheckin,
  NutritionEntry,
  SleepEntry,
  Supplement,
  SupplementLog,
} from "@lifeos/domain";
import { serializeCsv, type CsvSchema } from "./csv-export.ts";

export type HealthCsvExportKind =
  | "weight"
  | "blood-pressure"
  | "other-measurements"
  | "hydration"
  | "nutrition"
  | "sleep"
  | "activity"
  | "mood"
  | "supplements"
  | "breathing";

export interface HealthCsvExportInput {
  readonly measurements: readonly Measurement[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly nutritionEntries: readonly NutritionEntry[];
  readonly sleepEntries: readonly SleepEntry[];
  readonly activityEntries: readonly ActivityEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
  readonly breathingSessions: readonly BreathingSession[];
}

export interface HealthCsvExportDefinition {
  readonly kind: HealthCsvExportKind;
  readonly schemaId: string;
  readonly version: number;
  readonly filename: string;
}

export interface HealthCsvExportResult extends HealthCsvExportDefinition {
  readonly rowCount: number;
  readonly content: string;
}

export const HEALTH_CSV_EXPORT_DEFINITIONS: readonly HealthCsvExportDefinition[] = [
  { kind: "weight", schemaId: "weight-measurements", version: 1, filename: "lifeos-paino.csv" },
  {
    kind: "blood-pressure",
    schemaId: "blood-pressure-measurements",
    version: 1,
    filename: "lifeos-verenpaine.csv",
  },
  {
    kind: "other-measurements",
    schemaId: "other-health-measurements",
    version: 1,
    filename: "lifeos-muut-mittaukset.csv",
  },
  { kind: "hydration", schemaId: "hydration-entries", version: 1, filename: "lifeos-nesteet.csv" },
  { kind: "nutrition", schemaId: "nutrition-entries", version: 1, filename: "lifeos-ravinto.csv" },
  { kind: "sleep", schemaId: "sleep-entries", version: 1, filename: "lifeos-uni.csv" },
  { kind: "activity", schemaId: "activity-entries", version: 1, filename: "lifeos-liikunta.csv" },
  { kind: "mood", schemaId: "mood-checkins", version: 1, filename: "lifeos-mieliala.csv" },
  {
    kind: "supplements",
    schemaId: "supplement-logs",
    version: 1,
    filename: "lifeos-lisaravinteet.csv",
  },
  {
    kind: "breathing",
    schemaId: "breathing-sessions",
    version: 1,
    filename: "lifeos-hengitysharjoitukset.csv",
  },
];

const weightSchema: CsvSchema<Measurement> = {
  id: "weight-measurements",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "measuredAt", value: (entry) => entry.measuredAt },
    { key: "value", value: (entry) => entry.value },
    { key: "unit", value: (entry) => entry.unit },
    { key: "note", value: (entry) => entry.note },
  ],
};

const bloodPressureSchema: CsvSchema<Measurement> = {
  id: "blood-pressure-measurements",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "measuredAt", value: (entry) => entry.measuredAt },
    { key: "systolic", value: (entry) => entry.value },
    { key: "diastolic", value: (entry) => entry.secondaryValue },
    { key: "pulseBpm", value: (entry) => entry.pulseBpm },
    { key: "unit", value: (entry) => entry.unit },
    { key: "context", value: (entry) => entry.context },
    { key: "note", value: (entry) => entry.note },
  ],
};

const otherMeasurementSchema: CsvSchema<Measurement> = {
  id: "other-health-measurements",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "type", value: (entry) => entry.type },
    { key: "metricName", value: (entry) => entry.metricName },
    { key: "measuredAt", value: (entry) => entry.measuredAt },
    { key: "value", value: (entry) => entry.value },
    { key: "secondaryValue", value: (entry) => entry.secondaryValue },
    { key: "unit", value: (entry) => entry.unit },
    { key: "pulseBpm", value: (entry) => entry.pulseBpm },
    { key: "context", value: (entry) => entry.context },
    { key: "note", value: (entry) => entry.note },
  ],
};

const hydrationSchema: CsvSchema<HydrationEntry> = {
  id: "hydration-entries",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "drunkAt", value: (entry) => entry.drunkAt },
    { key: "milliliters", value: (entry) => entry.milliliters },
  ],
};

const nutritionSchema: CsvSchema<NutritionEntry> = {
  id: "nutrition-entries",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "eatenAt", value: (entry) => entry.eatenAt },
    { key: "mealSlotId", value: (entry) => entry.mealSlotId },
    { key: "foodId", value: (entry) => entry.foodId },
    { key: "label", value: (entry) => entry.label },
    { key: "amountG", value: (entry) => entry.amountG },
    { key: "calories", value: (entry) => entry.calories },
    { key: "proteinG", value: (entry) => entry.proteinG },
    { key: "carbsG", value: (entry) => entry.carbsG },
    { key: "fatG", value: (entry) => entry.fatG },
    { key: "fiberG", value: (entry) => entry.fiberG },
  ],
};

const sleepSchema: CsvSchema<SleepEntry> = {
  id: "sleep-entries",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "sleepStart", value: (entry) => entry.sleepStart },
    { key: "sleepEnd", value: (entry) => entry.sleepEnd },
    { key: "quality", value: (entry) => entry.quality },
    { key: "isNap", value: (entry) => entry.isNap ?? false },
  ],
};

const activitySchema: CsvSchema<ActivityEntry> = {
  id: "activity-entries",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "activityAt", value: (entry) => entry.activityAt },
    { key: "kind", value: (entry) => entry.kind },
    { key: "durationSeconds", value: (entry) => entry.durationSeconds },
    { key: "distanceMeters", value: (entry) => entry.distanceMeters },
    { key: "note", value: (entry) => entry.note },
  ],
};

const moodSchema: CsvSchema<MoodCheckin> = {
  id: "mood-checkins",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "checkedAt", value: (entry) => entry.checkedAt },
    { key: "mood", value: (entry) => entry.mood },
    { key: "stress", value: (entry) => entry.stress },
    { key: "energy", value: (entry) => entry.energy },
    { key: "motivation", value: (entry) => entry.motivation },
    { key: "focus", value: (entry) => entry.focus },
    { key: "note", value: (entry) => entry.note },
  ],
};

interface SupplementCsvRow {
  readonly id: string;
  readonly supplementId: string;
  readonly supplementName: string | null;
  readonly status: "taken" | "skipped" | "pending";
  readonly scheduledAt: string | null | undefined;
  readonly takenAt: string | null;
  readonly doseAmount: number | null | undefined;
  readonly doseUnit: string | null | undefined;
}

const supplementSchema: CsvSchema<SupplementCsvRow> = {
  id: "supplement-logs",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "supplementId", value: (entry) => entry.supplementId },
    { key: "supplementName", value: (entry) => entry.supplementName },
    { key: "status", value: (entry) => entry.status },
    { key: "scheduledAt", value: (entry) => entry.scheduledAt },
    { key: "takenAt", value: (entry) => entry.takenAt },
    { key: "doseAmount", value: (entry) => entry.doseAmount },
    { key: "doseUnit", value: (entry) => entry.doseUnit },
  ],
};

const breathingSchema: CsvSchema<BreathingSession> = {
  id: "breathing-sessions",
  version: 1,
  columns: [
    { key: "id", value: (entry) => entry.id },
    { key: "startedAt", value: (entry) => entry.startedAt },
    { key: "endedAt", value: (entry) => entry.endedAt },
    { key: "patternKey", value: (entry) => entry.patternKey },
  ],
};

function sortByTimestamp<T extends { readonly id: string }>(
  records: readonly T[],
  timestamp: (record: T) => string,
): readonly T[] {
  return [...records].sort((left, right) => {
    const timeOrder = timestamp(left).localeCompare(timestamp(right));
    return timeOrder || left.id.localeCompare(right.id);
  });
}

function result<Row>(
  definition: HealthCsvExportDefinition,
  rows: readonly Row[],
  schema: CsvSchema<Row>,
): HealthCsvExportResult {
  return {
    ...definition,
    rowCount: rows.length,
    content: serializeCsv(rows, schema),
  };
}

function definitionFor(kind: HealthCsvExportKind): HealthCsvExportDefinition {
  const definition = HEALTH_CSV_EXPORT_DEFINITIONS.find((item) => item.kind === kind);
  if (!definition) {
    throw new TypeError(`Missing health CSV export definition: ${kind}`);
  }
  return definition;
}

/** Builds one complete health-history export from the local entity repositories. */
export function createHealthCsvExport(
  kind: HealthCsvExportKind,
  input: HealthCsvExportInput,
): HealthCsvExportResult {
  const definition = definitionFor(kind);
  switch (kind) {
    case "weight": {
      const rows = sortByTimestamp(
        input.measurements.filter((entry) => entry.type === "weight"),
        (entry) => entry.measuredAt,
      );
      return result(definition, rows, weightSchema);
    }
    case "blood-pressure": {
      const rows = sortByTimestamp(
        input.measurements.filter((entry) => entry.type === "blood-pressure"),
        (entry) => entry.measuredAt,
      );
      return result(definition, rows, bloodPressureSchema);
    }
    case "other-measurements": {
      const rows = sortByTimestamp(
        input.measurements.filter(
          (entry) => entry.type !== "weight" && entry.type !== "blood-pressure",
        ),
        (entry) => entry.measuredAt,
      );
      return result(definition, rows, otherMeasurementSchema);
    }
    case "hydration":
      return result(
        definition,
        sortByTimestamp(input.hydrationEntries, (entry) => entry.drunkAt),
        hydrationSchema,
      );
    case "nutrition":
      return result(
        definition,
        sortByTimestamp(
          input.nutritionEntries.filter((entry) => entry.deletedAt === null),
          (entry) => entry.eatenAt,
        ),
        nutritionSchema,
      );
    case "sleep":
      return result(
        definition,
        sortByTimestamp(
          input.sleepEntries.filter((entry) => entry.deletedAt === null),
          (entry) => entry.sleepStart,
        ),
        sleepSchema,
      );
    case "activity":
      return result(
        definition,
        sortByTimestamp(
          input.activityEntries.filter((entry) => entry.deletedAt === null),
          (entry) => entry.activityAt,
        ),
        activitySchema,
      );
    case "mood":
      return result(
        definition,
        sortByTimestamp(input.moodCheckins, (entry) => entry.checkedAt),
        moodSchema,
      );
    case "supplements": {
      const supplementsById = new Map(input.supplements.map((entry) => [entry.id, entry]));
      const rows: SupplementCsvRow[] = sortByTimestamp(
        input.supplementLogs,
        (entry) => entry.takenAt ?? entry.scheduledAt ?? entry.createdAt,
      ).map((entry) => ({
        id: entry.id,
        supplementId: entry.supplementId,
        supplementName: supplementsById.get(entry.supplementId)?.name ?? null,
        status: entry.status ?? "taken",
        scheduledAt: entry.scheduledAt,
        takenAt: entry.takenAt,
        doseAmount: entry.doseAmount,
        doseUnit: entry.doseUnit,
      }));
      return result(definition, rows, supplementSchema);
    }
    case "breathing":
      return result(
        definition,
        sortByTimestamp(input.breathingSessions, (entry) => entry.startedAt),
        breathingSchema,
      );
  }
}
