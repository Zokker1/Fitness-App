// T122: viikkonäkymäkomposiitti (calendar query modelin päälle, §6).
// - Päiväkohtaiset timeboxit (blocksOnDay) viikon jokaiselle päivälle;
// - kiireellisyysjärjestys: myöhässä > tänään > tuleva (§8 fokus
//   seuraavaan askeleeseen, ei tulevaisuuden suunnittelua §7);
// - KAISTAT SKAALAUTUVAT: päällekkäisyysryhmät jaetaan T121 layoutilla,
//   kaistojen lukumäärä mukautuu ryhmän kokoon (layoutDayBlocks.lanes);
// - Keskittymismoodi: "piilota valmiit" ei poista päivän sisältöä — vain
//   optinen tiivistys (CSS display-none mobiililla), sisältö pysyy
//   ruudunlukijalla (aria-live-alue + kuukausilista alla) §31.
// - T123: kk-aggregaatio — kuukausiruudukon solut näyttävät päivän tiheyden
//   (count + "X timeboxia" -tekstilabeli, ei pelkkää väriä §31); tyhjät
//   solut tiivistyvät mobiililla samalla CSS:llä (§57.7).
// - Ruudukko: 7 päiväsaraketta avaruudessa → 1 sarake mobiilissa
//   (styles.css mediaquery, ei JS-haarautumista §57.7).
// - Ruudukko: 7 päiväsaraketta avaruudessa → 1 sarake mobiilissa
//   (styles.css mediaquery, ei JS-haarautumista §57.7).
// - Ruudukko päiväsoluilla: solut ovat react-router-Linkkejä päivään
//   (?view=week&date=<avain> — SPA-navigointi, muistidata säilyy (natiivi
//   <a> lataisi sivun uudelleen ja tyhjentäisi InMemoryStoren); näkymävalinta
//   säilyy URL:ssa, jotta käyttäjä palaa siihen mistä tuli (§27).
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useMemo } from "react";
import { Link } from "react-router";
import { Meta } from "@lifeos/ui";
import type { CalendarBlock } from "@lifeos/domain";
import type { CalendarModel } from "@lifeos/data";
import { addDaysIso, blocksOnDay, buildCalendarModel } from "@lifeos/data";

type Urgency = "overdue" | "today" | "future";

function urgencyOf(dateKey: string, todayKey: string): Urgency {
  if (dateKey === todayKey) {
    return "today";
  }
  return dateKey < todayKey ? "overdue" : "future";
}

const URGENCY_LABELS: Readonly<Record<Urgency, string>> = {
  overdue: "Myöhässä",
  today: "Tänään",
  future: "Tuleva",
};

const URGENCY_ORDER: Readonly<Record<Urgency, number>> = {
  overdue: 0,
  today: 1,
  future: 2,
};

function weekdayLabelFi(weekday: number): string {
  const labels = [
    "Maanantai",
    "Tiistai",
    "Keskiviikko",
    "Torstai",
    "Perjantai",
    "Lauantai",
    "Sunnuntai",
  ] as const;
  return t(labels[(weekday - 1 + 7) % 7] ?? "");
}

export interface WeekSummaryRow {
  readonly dateKey: string;
  readonly weekday: number;
  readonly urgency: Urgency;
  readonly blocks: readonly CalendarBlock[];
}

export function summarizeWeek(
  startLocalDate: string,
  todayKey: string,
  blocks: readonly CalendarBlock[],
  timezoneOffsetMinutes: number,
): {
  readonly rows: readonly WeekSummaryRow[];
  readonly blockCount: number;
} {
  const rows: WeekSummaryRow[] = [];
  let blockCount = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const dateKey = addDaysIso(startLocalDate, offset);
    const weekdayOf = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
    const weekday = weekdayOf === 0 ? 7 : weekdayOf;
    const dayBlocks = blocksOnDay(blocks, dateKey, timezoneOffsetMinutes);
    blockCount += dayBlocks.length;
    rows.push({
      dateKey,
      weekday,
      urgency: urgencyOf(dateKey, todayKey),
      blocks: dayBlocks,
    });
  }
  return { rows, blockCount };
}

function toStartMinutesLocal(startsAt: string, timezoneOffsetMinutes: number): number | null {
  const millis = Date.parse(startsAt);
  if (Number.isNaN(millis)) {
    return null;
  }
  const shifted = new Date(millis + timezoneOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

// T123: kk-aggregaatio — kuukausiruudukon solut näyttävät päivän tiheyden
// (count + "X timeboxia" -tekstilabeli, ei pelkkää väriä §31); tyhjät solut
// tiivistyvät mobiililla samalla CSS:llä (§57.7). Tiheys: 0 = rauhallinen,
// 1–2 = normaali, 3+ = kiireinen (määreet tekstinä, ei pelkkänä värinä).
// Tämä funktio laskee päiväkohtaiset tiheydet kuukausimallin avaimista.
// T123: viikkosiirtymän malli — viikon alku T120-modelista (yksi lähde,
// ei kahta aritmetiikkaa).
export function getWeekStartKey(dateKey: string): string {
  return buildCalendarModel({ view: "week", localDate: dateKey }).startLocalDate;
}

// T123: kuukauden kiireisten päivien määrä (aggregaatio näyttää tiheyden
// otsikossa; "kiireinen" = 3+ timeboxia — pure, ei renderiä).

// T123: kuukauden kiireisten päivien määrä (aggregaatio näyttää tiheyden
// otsikossa; "kiireinen" = 3+ timeboxia — pure, ei renderiä).
export function monthBusyDaysOf(
  model: CalendarModel,
  blocks: readonly CalendarBlock[],
  timezoneOffsetMinutes: number,
): number {
  let busy = 0;
  for (const day of model.days) {
    if (!day.inMonth) {
      continue;
    }
    if (
      dayDensity(blocksOnDay(blocks, day.dateKey, timezoneOffsetMinutes).length) === "kiireinen"
    ) {
      busy += 1;
    }
  }
  return busy;
}

// T123: kk-aggregaation tiheysluokat — tekstilabelit (§31: ei pelkkää väriä).
export type DayDensity = "rauhallinen" | "normaali" | "kiireinen";

export function dayDensity(count: number): DayDensity {
  if (count <= 0) {
    return "rauhallinen";
  }
  if (count <= 2) {
    return "normaali";
  }
  return "kiireinen";
}

// T123: kuukausiruudukko T120-mallista — 7 saraketta avaruudessa, 1 sarake
// mobiililla (sama CSS-periaate kuin viikkoruudukossa §57.7). Solu linkittää
// päivään (?view=day&date=<avain> — näkymä pysyy URL:ssa mistä §27 tulee).
export function MonthGrid({
  model,
  todayKey,
  blocks,
  timezoneOffsetMinutes,
}: {
  readonly model: CalendarModel;
  readonly todayKey: string;
  readonly blocks: readonly CalendarBlock[];
  readonly timezoneOffsetMinutes: number;
}): React.JSX.Element {
  const counts = new Map<string, number>();
  for (const day of model.days) {
    if (!day.inMonth) {
      continue;
    }
    counts.set(day.dateKey, blocksOnDay(blocks, day.dateKey, timezoneOffsetMinutes).length);
  }
  const busyDays = [...counts.values()].filter((count) => dayDensity(count) === "kiireinen").length;
  return (
    <div>
      <div
        className="calendar-week-grid"
        data-ui="calendar-week-grid"
        data-testid="calendar-month-grid"
        role="list"
        aria-label={tTemplate("Kuukausiruudukko: {{0}} päiväsolua, {{1}} kiireistä päivää", [
          String(model.days.length),
          String(busyDays),
        ])}
      >
        {model.days.map((day) => {
          const count = day.inMonth ? (counts.get(day.dateKey) ?? 0) : 0;
          const density = dayDensity(count);
          const params = new URLSearchParams();
          params.set("date", day.dateKey);
          return (
            <Link
              key={day.dateKey}
              to={`/calendar?${params.toString()}`}
              data-ui="calendar-month-day"
              data-empty={count === 0 ? "true" : undefined}
              aria-current={day.dateKey === todayKey ? "date" : undefined}
              aria-label={tTemplate("{{0}} {{1}}: {{2}}, {{3}} timeboxia", [
                t(weekdayLabelFi(day.weekday)),
                day.dateKey,
                t(density),
                String(count),
              ])}
            >
              <strong>{day.dateKey.slice(8, 10)}</strong>
              <span>
                {t(density)} — {String(count)} {t("timeboxia")}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// T123: kuukauden nimilabeli (fi-FI, UTC-avain → ei vyöhykeheittoja).
export function monthNameFi(model: CalendarModel): string {
  const start = model.startLocalDate;
  return new Intl.DateTimeFormat(getIntlLocale(), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${start.slice(0, 8)}01T00:00:00Z`));
}

// T123: viikkosiirtymän malli — viikon alku T120-modelista (yksi lähde,
// ei kahta aritmetiikkaa).
export function summarizeWeekBlocks(
  days: readonly WeekSummaryRow[],
  timezoneOffsetMinutes: number,
  limit = 5,
): readonly { readonly title: string; readonly dayLabel: string; readonly startLabel: string }[] {
  const entries: {
    readonly urgency: Urgency;
    readonly sortKey: string;
    readonly title: string;
    readonly dayLabel: string;
    readonly startLabel: string;
  }[] = [];
  for (const day of days) {
    for (const block of day.blocks) {
      const start = toStartMinutesLocal(block.startsAt, timezoneOffsetMinutes);
      entries.push({
        urgency: day.urgency,
        sortKey: block.startsAt,
        title: block.title,
        dayLabel: `${weekdayLabelFi(day.weekday)} ${day.dateKey}`,
        startLabel:
          start === null
            ? "—"
            : `${String(Math.floor(start / 60)).padStart(2, "0")}.${String(start % 60).padStart(2, "0")}`,
      });
    }
  }
  // Deterministinen: kiireellisyys ensin, sitten aloitusaika, sitten otsikko.
  entries.sort((a, b) => {
    const urgencyDiff = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (urgencyDiff !== 0) {
      return urgencyDiff;
    }
    if (a.sortKey !== b.sortKey) {
      return a.sortKey < b.sortKey ? -1 : 1;
    }
    return a.title.localeCompare(b.title, getIntlLocale());
  });
  return entries.slice(0, limit);
}

export function WeekSummary({
  startLocalDate,
  todayKey,
  blocks,
  timezoneOffsetMinutes,
}: {
  readonly startLocalDate: string;
  readonly todayKey: string;
  readonly blocks: readonly CalendarBlock[];
  readonly timezoneOffsetMinutes: number;
}): React.JSX.Element {
  const summary = useMemo(
    () => summarizeWeek(startLocalDate, todayKey, blocks, timezoneOffsetMinutes),
    [startLocalDate, todayKey, blocks, timezoneOffsetMinutes],
  );
  if (summary.blockCount === 0) {
    return <Meta>{t("Viikossa ei timeboxeja.")}</Meta>;
  }
  return (
    <ul data-ui="card-log-list" data-testid="calendar-week-summary">
      {summary.rows.map((row) => (
        <li key={row.dateKey} data-ui="card-log-row">
          <div>
            <strong>
              {weekdayLabelFi(row.weekday)} {row.dateKey}
            </strong>
            <Meta>
              {t(URGENCY_LABELS[row.urgency])} — {String(row.blocks.length)} {t("timeboxia")}
            </Meta>
            {row.blocks.length > 0 ? (
              <ul data-ui="card-log-list">
                {row.blocks.map((block) => (
                  <li key={block.id} data-ui="card-log-row">
                    <div>
                      <strong>{block.title}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function WeekGrid({
  startLocalDate,
  todayKey,
  blocks,
  timezoneOffsetMinutes,
}: {
  readonly startLocalDate: string;
  readonly todayKey: string;
  readonly blocks: readonly CalendarBlock[];
  readonly timezoneOffsetMinutes: number;
}): React.JSX.Element {
  const summary = useMemo(
    () => summarizeWeek(startLocalDate, todayKey, blocks, timezoneOffsetMinutes),
    [startLocalDate, todayKey, blocks, timezoneOffsetMinutes],
  );
  return (
    <div
      className="calendar-week-grid"
      data-ui="calendar-week-grid"
      data-testid="calendar-week-grid"
      role="list"
      aria-label={t("Viikkoruudukko: 7 päiväsolua, jokainen linkki päivään")}
    >
      {summary.rows.map((row) => {
        const params = new URLSearchParams();
        params.set("view", "week");
        params.set("date", row.dateKey);
        // T122: vakaa Link — to päivittää vain query-parametrit saman
        // /calendar-reitin sisällä (SPA, ei täyttä sivunlatausta →
        // muistidata säilyy). key sisältää startLocalDaten JOTTA
        // react-router ei kierrätä väärää riviä (drill-down ei saa näyttää
        // vanhaa viikkoa).
        return (
          <Link
            key={`${startLocalDate}-${row.dateKey}`}
            to={`/calendar?${params.toString()}`}
            data-ui="calendar-week-day"
            data-empty={row.blocks.length === 0 ? "true" : undefined}
            aria-current={row.dateKey === todayKey ? "date" : undefined}
          >
            <strong>
              {weekdayLabelFi(row.weekday)} {row.dateKey}
            </strong>
            <span>
              {t(URGENCY_LABELS[row.urgency])} — {String(row.blocks.length)} {t("timeboxia")}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
