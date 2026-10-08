// T093/T203/T209: Quick Weight/BP -lomake. Painon tai verenpaineen voi
// kirjata erikseen tai yhdessä. Verenpaine tallentaa SYS/DIA:n, valinnaisen
// pulssin, kontekstin ja muistiinpanon.
// Yksiköt ovat kiinteät; rajat estävät virheellisen syötteen, eivät tulkitse
// terveyttä. Tallennus kulkee validoidun T201 measurement-palvelun kautta.
// onSaved(rows) → kutsuja (QuickAdd) päivittää näkymän ja sulkee lomakkeen.
// Pilkku ja piste kelpaavat desimaalierottimiksi.
import { t, tOptions, tTemplate } from "../language.tsx";
import { useState } from "react";
import { Button, Input, NumberInput, Select } from "@lifeos/ui";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import {
  BLOOD_PRESSURE_CONTEXT_OPTIONS,
  BLOOD_PRESSURE_PULSE_RANGE,
  getDefaultMeasurementUnitDefinition,
} from "@lifeos/domain";
import type {
  BloodPressureContext,
  Measurement,
  MeasurementType,
  MeasurementUnitDefinition,
  UtcTimestamp,
} from "@lifeos/domain";

function requireDefaultUnit(
  type: Extract<MeasurementType, "weight" | "blood-pressure">,
): MeasurementUnitDefinition {
  const definition = getDefaultMeasurementUnitDefinition(type);
  if (definition === null) {
    throw new Error(tTemplate("Mittarityypille {{0}} ei ole oletusyksikköä.", [type]));
  }
  return definition;
}

const WEIGHT_RULE = requireDefaultUnit("weight");
const BLOOD_PRESSURE_RULE = requireDefaultUnit("blood-pressure");
export const WEIGHT_UNIT = WEIGHT_RULE.unit;
export const BLOOD_PRESSURE_UNIT = BLOOD_PRESSURE_RULE.unit;
const BLOOD_PRESSURE_CONTEXT_SELECT_OPTIONS = [
  { value: "", label: "Ei valittu" },
  ...BLOOD_PRESSURE_CONTEXT_OPTIONS,
];

export interface QuickMeasureFormProps {
  readonly measurements: EntityRepository<Measurement>;
  readonly now?: UtcTimestamp | undefined;
  readonly onSaved: (rows: readonly Measurement[]) => void;
  readonly onCancel?: (() => void) | undefined;
}

function parseDecimal(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function QuickMeasureForm({
  measurements,
  now,
  onSaved,
  onCancel,
}: QuickMeasureFormProps): React.JSX.Element {
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [systolic, setSystolic] = useState("");
  const [diastolic, setDiastolic] = useState("");
  const [pulse, setPulse] = useState("");
  const [context, setContext] = useState<BloodPressureContext | "">("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = (): void => {
    if (saving) {
      return;
    }
    const hasWeight = weight.trim() !== "";
    const hasBloodPressureInput =
      systolic.trim() !== "" || diastolic.trim() !== "" || pulse.trim() !== "" || context !== "";
    const weightValue = hasWeight ? parseDecimal(weight) : null;
    if (
      hasWeight &&
      (weightValue === null ||
        weightValue < WEIGHT_RULE.minimum ||
        weightValue > WEIGHT_RULE.maximum)
    ) {
      setError(
        tTemplate("Anna paino yksikössä {{0}} ({{1}}–{{2}} {{3}}).", [
          WEIGHT_UNIT,
          String(WEIGHT_RULE.minimum),
          String(WEIGHT_RULE.maximum),
          WEIGHT_UNIT,
        ]),
      );
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > 500) {
      setError(t("Muistiinpano voi olla enintään 500 merkkiä."));
      return;
    }
    const systolicValue = parseDecimal(systolic);
    const diastolicValue = parseDecimal(diastolic);
    if (!hasWeight && !hasBloodPressureInput) {
      setError(
        tTemplate("Anna paino ({{0}}–{{1}} {{2}}) tai täytä molemmat verenpainearvot.", [
          String(WEIGHT_RULE.minimum),
          String(WEIGHT_RULE.maximum),
          WEIGHT_UNIT,
        ]),
      );
      return;
    }
    if (hasBloodPressureInput) {
      if (
        systolicValue === null ||
        diastolicValue === null ||
        !Number.isInteger(systolicValue) ||
        !Number.isInteger(diastolicValue) ||
        systolicValue < BLOOD_PRESSURE_RULE.minimum ||
        systolicValue > BLOOD_PRESSURE_RULE.maximum ||
        diastolicValue < BLOOD_PRESSURE_RULE.minimum ||
        diastolicValue > BLOOD_PRESSURE_RULE.maximum
      ) {
        setError(
          tTemplate(
            "Anna ylä- ja alapaine kokonaislukuina ({{0}}–{{1}} {{2}}) tai jätä verenpainetiedot tyhjiksi.",
            [
              String(BLOOD_PRESSURE_RULE.minimum),
              String(BLOOD_PRESSURE_RULE.maximum),
              BLOOD_PRESSURE_UNIT,
            ],
          ),
        );
        return;
      }
    }
    let pulseValue: number | null = null;
    if (pulse.trim() !== "") {
      pulseValue = parseDecimal(pulse);
      if (
        pulseValue === null ||
        !Number.isInteger(pulseValue) ||
        pulseValue < BLOOD_PRESSURE_PULSE_RANGE.minimum ||
        pulseValue > BLOOD_PRESSURE_PULSE_RANGE.maximum
      ) {
        setError(
          tTemplate("Pulssin on oltava kokonaisluku väliltä {{0}}–{{1}} lyöntiä/min.", [
            String(BLOOD_PRESSURE_PULSE_RANGE.minimum),
            String(BLOOD_PRESSURE_PULSE_RANGE.maximum),
          ]),
        );
        return;
      }
    }

    setSaving(true);
    setError("");
    const clock = systemClock();
    const measuredAt = now ?? clock.nowIso();
    const createMeasurement = async (
      input: Parameters<typeof createMeasurementService>[1],
    ): Promise<Measurement> => {
      const result = await createMeasurementService({ clock, measurements }, input);
      if (!result.ok) {
        throw new Error(result.error.userMessage);
      }
      return result.value;
    };
    const createRows = async (): Promise<void> => {
      const rows: Measurement[] = [];
      if (weightValue !== null) {
        rows.push(
          await createMeasurement({
            type: "weight",
            value: weightValue,
            secondaryValue: null,
            unit: WEIGHT_UNIT,
            measuredAt,
            note: trimmedNote === "" ? null : trimmedNote,
          }),
        );
      }
      if (hasBloodPressureInput && systolicValue !== null && diastolicValue !== null) {
        rows.push(
          await createMeasurement({
            type: "blood-pressure",
            value: systolicValue,
            secondaryValue: diastolicValue,
            unit: BLOOD_PRESSURE_UNIT,
            pulseBpm: pulseValue,
            context: context === "" ? null : context,
            measuredAt,
            note: trimmedNote === "" ? null : trimmedNote,
          }),
        );
      }
      onSaved(rows);
    };
    void createRows()
      .catch((thrown: unknown) => {
        setError(thrown instanceof Error ? thrown.message : t("Tallennus epäonnistui."));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form
      data-testid="quick-measure-form"
      aria-label={t("Kirjaa paino tai verenpaine")}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <NumberInput
        label={tTemplate("Paino ({{0}})", [WEIGHT_UNIT])}
        hint={t("Voit jättää painon tyhjäksi, jos kirjaat verenpaineen.")}
        placeholder={t("Esim. 75,5")}
        value={weight}
        disabled={saving}
        onChange={(event) => {
          setWeight(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <NumberInput
        label={t("Yläpaine (valinnainen)")}
        hint={tTemplate("Systolinen, {{0}} — täytä molemmat painearvot", [BLOOD_PRESSURE_UNIT])}
        placeholder={t("Esim. 120")}
        min={BLOOD_PRESSURE_RULE.minimum}
        max={BLOOD_PRESSURE_RULE.maximum}
        step={1}
        value={systolic}
        disabled={saving}
        onChange={(event) => {
          setSystolic(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <NumberInput
        label={t("Alapaine (valinnainen)")}
        hint={tTemplate("Diastolinen, {{0}}", [BLOOD_PRESSURE_UNIT])}
        placeholder={t("Esim. 80")}
        min={BLOOD_PRESSURE_RULE.minimum}
        max={BLOOD_PRESSURE_RULE.maximum}
        step={1}
        value={diastolic}
        disabled={saving}
        onChange={(event) => {
          setDiastolic(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <NumberInput
        label={t("Pulssi (lyöntiä/min, valinnainen)")}
        hint={t("Kirjausraja 1–300; kyse ei ole terveysarviosta.")}
        placeholder={t("Esim. 68")}
        min={BLOOD_PRESSURE_PULSE_RANGE.minimum}
        max={BLOOD_PRESSURE_PULSE_RANGE.maximum}
        step={1}
        value={pulse}
        disabled={saving}
        onChange={(event) => {
          setPulse(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <Select
        label={t("Konteksti (valinnainen)")}
        options={tOptions(BLOOD_PRESSURE_CONTEXT_SELECT_OPTIONS)}
        value={context}
        disabled={saving}
        onChange={(event) => {
          setContext(event.target.value as BloodPressureContext | "");
          if (error !== "") {
            setError("");
          }
        }}
      />
      <Input
        label={t("Muistiinpano (valinnainen)")}
        hint={t("Liitetään kaikkiin tässä lomakkeessa kirjattuihin mittauksiin.")}
        placeholder={t("Esim. aamumittaus")}
        maxLength={500}
        value={note}
        disabled={saving}
        onChange={(event) => {
          setNote(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <p>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna mittaus")}
        </Button>{" "}
        {onCancel !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              onCancel();
            }}
          >
            {t("Peruuta")}
          </Button>
        ) : null}
      </p>
    </form>
  );
}
