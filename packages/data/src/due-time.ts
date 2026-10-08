// T109: deadline ja due time -apurit (pure data-funktio, ei IO:ta).
// Kriteeri: "Aikavyöhyke, locale ja overdue-laskenta ovat oikein." (§5, §50)
// - Tallennus UTC:nä (UtcTimestamp); paikallispäivä/kellonaika johdetaan
//   KUTSUJAN offsetilla (ei selaimen kellolta arvausta §50).
// - dueAtFromLocalParts: paikallinen päivä+klo → UTC-hetki (UTC = local −
//   offset). Paluuviite: localDueParts.
// - isOverdue: dueAtin PAIKALLISPÄIVÄ < kutsujan paikallispäivä — sama sääntö
//   kuin T103/T104/T105-ryhmittelyssä; epävalidi dueAt → ei myöhässä
//   ("ei deadlinea", ei arvailua).
// - formatDueDateTime: fi-FI "23.9. klo 14.30" (UTC-vyöhykkeellä siirretyn
//   hetken osista — ei paikallisen kellon riskejä).
import type { Task, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

/** Paikallinen päivä "YYYY-MM-DD" + kellonaika "HH:MM" → UTC-hetki. */
export function dueAtFromLocalParts(
  dateKey: string,
  time: string,
  timezoneOffsetMinutes: number,
): UtcTimestamp | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (dateMatch === null || timeMatch === null) {
    return null;
  }
  const year = Number(dateMatch[1]);
  const monthIndex = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  const utcMillis =
    Date.UTC(year, monthIndex, day, hours, minutes) - timezoneOffsetMinutes * 60_000;
  if (Number.isNaN(utcMillis)) {
    return null;
  }
  return new Date(utcMillis).toISOString();
}

/** UTC-hetki → paikalliset osat (päiväavain + "HH:MM"). Epävalidi → null. */
export function localDueParts(
  dueAt: UtcTimestamp,
  timezoneOffsetMinutes: number,
): { readonly dateKey: string; readonly time: string } | null {
  const millis = Date.parse(dueAt);
  if (Number.isNaN(millis)) {
    return null;
  }
  const shifted = new Date(millis + timezoneOffsetMinutes * 60_000);
  const dateKey = shifted.toISOString().slice(0, 10);
  const time = shifted.toISOString().slice(11, 16);
  return { dateKey, time };
}

/** Myöhässä: paikallispäivä tiukasti ennen kutsujan paikallispäivää. */
export function isOverdue(
  dueAt: Task["dueAt"],
  localDate: string,
  timezoneOffsetMinutes: number,
): boolean {
  if (dueAt === null || Number.isNaN(Date.parse(dueAt))) {
    return false;
  }
  return toLocalDateKey(dueAt, timezoneOffsetMinutes) < localDate;
}

/** fi-FI-muotoilu UTC-siirretyn hetken osista: "23.9. klo 14.30". */
export function formatDueDateTime(
  dueAt: UtcTimestamp,
  timezoneOffsetMinutes: number,
): string | null {
  const millis = Date.parse(dueAt);
  if (Number.isNaN(millis)) {
    return null;
  }
  const shifted = new Date(millis + timezoneOffsetMinutes * 60_000);
  const datePart = new Intl.DateTimeFormat("fi-FI", {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(shifted);
  const timePart = new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(shifted);
  return `${datePart} klo ${timePart}`;
}
