// T120: calendar query model (pure data-funktio, ei IO:taa).
// Kriteeri: "Päivä/viikko/kuukausi-data johdetaan yhdestä aikamallista."
// (§6, §27, §50)
// - YKSI lähde: paikallispäiväavaimet (YYYY-MM-DD) kutsujan maailmasta —
//   sama konventio kuin T103/T104/T109 (offset kutsujalta, ei kelloarvauksia).
// - day: yksittäinen päivä; week: maanantaista sunnuntaiin (ISO, Suomi);
//   month: kokonaisia viikkoruutuja (7 päivän rivejä), täydennys naapuri-
//   kuukausista (inMonth=false) — kalenterinäkymän ruudukko valmiina.
// - weekday: 1 = maanantai … 7 = sunnuntai (ISO; sama kuin T110).
// - isToday: dateKey === kutsujan paikallispäivä (näkymä ei "rastita"
//   tulevaisuutta §7 — tänään on aina eksplisiittinen syöte).
// - Epävalidi localDate → heittää (ohjelmointivirhe, ei data-virhe).
import { addDaysIso, isoWeekday } from "./recurrence.ts";

export type CalendarViewKind = "day" | "week" | "month";

export interface CalendarDay {
  readonly dateKey: string;
  /** 1 = maanantai … 7 = sunnuntai. */
  readonly weekday: number;
  /** false = täyttöpäivä naapurikuukaudesta (vain month-näkymässä). */
  readonly inMonth: boolean;
  readonly isToday: boolean;
}

export interface CalendarModel {
  readonly view: CalendarViewKind;
  readonly startLocalDate: string;
  readonly endLocalDate: string;
  /** day: 1 päivä; week: 7; month: 28–42 (kokonaisia viikkorivejä). */
  readonly days: readonly CalendarDay[];
}

function parseDateKeyUtc(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function isValidDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return false;
  }
  return !Number.isNaN(parseDateKeyUtc(dateKey));
}

function buildDay(dateKey: string, localDate: string, inMonth: boolean): CalendarDay {
  return {
    dateKey,
    weekday: isoWeekday(dateKey),
    inMonth,
    isToday: dateKey === localDate,
  };
}

function daysInRange(
  startLocalDate: string,
  endLocalDate: string,
  localDate: string,
  monthPrefix: string | null,
): readonly CalendarDay[] {
  const days: CalendarDay[] = [];
  let cursor = startLocalDate;
  let guard = 0;
  while (cursor <= endLocalDate && guard < 500) {
    days.push(buildDay(cursor, localDate, monthPrefix === null || cursor.startsWith(monthPrefix)));
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }
  return days;
}

export function buildCalendarModel(input: {
  readonly view: CalendarViewKind;
  /** Kutsujan paikallispäivä (mallin ankkuri + "tänään"-merkintä). */
  readonly localDate: string;
}): CalendarModel {
  if (!isValidDateKey(input.localDate)) {
    throw new Error(`calendar-model.bad-local-date: ${input.localDate}`);
  }
  if (input.view === "day") {
    return {
      view: "day",
      startLocalDate: input.localDate,
      endLocalDate: input.localDate,
      days: [buildDay(input.localDate, input.localDate, true)],
    };
  }
  if (input.view === "week") {
    // Maanantai alphaviikon alku: näkyviin täsmälleen 7 päivää.
    const daysSinceMonday = isoWeekday(input.localDate) - 1;
    const startLocalDate = addDaysIso(input.localDate, -daysSinceMonday);
    const endLocalDate = addDaysIso(startLocalDate, 6);
    return {
      view: "week",
      startLocalDate,
      endLocalDate,
      days: daysInRange(startLocalDate, endLocalDate, input.localDate, null),
    };
  }
  // month: ruudukko kokonaisin viikkorivein; täyttö naapurikuukausista.
  const year = Number(input.localDate.slice(0, 4));
  const monthIndex = Number(input.localDate.slice(5, 7)) - 1;
  const monthPrefix = `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}`;
  const firstOfMonth = `${monthPrefix}-01`;
  const lastOfMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  const startLocalDate = addDaysIso(firstOfMonth, -(isoWeekday(firstOfMonth) - 1));
  const endLocalDate = (() => {
    const lastWeekdaysFromMonday = isoWeekday(lastOfMonth) - 1;
    return addDaysIso(lastOfMonth, 6 - lastWeekdaysFromMonday);
  })();
  return {
    view: "month",
    startLocalDate,
    endLocalDate,
    days: daysInRange(startLocalDate, endLocalDate, input.localDate, monthPrefix),
  };
}
