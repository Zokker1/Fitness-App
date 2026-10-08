// T110: recurring task -säännöt (pure data-funktio, ei IO:ta).
// Kriteeri: "Päivä/viikko/kuukausi/custom recurrence luo seuraavan
// instanssin deterministisesti."
// - Kaikki laskenta PAIKALLISESSA päiväavainavaruuudessa (kutsujan offset,
//   §50) — sama lähestymistapa kuin T103/T104/T109:ssä.
// - daily: from + everyDays päivää.
// - weekly: seuraava päivä > from, jonka viikonpäivä ∈ weekdays JA
//   epookiviikko (floor(päiviä_since_epoch / 7)) jaollinen everyWeeksilla —
//   deterministinen ilman tallennettua ankkuria.
// - monthly: seuraava kuukausi (+everyMonths), dayOfMonth clamppina
//   kuukauden pituuteen (31.1. → 28.2./29.2.); edetään kunnes kandidaatti >
//   from.
// - custom: every × unit (day/week/month) — month clamppaa kuten monthly
//   (kuukauden päivä from-päivästä).
// - Epävalidi sääntö (every < 1, tyhjä weekdays, päivä 0/32) → null.
import type { Task, TaskRecurrence } from "@lifeos/domain";
import { dueAtFromLocalParts, localDueParts } from "./due-time.ts";

const DAY_MS = 86_400_000;

function parseDateKeyUtc(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

export function addDaysIso(dateKey: string, days: number): string {
  return new Date(parseDateKeyUtc(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

/** ISO-viikonpäivä 1 = maanantai … 7 = sunnuntai. */
export function isoWeekday(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay() === 0
    ? 7
    : new Date(`${dateKey}T00:00:00Z`).getUTCDay();
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function epochWeekIndex(dateKey: string): number {
  return Math.floor(parseDateKeyUtc(dateKey) / (7 * DAY_MS));
}

/** Seuraava toistumisen paikallispäivä (> fromDateKey) tai null. */
export function nextRecurrenceDate(rule: TaskRecurrence, fromDateKey: string): string | null {
  if (fromDateKey.length !== 10 || Number.isNaN(parseDateKeyUtc(fromDateKey))) {
    return null;
  }
  if (rule.kind === "daily") {
    if (!Number.isInteger(rule.everyDays) || rule.everyDays < 1) {
      return null;
    }
    return addDaysIso(fromDateKey, rule.everyDays);
  }
  if (rule.kind === "weekly") {
    const weekdays = [...new Set(rule.weekdays)].sort((a, b) => a - b);
    if (
      !Number.isInteger(rule.everyWeeks) ||
      rule.everyWeeks < 1 ||
      weekdays.length === 0 ||
      weekdays.some((day) => day < 1 || day > 7)
    ) {
      return null;
    }
    // Haku rajattu: 7 pv * everyWeeks * 2 + 7 kattaa aina seuraavan osuman.
    const limit = 7 * rule.everyWeeks * 2 + 7;
    for (let step = 1; step <= limit; step += 1) {
      const candidate = addDaysIso(fromDateKey, step);
      if (
        weekdays.includes(isoWeekday(candidate)) &&
        Math.abs(epochWeekIndex(candidate)) % rule.everyWeeks === 0
      ) {
        return candidate;
      }
    }
    return null;
  }
  if (rule.kind === "monthly") {
    if (!Number.isInteger(rule.everyMonths) || rule.everyMonths < 1) {
      return null;
    }
    return nextMonthly(fromDateKey, rule.dayOfMonth, rule.everyMonths);
  }
  // custom — runtime-validointi (data voi tulla JSON:sta); levennetty
  // string välttää turhan tyyppitason poissulkemisen.
  const unit: string = rule.unit;
  if (!Number.isInteger(rule.every) || rule.every < 1) {
    return null;
  }
  if (unit !== "day" && unit !== "week" && unit !== "month") {
    return null;
  }
  if (unit === "day") {
    return addDaysIso(fromDateKey, rule.every);
  }
  if (unit === "week") {
    return addDaysIso(fromDateKey, 7 * rule.every);
  }
  // Jäljellä: month.
  return nextMonthly(fromDateKey, Number(fromDateKey.slice(8, 10)), rule.every);
}

function nextMonthly(fromDateKey: string, dayOfMonth: number, everyMonths: number): string | null {
  if (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
    return null;
  }
  const year = Number(fromDateKey.slice(0, 4));
  const monthIndex = Number(fromDateKey.slice(5, 7)) - 1;
  const from = parseDateKeyUtc(fromDateKey);
  // Nykyinen kuukausi ensin (jos päivä vielä edessä), sitten +everyMonths.
  // Enintään 1200 askelta (sadan vuoden turvaraja).
  for (let step = 0; step < 1200; step += 1) {
    const shifted = monthIndex + everyMonths * step;
    const candidateYear = year + Math.floor(shifted / 12);
    const candidateMonth = ((shifted % 12) + 12) % 12;
    const day = Math.min(dayOfMonth, daysInMonth(candidateYear, candidateMonth));
    const candidate = `${String(candidateYear).padStart(4, "0")}-${String(candidateMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (parseDateKeyUtc(candidate) > from) {
      return candidate;
    }
  }
  return null;
}

/** Onko tehtävässä toistuvuussääntö (vanha data ilman kenttää = ei). */
export function hasRecurrence(task: Task): task is Task & { readonly recurrence: TaskRecurrence } {
  return task.recurrence !== null && task.recurrence !== undefined;
}

/** Valmistuneen instanssin seuraavan instanssin dueAt (sama paikallinen klo).
    Ei deadlinea valmistuneessa → seuraavallaakaan ei (deterministinen). */
export function nextRecurrenceDueAt(
  rule: TaskRecurrence,
  previousDueAt: Task["dueAt"],
  timezoneOffsetMinutes: number,
): Task["dueAt"] {
  if (previousDueAt === null) {
    return null;
  }
  const parts = localDueParts(previousDueAt, timezoneOffsetMinutes);
  if (parts === null) {
    return null;
  }
  const nextDateKey = nextRecurrenceDate(rule, parts.dateKey);
  if (nextDateKey === null) {
    return null;
  }
  return dueAtFromLocalParts(nextDateKey, parts.time, timezoneOffsetMinutes);
}
