import { MeasurementHeading } from "./MeasurementPresentation.tsx";
// T208: vyötärön ja käyttäjän nimeämien kehon mittojen kirjaus ja aktivointi.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useState } from "react";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import {
  BODY_MEASURE_NAME_MAX_LENGTH,
  getMeasurementDisplayPrecision,
  getMeasurementUnitDefinition,
  normalizeBodyMeasureName,
} from "@lifeos/domain";
import type { Measurement } from "@lifeos/domain";
import { Button, Card, Icon, Input, Meta, NumberInput, Select } from "@lifeos/ui";

const BODY_MEASURE_KIND_OPTIONS = [
  { value: "waist", label: "Vyötärö" },
  { value: "custom", label: "Oma mitta" },
] as const;

const BODY_MEASURE_UNIT_OPTIONS = [
  { value: "cm", label: "cm" },
  { value: "in", label: "in" },
] as const;

type BodyMeasureKind = (typeof BODY_MEASURE_KIND_OPTIONS)[number]["value"];

function parseDecimal(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (normalized === "") {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits }).format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function BodyMeasureForm({
  initialName,
  measurements,
  onSaved,
  onCancel,
}: {
  readonly initialName: string;
  readonly measurements: EntityRepository<Measurement>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [kind, setKind] = useState<BodyMeasureKind>(initialName === "Vyötärö" ? "waist" : "custom");
  const [customName, setCustomName] = useState(initialName === "Vyötärö" ? "" : initialName);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("cm");
  const [note, setNote] = useState("");
  const [nameError, setNameError] = useState("");
  const [valueError, setValueError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const unitDefinition = getMeasurementUnitDefinition("body-measure", unit);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) {
      return;
    }
    const metricName = kind === "waist" ? "Vyötärö" : normalizeBodyMeasureName(customName);
    const nextNameError =
      kind === "custom" &&
      (metricName.length === 0 || metricName.length > BODY_MEASURE_NAME_MAX_LENGTH)
        ? tTemplate("Anna mitan nimi (1–{{0}} merkkiä).", [String(BODY_MEASURE_NAME_MAX_LENGTH)])
        : "";
    const parsedValue = parseDecimal(value);
    const nextValueError =
      unitDefinition === null ||
      parsedValue === null ||
      parsedValue < unitDefinition.minimum ||
      parsedValue > unitDefinition.maximum
        ? tTemplate("Anna arvo väliltä {{0}}–{{1}} {{2}}.", [
            String(unitDefinition?.minimum ?? 0.1),
            String(unitDefinition?.maximum ?? 500),
            unit,
          ])
        : "";
    if (note.trim().length > 500) {
      setFormError(t("Muistiinpano voi olla enintään 500 merkkiä."));
    } else {
      setFormError("");
    }
    setNameError(nextNameError);
    setValueError(nextValueError);
    if (nextNameError !== "" || nextValueError !== "" || note.trim().length > 500) {
      return;
    }
    if (parsedValue === null) {
      return;
    }

    setSaving(true);
    try {
      const result = await createMeasurementService(
        { clock: systemClock(), measurements },
        {
          type: "body-measure",
          metricName,
          value: parsedValue,
          secondaryValue: null,
          unit,
          note: note.trim() === "" ? null : note.trim(),
        },
      );
      if (!result.ok) {
        setFormError(result.error.userMessage);
        return;
      }
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      onSaved();
    } catch (thrown) {
      setFormError(
        thrown instanceof Error ? thrown.message : t("Mittauksen tallennus epäonnistui."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-testid="health-body-measure-form"
      aria-label={t("Lisää kehon mitta")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <Select
        label={t("Mitta")}
        options={tOptions([...BODY_MEASURE_KIND_OPTIONS])}
        value={kind}
        disabled={saving}
        onChange={(event) => {
          setKind(event.target.value as BodyMeasureKind);
          setNameError("");
          setFormError("");
        }}
      />
      {kind === "custom" ? (
        <Input
          label={t("Mittauksen nimi")}
          placeholder={t("Esim. Rintakehä")}
          maxLength={BODY_MEASURE_NAME_MAX_LENGTH}
          value={customName}
          disabled={saving}
          error={nameError === "" ? undefined : t(nameError)}
          onChange={(event) => {
            setCustomName(event.target.value);
            setNameError("");
            setFormError("");
          }}
        />
      ) : null}
      <NumberInput
        label={tTemplate("Arvo ({{0}})", [unit])}
        placeholder={t("Esim. 82,5")}
        min={unitDefinition?.minimum}
        max={unitDefinition?.maximum}
        step={0.1}
        value={value}
        disabled={saving}
        error={valueError === "" ? undefined : t(valueError)}
        onChange={(event) => {
          setValue(event.target.value);
          setValueError("");
          setFormError("");
        }}
      />
      <Select
        label={t("Yksikkö")}
        hint={t("Yksikön vaihtaminen ei muunna lukua.")}
        options={tOptions([...BODY_MEASURE_UNIT_OPTIONS])}
        value={unit}
        disabled={saving}
        onChange={(event) => {
          setUnit(event.target.value);
          setValueError("");
          setFormError("");
        }}
      />
      <Input
        label={t("Muistiinpano (valinnainen)")}
        placeholder={t("Esim. aamumittaus")}
        maxLength={500}
        value={note}
        disabled={saving}
        onChange={(event) => {
          setNote(event.target.value);
          setFormError("");
        }}
      />
      {formError !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(formError)}
        </p>
      ) : null}
      <p>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna mitta")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function BodyMeasurementsCard({
  measurements,
  bodyMeasurements,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly bodyMeasurements: readonly Measurement[];
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [selectedName, setSelectedName] = useState("Vyötärö");
  return (
    <Card
      heading={<MeasurementHeading title="Kehon mitat" icon="body" />}
      data-testid="health-body-measures"
    >
      {bodyMeasurements.length === 0 ? (
        <div data-ui="measurement-body-intro">
          <Meta>{t("Kirjaa vyötärö tai lisää oma mitta, niin uusin arvo näkyy tässä.")}</Meta>
          <div data-ui="measurement-body-shortcuts">
            {["Vyötärö", "Rinnanympärys", "Lantio", "Hauis", "Reisi"].map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setSelectedName(name);
                  setFormOpen(true);
                }}
              >
                {t(name)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setSelectedName("");
                setFormOpen(true);
              }}
            >
              <Icon name="add" />
              {t("Lisää oma")}
            </button>
          </div>
          <img data-ui="measurement-body-illustration" src="/images/body-measurement.png" alt="" />
        </div>
      ) : (
        <dl data-ui="health-body-measure-values">
          {bodyMeasurements.map((measurement) => {
            const metricName = normalizeBodyMeasureName(measurement.metricName ?? "");
            return (
              <div key={measurement.id}>
                <dt>{metricName === "" ? t("Nimeämätön mitta") : metricName}</dt>
                <dd>
                  {formatNumber(
                    measurement.value,
                    getMeasurementDisplayPrecision("body-measure", measurement.unit),
                  )}{" "}
                  {measurement.unit}
                </dd>
                <Meta>
                  {t("Kirjattu ")}
                  {formatDateTime(measurement.measuredAt)}
                </Meta>
                {measurement.note !== null ? (
                  <Meta>
                    {t("Muistiinpano: ")}
                    {measurement.note}
                  </Meta>
                ) : null}
              </div>
            );
          })}
        </dl>
      )}
      <Meta>
        {t("Arvo tallennetaan valitussa yksikössä. Voit lisätä erillisen muistiinpanon.")}
      </Meta>
      <p>
        <Button
          type="button"
          variant="primary"
          aria-expanded={formOpen}
          aria-controls="health-body-measure-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          <Icon name="add" />
          {formOpen ? t("Piilota lomake") : t("Lisää kehon mitta")}
        </Button>
      </p>
      <div id="health-body-measure-form" data-ui="health-body-measure-editor" hidden={!formOpen}>
        {formOpen ? (
          <BodyMeasureForm
            key={selectedName}
            initialName={selectedName}
            measurements={measurements}
            onSaved={() => {
              setFormOpen(false);
            }}
            onCancel={() => {
              setFormOpen(false);
            }}
          />
        ) : null}
      </div>
    </Card>
  );
}
