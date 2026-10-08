import {
  MeasurementDataPreview,
  MeasurementHeading,
  MeasurementEmptyPreview,
} from "./MeasurementPresentation.tsx";
// T212: valinnainen SpO₂-kirjaus prosentteina ilman tilan luokittelua.
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useState } from "react";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import {
  getDefaultMeasurementUnitDefinition,
  getMeasurementDisplayPrecision,
  getMeasurementUnitDefinition,
} from "@lifeos/domain";
import type { Measurement } from "@lifeos/domain";
import { Button, Card, Icon, Input, Meta, NumberInput } from "@lifeos/ui";
import {
  filterMeasurementsByRange,
  HealthRangeControl,
  type HealthRange,
} from "./health-range.tsx";

const SPO2_UNIT = getDefaultMeasurementUnitDefinition("spo2")?.unit ?? "%";

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

function Spo2MeasurementForm({
  measurements,
  onSaved,
  onCancel,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [valueError, setValueError] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const unitDefinition = getMeasurementUnitDefinition("spo2", SPO2_UNIT);

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
            SPO2_UNIT,
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
          type: "spo2",
          value: parsedValue,
          secondaryValue: null,
          unit: SPO2_UNIT,
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
        thrown instanceof Error ? thrown.message : t("SpO₂-mittauksen tallennus epäonnistui."),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-testid="health-spo2-form"
      aria-label={t("Lisää SpO₂-mittaus")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <NumberInput
        label={tTemplate("SpO₂ ({{0}})", [SPO2_UNIT])}
        placeholder={t("Esim. 98")}
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
          {t("Tallenna SpO₂")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function Spo2MeasurementsCard({
  measurements,
  spo2History,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly spo2History: readonly Measurement[];
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const [range, setRange] = useState<HealthRange>("all");
  const visibleHistory = filterMeasurementsByRange(spo2History, range);
  return (
    <Card heading={<MeasurementHeading title="SpO₂" icon="droplet" />} data-testid="health-spo2">
      {spo2History.length > 0 ? (
        <HealthRangeControl range={range} onRangeChange={setRange} />
      ) : null}
      {visibleHistory.length === 0 ? (
        <MeasurementEmptyPreview
          unit="%"
          title={
            spo2History.length === 0
              ? t("Ei SpO₂-kirjauksia vielä")
              : t("Ei kirjauksia tällä aikavälillä")
          }
          hint={
            spo2History.length === 0
              ? "Voit aktivoida seurannan kirjaamalla itse mittaamasi arvon prosentteina."
              : t("Valitse pidempi aikaväli nähdäksesi aiempia merkintöjä.")
          }
        />
      ) : (
        <>
          <MeasurementDataPreview measurements={visibleHistory} />
          <details data-ui="measurement-history-details">
            <summary>{t("Viisi uusinta mittausta")}</summary>
            <dl data-ui="health-spo2-values">
              {visibleHistory.slice(0, 5).map((measurement) => (
                <div key={measurement.id}>
                  <dt>{formatDateTime(measurement.measuredAt)}</dt>
                  <dd>
                    {formatNumber(
                      measurement.value,
                      getMeasurementDisplayPrecision("spo2", measurement.unit),
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
      <Meta>{t("Merkinnät näytetään prosentteina ilman tulkintaa.")}</Meta>
      <p>
        <Button
          type="button"
          variant="primary"
          aria-expanded={formOpen}
          aria-controls="health-spo2-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          <Icon name="add" />
          {formOpen ? t("Piilota lomake") : t("Lisää SpO₂-mittaus")}
        </Button>
      </p>
      <div id="health-spo2-form" data-ui="health-spo2-editor" hidden={!formOpen}>
        {formOpen ? (
          <Spo2MeasurementForm
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
