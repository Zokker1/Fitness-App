// T215: painohistoria käyttäjän valitsemalla aikavälillä.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useState } from "react";
import { ChartFrame, Icon } from "@lifeos/ui";
import type { ChartSeriesPoint } from "@lifeos/ui";
import type { Measurement, WeightTarget } from "@lifeos/domain";
import {
  filterMeasurementsByRange,
  HEALTH_RANGE_OPTIONS,
  type HealthRange,
} from "./health-range.tsx";

const VIEWBOX = { width: 1120, height: 260, left: 52, right: 18, top: 18, bottom: 42 } as const;

function formatNumber(value: number): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(value);
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

function formatChartDate(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

function WeightPlot({
  measurements,
  points,
  unit,
  target,
}: {
  readonly measurements: readonly Measurement[];
  readonly points: readonly ChartSeriesPoint[];
  readonly unit: string;
  readonly target: WeightTarget | null;
}): React.JSX.Element {
  const plotWidth = VIEWBOX.width - VIEWBOX.left - VIEWBOX.right;
  const plotHeight = VIEWBOX.height - VIEWBOX.top - VIEWBOX.bottom;
  const noMeasurements = measurements.length === 0;
  const compatibleTarget = target?.unit === unit ? target : null;
  const chartValues = [
    ...points.map((point) => point.y),
    ...(compatibleTarget === null ? [] : [compatibleTarget.value]),
  ];
  const minimumReading = Math.min(...chartValues);
  const maximumReading = Math.max(...chartValues);
  const readingSpan = Math.max(2, maximumReading - minimumReading);
  const axisPadding = Math.max(1, readingSpan * 0.18);
  const axisMinimum = noMeasurements
    ? 0
    : Math.max(0, Math.floor((minimumReading - axisPadding) / 2) * 2);
  const axisMaximum = noMeasurements
    ? Math.max(10, Math.ceil(((compatibleTarget?.value ?? 0) * 1.15) / 10) * 10)
    : Math.ceil((maximumReading + axisPadding) / 2) * 2;
  const tickStep = (axisMaximum - axisMinimum) / 4;
  const xFor = (index: number): number =>
    points.length < 2
      ? VIEWBOX.left + plotWidth / 2
      : VIEWBOX.left + (index / (points.length - 1)) * plotWidth;
  const yFor = (value: number): number =>
    VIEWBOX.top + ((axisMaximum - value) / (axisMaximum - axisMinimum)) * plotHeight;
  const coordinates = points.map((point, index) => ({
    x: xFor(index),
    y: yFor(point.y),
  }));
  const line = coordinates.map((point) => `${String(point.x)},${String(point.y)}`).join(" ");
  const baselineY = VIEWBOX.height - VIEWBOX.bottom;
  const area =
    coordinates.length > 1
      ? [
          `${String(coordinates[0]?.x ?? VIEWBOX.left)},${String(baselineY)}`,
          ...coordinates.map((point) => `${String(point.x)},${String(point.y)}`),
          `${String(coordinates[coordinates.length - 1]?.x ?? VIEWBOX.width - VIEWBOX.right)},${String(baselineY)}`,
        ].join(" ")
      : "";

  return (
    <figure data-ui="health-weight-plot">
      <svg
        viewBox={`0 0 ${String(VIEWBOX.width)} ${String(VIEWBOX.height)}`}
        role="img"
        aria-label={
          noMeasurements
            ? tTemplate("Painohistoria on tyhjä. Näytetään nollataso yksikössä {{0}}.", [unit])
            : tTemplate("{{0}} painomittausta yksikössä {{1}}.", [
                String(measurements.length),
                unit,
              ])
        }
        preserveAspectRatio="xMidYMid meet"
      >
        {Array.from({ length: 5 }, (_, index) => {
          const value = axisMaximum - index * tickStep;
          const y = yFor(value);
          return (
            <g key={`y-${String(index)}`} data-ui="health-weight-y-tick">
              <line x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={y} y2={y} />
              <text x={VIEWBOX.left - 8} y={y} textAnchor="end" dominantBaseline="middle">
                {formatNumber(value)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: 9 }, (_, index) => {
          const x = VIEWBOX.left + (index / 8) * plotWidth;
          return (
            <line
              key={`x-${String(index)}`}
              data-ui="health-weight-x-tick"
              x1={x}
              x2={x}
              y1={VIEWBOX.top}
              y2={baselineY}
            />
          );
        })}
        <line
          data-ui="health-weight-axis"
          x1={VIEWBOX.left}
          x2={VIEWBOX.left}
          y1={VIEWBOX.top}
          y2={baselineY}
        />
        <line
          data-ui="health-weight-axis"
          x1={VIEWBOX.left}
          x2={VIEWBOX.width - VIEWBOX.right}
          y1={baselineY}
          y2={baselineY}
        />
        {compatibleTarget !== null &&
        compatibleTarget.value >= axisMinimum &&
        compatibleTarget.value <= axisMaximum ? (
          <g data-ui="health-weight-target-line">
            <line
              x1={VIEWBOX.left}
              x2={VIEWBOX.width - VIEWBOX.right}
              y1={yFor(compatibleTarget.value)}
              y2={yFor(compatibleTarget.value)}
            />
            <text
              x={VIEWBOX.width - VIEWBOX.right - 4}
              y={yFor(compatibleTarget.value) - 7}
              textAnchor="end"
            >
              {tTemplate("Tavoite {{0}} {{1}}", [
                formatNumber(compatibleTarget.value),
                compatibleTarget.unit,
              ])}
            </text>
          </g>
        ) : null}
        {!noMeasurements && area !== "" ? (
          <polygon data-ui="health-weight-area" points={area} />
        ) : null}
        {coordinates.length > 1 ? <polyline points={line} /> : null}
        {!noMeasurements
          ? coordinates.map((point, index) => (
              <circle
                key={measurements[index]?.id ?? String(index)}
                cx={point.x}
                cy={point.y}
                r="4"
              />
            ))
          : null}
        <text x={VIEWBOX.left} y={VIEWBOX.height - 12} textAnchor="start">
          {noMeasurements ? points[0]?.x : formatChartDate(measurements[0]?.measuredAt ?? "")}
        </text>
        <text x={VIEWBOX.width - VIEWBOX.right} y={VIEWBOX.height - 12} textAnchor="end">
          {noMeasurements
            ? points[points.length - 1]?.x
            : formatChartDate(measurements[measurements.length - 1]?.measuredAt ?? "")}
        </text>
      </svg>
      <figcaption>
        {noMeasurements
          ? t("Nollaviiva on aloitustaso, ei kirjattu paino.")
          : t("Raakamittaukset näytetään aikajärjestyksessä.")}
      </figcaption>
    </figure>
  );
}

function makePoints(measurements: readonly Measurement[]): ChartSeriesPoint[] {
  const usedLabels = new Map<string, number>();
  return measurements.map((measurement) => {
    const baseLabel = formatDateTime(measurement.measuredAt);
    const occurrence = (usedLabels.get(baseLabel) ?? 0) + 1;
    usedLabels.set(baseLabel, occurrence);
    return {
      x: occurrence === 1 ? baseLabel : `${baseLabel} (${String(occurrence)})`,
      y: measurement.value,
    };
  });
}

function latestMeasurement(measurements: readonly Measurement[]): Measurement | null {
  return measurements.reduce<Measurement | null>((latest, measurement) => {
    if (latest === null || Date.parse(measurement.measuredAt) > Date.parse(latest.measuredAt)) {
      return measurement;
    }
    return latest;
  }, null);
}

export function WeightHistory({
  measurements,
  target = null,
}: {
  readonly measurements: readonly Measurement[];
  readonly target?: WeightTarget | null;
}): React.JSX.Element {
  const [range, setRange] = useState<HealthRange>("7d");
  const rangeMeasurements = filterMeasurementsByRange(measurements, range);
  const rangeLatest = latestMeasurement(rangeMeasurements);
  const overallLatest = latestMeasurement(measurements);
  const unit = rangeLatest?.unit ?? overallLatest?.unit ?? target?.unit ?? "kg";
  const chartMeasurements = rangeMeasurements
    .filter((measurement) => measurement.unit === unit)
    .sort((left, right) => Date.parse(left.measuredAt) - Date.parse(right.measuredAt));
  const hasRangeData = chartMeasurements.length > 0;
  const dataPoints = makePoints(chartMeasurements);
  const points =
    dataPoints.length > 0
      ? dataPoints
      : [
          { x: t("Alku"), y: 0 },
          { x: t("Nyt"), y: 0 },
        ];
  const summary = hasRangeData
    ? tTemplate("{{0}} mittausta yksikössä {{1}}. Eri yksiköitä ei muunneta.", [
        String(chartMeasurements.length),
        unit,
      ])
    : t("Valitulla aikavälillä ei ole kirjauksia. Nollaviiva on aloitustaso.");
  const chartHeading = (
    <span data-ui="health-weight-metric-heading">
      <Icon name="chart" />
      <span>
        {t("Painon historia")}
        <small data-ui="health-weight-history-subtitle">
          {t("Seuraa painon muutosta ajan myötä.")}
        </small>
      </span>
    </span>
  );

  return (
    <section data-testid="health-weight-history">
      <ChartFrame
        title={t("Painomittaukset")}
        heading={chartHeading}
        unit={unit}
        ranges={tOptions(HEALTH_RANGE_OPTIONS)}
        range={range}
        onRangeChange={(value) => {
          if (HEALTH_RANGE_OPTIONS.some((option) => option.value === value)) {
            setRange(value as HealthRange);
          }
        }}
        points={points}
        summary={summary}
        baselineNote={
          hasRangeData
            ? t("Pystyakseli mukautuu valittuihin mittauksiin.")
            : t("Nollaviiva on aloitustaso, ei kirjattu paino.")
        }
        emptyText={t("Ei painomittauksia valitulla aikavälillä")}
      >
        <WeightPlot measurements={chartMeasurements} points={points} unit={unit} target={target} />
      </ChartFrame>
      {chartMeasurements.length > 0 ? (
        <details data-ui="health-weight-history-list-details">
          <summary>{t("Viisi uusinta mittausta")}</summary>
          <ol data-ui="health-weight-history-list">
            {[...chartMeasurements]
              .reverse()
              .slice(0, 5)
              .map((measurement) => (
                <li key={measurement.id}>
                  <div data-ui="health-weight-history-entry">
                    <time dateTime={measurement.measuredAt}>
                      {formatDateTime(measurement.measuredAt)}
                    </time>
                    <strong>
                      {formatNumber(measurement.value)} {measurement.unit}
                    </strong>
                  </div>
                  {measurement.note !== null ? (
                    <p data-ui="meta">
                      {t("Muistiinpano: ")}
                      {measurement.note}
                    </p>
                  ) : null}
                </li>
              ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
}
