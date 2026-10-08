// T200: terveysosion aloitus (§10, §14–§15, §20, §29, §52).
// Renderöi vain datasta aktivoituneet moduulit. Ei diagnooseja tai
// tulkintaa; yksityiskohtaiset mittaushistoriat ja graafit tulevat myöhemmissä
// työyksiköissä.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Display,
  EmptyState,
  Icon,
  LogCard,
  Meta,
  MetricCard,
  NumberInput,
  SegmentedControl,
  Select,
  Skeleton,
} from "@lifeos/ui";
import type { HealthOverviewCard, HealthOverviewSummary } from "@lifeos/data";
import {
  isManualStepCountMeasurement,
  isManualStepCountMetric,
  summarizeHealthOverview,
} from "@lifeos/data";
import {
  BLOOD_PRESSURE_CONTEXT_OPTIONS,
  HEIGHT_CM_RANGE,
  getMeasurementDisplayPrecision,
  getMeasurementUnitDefinition,
  validateWeightTarget,
  validateHeightCm,
} from "@lifeos/domain";
import type {
  ActivityEntry,
  Measurement,
  SleepEntry,
  WeightTarget,
  WeightUnit,
} from "@lifeos/domain";
import { useData } from "../../dataContext.tsx";
import { useWeightTarget } from "../../preferences/WeightTargetContext.tsx";
import { useHeight } from "../../preferences/HeightContext.tsx";
import { BodyMeasurementsCard } from "./BodyMeasurementsCard.tsx";
import { BloodSugarMeasurementsCard } from "./BloodSugarMeasurementsCard.tsx";
import { CustomNumericMeasurementsCard } from "./CustomNumericMeasurementsCard.tsx";
import { BloodPressureHistory } from "./BloodPressureHistory.tsx";
import { Spo2MeasurementsCard } from "./Spo2MeasurementsCard.tsx";
import { TemperatureMeasurementsCard } from "./TemperatureMeasurementsCard.tsx";
import { WeightHistory } from "./WeightHistory.tsx";
import { SleepDiary } from "./SleepDiary.tsx";
import { SleepTrends } from "./SleepTrends.tsx";
import { ActivityHistory } from "./ActivityHistory.tsx";
import { ManualStepCountCard } from "./ManualStepCountCard.tsx";
import { MoodCheckinCard } from "./MoodCheckinCard.tsx";
import { EveningReflectionCard } from "./EveningReflectionCard.tsx";
import { BreathingExerciseCard } from "./BreathingExerciseCard.tsx";
import { CUSTOM_SYMPTOM_SCALE_UNIT } from "@lifeos/data";
import "./health-overview.css";

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits }).format(value);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

type HealthOtherCard = Exclude<
  HealthOverviewCard,
  { readonly id: "weight" | "hydration" | "supplements" | "sleep" }
>;

function HealthModuleCard({ card }: { readonly card: HealthOtherCard }): React.JSX.Element | null {
  if (card.id === "blood-pressure") {
    const precision = getMeasurementDisplayPrecision(card.measurement.type, card.measurement.unit);
    const pressure =
      card.measurement.secondaryValue === null
        ? `${formatNumber(card.measurement.value, precision)} ${card.measurement.unit}`
        : `${formatNumber(card.measurement.value, precision)} / ${formatNumber(card.measurement.secondaryValue, precision)} ${card.measurement.unit}`;
    const contextLabel = BLOOD_PRESSURE_CONTEXT_OPTIONS.find(
      (option) => option.value === card.measurement.context,
    )?.label;
    const details = [
      card.measurement.pulseBpm === null || card.measurement.pulseBpm === undefined
        ? undefined
        : tTemplate("Pulssi {{0}} lyöntiä/min", [String(card.measurement.pulseBpm)]),
      contextLabel,
      `Viimeisin kirjaus ${formatDateTime(card.measurement.measuredAt)}`,
    ]
      .filter((value): value is string => value !== undefined)
      .join(". ");
    return (
      <MetricCard
        heading={t("Verenpaine")}
        value={pressure}
        valueLabel={tTemplate("Viimeisin verenpainemittaus {{0}}", [pressure])}
        data-testid="health-module-blood-pressure"
      >
        <Meta>{details}</Meta>
      </MetricCard>
    );
  }

  const details = [
    card.entry.energy === null ? undefined : `Energia ${String(card.entry.energy)}/5`,
    `Kirjattu ${formatDateTime(card.entry.checkedAt)}`,
  ]
    .filter((value): value is string => value !== undefined)
    .join(". ");
  return (
    <LogCard
      heading={t("Mieliala ja vointi")}
      rows={[{ title: "Viimeisin arvio", meta: details, value: `${String(card.entry.mood)}/5` }]}
      emptyText={t("Ei check-in-tietoja vielä.")}
      data-testid="health-module-mood"
    />
  );
}

const WEIGHT_UNIT_OPTIONS = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
] as const;

const HEALTH_SECTIONS = [
  { value: "overview", label: "Yhteenveto" },
  { value: "weight", label: "Paino" },
  { value: "sleep", label: "Uni" },
  { value: "measurements", label: "Mittaukset" },
  { value: "activity", label: "Aktiivisuus" },
] as const;

type HealthSection = (typeof HEALTH_SECTIONS)[number]["value"];

function formatWeight(measurement: Measurement | null): string {
  if (measurement === null) {
    return "0 kg";
  }
  const precision = getMeasurementDisplayPrecision(measurement.type, measurement.unit);
  return `${formatNumber(measurement.value, precision)} ${measurement.unit}`;
}

function formatWeightOrZero(measurement: Measurement | null, unit: WeightUnit): string {
  if (measurement === null) {
    return `0 ${unit}`;
  }
  return formatWeight(measurement);
}

function formatWeightValue(value: number | null, unit: WeightUnit | null): string {
  if (value === null || unit === null) {
    return "Ei tietoa";
  }
  const precision = getMeasurementDisplayPrecision("weight", unit);
  return `${formatNumber(value, precision)} ${unit}`;
}

function formatWeightChange(value: number | null, unit: WeightUnit | null): string {
  if (value === null || unit === null) {
    return "Ei vielä laskettavissa";
  }
  const precision = getMeasurementDisplayPrecision("weight", unit);
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(value), precision)} ${unit}`;
}

function formatWeightChangeOrZero(value: number | null, unit: WeightUnit | null): string {
  if (value === null || unit === null) {
    return `0 ${unit ?? "kg"}`;
  }
  return formatWeightChange(value, unit);
}

function WeightMetricHeading({
  icon,
  label,
}: {
  readonly icon: "calendar" | "chart" | "target" | "trend" | "weight";
  readonly label: string;
}): React.JSX.Element {
  return (
    <span data-ui="health-weight-metric-heading">
      <Icon name={icon} />
      <span>{t(label)}</span>
    </span>
  );
}

function WeightTrendSparkline({
  values,
}: {
  readonly values: readonly number[];
}): React.JSX.Element {
  const data = values.length > 1 ? values : [values[0] ?? 0, values[0] ?? 0];
  const minimum = Math.min(...data);
  const span = Math.max(1, Math.max(...data) - minimum);
  const points = data
    .map(
      (value, index) =>
        `${String(4 + (index / (data.length - 1)) * 132)},${String(26 - ((value - minimum) / span) * 20)}`,
    )
    .join(" ");
  return (
    <svg data-ui="health-weight-sparkline" viewBox="0 0 140 32" aria-hidden="true">
      <polyline points={points} />
    </svg>
  );
}

function WeightSummaryCard({
  summary,
  trend,
}: {
  readonly summary: HealthOverviewSummary["weight"];
  readonly trend: HealthOverviewSummary["weightTrend"];
}): React.JSX.Element {
  const defaultUnit = summary.unit ?? summary.target?.unit ?? "kg";
  const currentValue = formatWeightOrZero(summary.current, defaultUnit);
  const noMeasurements = summary.sampleCount === 0;
  const latestTrendPoint = [...trend.trendPoints]
    .reverse()
    .find((point) => point.trendValue !== null);
  const latestTrendValue =
    latestTrendPoint === undefined
      ? `0 ${defaultUnit}`
      : formatWeightValue(latestTrendPoint.trendValue, trend.unit);
  const minMaxValue =
    summary.minimum === null || summary.maximum === null || summary.unit === null
      ? `0–0 ${defaultUnit}`
      : `${formatNumber(summary.minimum, getMeasurementDisplayPrecision("weight", summary.unit))}–${formatNumber(summary.maximum, getMeasurementDisplayPrecision("weight", summary.unit))} ${summary.unit}`;
  return (
    <>
      {noMeasurements ? (
        <Meta data-ui="health-weight-default-note">
          {t("Nollat ovat aloitusarvoja, eivät mitattuja tuloksia.")}
        </Meta>
      ) : null}
      <section
        data-ui="health-weight-summary-values"
        data-testid="health-weight-summary"
        aria-label={t("Painon yhteenveto")}
      >
        <MetricCard
          heading={<WeightMetricHeading icon="weight" label="Nykyinen paino" />}
          value={currentValue}
          valueLabel={tTemplate("Nykyinen paino {{0}}", [currentValue])}
          data-priority="primary"
        >
          {summary.current !== null ? (
            <Meta>
              {t("Viimeisin kirjaus")}: {formatDateTime(summary.current.measuredAt)}
            </Meta>
          ) : null}
        </MetricCard>
        <MetricCard
          heading={<WeightMetricHeading icon="trend" label="Muutos alusta" />}
          value={formatWeightChangeOrZero(summary.change, summary.unit)}
          valueLabel={tTemplate("Muutos alusta {{0}}", [
            formatWeightChangeOrZero(summary.change, summary.unit),
          ])}
        >
          {summary.sampleCount > 0 ? (
            <Meta>
              {String(summary.sampleCount)} {t(" saman yksikön mittausta")}
            </Meta>
          ) : null}
        </MetricCard>
        <MetricCard
          heading={<WeightMetricHeading icon="chart" label="Muutos viikossa" />}
          value={formatWeightChangeOrZero(summary.changePerWeek, summary.unit)}
          valueLabel={tTemplate("Muutos viikossa {{0}}", [
            formatWeightChangeOrZero(summary.changePerWeek, summary.unit),
          ])}
        />
        <MetricCard
          heading={<WeightMetricHeading icon="chart" label="Kirjattu min–max" />}
          value={minMaxValue}
          valueLabel={tTemplate("Kirjattu painon minimi ja maksimi {{0}}", [minMaxValue])}
        />
        <MetricCard
          heading={<WeightMetricHeading icon="calendar" label="7 päivän trendi" />}
          value={latestTrendValue}
          valueLabel={tTemplate("7 päivän trendin paino {{0}}", [latestTrendValue])}
        >
          <WeightTrendSparkline
            values={trend.trendPoints.flatMap((point) =>
              point.trendValue === null ? [] : [point.trendValue],
            )}
          />
          {latestTrendPoint !== undefined ? (
            <Meta>
              {String(latestTrendPoint.sampleDayCount)} {t(" mittauspäivän keskiarvo")}
            </Meta>
          ) : null}
        </MetricCard>
        <MetricCard
          heading={<WeightMetricHeading icon="target" label="Tavoitepaino" />}
          value={
            summary.target === null
              ? t("Ei asetettu")
              : `${formatNumber(summary.target.value, 1)} ${summary.target.unit}`
          }
          valueLabel={tTemplate("Tavoitepaino {{0}}", [
            summary.target === null
              ? t("Ei asetettu")
              : `${formatNumber(summary.target.value, 1)} ${summary.target.unit}`,
          ])}
        />
      </section>
    </>
  );
}

function WeightTargetCard({
  summary,
  target,
  loading,
  saving,
  error,
  onSave,
  onRetry,
}: {
  readonly summary: HealthOverviewSummary["weight"];
  readonly target: WeightTarget | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: ReturnType<typeof useWeightTarget>["error"];
  readonly onSave: (target: WeightTarget | null) => Promise<boolean>;
  readonly onRetry: () => Promise<void>;
}): React.JSX.Element {
  const [draftValue, setDraftValue] = useState("");
  const [unit, setUnit] = useState<WeightUnit>(target?.unit ?? "kg");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setDraftValue(target === null ? "" : String(target.value));
    setUnit(target?.unit ?? "kg");
  }, [target]);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalized = draftValue.trim().replace(",", ".");
    const value = normalized === "" ? Number.NaN : Number(normalized);
    const validated = validateWeightTarget({ value, unit });
    if (!validated.ok || validated.value === null) {
      setFormError(validated.ok ? "Anna tavoitepaino." : validated.error.message);
      return;
    }
    setFormError("");
    if (await onSave(validated.value)) {
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    }
  };

  const clear = async (): Promise<void> => {
    setFormError("");
    if (await onSave(null)) {
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    }
  };

  const targetUnitDefinition = getMeasurementUnitDefinition("weight", unit);
  const targetDifference =
    summary.current !== null &&
    summary.target !== null &&
    summary.current.unit === summary.target.unit
      ? formatWeightChange(summary.target.value - summary.current.value, summary.current.unit)
      : null;

  return (
    <Card
      heading={
        <span data-ui="health-weight-metric-heading">
          <Icon name="target" />
          <span>{t("Tavoitepaino")}</span>
        </span>
      }
      data-testid="health-weight-target-card"
    >
      <Meta>{t("Aseta tavoitteesi, niin seuraat edistymistäsi helpommin.")}</Meta>
      <form
        data-testid="health-weight-target-form"
        noValidate
        onSubmit={(event) => void save(event)}
      >
        <NumberInput
          label={t("Tavoitepaino")}
          placeholder={t("Esim. 70")}
          hint={t("Tulkitaan valitussa yksikössä. Yksikön vaihtaminen ei muunna lukua.")}
          value={draftValue}
          min={targetUnitDefinition?.minimum}
          max={targetUnitDefinition?.maximum}
          step={0.1}
          disabled={loading || saving}
          onChange={(event) => {
            setDraftValue(event.target.value);
            setFormError("");
          }}
        />
        <Select
          label={t("Yksikkö")}
          options={tOptions([...WEIGHT_UNIT_OPTIONS])}
          value={unit}
          disabled={loading || saving}
          onChange={(event) => {
            setUnit(event.target.value as WeightUnit);
            setFormError("");
          }}
        />
        {formError !== "" ? (
          <p data-ui="field-error" role="alert">
            {t(formError)}
          </p>
        ) : null}
        {error !== null ? (
          <Alert
            tone="danger"
            title={t("Tavoitepainoa ei voitu tallentaa")}
            action={
              <Button type="button" variant="secondary" onClick={() => void onRetry()}>
                {t("Yritä uudelleen")}
              </Button>
            }
          >
            {t(error.body)}
          </Alert>
        ) : null}
        <p>
          <Button type="submit" variant="primary" loading={saving} disabled={loading || saving}>
            {t("Tallenna tavoite")}
          </Button>{" "}
          {target !== null ? (
            <Button
              type="button"
              variant="secondary"
              disabled={loading || saving}
              onClick={() => void clear()}
            >
              {t("Poista tavoite")}
            </Button>
          ) : null}
        </p>
      </form>
      {targetDifference !== null ? (
        <p data-ui="health-weight-target-progress">
          <strong>
            {tTemplate("Tavoitteeseen vielä {{0}} nykyisestä painosta.", [targetDifference])}
          </strong>
          <Meta>{t("Voit muokata tavoitetta milloin tahansa.")}</Meta>
        </p>
      ) : null}
    </Card>
  );
}

function BmiCard({
  bmi,
  heightCm,
  loading,
  saving,
  error,
  onSave,
  onRetry,
}: {
  readonly bmi: number | null;
  readonly heightCm: number | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: ReturnType<typeof useHeight>["error"];
  readonly onSave: (heightCm: number | null) => Promise<boolean>;
  readonly onRetry: () => Promise<void>;
}): React.JSX.Element {
  const [draftHeight, setDraftHeight] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    setDraftHeight(heightCm === null ? "" : String(heightCm));
  }, [heightCm]);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalized = draftHeight.trim().replace(",", ".");
    const parsedHeight = normalized === "" ? Number.NaN : Number(normalized);
    const validated = validateHeightCm(parsedHeight);
    if (!validated.ok || validated.value === null) {
      setFormError(validated.ok ? t("Anna pituus senttimetreinä.") : validated.error.message);
      return;
    }
    setFormError("");
    await onSave(validated.value);
  };

  const clear = async (): Promise<void> => {
    setFormError("");
    await onSave(null);
  };

  const inputHint = bmi === null ? "Lisää pituus ja kirjaa paino, jotta BMI voidaan laskea." : null;
  return (
    <Card
      heading={
        <span data-ui="health-weight-metric-heading">
          <Icon name="chart" />
          <span>{t("BMI (informatiivinen)")}</span>
        </span>
      }
      data-testid="health-bmi-card"
    >
      <Meta>
        {t(
          "BMI on rajallinen yleismittari eikä yksin kuvaa terveyttä. Laskenta käyttää uusinta painomerkintää ja antamaasi pituutta.",
        )}
      </Meta>
      <form data-testid="health-height-form" noValidate onSubmit={(event) => void save(event)}>
        <NumberInput
          label={t("Pituus (cm)")}
          placeholder={t("Esim. 172")}
          min={HEIGHT_CM_RANGE.minimum}
          max={HEIGHT_CM_RANGE.maximum}
          step={0.1}
          value={draftHeight}
          disabled={loading || saving}
          onChange={(event) => {
            setDraftHeight(event.target.value);
            setFormError("");
          }}
        />
        {formError !== "" ? (
          <p data-ui="field-error" role="alert">
            {t(formError)}
          </p>
        ) : null}
        {error !== null ? (
          <Alert
            tone="danger"
            title={t("Pituutta ei voitu tallentaa")}
            action={
              <Button type="button" variant="secondary" onClick={() => void onRetry()}>
                {t("Yritä uudelleen")}
              </Button>
            }
          >
            {t(error.body)}
          </Alert>
        ) : null}
        <p>
          <Button type="submit" variant="primary" disabled={loading || saving} loading={saving}>
            {t("Tallenna pituus")}
          </Button>{" "}
          {heightCm !== null ? (
            <Button
              type="button"
              variant="secondary"
              disabled={loading || saving}
              onClick={() => void clear()}
            >
              {t("Poista pituus")}
            </Button>
          ) : null}
        </p>
      </form>
      <div data-ui="health-bmi-result">
        <Meta>{t("BMI (informatiivinen)")}</Meta>
        <strong>{bmi === null ? "0" : formatNumber(bmi, 1)}</strong>
        {inputHint !== null ? <Meta>{t(inputHint)}</Meta> : null}
      </div>
      <div data-ui="health-bmi-info">
        <Icon name="info" />
        <Meta>
          {t(
            "BMI on suuntaa-antava mittari. Se ei huomioi lihasmassaa, kehonkoostumusta tai yksilöllisiä tekijöitä.",
          )}
        </Meta>
      </div>
    </Card>
  );
}

export function HealthOverview(): React.JSX.Element {
  const {
    measurements,
    sleepEntries,
    moodCheckins,
    activityEntries,
    journalEntries,
    breathingSessions,
  } = useData();
  const weightTarget = useWeightTarget();
  const height = useHeight();
  const [summary, setSummary] = useState<HealthOverviewSummary | undefined>(undefined);
  const [sleepDiaryEntries, setSleepDiaryEntries] = useState<readonly SleepEntry[]>([]);
  const [activityHistoryEntries, setActivityHistoryEntries] = useState<readonly ActivityEntry[]>(
    [],
  );
  const [manualStepEntries, setManualStepEntries] = useState<readonly Measurement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [activeSection, setActiveSection] = useState<HealthSection>("overview");

  const refresh = useCallback(async () => {
    const [measurementResult, sleepResult, moodResult, activityResult] = await Promise.all([
      measurements.list(),
      sleepEntries.list(),
      moodCheckins.list(),
      activityEntries.list(),
    ]);
    if (!measurementResult.ok || !sleepResult.ok || !moodResult.ok || !activityResult.ok) {
      setLoadError(true);
      setLoading(false);
      return;
    }

    setSleepDiaryEntries(sleepResult.value.filter((entry) => entry.deletedAt === null));
    setActivityHistoryEntries(activityResult.value.filter((entry) => entry.deletedAt === null));
    setManualStepEntries(measurementResult.value.filter(isManualStepCountMeasurement));
    const now = new Date().toISOString();
    setSummary(
      summarizeHealthOverview({
        now,
        timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        measurements: measurementResult.value,
        weightTarget: weightTarget.target,
        heightCm: height.heightCm,
        sleepEntries: sleepResult.value,
        moodCheckins: moodResult.value,
        hydrationEntries: [],
        supplements: [],
        supplementLogs: [],
      }),
    );
    setLoadError(false);
    setLoading(false);
  }, [
    activityEntries,
    measurements,
    moodCheckins,
    sleepEntries,
    weightTarget.target,
    height.heightCm,
  ]);

  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => {
          if (!guard.cancelled) {
            setLoadError(true);
            setLoading(false);
          }
        });
      }
    };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setLoadError(true);
        setLoading(false);
      }
    });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const customMetricHistories =
    summary?.customMetricHistories.filter(
      (history) => !isManualStepCountMetric(history.metricName, history.unit),
    ) ?? [];
  const overviewCards: HealthOtherCard[] =
    summary?.cards.filter((card) => card.id === "mood") ?? [];
  const measurementCards: HealthOtherCard[] =
    summary?.cards.filter((card) => card.id === "blood-pressure") ?? [];
  const sectionOptions = HEALTH_SECTIONS.map((section) => ({
    value: section.value,
    label: t(section.label),
  }));
  const handleSectionChange = (value: string): void => {
    const section = HEALTH_SECTIONS.find((option) => option.value === value);
    if (section !== undefined) setActiveSection(section.value);
  };
  const hasNoRecordedData =
    summary !== undefined &&
    summary.cards.length === 0 &&
    summary.bodyMeasurements.length === 0 &&
    summary.temperatureHistory.length === 0 &&
    summary.spo2History.length === 0 &&
    summary.bloodSugarHistory.length === 0 &&
    customMetricHistories.length === 0 &&
    manualStepEntries.length === 0;

  return (
    <div data-ui="health-overview-page" data-section={activeSection}>
      <Display>
        {activeSection === "weight" ? (
          <span data-ui="health-weight-page-title">
            <Icon name="weight" />
            <span>{t("Paino")}</span>
          </span>
        ) : (
          t("Terveys")
        )}
      </Display>
      <div data-ui="health-overview-intro" data-section={activeSection}>
        {activeSection === "weight" ? (
          <>
            <p>
              {t("Seuraa painon kehitystäsi ja aseta tavoitteita paremman hyvinvoinnin tueksi.")}
            </p>
            <Button
              type="button"
              variant="primary"
              data-testid="health-weight-log-button"
              onClick={(event) => {
                window.dispatchEvent(
                  new CustomEvent("lifeos:open-quick-add", {
                    detail: { kind: "weight", opener: event.currentTarget },
                  }),
                );
              }}
            >
              <Icon name="add" />
              {t("Kirjaa paino")}
            </Button>
          </>
        ) : (
          <>
            <Meta>{t("Omat kirjaukset")}</Meta>
            <p>{t("Tähän kootaan viimeisimmät merkintäsi kustakin seurannasta.")}</p>
          </>
        )}
      </div>
      <div data-ui="health-section-selector">
        <SegmentedControl
          label={t("Terveysosio")}
          name="health-section"
          options={sectionOptions}
          value={activeSection}
          onOptionChange={handleSectionChange}
        />
      </div>
      {loading ? (
        <Card heading={t("Yhteenveto")} data-testid="health-overview-loading">
          <Skeleton lines={4} label={t("Ladataan terveysmerkintöjä…")} />
        </Card>
      ) : loadError || summary === undefined ? (
        <Alert tone="danger" title={t("Terveysmerkintöjä ei voitu ladata")}>
          {t("Yritä uudelleen hetken kuluttua.")}
        </Alert>
      ) : (
        <>
          {activeSection === "overview" ? (
            <>
              <MoodCheckinCard
                moodCheckins={moodCheckins}
                measurements={measurements}
                symptomMetricNames={summary.customMetricHistories
                  .filter((history) => history.unit === CUSTOM_SYMPTOM_SCALE_UNIT)
                  .map((history) => history.metricName)}
              />
              <EveningReflectionCard journalEntries={journalEntries} />
              <BreathingExerciseCard breathingSessions={breathingSessions} />
              {overviewCards.length > 0 ? (
                <section
                  data-ui="health-overview-grid"
                  aria-label={t("Käytössä olevat terveysseurannat")}
                  data-testid="health-overview-grid"
                >
                  {overviewCards.map((card) => (
                    <HealthModuleCard key={card.id} card={card} />
                  ))}
                </section>
              ) : null}
              {hasNoRecordedData ? (
                <Card data-testid="health-overview-empty">
                  <EmptyState
                    title={t("Aloita omasta seurannastasi")}
                    hint={t(
                      "Kirjaa yöuni tai päiväuni unipäiväkirjaan. Paina Kirjaa lisätäksesi painon, lämpötilan, SpO₂:n, verensokerin tai muun mittarin.",
                    )}
                  />
                </Card>
              ) : null}
            </>
          ) : null}
          {activeSection === "weight" ? (
            <>
              <WeightSummaryCard summary={summary.weight} trend={summary.weightTrend} />
              <WeightHistory measurements={summary.weightHistory} target={weightTarget.target} />
              <section data-ui="health-weight-details" aria-label={t("Tavoitepaino ja BMI")}>
                <WeightTargetCard
                  summary={summary.weight}
                  target={weightTarget.target}
                  loading={weightTarget.loading}
                  saving={weightTarget.saving}
                  error={weightTarget.error}
                  onSave={weightTarget.setTarget}
                  onRetry={weightTarget.reload}
                />
                <BmiCard
                  bmi={summary.bmi}
                  heightCm={height.heightCm}
                  loading={height.loading}
                  saving={height.saving}
                  error={height.error}
                  onSave={height.setHeightCm}
                  onRetry={height.reload}
                />
              </section>
            </>
          ) : null}
          {activeSection === "sleep" ? (
            <>
              <SleepDiary entries={sleepDiaryEntries} sleepEntries={sleepEntries} />
              <SleepTrends entries={sleepDiaryEntries} />
            </>
          ) : null}
          {activeSection === "measurements" ? (
            <>
              <section data-ui="measurement-dashboard-intro">
                <div data-ui="measurement-dashboard-title">
                  <Icon name="chart" />
                  <div>
                    <h2>{t("Mittaukset")}</h2>
                    <Meta>
                      {t("Seuraa kehosi tärkeitä mittareita ja huomaa muutokset ajan myötä.")}
                    </Meta>
                  </div>
                </div>
                <div data-ui="measurement-dashboard-stats">
                  <div>
                    <Icon name="ruler" />
                    <span>
                      <strong>5</strong>
                      <small>{t("mittarityyppiä")}</small>
                    </span>
                  </div>
                  <div>
                    <Icon name="calendar" />
                    <span>
                      <strong>
                        {summary.bodyMeasurements.length +
                          summary.temperatureHistory.length +
                          summary.spo2History.length +
                          summary.bloodSugarHistory.length +
                          customMetricHistories.reduce(
                            (count, metric) => count + metric.measurements.length,
                            0,
                          )}
                      </strong>
                      <small>{t("kirjausta")}</small>
                    </span>
                  </div>
                  <div>
                    <Icon name="sparkles" />
                    <span>
                      <strong>{t("Oma seuranta")}</strong>
                      <small>{t("Lisää mittaus alta")}</small>
                    </span>
                  </div>
                </div>
              </section>
              <div data-ui="measurement-dashboard-grid">
                <BodyMeasurementsCard
                  measurements={measurements}
                  bodyMeasurements={summary.bodyMeasurements}
                />
                <TemperatureMeasurementsCard
                  measurements={measurements}
                  temperatureHistory={summary.temperatureHistory}
                />
                <Spo2MeasurementsCard
                  measurements={measurements}
                  spo2History={summary.spo2History}
                />
                <BloodSugarMeasurementsCard
                  measurements={measurements}
                  bloodSugarHistory={summary.bloodSugarHistory}
                />
                <CustomNumericMeasurementsCard
                  measurements={measurements}
                  customMetricHistories={customMetricHistories}
                />
              </div>
              {measurementCards.length > 0 ? (
                <section
                  data-ui="health-overview-grid"
                  aria-label={t("Käytössä olevat terveysseurannat")}
                  data-testid="health-overview-grid"
                >
                  {measurementCards.map((card) => (
                    <HealthModuleCard key={card.id} card={card} />
                  ))}
                </section>
              ) : null}
              {summary.bloodPressureHistory.length > 0 ? (
                <BloodPressureHistory measurements={summary.bloodPressureHistory} />
              ) : null}
            </>
          ) : null}
          {activeSection === "activity" ? (
            <>
              <ActivityHistory entries={activityHistoryEntries} activities={activityEntries} />
              <ManualStepCountCard entries={manualStepEntries} measurements={measurements} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
