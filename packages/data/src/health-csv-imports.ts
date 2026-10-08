// T276–T277: CSV-tuonnin validointi, sisältöduplikointien tunnistus ja commit.
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
import {
  BLOOD_PRESSURE_PULSE_RANGE,
  containsControlCharacters,
  CUSTOM_METRIC_NAME_MAX_LENGTH,
  getMeasurementTypeDefinition,
  getMeasurementUnitDefinition,
  isBloodPressureContext,
  isMeasurementType,
  MEASUREMENT_UNIT_MAX_LENGTH,
} from "@lifeos/domain";
import type { HealthCsvExportKind } from "./health-csv-exports.ts";
import type { EntityRepository } from "./repositories.ts";
import { type DataError, type DataResult } from "./errors.ts";

export type HealthCsvImportKind = HealthCsvExportKind;
export type CsvImportDelimiter = "," | ";" | "\t";

export interface CsvImportField {
  readonly key: string;
  readonly label: string;
  readonly required: boolean;
}

export interface ParsedCsvRow {
  readonly rowNumber: number;
  readonly values: readonly string[];
  readonly errors: readonly string[];
}

export interface ParsedCsvTable {
  readonly headers: readonly string[];
  readonly rows: readonly ParsedCsvRow[];
  readonly delimiter: CsvImportDelimiter;
  readonly fatalError: string | null;
}

export interface HealthCsvImportRow {
  readonly rowNumber: number;
  readonly sourceValues: readonly string[];
  readonly errors: readonly string[];
  readonly value: HealthCsvImportValue | null;
  readonly duplicate: boolean;
}

type MetadataKeys = "id" | "createdAt" | "updatedAt" | "version";

export type HealthCsvImportValue =
  | {
      readonly kind: "weight" | "blood-pressure" | "other-measurements";
      readonly entity: Omit<Measurement, MetadataKeys>;
    }
  | { readonly kind: "hydration"; readonly entity: Omit<HydrationEntry, MetadataKeys> }
  | {
      readonly kind: "nutrition";
      readonly entity: Omit<NutritionEntry, MetadataKeys>;
    }
  | { readonly kind: "sleep"; readonly entity: Omit<SleepEntry, MetadataKeys> }
  | { readonly kind: "activity"; readonly entity: Omit<ActivityEntry, MetadataKeys> }
  | { readonly kind: "mood"; readonly entity: Omit<MoodCheckin, MetadataKeys> }
  | { readonly kind: "supplements"; readonly entity: Omit<SupplementLog, MetadataKeys> }
  | { readonly kind: "breathing"; readonly entity: Omit<BreathingSession, MetadataKeys> };

export interface HealthCsvImportRepositories {
  readonly measurements: EntityRepository<Measurement>;
  readonly hydrationEntries: EntityRepository<HydrationEntry>;
  readonly nutritionEntries: EntityRepository<NutritionEntry>;
  readonly sleepEntries: EntityRepository<SleepEntry>;
  readonly activityEntries: EntityRepository<ActivityEntry>;
  readonly moodCheckins: EntityRepository<MoodCheckin>;
  readonly supplementLogs: EntityRepository<SupplementLog>;
  readonly breathingSessions: EntityRepository<BreathingSession>;
}

export type HealthCsvImportExistingRecord =
  | Measurement
  | HydrationEntry
  | NutritionEntry
  | SleepEntry
  | ActivityEntry
  | MoodCheckin
  | SupplementLog
  | BreathingSession;

export interface HealthCsvImportCommitResult {
  readonly importedCount: number;
  readonly duplicateRows: readonly number[];
  readonly failedRows: readonly { readonly rowNumber: number; readonly error: DataError }[];
}

const COMMON_TIME = "Ajankohta";

export const HEALTH_CSV_IMPORT_FIELDS: Readonly<
  Record<HealthCsvImportKind, readonly CsvImportField[]>
> = {
  weight: [
    { key: "measuredAt", label: COMMON_TIME, required: true },
    { key: "value", label: "Paino", required: true },
    { key: "unit", label: "Yksikkö", required: true },
    { key: "note", label: "Muistiinpano", required: false },
  ],
  "blood-pressure": [
    { key: "measuredAt", label: COMMON_TIME, required: true },
    { key: "systolic", label: "Systolinen paine", required: true },
    { key: "diastolic", label: "Diastolinen paine", required: true },
    { key: "pulseBpm", label: "Pulssi", required: false },
    { key: "unit", label: "Yksikkö", required: true },
    { key: "context", label: "Tilanne", required: false },
    { key: "note", label: "Muistiinpano", required: false },
  ],
  "other-measurements": [
    { key: "type", label: "Mittauksen tyyppi", required: true },
    { key: "metricName", label: "Mittarin nimi", required: false },
    { key: "measuredAt", label: COMMON_TIME, required: true },
    { key: "value", label: "Arvo", required: true },
    { key: "secondaryValue", label: "Lisäarvo", required: false },
    { key: "unit", label: "Yksikkö", required: true },
    { key: "pulseBpm", label: "Pulssi", required: false },
    { key: "context", label: "Tilanne", required: false },
    { key: "note", label: "Muistiinpano", required: false },
  ],
  hydration: [
    { key: "drunkAt", label: COMMON_TIME, required: true },
    { key: "milliliters", label: "Millilitrat", required: true },
  ],
  nutrition: [
    { key: "eatenAt", label: "Ruokailuaika", required: true },
    { key: "mealSlotId", label: "Aterialuokan tunniste", required: false },
    { key: "foodId", label: "Ruoan tunniste", required: false },
    { key: "label", label: "Ruoka", required: true },
    { key: "amountG", label: "Määrä grammoina", required: false },
    { key: "calories", label: "Kalorit", required: false },
    { key: "proteinG", label: "Proteiini", required: false },
    { key: "carbsG", label: "Hiilihydraatit", required: false },
    { key: "fatG", label: "Rasva", required: false },
    { key: "fiberG", label: "Kuitu", required: false },
  ],
  sleep: [
    { key: "sleepStart", label: "Unen alku", required: true },
    { key: "sleepEnd", label: "Unen loppu", required: true },
    { key: "quality", label: "Unen laatu", required: false },
    { key: "isNap", label: "Päiväunet", required: false },
  ],
  activity: [
    { key: "activityAt", label: COMMON_TIME, required: true },
    { key: "kind", label: "Aktiviteetti", required: true },
    { key: "durationSeconds", label: "Kesto sekunteina", required: false },
    { key: "distanceMeters", label: "Matka metreinä", required: false },
    { key: "note", label: "Muistiinpano", required: false },
  ],
  mood: [
    { key: "checkedAt", label: COMMON_TIME, required: true },
    { key: "mood", label: "Mieliala", required: true },
    { key: "stress", label: "Stressi", required: false },
    { key: "energy", label: "Energia", required: false },
    { key: "motivation", label: "Motivaatio", required: false },
    { key: "focus", label: "Keskittyminen", required: false },
    { key: "note", label: "Muistiinpano", required: false },
  ],
  supplements: [
    { key: "supplementId", label: "Lisäravinteen tunniste", required: true },
    { key: "status", label: "Tila", required: true },
    { key: "scheduledAt", label: "Suunniteltu aika", required: false },
    { key: "takenAt", label: "Otettu aika", required: false },
    { key: "doseAmount", label: "Annos", required: false },
    { key: "doseUnit", label: "Annosyksikkö", required: false },
  ],
  breathing: [
    { key: "startedAt", label: "Harjoituksen alku", required: true },
    { key: "endedAt", label: "Harjoituksen loppu", required: false },
    { key: "patternKey", label: "Hengitysmalli", required: true },
  ],
};

export const HEALTH_CSV_IMPORT_LABELS: Readonly<Record<HealthCsvImportKind, string>> = {
  weight: "Painohistoria",
  "blood-pressure": "Verenpainehistoria",
  "other-measurements": "Muut mittaukset",
  hydration: "Nesteytyshistoria",
  nutrition: "Ravintohistoria",
  sleep: "Unihistoria",
  activity: "Aktiivisuushistoria",
  mood: "Mielialahistoria",
  supplements: "Lisäravinnehistoria",
  breathing: "Hengityshistoria",
};

async function listImportRepositoryRecords<T extends HealthCsvImportExistingRecord>(
  repository: EntityRepository<T>,
): Promise<DataResult<readonly HealthCsvImportExistingRecord[]>> {
  const listed = await repository.list();
  return listed.ok ? { ok: true, value: listed.value } : listed;
}

export async function listHealthCsvImportExistingRecords(
  repositories: HealthCsvImportRepositories,
  kind: HealthCsvImportKind,
): Promise<DataResult<readonly HealthCsvImportExistingRecord[]>> {
  try {
    switch (kind) {
      case "weight":
      case "blood-pressure":
      case "other-measurements":
        return await listImportRepositoryRecords(repositories.measurements);
      case "hydration":
        return await listImportRepositoryRecords(repositories.hydrationEntries);
      case "nutrition":
        return await listImportRepositoryRecords(repositories.nutritionEntries);
      case "sleep":
        return await listImportRepositoryRecords(repositories.sleepEntries);
      case "activity":
        return await listImportRepositoryRecords(repositories.activityEntries);
      case "mood":
        return await listImportRepositoryRecords(repositories.moodCheckins);
      case "supplements":
        return await listImportRepositoryRecords(repositories.supplementLogs);
      case "breathing":
        return await listImportRepositoryRecords(repositories.breathingSessions);
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "transient-failure",
        userMessage: "Tallennettua historiaa ei voitu tarkistaa.",
        diagnosticCode: "data.health-csv-import.dedupe.read",
      },
    };
  }
}

const DELIMITERS: readonly CsvImportDelimiter[] = [",", ";", "\t"];
const MAX_CSV_CHARACTERS = 12_000_000;
const MAX_CSV_ROWS = 20_000;

interface CsvParseAttempt {
  readonly records: readonly string[][];
  readonly malformedQuoteRecord: number | null;
}

function parseWithDelimiter(text: string, delimiter: CsvImportDelimiter): CsvParseAttempt {
  const source = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let insideQuote = false;
  let malformedQuoteRecord: number | null = null;
  let recordNumber = 1;

  const finishCell = (): void => {
    record.push(cell);
    cell = "";
  };
  const finishRecord = (): void => {
    finishCell();
    if (record.some((value) => value.trim() !== "")) records.push(record);
    record = [];
    recordNumber += 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (insideQuote) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          insideQuote = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"') {
      if (cell.length === 0) insideQuote = true;
      else malformedQuoteRecord ??= recordNumber;
      if (cell.length > 0) cell += character;
    } else if (character === delimiter) {
      finishCell();
    } else if (character === "\n") {
      finishRecord();
    } else {
      cell += character;
    }
  }
  if (insideQuote) malformedQuoteRecord ??= recordNumber;
  if (cell.length > 0 || record.length > 0) finishRecord();
  return { records, malformedQuoteRecord };
}

function detectDelimiter(text: string): CsvImportDelimiter {
  let best: { readonly delimiter: CsvImportDelimiter; readonly score: number } = {
    delimiter: ",",
    score: Number.NEGATIVE_INFINITY,
  };
  for (const delimiter of DELIMITERS) {
    const parsed = parseWithDelimiter(text, delimiter);
    const headerWidth = parsed.records[0]?.length ?? 0;
    const consistentRows = parsed.records
      .slice(1, 11)
      .filter((row) => row.length === headerWidth).length;
    const score =
      headerWidth * 10 + consistentRows - (parsed.malformedQuoteRecord === null ? 0 : 100);
    if (score > best.score) best = { delimiter, score };
  }
  return best.delimiter;
}

/** Reads RFC-style quoted CSV locally, including doubled quotes and embedded line breaks. */
export function parseHealthCsv(text: string): ParsedCsvTable {
  if (text.length > MAX_CSV_CHARACTERS) {
    return { headers: [], rows: [], delimiter: ",", fatalError: "Tiedosto on liian suuri." };
  }
  const delimiter = detectDelimiter(text);
  const parsed = parseWithDelimiter(text, delimiter);
  const headerRecord = parsed.records[0];
  if (headerRecord === undefined || headerRecord.length < 2) {
    return {
      headers: headerRecord?.map((header) => header.trim()) ?? [],
      rows: [],
      delimiter,
      fatalError: "Tiedostosta ei löytynyt otsakeriviä ja vähintään kahta saraketta.",
    };
  }
  const headers = headerRecord.map((header, index) => {
    const trimmed = header.trim();
    return trimmed === "" ? `Sarake ${String(index + 1)}` : trimmed;
  });
  const rows = parsed.records.slice(1, MAX_CSV_ROWS + 1).map((values, index) => ({
    rowNumber: index + 2,
    values,
    errors:
      values.length === headers.length
        ? []
        : [`Rivillä on ${String(values.length)} arvoa, otsakkeita on ${String(headers.length)}.`],
  }));
  let fatalError: string | null = null;
  if (parsed.malformedQuoteRecord !== null) {
    fatalError = `CSV-lainausmerkki ei täsmää rivillä ${String(parsed.malformedQuoteRecord)}.`;
  } else if (parsed.records.length - 1 > MAX_CSV_ROWS) {
    fatalError = `Tiedosto sisältää yli ${String(MAX_CSV_ROWS)} tietoriviä.`;
  }
  return { headers, rows, delimiter, fatalError };
}

function normalizedHeader(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s_-]+/gu, "");
}

export function suggestHealthCsvImportKind(headers: readonly string[]): HealthCsvImportKind | null {
  const headerSet = new Set(headers.map(normalizedHeader));
  let bestKind: HealthCsvImportKind | null = null;
  let bestScore = 0;
  for (const kind of Object.keys(HEALTH_CSV_IMPORT_FIELDS) as HealthCsvImportKind[]) {
    const fields = HEALTH_CSV_IMPORT_FIELDS[kind];
    const requiredMatches = fields.filter(
      (field) => field.required && headerSet.has(normalizedHeader(field.key)),
    ).length;
    const optionalMatches = fields.filter(
      (field) => !field.required && headerSet.has(normalizedHeader(field.key)),
    ).length;
    const requiredCount = fields.filter((field) => field.required).length;
    if (requiredMatches !== requiredCount) continue;
    const score = requiredMatches * 100 + optionalMatches;
    if (score > bestScore) {
      bestKind = kind;
      bestScore = score;
    }
  }
  return bestKind;
}

export function suggestHealthCsvColumnMapping(
  headers: readonly string[],
  kind: HealthCsvImportKind,
): Readonly<Record<string, number | undefined>> {
  return Object.fromEntries(
    HEALTH_CSV_IMPORT_FIELDS[kind].map((field) => {
      const targetHeader = normalizedHeader(field.key);
      const index = headers.findIndex((header) => normalizedHeader(header) === targetHeader);
      return [field.key, index < 0 ? undefined : index];
    }),
  );
}

function readRawValue(
  sourceValues: readonly string[],
  mapping: Readonly<Record<string, number | undefined>>,
  key: string,
): string {
  const index = mapping[key];
  return index === undefined ? "" : (sourceValues[index] ?? "");
}

function validUtcTimestamp(value: string): boolean {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(normalized)) return false;
  const time = Date.parse(normalized);
  if (!Number.isFinite(time)) return false;
  const fraction = /\.(\d{1,3})Z$/u.exec(normalized)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(time).toISOString() === `${normalized.slice(0, 19)}.${fraction}Z`;
}

function parseTimestamp(
  value: string,
  label: string,
  errors: string[],
  required = true,
): string | null {
  if (value.trim() === "" && !required) return null;
  if (!validUtcTimestamp(value)) {
    errors.push(`${label}: käytä UTC-aikaleimaa muodossa 2026-05-01T12:00:00.000Z.`);
    return null;
  }
  return value.trim();
}

function parseText(
  value: string,
  label: string,
  errors: string[],
  options: {
    readonly required?: boolean;
    readonly maximum?: number;
    readonly preserveWhitespace?: boolean;
  } = {},
): string | null {
  const trimmed = value.trim();
  if (trimmed === "") {
    if (options.required === true) errors.push(`${label}: arvo puuttuu.`);
    return null;
  }
  const text = options.preserveWhitespace === true ? value : trimmed;
  if (
    (options.maximum !== undefined && text.length > options.maximum) ||
    containsControlCharacters(text)
  ) {
    errors.push(`${label}: arvo on liian pitkä tai sisältää ohjausmerkkejä.`);
    return null;
  }
  return text;
}

function parseNumber(
  value: string,
  label: string,
  errors: string[],
  options: {
    readonly required?: boolean;
    readonly integer?: boolean;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly decimalComma?: boolean;
  } = {},
): number | null {
  if (value.trim() === "") {
    if (options.required === true) errors.push(`${label}: arvo puuttuu.`);
    return null;
  }
  const trimmed = value.trim();
  const normalized =
    options.decimalComma === true || /^[+-]?\d+,\d+$/u.test(trimmed)
      ? trimmed.replace(",", ".")
      : trimmed;
  const parsed = Number(normalized);
  if (
    !Number.isFinite(parsed) ||
    (options.integer === true && !Number.isSafeInteger(parsed)) ||
    (options.minimum !== undefined && parsed < options.minimum) ||
    (options.maximum !== undefined && parsed > options.maximum)
  ) {
    errors.push(`${label}: tarkista numero ja sen sallitut rajat.`);
    return null;
  }
  return parsed;
}

function parseBoolean(value: string, label: string, errors: string[]): boolean | null {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  errors.push(`${label}: käytä arvoa true, false, 1 tai 0.`);
  return null;
}

function parseContext(value: string, errors: string[]): Measurement["context"] {
  const normalized = value.trim();
  if (normalized === "") return null;
  if (isBloodPressureContext(normalized)) return normalized;
  errors.push("Tilanne: käytä tunnistetta morning, evening, resting, after-activity tai other.");
  return null;
}

function validateRow(
  kind: HealthCsvImportKind,
  raw: readonly string[],
  mapping: Readonly<Record<string, number | undefined>>,
  knownSupplementIds: ReadonlySet<string>,
): { readonly value: HealthCsvImportValue | null; readonly errors: readonly string[] } {
  const errors: string[] = [];
  const value = (key: string): string => readRawValue(raw, mapping, key);
  const label = (key: string): string =>
    HEALTH_CSV_IMPORT_FIELDS[kind].find((field) => field.key === key)?.label ?? key;
  let result: HealthCsvImportValue | null = null;

  if (kind === "weight" || kind === "blood-pressure" || kind === "other-measurements") {
    const measuredAt = parseTimestamp(value("measuredAt"), label("measuredAt"), errors);
    const unit = parseText(value("unit"), label("unit"), errors, {
      required: true,
      maximum: MEASUREMENT_UNIT_MAX_LENGTH,
    });
    const typeValue =
      kind === "weight"
        ? "weight"
        : kind === "blood-pressure"
          ? "blood-pressure"
          : value("type").trim().toLocaleLowerCase("en-US");
    const type = isMeasurementType(typeValue) ? typeValue : null;
    if (
      type === null ||
      (kind === "other-measurements" && (type === "weight" || type === "blood-pressure"))
    ) {
      errors.push("Mittauksen tyyppi: valitse tiedostoon sopiva tunniste.");
    }
    const rawMetricName = parseText(value("metricName"), label("metricName"), errors, {
      maximum: CUSTOM_METRIC_NAME_MAX_LENGTH,
    });
    const metricName =
      rawMetricName === null ? null : rawMetricName.normalize("NFKC").trim().replace(/\s+/gu, " ");
    const mainValueKey = kind === "blood-pressure" ? "systolic" : "value";
    const primary = parseNumber(value(mainValueKey), label(mainValueKey), errors, {
      required: true,
    });
    const secondary =
      kind === "blood-pressure" || kind === "other-measurements"
        ? parseNumber(
            value(kind === "blood-pressure" ? "diastolic" : "secondaryValue"),
            label(kind === "blood-pressure" ? "diastolic" : "secondaryValue"),
            errors,
          )
        : null;
    const pulseBpm = parseNumber(value("pulseBpm"), label("pulseBpm"), errors, {
      integer: true,
      minimum: BLOOD_PRESSURE_PULSE_RANGE.minimum,
      maximum: BLOOD_PRESSURE_PULSE_RANGE.maximum,
    });
    const context = parseContext(value("context"), errors);
    const note = parseText(value("note"), label("note"), errors, {
      maximum: 500,
      preserveWhitespace: true,
    });
    if (kind === "blood-pressure" && (primary === null || secondary === null)) {
      errors.push("Verenpaine: systolinen ja diastolinen arvo tarvitaan.");
    }
    if (kind === "other-measurements" && type === "body-measure" && metricName === null) {
      errors.push("Mittarin nimi: kehon mitan tyyppi tarvitsee nimen.");
    }
    if (type !== null && type !== "body-measure" && type !== "custom" && metricName !== null) {
      errors.push("Mittarin nimeä voi käyttää vain kehon mitassa tai omassa mittarissa.");
    }
    if (type !== null && unit !== null) {
      const typeDefinition = getMeasurementTypeDefinition(type);
      const unitDefinition = getMeasurementUnitDefinition(type, unit);
      if (unitDefinition === null && !typeDefinition.allowsCustomUnit) {
        errors.push("Yksikkö ei ole tuetun mittaustyypin käytettävissä.");
      }
      if (typeDefinition.secondaryValue === "required" && secondary === null) {
        errors.push("Tälle mittaustyypille tarvitaan lisäarvo.");
      }
      if (typeDefinition.secondaryValue === "forbidden" && secondary !== null) {
        errors.push("Tämä mittaustyyppi ei käytä lisäarvoa.");
      }
      if (unitDefinition !== null && primary !== null) {
        if (primary < unitDefinition.minimum || primary > unitDefinition.maximum) {
          errors.push("Arvo on kyseisen yksikön sallitun kirjausrajan ulkopuolella.");
        }
        if (
          typeDefinition.secondaryValue === "required" &&
          secondary !== null &&
          (secondary < unitDefinition.minimum || secondary > unitDefinition.maximum)
        ) {
          errors.push("Lisäarvo on kyseisen yksikön sallitun kirjausrajan ulkopuolella.");
        }
      }
      if (
        type === "blood-pressure" &&
        ((primary !== null && !Number.isInteger(primary)) ||
          (secondary !== null && !Number.isInteger(secondary)))
      ) {
        errors.push("Verenpaineen arvojen pitää olla kokonaislukuja.");
      }
      if (type !== "blood-pressure" && (pulseBpm !== null || context !== null)) {
        errors.push("Pulssi ja tilanne kuuluvat vain verenpainemittaukseen.");
      }
    }
    if (measuredAt !== null && unit !== null && type !== null && primary !== null) {
      result = {
        kind,
        entity: {
          type,
          measuredAt,
          value: primary,
          secondaryValue: secondary,
          unit,
          metricName,
          pulseBpm,
          context,
          note,
        },
      };
    }
  } else if (kind === "hydration") {
    const drunkAt = parseTimestamp(value("drunkAt"), label("drunkAt"), errors);
    const milliliters = parseNumber(value("milliliters"), label("milliliters"), errors, {
      required: true,
      integer: true,
      minimum: 1,
      maximum: 5_000,
    });
    if (drunkAt !== null && milliliters !== null) {
      result = { kind, entity: { drunkAt, milliliters } };
    }
  } else if (kind === "nutrition") {
    const eatenAt = parseTimestamp(value("eatenAt"), label("eatenAt"), errors);
    const mealSlotId = parseText(value("mealSlotId"), label("mealSlotId"), errors, {
      maximum: 128,
    });
    const foodId = parseText(value("foodId"), label("foodId"), errors, { maximum: 128 });
    const foodLabel = parseText(value("label"), label("label"), errors, {
      required: true,
      maximum: 200,
    });
    const amountG = parseNumber(value("amountG"), label("amountG"), errors, { minimum: 0.001 });
    const calories = parseNumber(value("calories"), label("calories"), errors, { minimum: 0 });
    const proteinG = parseNumber(value("proteinG"), label("proteinG"), errors, { minimum: 0 });
    const carbsG = parseNumber(value("carbsG"), label("carbsG"), errors, { minimum: 0 });
    const fatG = parseNumber(value("fatG"), label("fatG"), errors, { minimum: 0 });
    const fiberG = parseNumber(value("fiberG"), label("fiberG"), errors, { minimum: 0 });
    if (eatenAt !== null && foodLabel !== null) {
      result = {
        kind,
        entity: {
          eatenAt,
          mealSlotId,
          foodId,
          label: foodLabel,
          amountG,
          calories,
          proteinG,
          carbsG,
          fatG,
          fiberG,
          deletedAt: null,
        },
      };
    }
  } else if (kind === "sleep") {
    const sleepStart = parseTimestamp(value("sleepStart"), label("sleepStart"), errors);
    const sleepEnd = parseTimestamp(value("sleepEnd"), label("sleepEnd"), errors);
    const quality = parseNumber(value("quality"), label("quality"), errors, {
      integer: true,
      minimum: 1,
      maximum: 5,
    });
    const isNap =
      value("isNap").trim() === "" ? false : parseBoolean(value("isNap"), label("isNap"), errors);
    if (
      sleepStart !== null &&
      sleepEnd !== null &&
      Date.parse(sleepEnd) <= Date.parse(sleepStart)
    ) {
      errors.push("Unen loppu: ajankohdan pitää olla unen alkua myöhemmin.");
    }
    if (sleepStart !== null && sleepEnd !== null && isNap !== null) {
      result = { kind, entity: { sleepStart, sleepEnd, quality, isNap, deletedAt: null } };
    }
  } else if (kind === "activity") {
    const activityAt = parseTimestamp(value("activityAt"), label("activityAt"), errors);
    const activityKind = parseText(value("kind"), label("kind"), errors, {
      required: true,
      maximum: 60,
    });
    const durationSeconds = parseNumber(
      value("durationSeconds"),
      label("durationSeconds"),
      errors,
      {
        integer: true,
        minimum: 0,
      },
    );
    const distanceMeters = parseNumber(value("distanceMeters"), label("distanceMeters"), errors, {
      minimum: 0,
    });
    const note = parseText(value("note"), label("note"), errors, {
      maximum: 500,
      preserveWhitespace: true,
    });
    if (activityAt !== null && activityKind !== null) {
      result = {
        kind,
        entity: {
          activityAt,
          kind: activityKind,
          durationSeconds,
          distanceMeters,
          note,
          deletedAt: null,
        },
      };
    }
  } else if (kind === "mood") {
    const checkedAt = parseTimestamp(value("checkedAt"), label("checkedAt"), errors);
    const mood = parseNumber(value("mood"), label("mood"), errors, {
      required: true,
      integer: true,
      minimum: 1,
      maximum: 5,
    });
    const stress = parseNumber(value("stress"), label("stress"), errors, {
      integer: true,
      minimum: 1,
      maximum: 5,
    });
    const energy = parseNumber(value("energy"), label("energy"), errors, {
      integer: true,
      minimum: 1,
      maximum: 5,
    });
    const motivation = parseNumber(value("motivation"), label("motivation"), errors, {
      integer: true,
      minimum: 1,
      maximum: 5,
    });
    const focus = parseNumber(value("focus"), label("focus"), errors, {
      integer: true,
      minimum: 1,
      maximum: 5,
    });
    const note = parseText(value("note"), label("note"), errors, {
      maximum: 500,
      preserveWhitespace: true,
    });
    if (checkedAt !== null && mood !== null) {
      result = { kind, entity: { checkedAt, mood, stress, energy, motivation, focus, note } };
    }
  } else if (kind === "supplements") {
    const supplementId = parseText(value("supplementId"), label("supplementId"), errors, {
      required: true,
      maximum: 128,
    });
    const statusRaw = value("status").trim().toLocaleLowerCase("en-US");
    const status = ["taken", "skipped", "pending"].includes(statusRaw)
      ? (statusRaw as SupplementLog["status"])
      : null;
    if (status === null) errors.push("Tila: käytä tunnistetta taken, skipped tai pending.");
    const scheduledAtRaw = value("scheduledAt");
    const scheduledAt =
      scheduledAtRaw.trim() === ""
        ? null
        : parseTimestamp(scheduledAtRaw, label("scheduledAt"), errors);
    const takenAtRaw = value("takenAt");
    const takenAt =
      takenAtRaw.trim() === "" ? null : parseTimestamp(takenAtRaw, label("takenAt"), errors);
    const doseAmount = parseNumber(value("doseAmount"), label("doseAmount"), errors, {
      minimum: 0,
    });
    const doseUnit = parseText(value("doseUnit"), label("doseUnit"), errors, { maximum: 60 });
    if (supplementId !== null && !knownSupplementIds.has(supplementId)) {
      errors.push("Lisäravinnetta ei löydy tästä laitteesta. Tuo ensin lisäravinteen tiedot.");
    }
    if ((status === "pending" || status === "skipped") && scheduledAt === null) {
      errors.push("Suunniteltu aika tarvitaan odottavalle tai ohitetulle merkinnälle.");
    }
    if (status === "taken" && takenAt === null) {
      errors.push("Otettu aika tarvitaan otetulle merkinnälle.");
    }
    if (status !== null && status !== "taken" && takenAt !== null) {
      errors.push("Otettu aika kuuluu vain otetulle merkinnälle.");
    }
    if (supplementId !== null && status !== null && knownSupplementIds.has(supplementId)) {
      result = {
        kind,
        entity: { supplementId, status, scheduledAt, takenAt, doseAmount, doseUnit },
      };
    }
  } else {
    const startedAt = parseTimestamp(value("startedAt"), label("startedAt"), errors);
    const endedAt =
      value("endedAt").trim() === ""
        ? null
        : parseTimestamp(value("endedAt"), label("endedAt"), errors);
    const patternKey = parseText(value("patternKey"), label("patternKey"), errors, {
      required: true,
      maximum: 80,
    });
    if (startedAt !== null && endedAt !== null && Date.parse(endedAt) < Date.parse(startedAt)) {
      errors.push("Harjoituksen loppu ei voi olla ennen sen alkua.");
    }
    if (startedAt !== null && patternKey !== null) {
      result = { kind, entity: { startedAt, endedAt, patternKey } };
    }
  }

  return { value: errors.length === 0 ? result : null, errors };
}

function healthCsvImportFingerprint(value: HealthCsvImportValue): string {
  switch (value.kind) {
    case "weight":
    case "blood-pressure":
    case "other-measurements":
      return JSON.stringify([
        value.kind,
        value.entity.type,
        value.entity.measuredAt,
        value.entity.value,
        value.entity.secondaryValue,
        value.entity.unit,
        value.entity.metricName ?? null,
        value.entity.pulseBpm ?? null,
        value.entity.context ?? null,
        value.entity.note,
      ]);
    case "hydration":
      return JSON.stringify([value.kind, value.entity.drunkAt, value.entity.milliliters]);
    case "nutrition":
      return JSON.stringify([
        value.kind,
        value.entity.eatenAt,
        value.entity.mealSlotId ?? null,
        value.entity.foodId ?? null,
        value.entity.label,
        value.entity.amountG ?? null,
        value.entity.calories,
        value.entity.proteinG,
        value.entity.carbsG,
        value.entity.fatG,
        value.entity.fiberG ?? null,
      ]);
    case "sleep":
      return JSON.stringify([
        value.kind,
        value.entity.sleepStart,
        value.entity.sleepEnd,
        value.entity.quality,
        value.entity.isNap ?? false,
      ]);
    case "activity":
      return JSON.stringify([
        value.kind,
        value.entity.activityAt,
        value.entity.kind,
        value.entity.durationSeconds,
        value.entity.distanceMeters,
        value.entity.note ?? null,
      ]);
    case "mood":
      return JSON.stringify([
        value.kind,
        value.entity.checkedAt,
        value.entity.mood,
        value.entity.stress,
        value.entity.energy,
        value.entity.motivation,
        value.entity.focus,
        value.entity.note,
      ]);
    case "supplements":
      return JSON.stringify([
        value.kind,
        value.entity.supplementId,
        value.entity.status ?? "taken",
        value.entity.scheduledAt ?? null,
        value.entity.takenAt,
        value.entity.doseAmount ?? null,
        value.entity.doseUnit ?? null,
      ]);
    case "breathing":
      return JSON.stringify([
        value.kind,
        value.entity.startedAt,
        value.entity.endedAt,
        value.entity.patternKey,
      ]);
  }
}

function importValueFromExistingRecord(
  record: HealthCsvImportExistingRecord,
): HealthCsvImportValue | null {
  if ("deletedAt" in record && record.deletedAt !== null) return null;
  if ("measuredAt" in record) {
    const kind: HealthCsvImportKind =
      record.type === "weight"
        ? "weight"
        : record.type === "blood-pressure"
          ? "blood-pressure"
          : "other-measurements";
    return { kind, entity: record };
  }
  if ("drunkAt" in record) return { kind: "hydration", entity: record };
  if ("eatenAt" in record) return { kind: "nutrition", entity: record };
  if ("sleepStart" in record) return { kind: "sleep", entity: record };
  if ("activityAt" in record) return { kind: "activity", entity: record };
  if ("checkedAt" in record) return { kind: "mood", entity: record };
  if ("supplementId" in record) return { kind: "supplements", entity: record };
  if ("startedAt" in record) return { kind: "breathing", entity: record };
  return null;
}

function flagDuplicateHealthCsvImportRows(
  rows: readonly HealthCsvImportRow[],
  existingRecords: readonly HealthCsvImportExistingRecord[],
): readonly HealthCsvImportRow[] {
  const seen = new Set<string>();
  for (const record of existingRecords) {
    const value = importValueFromExistingRecord(record);
    if (value !== null) seen.add(healthCsvImportFingerprint(value));
  }
  return rows.map((row) => {
    if (row.value === null || row.errors.length > 0) return { ...row, duplicate: false };
    const fingerprint = healthCsvImportFingerprint(row.value);
    const duplicate = seen.has(fingerprint);
    seen.add(fingerprint);
    return { ...row, duplicate };
  });
}

export interface HealthCsvImportPreview {
  readonly mappingErrors: readonly string[];
  readonly rows: readonly HealthCsvImportRow[];
  readonly validCount: number;
  readonly duplicateCount: number;
  readonly invalidCount: number;
}

export function previewHealthCsvImport(
  table: ParsedCsvTable,
  kind: HealthCsvImportKind,
  mapping: Readonly<Record<string, number | undefined>>,
  options: {
    readonly knownSupplementIds?: readonly string[];
    readonly existingRecords?: readonly HealthCsvImportExistingRecord[];
  } = {},
): HealthCsvImportPreview {
  const fields = HEALTH_CSV_IMPORT_FIELDS[kind];
  const mappingErrors: string[] = [];
  for (const field of fields) {
    if (field.required && mapping[field.key] === undefined) {
      mappingErrors.push(`${field.label}: valitse tiedoston sarake.`);
    }
  }
  const selectedIndexes = fields
    .map((field) => mapping[field.key])
    .filter((index): index is number => index !== undefined);
  if (new Set(selectedIndexes).size !== selectedIndexes.length) {
    mappingErrors.push("Samaa tiedostosaraketta ei voi kohdistaa useaan kenttään.");
  }
  const knownSupplementIds = new Set(options.knownSupplementIds ?? []);
  const rows = table.rows.map((row) => {
    const rowErrors = [...row.errors];
    const validation =
      rowErrors.length > 0 || mappingErrors.length > 0
        ? { value: null, errors: [] }
        : validateRow(kind, row.values, mapping, knownSupplementIds);
    rowErrors.push(...validation.errors);
    return {
      rowNumber: row.rowNumber,
      sourceValues: row.values,
      errors: rowErrors,
      value: validation.value,
      duplicate: false,
    };
  });
  const deduplicatedRows = flagDuplicateHealthCsvImportRows(rows, options.existingRecords ?? []);
  const validCount = deduplicatedRows.filter(
    (row) => row.value !== null && row.errors.length === 0 && !row.duplicate,
  ).length;
  return {
    mappingErrors,
    rows: deduplicatedRows,
    validCount,
    duplicateCount: deduplicatedRows.filter((row) => row.duplicate).length,
    invalidCount: deduplicatedRows.filter((row) => row.value === null || row.errors.length > 0)
      .length,
  };
}

function repositoryGroupForKind(kind: HealthCsvImportKind): string {
  return kind === "weight" || kind === "blood-pressure" || kind === "other-measurements"
    ? "measurements"
    : kind;
}

export async function commitHealthCsvImport(
  repositories: HealthCsvImportRepositories,
  rows: readonly HealthCsvImportRow[],
): Promise<HealthCsvImportCommitResult> {
  const candidateRows = rows.filter((row) => row.value !== null && row.errors.length === 0);
  const candidateKinds = new Map<string, HealthCsvImportKind>();
  for (const row of candidateRows) {
    if (row.value !== null) {
      const group = repositoryGroupForKind(row.value.kind);
      if (!candidateKinds.has(group)) candidateKinds.set(group, row.value.kind);
    }
  }
  const existingRecords: HealthCsvImportExistingRecord[] = [];
  for (const kind of candidateKinds.values()) {
    const listed = await listHealthCsvImportExistingRecords(repositories, kind);
    if (!listed.ok) {
      return {
        importedCount: 0,
        duplicateRows: [],
        failedRows: candidateRows.map((row) => ({ rowNumber: row.rowNumber, error: listed.error })),
      };
    }
    existingRecords.push(...listed.value);
  }

  const seen = new Set<string>();
  for (const record of existingRecords) {
    const value = importValueFromExistingRecord(record);
    if (value !== null) seen.add(healthCsvImportFingerprint(value));
  }
  let importedCount = 0;
  const duplicateRows: number[] = [];
  const failedRows: { rowNumber: number; error: DataError }[] = [];
  for (const row of rows) {
    if (row.value === null || row.errors.length > 0) continue;
    const fingerprint = healthCsvImportFingerprint(row.value);
    if (seen.has(fingerprint)) {
      duplicateRows.push(row.rowNumber);
      continue;
    }
    let result: DataResult<unknown>;
    try {
      switch (row.value.kind) {
        case "weight":
        case "blood-pressure":
        case "other-measurements":
          result = await repositories.measurements.create(row.value.entity);
          break;
        case "hydration":
          result = await repositories.hydrationEntries.create(row.value.entity);
          break;
        case "nutrition":
          result = await repositories.nutritionEntries.create(row.value.entity);
          break;
        case "sleep":
          result = await repositories.sleepEntries.create(row.value.entity);
          break;
        case "activity":
          result = await repositories.activityEntries.create(row.value.entity);
          break;
        case "mood":
          result = await repositories.moodCheckins.create(row.value.entity);
          break;
        case "supplements":
          result = await repositories.supplementLogs.create(row.value.entity);
          break;
        case "breathing":
          result = await repositories.breathingSessions.create(row.value.entity);
          break;
      }
    } catch {
      failedRows.push({
        rowNumber: row.rowNumber,
        error: {
          code: "transient-failure",
          userMessage: "Tämän rivin tallennus epäonnistui.",
          diagnosticCode: "data.health-csv-import.commit",
        },
      });
      continue;
    }
    if (result.ok) {
      importedCount += 1;
      seen.add(fingerprint);
    } else failedRows.push({ rowNumber: row.rowNumber, error: result.error });
  }
  return { importedCount, duplicateRows, failedRows };
}

export function isActiveSupplement(supplement: Supplement): boolean {
  return supplement.deletedAt === null;
}
