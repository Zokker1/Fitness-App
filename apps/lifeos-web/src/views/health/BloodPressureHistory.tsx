import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useMemo, useState } from "react";
import { Card, ChartFrame, Meta } from "@lifeos/ui";
import type { ChartFrameSeries, ChartSeriesPoint } from "@lifeos/ui";
import { BLOOD_PRESSURE_CONTEXT_OPTIONS } from "@lifeos/domain";
import type { Measurement } from "@lifeos/domain";
import {
  filterMeasurementsByRange,
  HEALTH_RANGE_OPTIONS,
  type HealthRange,
} from "./health-range.tsx";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const VIEWBOX = { width: 720, height: 280, left: 48, right: 18, top: 18, bottom: 44 } as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 0 }).format(value);
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

function formatAxisLabel(value: string, showTime: boolean, includeSeconds: boolean): string {
  return new Intl.DateTimeFormat(
    getIntlLocale(),
    showTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          ...(includeSeconds ? { second: "2-digit" as const } : {}),
        }
      : { day: "numeric", month: "numeric" },
  ).format(new Date(value));
}

function makeSeriesPoints(
  measurements: readonly Measurement[],
  valueFor: (measurement: Measurement) => number,
): ChartSeriesPoint[] {
  const usedLabels = new Map<string, number>();
  return [...measurements]
    .sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt))
    .map((measurement) => {
      const baseLabel = formatDateTime(measurement.measuredAt);
      const occurrence = (usedLabels.get(baseLabel) ?? 0) + 1;
      usedLabels.set(baseLabel, occurrence);
      return {
        x: occurrence === 1 ? baseLabel : `${baseLabel} (${String(occurrence)})`,
        y: valueFor(measurement),
      };
    });
}

function BloodPressurePlot({
  measurements,
  systolicPoints,
  diastolicPoints,
}: {
  readonly measurements: readonly Measurement[];
  readonly systolicPoints: readonly ChartSeriesPoint[];
  readonly diastolicPoints: readonly ChartSeriesPoint[];
}): React.JSX.Element {
  const plotWidth = VIEWBOX.width - VIEWBOX.left - VIEWBOX.right;
  const plotHeight = VIEWBOX.height - VIEWBOX.top - VIEWBOX.bottom;
  const maximumReading = Math.max(
    0,
    ...measurements.flatMap((item) => [item.value, item.secondaryValue ?? 0]),
  );
  const axisMaximum = Math.max(150, Math.ceil(maximumReading / 50) * 50);
  const tickStep = axisMaximum / 5;
  const firstAt = Date.parse(measurements[0]?.measuredAt ?? "");
  const lastAt = Date.parse(measurements[measurements.length - 1]?.measuredAt ?? "");
  const timestampSpan = lastAt - firstAt;
  const xFor = (index: number): number => {
    if (measurements.length < 2) {
      return VIEWBOX.left + plotWidth / 2;
    }
    if (timestampSpan <= 0) {
      return VIEWBOX.left + plotWidth / 2;
    }
    const timestamp = Date.parse(measurements[index]?.measuredAt ?? "");
    return VIEWBOX.left + ((timestamp - firstAt) / timestampSpan) * plotWidth;
  };
  const yFor = (value: number): number => VIEWBOX.top + (1 - value / axisMaximum) * plotHeight;
  const systolicCoordinates = systolicPoints.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.y),
  }));
  const diastolicCoordinates = diastolicPoints.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.y),
  }));
  const systolicLine = systolicCoordinates
    .map((point) => `${String(point.x)},${String(point.y)}`)
    .join(" ");
  const diastolicLine = diastolicCoordinates
    .map((point) => `${String(point.x)},${String(point.y)}`)
    .join(" ");
  const firstMeasurement = measurements[0];
  const lastMeasurement = measurements[measurements.length - 1];
  const showTime = timestampSpan >= 0 && timestampSpan < DAY_IN_MILLISECONDS;
  const includeSeconds = timestampSpan > 0 && timestampSpan < 60_000;

  return (
    <>
      <ul data-ui="health-bp-legend" aria-label={t("Kaavion mittaussarjat")}>
        <li data-series="systolic">{t("Systolinen")}</li>
        <li data-series="diastolic">{t("Diastolinen")}</li>
      </ul>
      <figure data-ui="health-bp-plot">
        <svg
          viewBox={`0 0 ${String(VIEWBOX.width)} ${String(VIEWBOX.height)}`}
          role="img"
          aria-label={tTemplate(
            "Verenpaineen {{0}} mittausta. Kaaviossa näytetään systolinen ja diastolinen arvo yksikössä mmHg.",
            [String(measurements.length)],
          )}
          preserveAspectRatio="xMidYMid meet"
        >
          {Array.from({ length: 6 }, (_, index) => {
            const value = axisMaximum - index * tickStep;
            const y = yFor(value);
            return (
              <g key={index} data-ui="health-bp-y-tick">
                <line x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={y} y2={y} />
                <text x={VIEWBOX.left - 8} y={y} textAnchor="end" dominantBaseline="middle">
                  {formatNumber(value)}
                </text>
              </g>
            );
          })}
          <line
            data-ui="health-bp-axis"
            x1={VIEWBOX.left}
            x2={VIEWBOX.left}
            y1={VIEWBOX.top}
            y2={VIEWBOX.height - VIEWBOX.bottom}
          />
          <line
            data-ui="health-bp-axis"
            x1={VIEWBOX.left}
            x2={VIEWBOX.width - VIEWBOX.right}
            y1={VIEWBOX.height - VIEWBOX.bottom}
            y2={VIEWBOX.height - VIEWBOX.bottom}
          />
          <polyline data-series="systolic" points={systolicLine} />
          <polyline data-series="diastolic" points={diastolicLine} />
          {systolicCoordinates.map((point, index) =>
            index % Math.max(1, Math.ceil(systolicCoordinates.length / 160)) === 0 ||
            index === systolicCoordinates.length - 1 ? (
              <circle
                key={`systolic-${String(index)}`}
                data-series="systolic"
                cx={point.x}
                cy={point.y}
                r="4"
              />
            ) : null,
          )}
          {diastolicCoordinates.map((point, index) =>
            index % Math.max(1, Math.ceil(diastolicCoordinates.length / 160)) === 0 ||
            index === diastolicCoordinates.length - 1 ? (
              <circle
                key={`diastolic-${String(index)}`}
                data-series="diastolic"
                cx={point.x}
                cy={point.y}
                r="4"
              />
            ) : null,
          )}
          {firstMeasurement !== undefined ? (
            <text x={VIEWBOX.left} y={VIEWBOX.height - 12} textAnchor="start">
              {formatAxisLabel(firstMeasurement.measuredAt, showTime, includeSeconds)}
            </text>
          ) : null}
          {lastMeasurement !== undefined && lastMeasurement.id !== firstMeasurement?.id ? (
            <text x={VIEWBOX.width - VIEWBOX.right} y={VIEWBOX.height - 12} textAnchor="end">
              {formatAxisLabel(lastMeasurement.measuredAt, showTime, includeSeconds)}
            </text>
          ) : null}
        </svg>
        <figcaption>
          {t("Vaaka-akseli näyttää mittausajan ja pysty-akseli arvon yksikössä mmHg.")}
        </figcaption>
      </figure>
    </>
  );
}

function MeasurementRecord({
  measurement,
}: {
  readonly measurement: Measurement;
}): React.JSX.Element {
  const contextLabel = BLOOD_PRESSURE_CONTEXT_OPTIONS.find(
    (option) => option.value === measurement.context,
  )?.label;
  const metadata = [
    measurement.pulseBpm === null || measurement.pulseBpm === undefined
      ? undefined
      : tTemplate("Pulssi {{0}} lyöntiä/min", [String(measurement.pulseBpm)]),
    contextLabel,
  ].filter((value): value is string => value !== undefined);

  return (
    <li data-ui="health-bp-record">
      <time dateTime={measurement.measuredAt}>{formatDateTime(measurement.measuredAt)}</time>
      <strong>
        <span data-ui="sr-only">{t("Systolinen / diastolinen: ")}</span>
        {formatNumber(measurement.value)} / {formatNumber(measurement.secondaryValue ?? 0)}{" "}
        {measurement.unit}
      </strong>
      {metadata.length > 0 ? <Meta>{metadata.join(" · ")}</Meta> : null}
      {measurement.note !== null ? (
        <Meta>
          {t("Muistiinpano: ")}
          {measurement.note}
        </Meta>
      ) : null}
    </li>
  );
}

export function BloodPressureHistory({
  measurements,
}: {
  readonly measurements: readonly Measurement[];
}): React.JSX.Element {
  const [range, setRange] = useState<HealthRange>("all");
  const chartMeasurements = useMemo(() => {
    return filterMeasurementsByRange(measurements, range).sort(
      (left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt),
    );
  }, [measurements, range]);
  const series = useMemo<readonly ChartFrameSeries[]>(() => {
    const systolicPoints = makeSeriesPoints(chartMeasurements, (measurement) => measurement.value);
    const diastolicPoints = makeSeriesPoints(
      chartMeasurements,
      (measurement) => measurement.secondaryValue ?? 0,
    );
    return [
      { label: "Systolinen", points: systolicPoints },
      { label: "Diastolinen", points: diastolicPoints },
    ];
  }, [chartMeasurements]);
  const systolicPoints = series[0]?.points ?? [];
  const diastolicPoints = series[1]?.points ?? [];
  const summary =
    chartMeasurements.length === 0
      ? "Valitulla aikavälillä ei ole verenpainemittauksia. Kaikki mittaukset näkyvät alla olevassa listassa."
      : tTemplate("Kaaviossa {{0}} mittausta. Lista sisältää kaikki {{1}} kirjausta.", [
          String(chartMeasurements.length),
          String(measurements.length),
        ]);

  return (
    <Card heading={t("Verenpaineen historia")} data-testid="health-blood-pressure-history">
      <Meta>
        {t(
          "Kaavio näyttää systolisen ja diastolisen arvon. Esitys ei arvioi mittausten terveydellistä merkitystä.",
        )}
      </Meta>
      <ChartFrame
        title={t("Systolinen ja diastolinen paine")}
        unit="mmHg"
        ranges={tOptions(HEALTH_RANGE_OPTIONS)}
        range={range}
        onRangeChange={(value) => {
          if (HEALTH_RANGE_OPTIONS.some((option) => option.value === value)) {
            setRange(value as HealthRange);
          }
        }}
        series={series}
        summary={summary}
        emptyText={t("Ei verenpainemittauksia valitulla aikavälillä")}
      >
        {chartMeasurements.length > 0 ? (
          <BloodPressurePlot
            measurements={chartMeasurements}
            systolicPoints={systolicPoints}
            diastolicPoints={diastolicPoints}
          />
        ) : null}
      </ChartFrame>
      <section data-ui="health-bp-history-list" aria-labelledby="health-bp-history-list-title">
        <h3 id="health-bp-history-list-title">{t("Kaikki mittaukset")}</h3>
        <Meta>{t("Uusin kirjaus ensin. Lista ei muutu kaavion aikaväliä vaihdettaessa.")}</Meta>
        <ol>
          {[...measurements]
            .sort((left, right) => Date.parse(right.measuredAt) - Date.parse(left.measuredAt))
            .map((measurement) => (
              <MeasurementRecord key={measurement.id} measurement={measurement} />
            ))}
        </ol>
      </section>
    </Card>
  );
}
