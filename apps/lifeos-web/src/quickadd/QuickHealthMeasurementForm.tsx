// T217: aiemmin aktivoidun terveysmittarin pikakirjaus.
import { t, tOptions, tTemplate, getIntlLocale } from "../language.tsx";
import { useMemo, useState } from "react";
import { createMeasurementService, systemClock, type EntityRepository } from "@lifeos/data";
import {
  getMeasurementTypeDefinition,
  getMeasurementUnitDefinition,
  normalizeBodyMeasureName,
} from "@lifeos/domain";
import type { Measurement, MeasurementType } from "@lifeos/domain";
import { Button, Input, Meta, NumberInput, Select } from "@lifeos/ui";

export type QuickHealthMeasurementType = Extract<
  MeasurementType,
  "blood-sugar" | "temperature" | "spo2" | "body-measure" | "custom"
>;

interface ActiveMetricOption {
  readonly key: string;
  readonly metricName: string | null;
  readonly unit: string;
}

function parseDecimal(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (normalized === "") {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

function isNamedMetricType(type: QuickHealthMeasurementType): boolean {
  return type === "body-measure" || type === "custom";
}

function createActiveMetricOptions(
  type: QuickHealthMeasurementType,
  measurements: readonly Measurement[],
): ActiveMetricOption[] {
  const byKey = new Map<string, ActiveMetricOption>();
  const newestFirst = [...measurements].sort((left, right) =>
    left.measuredAt < right.measuredAt ? 1 : left.measuredAt > right.measuredAt ? -1 : 0,
  );
  for (const measurement of newestFirst) {
    if (measurement.type !== type) {
      continue;
    }
    const metricName = measurement.metricName ?? null;
    if (type === "body-measure" && normalizeBodyMeasureName(metricName ?? "") === "") {
      continue;
    }
    const key = JSON.stringify([metricName, measurement.unit]);
    if (!byKey.has(key)) {
      byKey.set(key, { key, metricName, unit: measurement.unit });
    }
  }
  return [...byKey.values()];
}

export interface QuickHealthMeasurementFormProps {
  readonly type: QuickHealthMeasurementType;
  readonly measurements: EntityRepository<Measurement>;
  readonly activeMeasurements: readonly Measurement[];
  readonly onSaved: (measurement: Measurement) => void;
  readonly onCancel: () => void;
}

export function QuickHealthMeasurementForm({
  type,
  measurements,
  activeMeasurements,
  onSaved,
  onCancel,
}: QuickHealthMeasurementFormProps): React.JSX.Element {
  const definition = getMeasurementTypeDefinition(type);
  const activeMetricOptions = useMemo(
    () => createActiveMetricOptions(type, activeMeasurements),
    [type, activeMeasurements],
  );
  const latestMeasurement = [...activeMeasurements]
    .filter((measurement) => measurement.type === type)
    .sort((left, right) =>
      left.measuredAt < right.measuredAt ? 1 : left.measuredAt > right.measuredAt ? -1 : 0,
    )[0];
  const [selectedMetricKey, setSelectedMetricKey] = useState(
    () => activeMetricOptions[0]?.key ?? "",
  );
  const [unit, setUnit] = useState(
    () => latestMeasurement?.unit ?? definition.defaultUnit ?? definition.units[0]?.unit ?? "",
  );
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedMetric = activeMetricOptions.find((option) => option.key === selectedMetricKey);
  const effectiveUnit = selectedMetric?.unit ?? unit;
  const unitDefinition = getMeasurementUnitDefinition(type, effectiveUnit);
  const metricOptions = activeMetricOptions.map((option) => ({
    value: option.key,
    label: `${option.metricName ?? "Oma mittari"} (${option.unit})`,
  }));
  const unitOptions = definition.units.map((unitOption) => ({
    value: unitOption.unit,
    label: unitOption.unit,
  }));

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) {
      return;
    }
    const parsedValue = parseDecimal(value);
    if (parsedValue === null) {
      setError(t("Anna äärellinen mittausarvo."));
      return;
    }
    if (
      unitDefinition !== null &&
      (parsedValue < unitDefinition.minimum || parsedValue > unitDefinition.maximum)
    ) {
      setError(
        `Arvon on oltava ${String(unitDefinition.minimum)}–${String(unitDefinition.maximum)} ${effectiveUnit}.`,
      );
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > 500) {
      setError(t("Muistiinpano voi olla enintään 500 merkkiä."));
      return;
    }
    if (isNamedMetricType(type) && selectedMetric === undefined) {
      setError("Valitse aiemmin aktivoitu mittari.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await createMeasurementService(
        { clock: systemClock(), measurements },
        {
          type,
          value: parsedValue,
          secondaryValue: null,
          unit: effectiveUnit,
          ...(type === "body-measure" || type === "custom"
            ? { metricName: selectedMetric?.metricName ?? null }
            : {}),
          note: trimmedNote === "" ? null : trimmedNote,
        },
      );
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      onSaved(result.value);
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : t("Mittauksen tallennus epäonnistui."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      data-testid={`quick-health-measure-${type}-form`}
      aria-label={tTemplate("Kirjaa {{0}}", [
        t(definition.label).toLocaleLowerCase(getIntlLocale()),
      ])}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      {isNamedMetricType(type) ? (
        <Select
          label={t("Mittari")}
          hint={t("Valitse aktivoitu mittari. Sen yksikkö säilyy samana.")}
          options={tOptions(metricOptions)}
          value={selectedMetricKey}
          disabled={saving}
          onChange={(event) => {
            setSelectedMetricKey(event.target.value);
            setValue("");
            setError("");
          }}
        />
      ) : definition.units.length > 1 ? (
        <Select
          label={t("Yksikkö")}
          hint={t("Yksikön vaihtaminen ei muunna aiemmin tallennettua arvoa.")}
          options={tOptions(unitOptions)}
          value={unit}
          disabled={saving}
          onChange={(event) => {
            setUnit(event.target.value);
            setValue("");
            setError("");
          }}
        />
      ) : (
        <Meta>
          {t("Yksikkö: ")}
          {effectiveUnit}
        </Meta>
      )}
      <NumberInput
        label={tTemplate("Arvo ({{0}})", [effectiveUnit])}
        placeholder={t("Anna mitattu arvo")}
        min={unitDefinition?.minimum}
        max={unitDefinition?.maximum}
        step="any"
        value={value}
        disabled={saving}
        onChange={(event) => {
          setValue(event.target.value);
          setError("");
        }}
      />
      <Input
        label={t("Muistiinpano (valinnainen)")}
        maxLength={500}
        value={note}
        disabled={saving}
        onChange={(event) => {
          setNote(event.target.value);
          setError("");
        }}
      />
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <Meta>
        {t(
          "Kirjaus tallentuu nykyhetkeen. Arvo näytetään valitussa yksikössä ilman terveysarviota.",
        )}
      </Meta>
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
