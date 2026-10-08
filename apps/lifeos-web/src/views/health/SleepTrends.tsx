// T242: paikallisen kalenteripäivän unen määrä ja arvioitu laatu.
import { getIntlLocale, t, tOptions, tTemplate } from "../../language.tsx";
import { useState } from "react";
import { Card, ChartFrame, EmptyState, Meta, SegmentedControl } from "@lifeos/ui";
import type { ChartSeriesPoint } from "@lifeos/ui";
import { calculateSleepDurationMinutes } from "@lifeos/data";
import type { SleepEntry } from "@lifeos/domain";
import "./sleep-trends.css";

const SLEEP_PERIODS = [
  { value: "7d", label: "Viikko" },
  { value: "30d", label: "Kuukausi" },
] as const;

type SleepTrendPeriod = (typeof SLEEP_PERIODS)[number]["value"];
type SleepTrendMetric = "duration" | "quality";

interface SleepTrendDay {
  readonly dateKey: string;
  readonly label: string;
  readonly durationMinutes: number | null;
  readonly quality: number | null;
}

interface SleepDayAccumulator {
  durationMinutes: number;
  entryCount: number;
  qualityTotal: number;
  qualityCount: number;
}

interface SleepTrendCoordinate {
  readonly dateKey: string;
  readonly x: number;
  readonly y: number;
}

const numberFormat = {
  format: (value: number): string =>
    new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(value),
};
const VIEWBOX = { width: 720, height: 260, left: 48, right: 18, top: 18, bottom: 42 } as const;

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateFromKey(dateKey: string): Date {
  const [yearValue, monthValue, dayValue] = dateKey.split("-");
  return new Date(Number(yearValue), Number(monthValue) - 1, Number(dayValue), 12);
}

function shortDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { day: "numeric", month: "numeric" }).format(
    date,
  );
}

function getPeriodDays(
  entries: readonly SleepEntry[],
  period: SleepTrendPeriod,
  now: Date,
): readonly SleepTrendDay[] {
  const dayCount = period === "7d" ? 7 : 30;
  const today = dateFromKey(localDateKey(now));
  const dates = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - dayCount + 1 + index);
    return date;
  });
  const accumulators = new Map<string, SleepDayAccumulator>();
  for (const date of dates) {
    accumulators.set(localDateKey(date), {
      durationMinutes: 0,
      entryCount: 0,
      qualityTotal: 0,
      qualityCount: 0,
    });
  }

  for (const entry of entries) {
    const sleepStart = Date.parse(entry.sleepStart);
    const sleepEnd = Date.parse(entry.sleepEnd);
    if (entry.deletedAt !== null || !Number.isFinite(sleepStart) || sleepEnd > now.getTime()) {
      continue;
    }
    const accumulator = accumulators.get(localDateKey(new Date(sleepStart)));
    if (accumulator === undefined) continue;
    accumulator.durationMinutes += calculateSleepDurationMinutes(entry);
    accumulator.entryCount += 1;
    if (entry.quality !== null) {
      accumulator.qualityTotal += entry.quality;
      accumulator.qualityCount += 1;
    }
  }

  return dates.map((date) => {
    const dateKey = localDateKey(date);
    const accumulated = accumulators.get(dateKey);
    return {
      dateKey,
      label: shortDayLabel(date),
      durationMinutes:
        accumulated === undefined || accumulated.entryCount === 0
          ? null
          : accumulated.durationMinutes,
      quality:
        accumulated === undefined || accumulated.qualityCount === 0
          ? null
          : accumulated.qualityTotal / accumulated.qualityCount,
    };
  });
}

function makePoints(days: readonly SleepTrendDay[], metric: SleepTrendMetric): ChartSeriesPoint[] {
  return days.flatMap((day) => {
    if (metric === "duration") {
      return day.durationMinutes === null
        ? []
        : [{ x: day.label, y: Math.round((day.durationMinutes / 60) * 10) / 10 }];
    }
    return day.quality === null ? [] : [{ x: day.label, y: Math.round(day.quality * 10) / 10 }];
  });
}

function makeSummary(days: readonly SleepTrendDay[], metric: SleepTrendMetric): string {
  if (metric === "duration") {
    const recordedDays = days.filter((day) => day.durationMinutes !== null).length;
    return tTemplate("{{0}} kirjattua päivää. Päivän määrä summaa yöunen ja päiväunet.", [
      String(recordedDays),
    ]);
  }
  const ratedDays = days.filter((day) => day.quality !== null).length;
  return tTemplate(
    "{{0}} päivää, joilta on laatuarvio. Päivän arvo on arvioitujen unien keskiarvo.",
    [String(ratedDays)],
  );
}

function axisMaximum(days: readonly SleepTrendDay[], metric: SleepTrendMetric): number {
  if (metric === "quality") return 5;
  const maximumHours = Math.max(0, ...days.map((day) => (day.durationMinutes ?? 0) / 60));
  return Math.max(12, Math.ceil(maximumHours / 4) * 4);
}

function labelIndexes(dayCount: number): readonly number[] {
  if (dayCount <= 7) return Array.from({ length: dayCount }, (_, index) => index);
  return [...new Set([0, 7, 14, 21, dayCount - 1])];
}

function SleepTrendPlot({
  days,
  metric,
  maximum,
  description,
}: {
  readonly days: readonly SleepTrendDay[];
  readonly metric: SleepTrendMetric;
  readonly maximum: number;
  readonly description: string;
}): React.JSX.Element {
  const plotWidth = VIEWBOX.width - VIEWBOX.left - VIEWBOX.right;
  const plotHeight = VIEWBOX.height - VIEWBOX.top - VIEWBOX.bottom;
  const valueFor = (day: SleepTrendDay): number | null =>
    metric === "duration"
      ? day.durationMinutes === null
        ? null
        : day.durationMinutes / 60
      : day.quality;
  const coordinates = days.map((day, index) => {
    const value = valueFor(day);
    return value === null
      ? null
      : {
          dateKey: day.dateKey,
          x:
            VIEWBOX.left +
            (days.length < 2 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth),
          y: VIEWBOX.top + (1 - value / maximum) * plotHeight,
        };
  });
  const runs: SleepTrendCoordinate[][] = [];
  for (const point of coordinates) {
    if (point === null) continue;
    const lastRun = runs[runs.length - 1];
    if (lastRun === undefined) {
      runs.push([point]);
      continue;
    }
    const previousPoint = lastRun[lastRun.length - 1];
    if (previousPoint === undefined) {
      runs.push([point]);
      continue;
    }
    const previousDayIndex = coordinates.findIndex(
      (item) => item?.dateKey === previousPoint.dateKey,
    );
    const currentDayIndex = coordinates.findIndex((item) => item?.dateKey === point.dateKey);
    if (currentDayIndex === previousDayIndex + 1) {
      lastRun.push(point);
    } else {
      runs.push([point]);
    }
  }
  const tickValues = Array.from({ length: 5 }, (_, index) => maximum - (index * maximum) / 4);
  const xLabelIndexes = labelIndexes(days.length);

  return (
    <figure data-ui="health-sleep-trend-plot" data-series={metric}>
      <svg
        viewBox={`0 0 ${String(VIEWBOX.width)} ${String(VIEWBOX.height)}`}
        role="img"
        aria-label={description}
        preserveAspectRatio="xMidYMid meet"
      >
        {tickValues.map((value, index) => {
          const y = VIEWBOX.top + (index / 4) * plotHeight;
          return (
            <g key={index} data-ui="health-sleep-trend-y-tick">
              <line x1={VIEWBOX.left} x2={VIEWBOX.width - VIEWBOX.right} y1={y} y2={y} />
              <text x={VIEWBOX.left - 8} y={y} textAnchor="end" dominantBaseline="middle">
                {numberFormat.format(value)}
              </text>
            </g>
          );
        })}
        <line
          data-ui="health-sleep-trend-axis"
          x1={VIEWBOX.left}
          x2={VIEWBOX.left}
          y1={VIEWBOX.top}
          y2={VIEWBOX.height - VIEWBOX.bottom}
        />
        <line
          data-ui="health-sleep-trend-axis"
          x1={VIEWBOX.left}
          x2={VIEWBOX.width - VIEWBOX.right}
          y1={VIEWBOX.height - VIEWBOX.bottom}
          y2={VIEWBOX.height - VIEWBOX.bottom}
        />
        {runs.map((run, index) =>
          run.length > 1 ? (
            <polyline
              key={`run-${String(index)}`}
              points={run.map((point) => `${String(point.x)},${String(point.y)}`).join(" ")}
            />
          ) : null,
        )}
        {coordinates.map((point, index) =>
          point === null ? null : (
            <circle key={point.dateKey} cx={point.x} cy={point.y} r="4" data-index={index} />
          ),
        )}
        {xLabelIndexes.map((index) => {
          const day = days[index];
          if (day === undefined) return null;
          const x =
            VIEWBOX.left +
            (days.length < 2 ? plotWidth / 2 : (index / (days.length - 1)) * plotWidth);
          const anchor = index === 0 ? "start" : index === days.length - 1 ? "end" : "middle";
          return (
            <text
              key={day.dateKey}
              x={x}
              y={VIEWBOX.height - 10}
              textAnchor={anchor}
              data-ui="health-sleep-trend-x-label"
            >
              {day.label}
            </text>
          );
        })}
      </svg>
      <figcaption>
        {metric === "duration"
          ? t("Yöuni ja päiväunet, tuntia päivässä.")
          : t("Laatuarvion keskiarvo, asteikko 1–5.")}
      </figcaption>
    </figure>
  );
}

export function SleepTrends({
  entries,
}: {
  readonly entries: readonly SleepEntry[];
}): React.JSX.Element {
  const [period, setPeriod] = useState<SleepTrendPeriod>("7d");
  const now = new Date();
  const days = getPeriodDays(entries, period, now);
  const durationPoints = makePoints(days, "duration");
  const qualityPoints = makePoints(days, "quality");
  const durationsMaximum = axisMaximum(days, "duration");
  const periodCaption =
    period === "7d"
      ? tTemplate("{{0}} paikallista kalenteripäivää", ["7"])
      : tTemplate("{{0}} paikallista kalenteripäivää", ["30"]);

  return (
    <Card heading={t("Unen trendit")} data-testid="health-sleep-trends">
      {entries.length === 0 ? (
        <EmptyState
          title={t("Ei unitrendejä vielä")}
          hint={t("Kirjaa yöuni tai päiväuni päiväkirjaan, niin kehitys näkyy täällä.")}
        />
      ) : (
        <>
          <SegmentedControl
            label={t("Tarkastelu")}
            options={tOptions(SLEEP_PERIODS)}
            value={period}
            onOptionChange={(value) => {
              if (SLEEP_PERIODS.some((option) => option.value === value)) {
                setPeriod(value as SleepTrendPeriod);
              }
            }}
          />
          <Meta>
            {t("Näytetään")}
            {periodCaption}
            {t(
              ". Kesto sisältää päiväunet; laatu on päivän arvioitujen unien keskiarvo. Päivät määräytyvät unen aloitusajan mukaan.",
            )}
          </Meta>
          <div data-ui="health-sleep-trend-charts">
            <ChartFrame
              title={t("Unen kesto")}
              unit="h"
              ranges={tOptions(SLEEP_PERIODS)}
              range={period}
              onRangeChange={(value) => {
                if (SLEEP_PERIODS.some((option) => option.value === value)) {
                  setPeriod(value as SleepTrendPeriod);
                }
              }}
              showRangeControl={false}
              points={durationPoints}
              summary={makeSummary(days, "duration")}
              emptyText={
                period === "7d"
                  ? t("Ei unitietoja viimeiseltä viikolta")
                  : t("Ei unitietoja viimeiseltä kuukaudelta")
              }
            >
              {durationPoints.length > 0 ? (
                <SleepTrendPlot
                  days={days}
                  metric="duration"
                  maximum={durationsMaximum}
                  description={tTemplate(
                    "Unen kesto tunneissa {{0}} päivinä, joilta on kirjauksia.",
                    [periodCaption],
                  )}
                />
              ) : null}
            </ChartFrame>
            <ChartFrame
              title={t("Oma laatuarvio")}
              unit="/5"
              ranges={tOptions(SLEEP_PERIODS)}
              range={period}
              onRangeChange={(value) => {
                if (SLEEP_PERIODS.some((option) => option.value === value)) {
                  setPeriod(value as SleepTrendPeriod);
                }
              }}
              showRangeControl={false}
              points={qualityPoints}
              summary={makeSummary(days, "quality")}
              emptyText={t("Ei laatuarvioita valitulta aikaväliltä")}
            >
              {qualityPoints.length > 0 ? (
                <SleepTrendPlot
                  days={days}
                  metric="quality"
                  maximum={5}
                  description={tTemplate("Unen laatuarvion keskiarvo asteikolla 1–5, {{0}}.", [
                    t(periodCaption),
                  ])}
                />
              ) : null}
            </ChartFrame>
          </div>
        </>
      )}
    </Card>
  );
}
