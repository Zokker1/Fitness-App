// T202: tyypitetyt mittausyksiköt, esitystarkkuus ja syöttörajat.
// Rajat suojaavat ilmeisiltä syöttövirheiltä; ne eivät ole viitearvoja tai
// arvioita mittauksen lääketieteellisestä merkityksestä.
// Mittaus tallennetaan valittuun yksikköön; automaattimuunnokset ovat myöhempää työtä.

import type { BloodPressureContext, MeasurementType } from "./health.ts";

export interface MeasurementUnitDefinition {
  /** Tallennettava ja käyttäjälle näytettävä yksikkö. */
  readonly unit: string;
  /** Näyttöpyöristyksen desimaalien enimmäismäärä; raakaarvo säilytetään. */
  readonly displayPrecision: number;
  readonly minimum: number;
  readonly maximum: number;
}

export interface MeasurementTypeDefinition {
  readonly type: MeasurementType;
  readonly label: string;
  readonly units: readonly MeasurementUnitDefinition[];
  readonly displayPrecision: number;
  /** null tarkoittaa, että käyttäjä valitsee oman yksikön. */
  readonly defaultUnit: string | null;
  readonly allowsCustomUnit: boolean;
  readonly secondaryValue: "forbidden" | "required";
}

export const BODY_MEASURE_NAME_MAX_LENGTH = 60;
export const CUSTOM_METRIC_NAME_MAX_LENGTH = 60;
export const MEASUREMENT_UNIT_MAX_LENGTH = 20;

/** Kirjausraja suojaa virheellisiltä syötteiltä; se ei ole viitearvo. */
export const BLOOD_PRESSURE_PULSE_RANGE = { minimum: 1, maximum: 300 } as const;

export const BLOOD_PRESSURE_CONTEXT_OPTIONS: readonly {
  readonly value: BloodPressureContext;
  readonly label: string;
}[] = [
  { value: "morning", label: "Aamu" },
  { value: "evening", label: "Ilta" },
  { value: "resting", label: "Levossa" },
  { value: "after-activity", label: "Liikunnan jälkeen" },
  { value: "other", label: "Muu" },
];

export function isBloodPressureContext(value: unknown): value is BloodPressureContext {
  return (
    typeof value === "string" &&
    BLOOD_PRESSURE_CONTEXT_OPTIONS.some((option) => option.value === value)
  );
}

/** Normalisoi kehon mitan nimen tallennusta ja mittarien ryhmittelyä varten. */
export function normalizeBodyMeasureName(value: string): string {
  return normalizeMeasurementMetricName(value);
}

/** Normalisoi käyttäjän nimeämän mittarin ryhmittelyä ja tallennusta varten. */
export function normalizeMeasurementMetricName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** Tunnistaa ohjausmerkit käyttäjän syöttämistä nimistä ja yksiköistä. */
export function containsControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export const MEASUREMENT_TYPE_REGISTRY: Readonly<
  Record<MeasurementType, MeasurementTypeDefinition>
> = {
  weight: {
    type: "weight",
    label: "Paino",
    displayPrecision: 1,
    defaultUnit: "kg",
    allowsCustomUnit: false,
    secondaryValue: "forbidden",
    units: [
      { unit: "kg", displayPrecision: 1, minimum: 20, maximum: 400 },
      { unit: "lb", displayPrecision: 1, minimum: 44, maximum: 880 },
    ],
  },
  "blood-pressure": {
    type: "blood-pressure",
    label: "Verenpaine",
    displayPrecision: 0,
    defaultUnit: "mmHg",
    allowsCustomUnit: false,
    secondaryValue: "required",
    units: [{ unit: "mmHg", displayPrecision: 0, minimum: 40, maximum: 300 }],
  },
  "blood-sugar": {
    type: "blood-sugar",
    label: "Verensokeri",
    displayPrecision: 1,
    defaultUnit: "mmol/l",
    allowsCustomUnit: false,
    secondaryValue: "forbidden",
    units: [
      { unit: "mmol/l", displayPrecision: 1, minimum: 0, maximum: 100 },
      { unit: "mg/dL", displayPrecision: 0, minimum: 0, maximum: 1800 },
    ],
  },
  temperature: {
    type: "temperature",
    label: "Lämpötila",
    displayPrecision: 1,
    defaultUnit: "°C",
    allowsCustomUnit: false,
    secondaryValue: "forbidden",
    units: [
      { unit: "°C", displayPrecision: 1, minimum: -100, maximum: 100 },
      { unit: "°F", displayPrecision: 1, minimum: -148, maximum: 212 },
    ],
  },
  spo2: {
    type: "spo2",
    label: "SpO₂",
    displayPrecision: 1,
    defaultUnit: "%",
    allowsCustomUnit: false,
    secondaryValue: "forbidden",
    units: [{ unit: "%", displayPrecision: 1, minimum: 0, maximum: 100 }],
  },
  "body-measure": {
    type: "body-measure",
    label: "Kehon mitta",
    displayPrecision: 1,
    defaultUnit: "cm",
    allowsCustomUnit: false,
    secondaryValue: "forbidden",
    units: [
      { unit: "cm", displayPrecision: 1, minimum: 0.1, maximum: 500 },
      { unit: "in", displayPrecision: 1, minimum: 0.1, maximum: 200 },
    ],
  },
  custom: {
    type: "custom",
    label: "Oma mittari",
    displayPrecision: 2,
    defaultUnit: null,
    allowsCustomUnit: true,
    secondaryValue: "forbidden",
    units: [],
  },
};

export function getMeasurementTypeDefinition(type: MeasurementType): MeasurementTypeDefinition {
  return MEASUREMENT_TYPE_REGISTRY[type];
}

export function isMeasurementType(value: unknown): value is MeasurementType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(MEASUREMENT_TYPE_REGISTRY, value)
  );
}

export function getMeasurementUnitDefinition(
  type: MeasurementType,
  unit: string,
): MeasurementUnitDefinition | null {
  return (
    MEASUREMENT_TYPE_REGISTRY[type].units.find((definition) => definition.unit === unit) ?? null
  );
}

export function getMeasurementDisplayPrecision(type: MeasurementType, unit: string): number {
  return (
    getMeasurementUnitDefinition(type, unit)?.displayPrecision ??
    MEASUREMENT_TYPE_REGISTRY[type].displayPrecision
  );
}

export function getDefaultMeasurementUnitDefinition(
  type: MeasurementType,
): MeasurementUnitDefinition | null {
  const definition = MEASUREMENT_TYPE_REGISTRY[type];
  return definition.defaultUnit === null
    ? null
    : getMeasurementUnitDefinition(type, definition.defaultUnit);
}
