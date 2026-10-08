import { t, tOptions, tTemplate, useLanguage } from "../../language.tsx";
import type { AppLanguage } from "../../language.tsx";
import { useMemo, useState } from "react";
import { buildCalendarModel } from "@lifeos/data";
import type { FocusSession } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { ChartFrame, StatChip } from "@lifeos/ui";

type Range = "day" | "week";

interface FocusDayPoint {
  readonly x: string;
  readonly y: number;
  readonly visualLabel: string;
  readonly longLabel: string;
}

const RANGE_OPTIONS = [
  { value: "day", label: "Päivä" },
  { value: "week", label: "Viikko" },
] as const;

const WEEKDAY_NAMES = [
  "Maanantai",
  "Tiistai",
  "Keskiviikko",
  "Torstai",
  "Perjantai",
  "Lauantai",
  "Sunnuntai",
] as const;

const WEEKDAY_SHORT_NAMES = ["ma", "ti", "ke", "to", "pe", "la", "su"] as const;

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(dateKey: string, weekday: number, language: AppLanguage): string {
  return tTemplate(
    "{{0}} {{1}}.",
    [t(WEEKDAY_NAMES[weekday - 1] ?? "Päivä", language), String(Number(dateKey.slice(8, 10)))],
    language,
  );
}

function roundedMinutes(seconds: number): number {
  return Math.round(seconds / 60);
}

export function FocusWeeklyStats({
  sessions,
}: {
  readonly sessions: readonly FocusSession[];
}): React.JSX.Element {
  const { language } = useLanguage();
  const [range, setRange] = useState<Range>("week");
  const summary = useMemo(() => {
    const todayKey = localDateKey(new Date());
    const week = buildCalendarModel({ view: "week", localDate: todayKey });
    const secondsByDay = new Map(week.days.map((day) => [day.dateKey, 0]));

    for (const session of sessions) {
      if (session.phase !== "completed" || session.startedAt === null) {
        continue;
      }
      const startedAtMillis = Date.parse(session.startedAt);
      const seconds = session.activeElapsedSeconds ?? session.durationSeconds;
      if (Number.isNaN(startedAtMillis) || seconds === null || !Number.isFinite(seconds)) {
        continue;
      }
      const localOffsetMinutes = -new Date(startedAtMillis).getTimezoneOffset();
      const dayKey = toLocalDateKey(session.startedAt, localOffsetMinutes);
      const currentSeconds = secondsByDay.get(dayKey);
      if (currentSeconds !== undefined) {
        secondsByDay.set(dayKey, currentSeconds + Math.max(0, Math.floor(seconds)));
      }
    }

    const weekPoints: FocusDayPoint[] = week.days.map((day) => {
      const weekdayIndex = day.weekday - 1;
      const weekdayShort = t(WEEKDAY_SHORT_NAMES[weekdayIndex] ?? "", language);
      const visualLabel = `${weekdayShort} ${day.dateKey.slice(8, 10)}`;
      return {
        x: dateLabel(day.dateKey, day.weekday, language),
        y: roundedMinutes(secondsByDay.get(day.dateKey) ?? 0),
        visualLabel,
        longLabel: dateLabel(day.dateKey, day.weekday, language),
      };
    });
    const weekSeconds = [...secondsByDay.values()].reduce((total, seconds) => total + seconds, 0);
    const todayDay = week.days.find((day) => day.isToday);
    const todayPoint: FocusDayPoint = {
      x: t("Tänään", language),
      y: roundedMinutes(secondsByDay.get(todayKey) ?? 0),
      visualLabel: t("Tänään", language),
      longLabel:
        todayDay === undefined
          ? tTemplate("Tänään {{0}}", [todayKey], language)
          : dateLabel(todayDay.dateKey, todayDay.weekday, language),
    };

    return {
      weekPoints,
      weekMinutes: roundedMinutes(weekSeconds),
      todayPoint,
      todayMinutes: todayPoint.y,
    };
  }, [sessions, language]);

  const points = range === "week" ? summary.weekPoints : [summary.todayPoint];
  const maximum = Math.max(0, ...points.map((point) => point.y));
  const chartSummary =
    range === "week"
      ? tTemplate(
          "Tällä viikolla {{0}} min. Vain valmiit istunnot lasketaan; päivä määräytyy istunnon aloitusajan mukaan.",
          [String(summary.weekMinutes)],
        )
      : tTemplate("Tänään {{0}} min. Viikon yhteensä {{1}} min.", [
          String(summary.todayMinutes),
          String(summary.weekMinutes),
        ]);

  return (
    <section data-ui="focus-weekly-stats" aria-label={t("Fokusminuutit")}>
      <StatChip
        value={`${String(summary.weekMinutes)} min`}
        valueLabel={tTemplate("{{0}} fokusminuuttia tällä viikolla", [String(summary.weekMinutes)])}
        label={t("Tällä viikolla")}
      />
      <ChartFrame
        title={t("Päivittäiset fokusminuutit")}
        unit="min"
        ranges={tOptions(RANGE_OPTIONS)}
        range={range}
        onRangeChange={(value) => {
          setRange(value === "day" ? "day" : "week");
        }}
        points={points}
        summary={chartSummary}
        emptyText={t("Ei fokusminuutteja vielä")}
      >
        <div
          data-ui="focus-weekly-bars"
          data-range={range}
          role="list"
          aria-label={
            range === "week"
              ? t("Viikon fokusminuutit päivittäin")
              : t("Tämän päivän fokusminuutit")
          }
        >
          {points.map((point) => {
            const barHeight =
              maximum === 0 || point.y === 0 ? 0 : Math.max(4, (point.y / maximum) * 100);
            return (
              <div
                key={point.x}
                data-ui="focus-weekly-day"
                role="listitem"
                aria-label={tTemplate("{{0}}: {{1}} minuuttia", [
                  t(point.longLabel),
                  String(point.y),
                ])}
              >
                <span data-ui="focus-weekly-value" aria-hidden="true">
                  {String(point.y)}
                </span>
                <div data-ui="focus-weekly-track" aria-hidden="true">
                  <span style={{ blockSize: `${String(barHeight)}%` }} />
                </div>
                <span data-ui="focus-weekly-label" aria-hidden="true">
                  {point.visualLabel}
                </span>
              </div>
            );
          })}
        </div>
      </ChartFrame>
    </section>
  );
}
