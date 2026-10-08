import { MeasurementHeading } from "./MeasurementPresentation.tsx";
// T214: käyttäjän nimeämät numeeriset mittarit omilla yksiköillään.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useState } from "react";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import type { CustomMetricHistory } from "@lifeos/data";
import {
  CUSTOM_METRIC_NAME_MAX_LENGTH,
  containsControlCharacters,
  getMeasurementDisplayPrecision,
  MEASUREMENT_UNIT_MAX_LENGTH,
  normalizeMeasurementMetricName,
} from "@lifeos/domain";
import type { Measurement } from "@lifeos/domain";
import { Button, Card, Icon, Input, Meta, NumberInput, Select } from "@lifeos/ui";

const NEW_METRIC_KEY = "__new_custom_metric__";

function metricKey(metric: Pick<CustomMetricHistory, "metricName" | "unit">): string {
  return JSON.stringify([metric.metricName.toLocaleLowerCase(getIntlLocale()), metric.unit]);
}

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

function CustomMetricForm({
  measurements,
  customMetricHistories,
  onSaved,
  onCancel,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly customMetricHistories: readonly CustomMetricHistory[];
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [selectedMetricKey, setSelectedMetricKey] = useState(() => {
    const latestMetric = customMetricHistories[0];
    return latestMetric === undefined ? NEW_METRIC_KEY : metricKey(latestMetric);
  });
  const [metricNameDraft, setMetricNameDraft] = useState("");
  const [unitDraft, setUnitDraft] = useState("");
  const [valueDraft, setValueDraft] = useState("");
  const [note, setNote] = useState("");
  const [nameError, setNameError] = useState("");
  const [unitError, setUnitError] = useState("");
  const [valueError, setValueError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedMetric = customMetricHistories.find(
    (metric) => metricKey(metric) === selectedMetricKey,
  );
  const creatingNewMetric = selectedMetric === undefined;
  const metricOptions = [
    { value: NEW_METRIC_KEY, label: "Uusi oma mittari" },
    ...customMetricHistories.map((metric) => ({
      value: metricKey(metric),
      label: `${metric.metricName} (${metric.unit})`,
    })),
  ];

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) {
      return;
    }
    const metricName = creatingNewMetric
      ? normalizeMeasurementMetricName(metricNameDraft)
      : selectedMetric.metricName;
    const unit = creatingNewMetric ? unitDraft.normalize("NFKC").trim() : selectedMetric.unit;
    const parsedValue = parseDecimal(valueDraft);
    const nextNameError =
      creatingNewMetric &&
      (metricName.length === 0 ||
        metricName.length > CUSTOM_METRIC_NAME_MAX_LENGTH ||
        containsControlCharacters(metricName))
        ? tTemplate("Anna nimi väliltä 1–{{0}} merkkiä.", [String(CUSTOM_METRIC_NAME_MAX_LENGTH)])
        : "";
    const nextUnitError =
      creatingNewMetric &&
      (unit.length === 0 ||
        unit.length > MEASUREMENT_UNIT_MAX_LENGTH ||
        containsControlCharacters(unit))
        ? tTemplate("Anna yksikkö väliltä 1–{{0}} merkkiä.", [String(MEASUREMENT_UNIT_MAX_LENGTH)])
        : "";
    const nextValueError = parsedValue === null ? "Anna äärellinen numeroarvo." : "";
    const nextFormError =
      note.trim().length > 500 ? "Muistiinpano voi olla enintään 500 merkkiä." : "";
    setNameError(nextNameError);
    setUnitError(nextUnitError);
    setValueError(nextValueError);
    setFormError(nextFormError);
    if (
      nextNameError !== "" ||
      nextUnitError !== "" ||
      nextValueError !== "" ||
      nextFormError !== "" ||
      parsedValue === null
    ) {
      return;
    }

    setSaving(true);
    try {
      const result = await createMeasurementService(
        { clock: systemClock(), measurements },
        {
          type: "custom",
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
      data-testid="health-custom-metric-form"
      aria-label={t("Lisää oma numeerinen mittaus")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      {customMetricHistories.length > 0 ? (
        <Select
          label={t("Mittari")}
          hint={t("Aiemmin luodun mittarin yksikkö säilyy samana.")}
          options={tOptions(metricOptions)}
          value={selectedMetricKey}
          disabled={saving}
          onChange={(event) => {
            setSelectedMetricKey(event.target.value);
            setNameError("");
            setUnitError("");
            setFormError("");
          }}
        />
      ) : null}
      {creatingNewMetric ? (
        <>
          <Input
            label={t("Mittarin nimi")}
            placeholder={t("Esim. Askelmäärä")}
            maxLength={CUSTOM_METRIC_NAME_MAX_LENGTH}
            value={metricNameDraft}
            disabled={saving}
            error={nameError === "" ? undefined : t(nameError)}
            onChange={(event) => {
              setMetricNameDraft(event.target.value);
              setNameError("");
              setFormError("");
            }}
          />
          <Input
            label={t("Yksikkö")}
            placeholder={t("Esim. askelta")}
            maxLength={MEASUREMENT_UNIT_MAX_LENGTH}
            value={unitDraft}
            disabled={saving}
            error={unitError === "" ? undefined : t(unitError)}
            onChange={(event) => {
              setUnitDraft(event.target.value);
              setUnitError("");
              setFormError("");
            }}
          />
        </>
      ) : (
        <div data-ui="health-custom-metric-selected">
          <strong>{selectedMetric.metricName}</strong>
          <Meta>
            {t("Yksikkö: ")}
            {selectedMetric.unit}
          </Meta>
        </div>
      )}
      <NumberInput
        label={tTemplate("Arvo ({{0}})", [
          creatingNewMetric ? unitDraft.trim() || "yksikkö" : selectedMetric.unit,
        ])}
        placeholder={t("Esim. 8400")}
        step="any"
        value={valueDraft}
        disabled={saving}
        error={valueError === "" ? undefined : t(valueError)}
        onChange={(event) => {
          setValueDraft(event.target.value);
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
      <Meta>{t("Arvo tallentuu valittuun yksikköön sellaisenaan. Mittauksia ei tulkita.")}</Meta>
      <p>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna mittaus")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function CustomNumericMeasurementsCard({
  measurements,
  customMetricHistories,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly customMetricHistories: readonly CustomMetricHistory[];
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  return (
    <Card
      heading={<MeasurementHeading title="Omat mittarit" icon="grid" />}
      data-testid="health-custom-metrics"
    >
      {customMetricHistories.length === 0 ? (
        <div data-ui="measurement-custom-intro">
          <Meta>
            {t(
              "Luo mittarille nimi ja yksikkö. Uusi mittarityyppi tallentuu ensimmäisen arvon yhteydessä.",
            )}
          </Meta>
          <div data-ui="measurement-custom-art" aria-hidden="true">
            <Icon name="add" />
            <Icon name="chart" />
          </div>
        </div>
      ) : (
        <div data-ui="health-custom-metric-list">
          {customMetricHistories.map((metric) => (
            <section key={metricKey(metric)} data-ui="health-custom-metric-item">
              <h3>{metric.metricName}</h3>
              <Meta>
                {metric.unit} · {String(metric.measurements.length)} {t("merkintää")}
              </Meta>
              <dl>
                {metric.measurements.slice(0, 5).map((measurement) => (
                  <div key={measurement.id}>
                    <dt>{formatDateTime(measurement.measuredAt)}</dt>
                    <dd>
                      {formatNumber(
                        measurement.value,
                        getMeasurementDisplayPrecision("custom", metric.unit),
                      )}{" "}
                      {metric.unit}
                    </dd>
                    {measurement.note !== null ? (
                      <Meta>
                        {t("Muistiinpano: ")}
                        {measurement.note}
                      </Meta>
                    ) : null}
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      )}
      <p>
        <Button
          type="button"
          variant="primary"
          aria-expanded={formOpen}
          aria-controls="health-custom-metric-form-panel"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          <Icon name="add" />
          {formOpen ? t("Piilota lomake") : t("Lisää oma mittaus")}
        </Button>
      </p>
      <div
        id="health-custom-metric-form-panel"
        data-ui="health-custom-metric-editor"
        hidden={!formOpen}
      >
        {formOpen ? (
          <CustomMetricForm
            measurements={measurements}
            customMetricHistories={customMetricHistories}
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
