// T201: yleinen mittauspalvelu (§10, §14–§15, §20, §29, §52).
// Mittaukset ovat T068/M009:n ja §36:n mukaan append-only: palvelu ei
// tarjoa päivitystä tai poistoa, jotka rikkoisivat replikoiden yhdistämisen.

import {
  BLOOD_PRESSURE_PULSE_RANGE,
  BODY_MEASURE_NAME_MAX_LENGTH,
  CUSTOM_METRIC_NAME_MAX_LENGTH,
  MEASUREMENT_UNIT_MAX_LENGTH,
  containsControlCharacters,
  getMeasurementTypeDefinition,
  getMeasurementUnitDefinition,
  isBloodPressureContext,
  isMeasurementType,
  normalizeBodyMeasureName,
  normalizeMeasurementMetricName,
} from "@lifeos/domain";
import type {
  BloodPressureContext,
  Measurement,
  MeasurementType,
  UtcTimestamp,
} from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

const MEASUREMENT_NOTE_MAX_LENGTH = 500;
const UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

export interface MeasurementServiceDeps {
  readonly clock: Clock;
  readonly measurements: EntityRepository<Measurement>;
}

export interface CreateMeasurementInput {
  readonly type: MeasurementType;
  readonly value: number;
  readonly secondaryValue?: number | null | undefined;
  readonly unit: string;
  readonly metricName?: string | null | undefined;
  readonly pulseBpm?: number | null | undefined;
  readonly context?: BloodPressureContext | null | undefined;
  readonly measuredAt?: UtcTimestamp | undefined;
  readonly note?: string | null | undefined;
}

export interface ListMeasurementsOptions {
  readonly type?: MeasurementType | undefined;
}

function invalidMeasurement<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.measurement.validation.${field}`, message),
  };
}

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string") {
    return false;
  }
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const dateAndTime = match[1];
  if (dateAndTime === undefined) {
    return false;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return false;
  }
  const fraction = (match[2] ?? "").padEnd(3, "0");
  return new Date(milliseconds).toISOString() === `${dateAndTime}.${fraction}Z`;
}

function validateMeasurementInput(
  input: CreateMeasurementInput,
  fallbackMeasuredAt: UtcTimestamp,
): DataResult<Omit<Measurement, "id" | "createdAt" | "updatedAt" | "version">> {
  if (!isMeasurementType(input.type)) {
    return invalidMeasurement("type", "Valitse tuettu mittaustyyppi.");
  }
  if (typeof input.value !== "number" || !Number.isFinite(input.value)) {
    return invalidMeasurement("value", "Mittausarvon on oltava äärellinen numero.");
  }
  const secondaryValue = input.secondaryValue ?? null;
  if (
    secondaryValue !== null &&
    (typeof secondaryValue !== "number" || !Number.isFinite(secondaryValue))
  ) {
    return invalidMeasurement("secondary-value", "Lisäarvon on oltava äärellinen numero.");
  }
  if (typeof input.unit !== "string") {
    return invalidMeasurement("unit", "Anna mittauksen yksikkö.");
  }
  const unit = input.unit.trim();
  if (
    unit.length === 0 ||
    unit.length > MEASUREMENT_UNIT_MAX_LENGTH ||
    containsControlCharacters(unit)
  ) {
    return invalidMeasurement(
      "unit",
      `Yksikön on oltava 1–${String(MEASUREMENT_UNIT_MAX_LENGTH)} merkkiä ilman ohjausmerkkejä.`,
    );
  }
  const typeDefinition = getMeasurementTypeDefinition(input.type);
  const rawMetricName = input.metricName ?? null;
  let metricName: string | undefined;
  if (input.type === "body-measure") {
    if (typeof rawMetricName !== "string") {
      return invalidMeasurement("metric-name", "Anna kehon mitan nimi.");
    }
    metricName = normalizeBodyMeasureName(rawMetricName);
    if (metricName.length === 0 || metricName.length > BODY_MEASURE_NAME_MAX_LENGTH) {
      return invalidMeasurement(
        "metric-name",
        `Nimen pituuden tulee olla 1–${String(BODY_MEASURE_NAME_MAX_LENGTH)} merkkiä.`,
      );
    }
  } else if (input.type === "custom") {
    if (rawMetricName !== null) {
      if (typeof rawMetricName !== "string") {
        return invalidMeasurement("metric-name", "Anna oman mittarin nimi tekstinä.");
      }
      metricName = normalizeMeasurementMetricName(rawMetricName);
      if (
        metricName.length === 0 ||
        metricName.length > CUSTOM_METRIC_NAME_MAX_LENGTH ||
        containsControlCharacters(metricName)
      ) {
        return invalidMeasurement(
          "metric-name",
          `Nimen pituuden tulee olla 1–${String(CUSTOM_METRIC_NAME_MAX_LENGTH)} merkkiä ilman ohjausmerkkejä.`,
        );
      }
    }
  } else if (rawMetricName !== null) {
    return invalidMeasurement(
      "metric-name",
      "Nimi voidaan liittää kehon mittaukseen tai omaan mittariin.",
    );
  }
  const pulseBpm = input.pulseBpm ?? null;
  const context = input.context ?? null;
  if (input.type === "blood-pressure") {
    if (
      pulseBpm !== null &&
      (typeof pulseBpm !== "number" ||
        !Number.isInteger(pulseBpm) ||
        pulseBpm < BLOOD_PRESSURE_PULSE_RANGE.minimum ||
        pulseBpm > BLOOD_PRESSURE_PULSE_RANGE.maximum)
    ) {
      return invalidMeasurement(
        "pulse",
        `Pulssin on oltava kokonaisluku väliltä ${String(BLOOD_PRESSURE_PULSE_RANGE.minimum)}–${String(BLOOD_PRESSURE_PULSE_RANGE.maximum)} lyöntiä/min.`,
      );
    }
    if (context !== null && !isBloodPressureContext(context)) {
      return invalidMeasurement("context", "Valitse tuettu verenpainemittauksen konteksti.");
    }
  } else if (pulseBpm !== null || context !== null) {
    return invalidMeasurement(
      "blood-pressure-fields",
      "Pulssi ja konteksti voidaan liittää verenpainemittaukseen.",
    );
  }
  if (
    input.type === "blood-pressure" &&
    (!Number.isInteger(input.value) ||
      (secondaryValue !== null && !Number.isInteger(secondaryValue)))
  ) {
    return invalidMeasurement(
      "blood-pressure-integer",
      "Ylä- ja alapaineen on oltava kokonaislukuja.",
    );
  }
  const unitDefinition = getMeasurementUnitDefinition(input.type, unit);
  if (unitDefinition === null && !typeDefinition.allowsCustomUnit) {
    const options = typeDefinition.units.map((definition) => definition.unit).join(", ");
    return invalidMeasurement("unit", `Mittauksen yksikön tulee olla jokin näistä: ${options}.`);
  }
  if (typeDefinition.secondaryValue === "required" && secondaryValue === null) {
    return invalidMeasurement(
      "secondary-value-required",
      "Verenpainemittaukseen tarvitaan ylä- ja alapaine.",
    );
  }
  if (typeDefinition.secondaryValue === "forbidden" && secondaryValue !== null) {
    return invalidMeasurement(
      "secondary-value-unsupported",
      "Tämä mittaustyyppi ei käytä toista mittausarvoa.",
    );
  }
  if (unitDefinition !== null) {
    if (input.value < unitDefinition.minimum || input.value > unitDefinition.maximum) {
      return invalidMeasurement(
        "value-range",
        `Arvon on oltava ${String(unitDefinition.minimum)}–${String(unitDefinition.maximum)} ${unit}.`,
      );
    }
    if (
      secondaryValue !== null &&
      (secondaryValue < unitDefinition.minimum || secondaryValue > unitDefinition.maximum)
    ) {
      return invalidMeasurement(
        "secondary-value-range",
        `Lisäarvon on oltava ${String(unitDefinition.minimum)}–${String(unitDefinition.maximum)} ${unit}.`,
      );
    }
  }
  const measuredAt = input.measuredAt ?? fallbackMeasuredAt;
  if (!isValidUtcTimestamp(measuredAt)) {
    return invalidMeasurement("measured-at", "Anna mittausajankohta UTC-aikaleimana.");
  }
  const rawNote = input.note ?? null;
  if (rawNote !== null && typeof rawNote !== "string") {
    return invalidMeasurement("note", "Mittausmuistiinpanon on oltava tekstiä.");
  }
  const note = rawNote?.trim() || null;
  if (note !== null && note.length > MEASUREMENT_NOTE_MAX_LENGTH) {
    return invalidMeasurement(
      "note-length",
      `Muistiinpano voi olla enintään ${String(MEASUREMENT_NOTE_MAX_LENGTH)} merkkiä.`,
    );
  }

  return {
    ok: true,
    value: {
      type: input.type,
      value: input.value,
      secondaryValue,
      unit,
      ...(metricName !== undefined ? { metricName } : {}),
      ...(pulseBpm !== null ? { pulseBpm } : {}),
      ...(context !== null ? { context } : {}),
      measuredAt,
      note,
    },
  };
}

/** Luo validoidun mittauksen. Puuttuva mittausajankohta saa kellon nykyhetken. */
export async function createMeasurementService(
  deps: MeasurementServiceDeps,
  input: CreateMeasurementInput,
): Promise<DataResult<Measurement>> {
  const validated = validateMeasurementInput(input, deps.clock.nowIso());
  if (!validated.ok) {
    return validated;
  }
  return deps.measurements.create(validated.value);
}

/** Hakee mittauksen tunnisteella repositoryn not-found-virheineen. */
export function getMeasurementService(
  deps: MeasurementServiceDeps,
  measurementId: string,
): Promise<DataResult<Measurement>> {
  return deps.measurements.getById(measurementId);
}

/** Listaa mittaukset uusimmasta vanhimpaan; tyypin rajaus on valinnainen. */
export async function listMeasurementsService(
  deps: MeasurementServiceDeps,
  options: ListMeasurementsOptions = {},
): Promise<DataResult<readonly Measurement[]>> {
  if (options.type !== undefined && !isMeasurementType(options.type)) {
    return invalidMeasurement("type-filter", "Valitse tuettu mittaustyyppi.");
  }
  const listed = await deps.measurements.list();
  if (!listed.ok) {
    return listed;
  }
  const filtered =
    options.type === undefined
      ? listed.value
      : listed.value.filter((measurement) => measurement.type === options.type);
  return {
    ok: true,
    value: [...filtered].sort((left, right) =>
      left.measuredAt < right.measuredAt
        ? 1
        : left.measuredAt > right.measuredAt
          ? -1
          : left.id.localeCompare(right.id),
    ),
  };
}
