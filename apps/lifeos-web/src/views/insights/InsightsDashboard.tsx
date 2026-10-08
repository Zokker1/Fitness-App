// T271: paikallinen Insights-koonti päiväkohtaisista mittareista.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type {
  ActivityEntry,
  FocusSession,
  Goal,
  GoalDay,
  HabitRule,
  HydrationEntry,
  Measurement,
  MoodCheckin,
  NutritionEntry,
  Routine,
  RoutineRun,
  RoutineSchedule,
  SleepEntry,
  Task,
  XPTransaction,
} from "@lifeos/domain";
import { getMeasurementTypeDefinition, toLocalDateKey } from "@lifeos/domain";
import {
  calculateCrossMetricCorrelation,
  calculateFocusMetrics,
  calculateGoalRoutineConsistencyMetrics,
  calculateMoodEnergyMetrics,
  calculateNutritionHydrationMetrics,
  calculateSleepActivityMetrics,
  calculateTaskCompletionMetrics,
  calculateVitalsMetrics,
  calculateWeightInsightMetrics,
  timezoneOffsetMinutesAtInstant,
  type AnalyticsProjectionPeriod,
  type DataResult,
} from "@lifeos/data";
import {
  Alert,
  Card,
  ChartFrame,
  Display,
  EmptyState,
  SegmentedControl,
  StatChip,
} from "@lifeos/ui";
import type { ChartRangeOption, ChartSeriesPoint } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";
import { useHydrationTarget } from "../../preferences/HydrationTargetContext.tsx";
import {
  defaultInsightsCardOrder,
  hideInsightsCard,
  INSIGHTS_CARD_IDS,
  INSIGHTS_CARD_LABELS,
  moveInsightsCard,
  readInsightsCardOrder,
  showInsightsCard,
  storeInsightsCardOrder,
  type InsightsCardId,
  type InsightsCardOrder,
} from "./insightsCards.ts";
import "./InsightsDashboard.css";

type RangeDays = 7 | 30 | 90;

const RANGE_OPTIONS = [
  { value: "7", label: "7 pv" },
  { value: "30", label: "30 pv" },
  { value: "90", label: "90 pv" },
] as const;

const CHART_RANGE: readonly ChartRangeOption[] = [{ value: "selected", label: "Valittu jakso" }];
const DAY_MILLISECONDS = 86_400_000;

interface SourceSnapshot {
  readonly tasks: readonly Task[];
  readonly focusSessions: readonly FocusSession[];
  readonly goals: readonly Goal[];
  readonly habitRules: readonly HabitRule[];
  readonly goalDays: readonly GoalDay[];
  readonly routines: readonly Routine[];
  readonly routineSchedules: readonly RoutineSchedule[];
  readonly routineRuns: readonly RoutineRun[];
  readonly xpTransactions: readonly XPTransaction[];
  readonly measurements: readonly Measurement[];
  readonly nutritionEntries: readonly NutritionEntry[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly sleepEntries: readonly SleepEntry[];
  readonly activityEntries: readonly ActivityEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
}

interface TrendPoint extends ChartSeriesPoint {
  readonly localDate: string;
}

interface MetricSeries {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly points: readonly TrendPoint[];
}

interface SummaryItem {
  readonly label: string;
  readonly value: string;
  readonly valueLabel: string;
}

interface DashboardCardData {
  readonly series: readonly MetricSeries[];
  readonly summary: readonly SummaryItem[];
  readonly note?: string;
}

interface DashboardMetrics {
  readonly cards: Readonly<Record<InsightsCardId, DashboardCardData>>;
  readonly comparisonSeries: readonly MetricSeries[];
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
}

function requireValue<T>(result: DataResult<T>): T {
  if (!result.ok) throw new Error(result.error.userMessage);
  return result.value;
}

function localDateAndZone(nowIso: string): {
  readonly localDate: string;
  readonly timeZone: string;
  readonly offset: number;
} {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const offset =
    timezoneOffsetMinutesAtInstant(nowIso, timeZone) ?? -new Date(nowIso).getTimezoneOffset();
  return { localDate: toLocalDateKey(nowIso, offset), timeZone, offset };
}

function projectionPeriod(
  localDate: string,
  timeZone: string,
  offset: number,
  days: RangeDays,
): AnalyticsProjectionPeriod {
  const end = Date.parse(`${localDate}T00:00:00.000Z`);
  const startLocalDate = new Date(end - (days - 1) * DAY_MILLISECONDS).toISOString().slice(0, 10);
  return { startLocalDate, endLocalDate: localDate, timezoneOffsetMinutes: offset, timeZone };
}

function dayLabel(localDate: string): string {
  return `${localDate.slice(8, 10)}.${localDate.slice(5, 7)}.`;
}

function numberLabel(value: number | null, digits = 0): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: digits }).format(value);
}

function percentLabel(value: number | null): string {
  return value === null ? "—" : `${numberLabel(value * 100)} %`;
}

function summary(label: string, value: string, valueLabel = `${label}: ${value}`): SummaryItem {
  return { label, value, valueLabel };
}

function trendSeries(
  key: string,
  label: string,
  unit: string,
  values: readonly { readonly localDate: string; readonly value: number | null }[],
): MetricSeries {
  return {
    key,
    label,
    unit,
    points: values.flatMap(({ localDate, value }) =>
      value === null || !Number.isFinite(value)
        ? []
        : [{ localDate, x: dayLabel(localDate), y: value }],
    ),
  };
}

function makeDashboardMetrics(
  snapshot: SourceSnapshot,
  days: RangeDays,
  hydrationTargetMl: number | null,
): DashboardMetrics {
  const now = new Date();
  const nowIso = now.toISOString();
  const { localDate, timeZone, offset } = localDateAndZone(nowIso);
  const period = projectionPeriod(localDate, timeZone, offset, days);
  const task = requireValue(
    calculateTaskCompletionMetrics({ period, asOfLocalDate: localDate, tasks: snapshot.tasks }),
  );
  const focus = requireValue(
    calculateFocusMetrics({ period, asOfLocalDate: localDate, sessions: snapshot.focusSessions }),
  );
  const goals = requireValue(
    calculateGoalRoutineConsistencyMetrics({
      period,
      asOfLocalDate: localDate,
      goals: snapshot.goals,
      habitRules: snapshot.habitRules,
      goalDays: snapshot.goalDays,
      routines: snapshot.routines,
      routineSchedules: snapshot.routineSchedules,
      routineRuns: snapshot.routineRuns,
      xpTransactions: snapshot.xpTransactions,
    }),
  );
  const nutrition = requireValue(
    calculateNutritionHydrationMetrics({
      period,
      now: nowIso,
      nutritionEntries: snapshot.nutritionEntries,
      hydrationEntries: snapshot.hydrationEntries,
      hydrationTargetMl: hydrationTargetMl ?? undefined,
    }),
  );
  const sleep = requireValue(
    calculateSleepActivityMetrics({
      period,
      now: nowIso,
      sleepEntries: snapshot.sleepEntries,
      activityEntries: snapshot.activityEntries,
    }),
  );
  const mood = requireValue(
    calculateMoodEnergyMetrics({ period, now: nowIso, checkins: snapshot.moodCheckins }),
  );
  const weight = requireValue(
    calculateWeightInsightMetrics({ period, now: nowIso, measurements: snapshot.measurements }),
  );
  const vitals = requireValue(
    calculateVitalsMetrics({ period, now: nowIso, measurements: snapshot.measurements }),
  );

  const workSeries = [
    trendSeries(
      "focus-minutes",
      "Fokusminuutit",
      "min",
      focus.trend.map((day) => ({ localDate: day.localDate, value: day.focusedMinutes })),
    ),
    trendSeries(
      "tasks-completed",
      "Valmiit tehtävät",
      "kpl",
      task.trend.map((day) => ({
        localDate: day.localDate,
        value: day.localDate > localDate ? null : day.completedTaskCount,
      })),
    ),
    trendSeries(
      "completion-rate",
      "Tehtävien valmistumisaste",
      "%",
      task.trend.map((day) => ({
        localDate: day.localDate,
        value: day.completionRate === null ? null : day.completionRate * 100,
      })),
    ),
  ];
  const goalSeries = [
    trendSeries(
      "goal-success",
      "Tavoitepäivien onnistuminen",
      "%",
      goals.trend.map((day) => ({
        localDate: day.localDate,
        value: day.goalSuccessRate === null ? null : day.goalSuccessRate * 100,
      })),
    ),
    trendSeries(
      "routine-success",
      "Rutiinien toteutuminen",
      "%",
      goals.trend.map((day) => ({
        localDate: day.localDate,
        value: day.routineSuccessRate === null ? null : day.routineSuccessRate * 100,
      })),
    ),
    trendSeries(
      "momentum",
      "Momentum",
      "pistettä / 100",
      goals.momentumHistory.map((day) => ({
        localDate: day.localDate,
        value: day.momentum?.score ?? null,
      })),
    ),
  ];
  const nutritionSeries = [
    trendSeries(
      "calories",
      "Energia",
      "kcal",
      nutrition.trend.map((day) => ({
        localDate: day.localDate,
        value: day.nutrition?.totals.caloriesKcal ?? null,
      })),
    ),
    trendSeries(
      "protein",
      "Proteiini",
      "g",
      nutrition.trend.map((day) => ({
        localDate: day.localDate,
        value: day.nutrition?.totals.proteinG ?? null,
      })),
    ),
    trendSeries(
      "carbs",
      "Hiilihydraatit",
      "g",
      nutrition.trend.map((day) => ({
        localDate: day.localDate,
        value: day.nutrition?.totals.carbsG ?? null,
      })),
    ),
    trendSeries(
      "fat",
      "Rasva",
      "g",
      nutrition.trend.map((day) => ({
        localDate: day.localDate,
        value: day.nutrition?.totals.fatG ?? null,
      })),
    ),
    trendSeries(
      "fiber",
      "Kuitu",
      "g",
      nutrition.trend.map((day) => ({
        localDate: day.localDate,
        value: day.nutrition?.totals.fiberG ?? null,
      })),
    ),
    trendSeries(
      "hydration",
      "Neste",
      "ml",
      nutrition.trend.map((day) => ({
        localDate: day.localDate,
        value: day.hydration?.milliliters ?? null,
      })),
    ),
  ];
  const sleepSeries = [
    trendSeries(
      "sleep-hours",
      "Yöuni",
      "h",
      sleep.trend.map((day) => ({
        localDate: day.localDate,
        value: day.sleep === null ? null : day.sleep.overnightDurationSeconds / 3600,
      })),
    ),
    trendSeries(
      "sleep-quality",
      "Unen laatupisteet",
      "pistettä / 5",
      sleep.trend.map((day) => ({
        localDate: day.localDate,
        value: day.sleep?.averageQuality ?? null,
      })),
    ),
    trendSeries(
      "activity-minutes",
      "Aktiivisuus",
      "min",
      sleep.trend.map((day) => ({
        localDate: day.localDate,
        value:
          day.activity?.recordedDurationSeconds === null || day.activity === null
            ? null
            : day.activity.recordedDurationSeconds / 60,
      })),
    ),
    trendSeries(
      "activity-count",
      "Aktiviteetit",
      "kpl",
      sleep.trend.map((day) => ({
        localDate: day.localDate,
        value: day.activity?.entryCount ?? null,
      })),
    ),
  ];
  const moodScales = [
    ["mood", "Mieliala"],
    ["stress", "Stressi"],
    ["energy", "Energia"],
    ["motivation", "Motivaatio"],
    ["focus", "Keskittyminen"],
  ] as const;
  const moodSeries = moodScales.map(([key, label]) =>
    trendSeries(
      `mood-${key}`,
      label,
      "pistettä / 5",
      mood.trend.map((day) => ({
        localDate: day.localDate,
        value: day.scales?.[key]?.average ?? null,
      })),
    ),
  );
  const measurementSeries: MetricSeries[] = [
    trendSeries(
      "weight",
      "Paino",
      weight.unit ?? "kg",
      weight.trend.map((day) => ({ localDate: day.localDate, value: day.dailyAverage })),
    ),
  ];
  for (const item of vitals.series) {
    const itemLabel = item.metricName ?? getMeasurementTypeDefinition(item.type).label;
    const suffix = item.type === "blood-pressure" ? " (yläpaine)" : "";
    const key = `vital-${item.type}-${item.metricName ?? ""}-${item.unit}`;
    measurementSeries.push(
      trendSeries(
        key,
        `${itemLabel}${suffix}`,
        item.unit,
        item.days.map((day) => ({ localDate: day.localDate, value: day.value?.average ?? null })),
      ),
    );
    if (item.secondaryValue !== null) {
      measurementSeries.push(
        trendSeries(
          `${key}-secondary`,
          `${itemLabel} (alapaine)`,
          item.unit,
          item.days.map((day) => ({
            localDate: day.localDate,
            value: day.secondaryValue?.average ?? null,
          })),
        ),
      );
    }
    if (item.pulseBpm !== null) {
      measurementSeries.push(
        trendSeries(
          `${key}-pulse`,
          `${itemLabel} (pulssi)`,
          "bpm",
          item.days.map((day) => ({
            localDate: day.localDate,
            value: day.pulseBpm?.average ?? null,
          })),
        ),
      );
    }
  }

  const cards: Record<InsightsCardId, DashboardCardData> = {
    work: {
      series: workSeries,
      summary: [
        summary("Fokus", `${numberLabel(focus.focusedMinutes)} min`),
        summary("Valmiit tehtävät", numberLabel(task.completedTaskCount)),
        summary("Valmistumisaste", percentLabel(task.completionRate)),
      ],
    },
    goals: {
      series: goalSeries,
      summary: [
        summary("Tavoitepäivät", percentLabel(goals.dailyGoalSuccessRate)),
        summary("Rutiinipäivät", percentLabel(goals.routineSuccessRate)),
        summary("Tavoitteita", numberLabel(goals.goals.length)),
        summary("Rutiineja", numberLabel(goals.routines.length)),
      ],
    },
    nutrition: {
      series: nutritionSeries,
      summary: [
        summary("Kirjatut ateriat", numberLabel(nutrition.nutrition.entryCount)),
        summary("Nestepäiviä", numberLabel(nutrition.hydration.daysWithEntries)),
        summary("Nesteen tavoiteosuma", percentLabel(nutrition.hydration.targetHitRate)),
      ],
    },
    sleep: {
      series: sleepSeries,
      summary: [
        summary("Yöunia", numberLabel(sleep.sleep.nightCount)),
        summary(
          "Uni keskimäärin",
          sleep.sleep.averageDurationSecondsPerSleepDay === null
            ? "—"
            : `${numberLabel(sleep.sleep.averageDurationSecondsPerSleepDay / 3600, 1)} h`,
        ),
        summary("Aktiviteetteja", numberLabel(sleep.activity.entryCount)),
      ],
    },
    mood: {
      series: moodSeries,
      summary: [
        summary("Kirjaukset", numberLabel(mood.summary.checkinCount)),
        summary(
          "Mieliala",
          mood.summary.scales === null
            ? "—"
            : `${numberLabel(mood.summary.scales.mood.average, 1)} / 5`,
        ),
        summary(
          "Energia",
          mood.summary.scales?.energy === null || mood.summary.scales?.energy === undefined
            ? "—"
            : `${numberLabel(mood.summary.scales.energy.average, 1)} / 5`,
        ),
      ],
      note: "Asteikot ovat omia kirjauksiasi, eivät terveydellisiä arvioita.",
    },
    measurements: {
      series: measurementSeries,
      summary: [
        summary("Painomittauksia", numberLabel(weight.measurementCount)),
        summary(
          "Painon muutos",
          weight.change === null || weight.unit === null
            ? "—"
            : `${numberLabel(weight.change, 1)} ${weight.unit}`,
        ),
        summary("Muita mittaussarjoja", numberLabel(vitals.series.length)),
      ],
      note: "Mittaukset näytetään omissa yksiköissään. Yhteenveto ei ole diagnoosi.",
    },
    comparison: { series: [], summary: [] },
  };
  const comparisonSeries = [
    ...workSeries,
    ...goalSeries,
    ...nutritionSeries,
    ...sleepSeries,
    ...moodSeries,
    ...measurementSeries,
  ];
  return { cards, comparisonSeries, period, asOfLocalDate: localDate };
}

function selectSeries(
  series: readonly MetricSeries[],
  key: string | undefined,
): MetricSeries | undefined {
  return series.find((item) => item.key === key) ?? series[0];
}

function MetricChart({ series }: { readonly series: MetricSeries | undefined }): React.JSX.Element {
  if (series === undefined) {
    return (
      <EmptyState
        title={t("Mittarisarjaa ei ole vielä")}
        hint={t("Lisää ensin mittaus, jotta trendi näkyy täällä.")}
      />
    );
  }
  const maximum = Math.max(0, ...series.points.map((point) => point.y));
  return (
    <ChartFrame
      title={tTemplate("{{0}} päivittäin", [t(series.label)])}
      unit={series.unit}
      ranges={tOptions(CHART_RANGE)}
      range="selected"
      onRangeChange={() => undefined}
      points={series.points}
      showRangeControl={false}
      emptyText={tTemplate("Ei {{0}} kirjauksia valitulla jaksolla", [
        t(series.label).toLocaleLowerCase(getIntlLocale()),
      ])}
    >
      <div
        data-ui="insights-bars"
        role="list"
        aria-label={tTemplate("{{0}}, päivittäin", [t(series.label)])}
      >
        {series.points.map((point) => {
          const height = maximum <= 0 || point.y <= 0 ? 0 : Math.max(4, (point.y / maximum) * 100);
          return (
            <div
              key={point.localDate}
              data-ui="insights-bar-day"
              role="listitem"
              aria-label={`${point.localDate}: ${numberLabel(point.y, 1)} ${series.unit}`}
            >
              <span data-ui="insights-bar-value" aria-hidden="true">
                {numberLabel(point.y, 1)}
              </span>
              <div data-ui="insights-bar-track" aria-hidden="true">
                <span style={{ blockSize: `${String(height)}%` }} />
              </div>
              <span data-ui="insights-bar-label" aria-hidden="true">
                {point.x}
              </span>
            </div>
          );
        })}
      </div>
    </ChartFrame>
  );
}

function CorrelationPlot({
  first,
  second,
  result,
}: {
  readonly first: MetricSeries;
  readonly second: MetricSeries;
  readonly result: ReturnType<typeof calculateCrossMetricCorrelation> extends DataResult<infer T>
    ? T | null
    : never;
}): React.JSX.Element {
  const firstValues = result?.pairedDays.map((day) => day.firstValue) ?? [];
  const secondValues = result?.pairedDays.map((day) => day.secondValue) ?? [];
  const minX = Math.min(...firstValues);
  const maxX = Math.max(...firstValues);
  const minY = Math.min(...secondValues);
  const maxY = Math.max(...secondValues);
  const coordinate = (value: number, min: number, max: number): number =>
    max === min ? 50 : 7 + ((value - min) / (max - min)) * 86;
  return (
    <div data-ui="insights-correlation">
      <div
        data-ui="insights-scatter"
        role="list"
        aria-label={tTemplate("Paritetut päivät: {{0}} ja {{1}}", [first.label, second.label])}
      >
        {result?.pairedDays.map((day) => (
          <span
            key={day.localDate}
            role="listitem"
            aria-label={tTemplate("{{0}}: {{1}} {{2}} {{3}}; {{4}} {{5}} {{6}}", [
              day.localDate,
              t(first.label),
              numberLabel(day.firstValue, 1),
              first.unit,
              t(second.label),
              numberLabel(day.secondValue, 1),
              second.unit,
            ])}
            style={{
              left: `${String(coordinate(day.firstValue, minX, maxX))}%`,
              bottom: `${String(coordinate(day.secondValue, minY, maxY))}%`,
            }}
          />
        ))}
      </div>
      <div data-ui="insights-scatter-axes">
        <span>
          {t(first.label)} ({first.unit})
        </span>
        <span>
          {t(second.label)} ({second.unit})
        </span>
      </div>
      {result === null || result.pairedDays.length === 0 ? null : (
        <details data-ui="insights-pairs">
          <summary>
            {t("Näytä ")}
            {String(result.pairedDayCount)} {t(" paritettua päivää")}
          </summary>
          <table>
            <thead>
              <tr>
                <th scope="col">{t("Päivä")}</th>
                <th scope="col">
                  {t(first.label)} ({first.unit})
                </th>
                <th scope="col">
                  {t(second.label)} ({second.unit})
                </th>
              </tr>
            </thead>
            <tbody>
              {result.pairedDays.map((day) => (
                <tr key={day.localDate}>
                  <th scope="row">{day.localDate}</th>
                  <td>{numberLabel(day.firstValue, 1)}</td>
                  <td>{numberLabel(day.secondValue, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

export function InsightsDashboard(): React.JSX.Element {
  const data = useData();
  const { targetMilliliters } = useHydrationTarget();
  const location = useLocation();
  const navigate = useNavigate();
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);
  const [snapshot, setSnapshot] = useState<SourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [order, setOrder] = useState<InsightsCardOrder>(readInsightsCardOrder);
  const [selectedSeries, setSelectedSeries] = useState<Partial<Record<InsightsCardId, string>>>({});
  const [momentumShortcutRequest, setMomentumShortcutRequest] = useState(0);
  const lastFocusedMomentumShortcut = useRef(0);
  const momentumShortcutConsumed = useRef(false);
  const [comparisonKeys, setComparisonKeys] = useState<readonly [string, string]>([
    "focus-minutes",
    "completion-rate",
  ]);
  const latestRequest = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    const shortcutValues = new URLSearchParams(location.search).getAll("shortcut");
    const isMomentumShortcut =
      location.pathname === "/insights" &&
      shortcutValues.length === 1 &&
      shortcutValues[0] === "momentum";
    if (!isMomentumShortcut) {
      momentumShortcutConsumed.current = false;
      return;
    }
    if (momentumShortcutConsumed.current) {
      return;
    }

    momentumShortcutConsumed.current = true;
    setMomentumShortcutRequest((current) => current + 1);
    setSelectedSeries((current) => ({ ...current, goals: "momentum" }));
    void navigate("/insights", { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    storeInsightsCardOrder(order);
  }, [order]);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setLoading(true);
    setLoadError(null);
    try {
      const results = await Promise.all([
        data.tasks.list(),
        data.focusSessions.list(),
        data.goals.list(),
        data.habitRules.list(),
        data.goalDays.list(),
        data.routines.list(),
        data.routineSchedules.list(),
        data.routineRuns.list(),
        data.xpTransactions.list(),
        data.measurements.list(),
        data.nutritionEntries.list(),
        data.hydrationEntries.list(),
        data.sleepEntries.list(),
        data.activityEntries.list(),
        data.moodCheckins.list(),
      ]);
      const nextSnapshot: SourceSnapshot = {
        tasks: requireValue(results[0]),
        focusSessions: requireValue(results[1]),
        goals: requireValue(results[2]),
        habitRules: requireValue(results[3]),
        goalDays: requireValue(results[4]),
        routines: requireValue(results[5]),
        routineSchedules: requireValue(results[6]),
        routineRuns: requireValue(results[7]),
        xpTransactions: requireValue(results[8]),
        measurements: requireValue(results[9]),
        nutritionEntries: requireValue(results[10]),
        hydrationEntries: requireValue(results[11]),
        sleepEntries: requireValue(results[12]),
        activityEntries: requireValue(results[13]),
        moodCheckins: requireValue(results[14]),
      };
      if (requestId === latestRequest.current && mounted.current) setSnapshot(nextSnapshot);
    } catch (error) {
      if (requestId === latestRequest.current && mounted.current) {
        setLoadError(error instanceof Error ? error.message : "Insights-tietoja ei voitu lukea.");
      }
    } finally {
      if (requestId === latestRequest.current && mounted.current) setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onDataChanged = (): void => {
      void refresh();
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      mounted.current = false;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const metricResult = useMemo(() => {
    if (snapshot === null) return { metrics: null, error: null };
    try {
      return { metrics: makeDashboardMetrics(snapshot, rangeDays, targetMilliliters), error: null };
    } catch (error) {
      return {
        metrics: null,
        error: error instanceof Error ? error.message : "Insights-mittareita ei voitu laskea.",
      };
    }
  }, [rangeDays, snapshot, targetMilliliters]);
  const metrics = metricResult.metrics;
  const correlationOptions = metrics?.comparisonSeries ?? [];
  const firstSeries = selectSeries(correlationOptions, comparisonKeys[0]);
  const secondCandidates = correlationOptions.filter((item) => item.key !== firstSeries?.key);
  const secondSeries = selectSeries(secondCandidates, comparisonKeys[1]);
  const correlation = useMemo(() => {
    if (metrics === null || firstSeries === undefined || secondSeries === undefined) return null;
    const result = calculateCrossMetricCorrelation({
      period: metrics.period,
      asOfLocalDate: metrics.asOfLocalDate,
      first: {
        key: firstSeries.key,
        label: firstSeries.label,
        unit: firstSeries.unit,
        points: firstSeries.points.map((point) => ({ localDate: point.localDate, value: point.y })),
      },
      second: {
        key: secondSeries.key,
        label: secondSeries.label,
        unit: secondSeries.unit,
        points: secondSeries.points.map((point) => ({
          localDate: point.localDate,
          value: point.y,
        })),
      },
    });
    return result.ok ? result.value : null;
  }, [firstSeries, metrics, secondSeries]);

  const updateOrder = (next: InsightsCardOrder): void => {
    setOrder(next);
  };
  const updateComparison = (index: 0 | 1, key: string): void => {
    setComparisonKeys((current) => {
      if (index === 0) {
        const second =
          current[1] === key
            ? (correlationOptions.find((item) => item.key !== key)?.key ?? current[1])
            : current[1];
        return [key, second];
      }
      const first =
        current[0] === key
          ? (correlationOptions.find((item) => item.key !== key)?.key ?? current[0])
          : current[0];
      return [first, key];
    });
  };

  const visibleCardIds =
    momentumShortcutRequest > 0 && !order.visible.includes("goals")
      ? (["goals", ...order.visible] as readonly InsightsCardId[])
      : order.visible;

  useEffect(() => {
    if (
      momentumShortcutRequest === 0 ||
      loading ||
      lastFocusedMomentumShortcut.current === momentumShortcutRequest
    ) {
      return;
    }
    const goalsCard = document.getElementById("insights-momentum-shortcut");
    if (goalsCard instanceof HTMLElement) {
      lastFocusedMomentumShortcut.current = momentumShortcutRequest;
      goalsCard.focus({ preventScroll: true });
      goalsCard.scrollIntoView({ block: "start" });
    }
  }, [loading, momentumShortcutRequest]);

  return (
    <div data-ui="insights-dashboard">
      <div data-ui="insights-header">
        <Display>{t("Insights")}</Display>
        <Link to="/insights/history" data-ui="insights-history-link">
          {t("Avaa historia")}
        </Link>
      </div>
      <section data-ui="insights-controls" aria-label={t("Insights-näkymän asetukset")}>
        <SegmentedControl
          label={t("Aikaväli")}
          options={tOptions(RANGE_OPTIONS)}
          value={String(rangeDays)}
          onOptionChange={(value) => {
            if (value === "7" || value === "30" || value === "90")
              setRangeDays(Number(value) as RangeDays);
          }}
        />
        <details data-ui="insights-layout-editor">
          <summary>{t("Muokkaa kortteja")}</summary>
          <p>
            {t("Järjestä kortit tai piilota ja palauta ne. Valinta tallentuu tähän selaimeen.")}
          </p>
          <ul>
            {order.visible.map((id, index) => (
              <li key={id}>
                <span>{t(INSIGHTS_CARD_LABELS[id])}</span>
                <button
                  type="button"
                  disabled={index === 0}
                  aria-label={tTemplate("Siirrä {{0}} ylöspäin", [t(INSIGHTS_CARD_LABELS[id])])}
                  onClick={() => {
                    updateOrder(moveInsightsCard(order, id, -1));
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === order.visible.length - 1}
                  aria-label={tTemplate("Siirrä {{0}} alaspäin", [t(INSIGHTS_CARD_LABELS[id])])}
                  onClick={() => {
                    updateOrder(moveInsightsCard(order, id, 1));
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    updateOrder(hideInsightsCard(order, id));
                  }}
                >
                  {t("Piilota")}
                </button>
              </li>
            ))}
            {order.hidden.map((id) => (
              <li key={id}>
                <span>{t(INSIGHTS_CARD_LABELS[id])}</span>
                <button
                  type="button"
                  onClick={() => {
                    updateOrder(showInsightsCard(order, id));
                  }}
                >
                  {t("Palauta")}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              updateOrder(defaultInsightsCardOrder());
            }}
          >
            {t("Palauta oletusjärjestys")}
          </button>
        </details>
      </section>

      {loadError !== null || metricResult.error !== null ? (
        <Alert
          tone="danger"
          title={t("Insights-tietoja ei voitu lukea")}
          action={
            <button type="button" onClick={() => void refresh()}>
              {t("Yritä uudelleen")}
            </button>
          }
        >
          {loadError ?? metricResult.error}
        </Alert>
      ) : null}

      <div data-ui="insights-grid" aria-busy={loading}>
        {visibleCardIds.map((id) => {
          const card = metrics?.cards[id];
          const activeSeries = selectSeries(card?.series ?? [], selectedSeries[id]);
          const cardLoading = loading && snapshot === null;
          return (
            <Card
              key={id}
              id={
                id === "goals" && momentumShortcutRequest > 0
                  ? "insights-momentum-shortcut"
                  : undefined
              }
              tabIndex={id === "goals" && momentumShortcutRequest > 0 ? -1 : undefined}
              heading={t(INSIGHTS_CARD_LABELS[id])}
              data-card-id={id}
            >
              {id === "comparison" ? (
                <>
                  {cardLoading ? (
                    <p aria-live="polite">{t("Ladataan vertailua…")}</p>
                  ) : correlationOptions.length < 2 ? (
                    <EmptyState
                      title={t("Vertailuun tarvitaan kaksi mittaria")}
                      hint={t(
                        "Tee kirjauksia vähintään kahdesta mittarista, niin voit tarkastella niiden päiväkohtaista yhteisvaihtelua.",
                      )}
                    />
                  ) : (
                    <>
                      <div data-ui="insights-selectors">
                        <label>
                          {t("Ensimmäinen mittari")}
                          <select
                            value={firstSeries?.key ?? ""}
                            onChange={(event) => {
                              updateComparison(0, event.currentTarget.value);
                            }}
                          >
                            {correlationOptions.map((item) => (
                              <option key={item.key} value={item.key}>
                                {t(item.label)} ({item.unit})
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          {t("Toinen mittari")}
                          <select
                            value={secondSeries?.key ?? ""}
                            onChange={(event) => {
                              updateComparison(1, event.currentTarget.value);
                            }}
                          >
                            {secondCandidates.map((item) => (
                              <option key={item.key} value={item.key}>
                                {t(item.label)} ({item.unit})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      {correlation === null ||
                      firstSeries === undefined ||
                      secondSeries === undefined ? (
                        <EmptyState title={t("Vertailua ei voitu muodostaa")} />
                      ) : (
                        <>
                          <div data-ui="insights-correlation-result">
                            <StatChip
                              value={
                                correlation.pearsonR === null
                                  ? "—"
                                  : numberLabel(correlation.pearsonR, 2)
                              }
                              valueLabel={tTemplate("Pearsonin korrelaatio: {{0}}", [
                                correlation.pearsonR === null
                                  ? t("ei laskettavissa")
                                  : numberLabel(correlation.pearsonR, 2),
                              ])}
                              label={t("Pearson r")}
                            />
                            <StatChip
                              value={String(correlation.pairedDayCount)}
                              valueLabel={tTemplate("{{0}} yhteistä päivää", [
                                String(correlation.pairedDayCount),
                              ])}
                              label={t("Yhteisiä päiviä")}
                            />
                          </div>
                          <p data-ui="insights-correlation-note">
                            {correlation.status === "computed"
                              ? t(
                                  "Kuvaileva yhteisvaihtelu valituilta päiviltä. Tulos ei osoita syy-seurausta.",
                                )
                              : correlation.status === "constant-series"
                                ? t(
                                    "Yhteisiä päiviä on, mutta vähintään yksi sarja ei vaihtele valitulla jaksolla.",
                                  )
                                : tTemplate(
                                    "Kertoimen laskemiseen tarvitaan vähintään kolme yhteistä päivää. Nyt niitä on {{0}}.",
                                    [String(correlation.pairedDayCount)],
                                  )}
                          </p>
                          <CorrelationPlot
                            first={firstSeries}
                            second={secondSeries}
                            result={correlation}
                          />
                        </>
                      )}
                    </>
                  )}
                </>
              ) : cardLoading ? (
                <p aria-live="polite">{t("Ladataan mittareita…")}</p>
              ) : card === undefined ? (
                <EmptyState title={t("Mittareita ei voitu laskea")} />
              ) : (
                <>
                  {card.series.length > 1 ? (
                    <label data-ui="insights-series-select">
                      {t("Näytettävä mittari")}
                      <select
                        value={activeSeries?.key ?? ""}
                        onChange={(event) => {
                          setSelectedSeries((current) => ({
                            ...current,
                            [id]: event.currentTarget.value,
                          }));
                        }}
                      >
                        {card.series.map((item) => (
                          <option key={item.key} value={item.key}>
                            {t(item.label)} ({item.unit})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <div data-ui="insights-stat-grid">
                    {card.summary.map((item) => (
                      <StatChip
                        key={item.label}
                        value={item.value}
                        valueLabel={t(item.valueLabel)}
                        label={t(item.label)}
                      />
                    ))}
                  </div>
                  <MetricChart series={activeSeries} />
                  {card.note !== undefined ? (
                    <p data-ui="insights-card-note">{t(card.note)}</p>
                  ) : null}
                </>
              )}
            </Card>
          );
        })}
      </div>

      {order.hidden.length === INSIGHTS_CARD_IDS.length ? (
        <EmptyState
          title={t("Kaikki Insights-kortit on piilotettu")}
          hint={t("Avaa Muokkaa kortteja ja palauta haluamasi kortit.")}
        />
      ) : null}
    </div>
  );
}
