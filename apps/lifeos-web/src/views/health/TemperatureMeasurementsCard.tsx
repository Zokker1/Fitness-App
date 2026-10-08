import {
  MeasurementDataPreview,
  MeasurementHeading,
  MeasurementEmptyPreview,
} from "./MeasurementPresentation.tsx";
// T211: käyttäjän aktivoitava lämpötilakirjaus. Arvo tallennetaan valittuun
// yksikköön sellaisenaan eikä sitä tulkita terveydelliseksi arvioksi.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useState } from "react";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import {
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

const TEMPERATURE_UNITS = getMeasurementTypeDefinition("temperature").units;
const TEMPERATURE_UNIT_OPTIONS = TEMPERATURE_UNITS.map((definition) => ({
  value: definition.unit,
  label: definition.unit,
}));

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

function TemperatureMeasurementForm({
  measurements,
  onSaved,
  onCancel,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [unit, setUnit] = useState("°C");
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [valueError, setValueError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const unitDefinition = getMeasurementUnitDefinition("temperature", unit);

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
            String(unitDefinition?.minimum ?? -100),
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
          type: "temperature",
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
        thrown instanceof Error ? thrown.message : t("Lämpötilan tallennus epäonnistui."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-testid="health-temperature-form"
      aria-label={t("Lisää lämpötilamittaus")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <NumberInput
        label={tTemplate("Lämpötila ({{0}})", [unit])}
        placeholder={unit === "°C" ? "Esim. 36,6" : "Esim. 97,9"}
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
        hint={t("Arvo tallennetaan valitussa yksikössä. Yksikön vaihtaminen ei muunna lukua.")}
        options={tOptions(TEMPERATURE_UNIT_OPTIONS)}
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
          {t("Tallenna lämpötila")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function TemperatureMeasurementsCard({
  measurements,
  temperatureHistory,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly temperatureHistory: readonly Measurement[];
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [range, setRange] = useState<HealthRange>("all");
  const visibleHistory = filterMeasurementsByRange(temperatureHistory, range);
  return (
    <Card
      heading={<MeasurementHeading title="Lämpötila" icon="thermometer" />}
      data-testid="health-temperature"
    >
      {temperatureHistory.length > 0 ? (
        <HealthRangeControl range={range} onRangeChange={setRange} />
      ) : null}
      {visibleHistory.length === 0 ? (
        <MeasurementEmptyPreview
          unit={temperatureHistory[0]?.unit ?? "°C"}
          title={
            temperatureHistory.length === 0
              ? t("Ei lämpötilakirjauksia vielä")
              : t("Ei kirjauksia tällä aikavälillä")
          }
          hint={
            temperatureHistory.length === 0
              ? t(
                  "Voit ottaa seurannan käyttöön kirjaamalla lämpötilan itse valitsemassasi yksikössä.",
                )
              : t("Valitse pidempi aikaväli nähdäksesi aiempia merkintöjä.")
          }
        />
      ) : (
        <>
          <MeasurementDataPreview measurements={visibleHistory} />
          <details data-ui="measurement-history-details">
            <summary>{t("Viisi uusinta mittausta")}</summary>
            <dl data-ui="health-temperature-values">
              {visibleHistory.slice(0, 5).map((measurement) => (
                <div key={measurement.id}>
                  <dt>{formatDateTime(measurement.measuredAt)}</dt>
                  <dd>
                    {formatNumber(
                      measurement.value,
                      getMeasurementDisplayPrecision("temperature", measurement.unit),
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
      <Meta>
        {t("Yksikkö näkyy jokaisen kirjauksen yhteydessä. Arvoa ei muunneta tai arvioida.")}
      </Meta>
      <p>
        <Button
          type="button"
          variant="primary"
          aria-expanded={formOpen}
          aria-controls="health-temperature-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          <Icon name="add" />
          {formOpen ? t("Piilota lomake") : t("Lisää lämpötilamittaus")}
        </Button>
      </p>
      <div id="health-temperature-form" data-ui="health-temperature-editor" hidden={!formOpen}>
        {formOpen ? (
          <TemperatureMeasurementForm
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
