import {
  MeasurementDataPreview,
  MeasurementHeading,
  MeasurementEmptyPreview,
} from "./MeasurementPresentation.tsx";
// T213: valinnainen verensokerikirjaus rekisterin yksiköissä ilman
// terveysarvioita tai hoito-ohjeita.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useState } from "react";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import {
  getDefaultMeasurementUnitDefinition,
  getMeasurementDisplayPrecision,
  getMeasurementTypeDefinition,
  getMeasurementUnitDefinition,
} from "@lifeos/domain";
import type { Measurement } from "@lifeos/domain";
import { Button, Card, Icon, Input, Meta, NumberInput, Select } from "@lifeos/ui";
import {
  filterMeasurementsByRange,
  HealthRangeControl,
  type HealthRange,
} from "./health-range.tsx";

const BLOOD_SUGAR_UNITS = getMeasurementTypeDefinition("blood-sugar").units;
const BLOOD_SUGAR_UNIT_OPTIONS = BLOOD_SUGAR_UNITS.map((definition) => ({
  value: definition.unit,
  label: definition.unit,
}));
const DEFAULT_BLOOD_SUGAR_UNIT =
  getDefaultMeasurementUnitDefinition("blood-sugar")?.unit ?? "mmol/l";

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

function BloodSugarMeasurementForm({
  measurements,
  onSaved,
  onCancel,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [unit, setUnit] = useState(DEFAULT_BLOOD_SUGAR_UNIT);
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [valueError, setValueError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const unitDefinition = getMeasurementUnitDefinition("blood-sugar", unit);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) {
      return;
    }
    const parsedValue = parseDecimal(value);
    const nextValueError =
      unitDefinition === null ||
      parsedValue === null ||
      parsedValue < unitDefinition.minimum ||
      parsedValue > unitDefinition.maximum
        ? tTemplate("Anna arvo väliltä {{0}}–{{1}} {{2}}.", [
            String(unitDefinition?.minimum ?? 0),
            String(unitDefinition?.maximum ?? 100),
            unit,
          ])
        : "";
    const nextFormError =
      note.trim().length > 500 ? "Muistiinpano voi olla enintään 500 merkkiä." : "";
    setValueError(nextValueError);
    setFormError(nextFormError);
    if (nextValueError !== "" || nextFormError !== "" || parsedValue === null) {
      return;
    }

    setSaving(true);
    try {
      const result = await createMeasurementService(
        { clock: systemClock(), measurements },
        {
          type: "blood-sugar",
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
        thrown instanceof Error ? thrown.message : t("Verensokerimerkinnän tallennus epäonnistui."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-testid="health-blood-sugar-form"
      aria-label={t("Lisää verensokerimerkintä")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <NumberInput
        label={tTemplate("Verensokeri ({{0}})", [unit])}
        placeholder={unit === "mg/dL" ? "Esim. 97" : "Esim. 5,4"}
        min={unitDefinition?.minimum}
        max={unitDefinition?.maximum}
        step={unitDefinition?.displayPrecision === 0 ? 1 : 0.1}
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
        hint={t("Arvo tallentuu valittuun yksikköön. Yksikön vaihtaminen ei muunna lukua.")}
        options={tOptions(BLOOD_SUGAR_UNIT_OPTIONS)}
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
        placeholder={t("Esim. mittaustilanne")}
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
          {t("Tallenna merkintä")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function BloodSugarMeasurementsCard({
  measurements,
  bloodSugarHistory,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly bloodSugarHistory: readonly Measurement[];
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [range, setRange] = useState<HealthRange>("all");
  const visibleHistory = filterMeasurementsByRange(bloodSugarHistory, range);
  return (
    <Card
      heading={<MeasurementHeading title="Verensokeri" icon="droplet" />}
      data-testid="health-blood-sugar"
    >
      {bloodSugarHistory.length > 0 ? (
        <HealthRangeControl range={range} onRangeChange={setRange} />
      ) : null}
      {visibleHistory.length === 0 ? (
        <MeasurementEmptyPreview
          unit={bloodSugarHistory[0]?.unit ?? "mmol/L"}
          title={
            bloodSugarHistory.length === 0
              ? t("Ei verensokerimerkintöjä vielä")
              : t("Ei kirjauksia tällä aikavälillä")
          }
          hint={
            bloodSugarHistory.length === 0
              ? t(
                  "Voit ottaa seurannan käyttöön kirjaamalla mittaamasi arvon itse valitsemassasi yksikössä.",
                )
              : t("Valitse pidempi aikaväli nähdäksesi aiempia merkintöjä.")
          }
        />
      ) : (
        <>
          <MeasurementDataPreview measurements={visibleHistory} />
          <details data-ui="measurement-history-details">
            <summary>{t("Viisi uusinta mittausta")}</summary>
            <dl data-ui="health-blood-sugar-values">
              {visibleHistory.slice(0, 5).map((measurement) => (
                <div key={measurement.id}>
                  <dt>{formatDateTime(measurement.measuredAt)}</dt>
                  <dd>
                    {formatNumber(
                      measurement.value,
                      getMeasurementDisplayPrecision("blood-sugar", measurement.unit),
                    )}{" "}
                    {measurement.unit}
                  </dd>
                  {measurement.note !== null ? (
                    <Meta>
                      {t("Muistiinpano: ")}
                      {measurement.note}
                    </Meta>
                  ) : null}
                </div>
              ))}
            </dl>{" "}
          </details>
        </>
      )}
      <Meta>{t("Arvo näkyy kirjatussa yksikössä ilman terveysarviota tai hoito-ohjeita.")}</Meta>
      <p>
        <Button
          type="button"
          variant="primary"
          aria-expanded={formOpen}
          aria-controls="health-blood-sugar-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          <Icon name="add" />
          {formOpen ? t("Piilota lomake") : t("Lisää verensokerimittaus")}
        </Button>
      </p>
      <div id="health-blood-sugar-form" data-ui="health-blood-sugar-editor" hidden={!formOpen}>
        {formOpen ? (
          <BloodSugarMeasurementForm
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
