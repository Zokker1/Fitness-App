// T104: päivä/viikko/kuukausi-listat (pure data-funktio, ei IO:ta).
// Kriteeri: "Tehtäviä voi tarkastella valitulla ajanjaksolla." (§5 Päivä/
// Viikko/Kuukausi -näkymät)
// - Jakso lasketaan kutsujan paikallispäivästä (localDate) ja offsetista;
//   viikko alkaa maanantaista (Suomi/ISO), kuukausi kalenterikuukauden 1:stä.
// - dueInPeriod: avoimet tehtävät joiden dueAt paikallispäivänä jakson sisällä
//   (järjestys: dueAt nouseva → prioriteetti high→low → createdAt).
// - completedInPeriod: valmistuneet joiden completedAt paikallispäivänä jakson
//   sisällä (uusin ensin) — rehellinen historia, ei arvioitua progressia (§51).
// - YKSIKÄÄN done-rivi ei päädy dueInPeriodiin, tombstonet eivät näy missään.
// - Epävalidi dueAt (NaN) käsitellään kuin "ei deadlinea" → ei jakso-listassa.
import type { Task } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

export type TaskPeriodKey = "paiva" | "viikko" | "kuukausi";

const PRIORITY_ORDER: Readonly<Record<Task["priority"], number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

const DAY_MS = 86_400_000;

function parseDateKeyUtc(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00Z`);
}

function addDays(dateKey: string, days: number): string {
  return new Date(parseDateKeyUtc(dateKey) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = maanantai … 6 = sunnuntai (UTC-päiväavaimesta, ei paikallisesta kellosta). */
function daysSinceMonday(dateKey: string): number {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return (weekday + 6) % 7;
}

/** Jakson paikallispäivärajat (sisällyttävästi) valitulle ajanjaksolle. */
export function taskPeriodRange(
  period: TaskPeriodKey,
  localDate: string,
): { readonly startLocalDate: string; readonly endLocalDate: string } {
  if (period === "paiva") {
    return { startLocalDate: localDate, endLocalDate: localDate };
  }
  if (period === "viikko") {
    const startLocalDate = addDays(localDate, -daysSinceMonday(localDate));
    return { startLocalDate, endLocalDate: addDays(startLocalDate, 6) };
  }
  const year = Number(localDate.slice(0, 4));
  const monthIndex = Number(localDate.slice(5, 7)) - 1;
  const endLocalDate = new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10);
  return { startLocalDate: localDate.slice(0, 8) + "01", endLocalDate };
}

export interface TaskPeriodGroups {
  readonly period: TaskPeriodKey;
  readonly startLocalDate: string;
  readonly endLocalDate: string;
  /** Avoimet tehtävät jaksolla (dueAt paikallispäivänä sisällä). */
  readonly dueInPeriod: readonly Task[];
  /** Valmistuneet jaksolla (completedAt paikallispäivänä sisällä), uusin ensin. */
  readonly completedInPeriod: readonly Task[];
}

export function groupTasksInPeriod(input: {
  readonly tasks: readonly Task[];
  readonly period: TaskPeriodKey;
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
}): TaskPeriodGroups {
  const { startLocalDate, endLocalDate } = taskPeriodRange(input.period, input.localDate);
  const alive = input.tasks.filter((task) => task.deletedAt === null);
  const localDateOf = (utc: Task["dueAt"]): string | null => {
    if (utc === null || Number.isNaN(Date.parse(utc))) {
      return null;
    }
    return toLocalDateKey(utc, input.timezoneOffsetMinutes);
  };
  const inRange = (key: string | null): boolean =>
    key !== null && key >= startLocalDate && key <= endLocalDate;

  const dueInPeriod = alive
    .filter((task) => task.status === "open" && inRange(localDateOf(task.dueAt)))
    .sort((a, b) => {
      if (a.dueAt !== null && b.dueAt !== null && a.dueAt !== b.dueAt) {
        return a.dueAt < b.dueAt ? -1 : 1;
      }
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      if (a.createdAt === b.createdAt) {
        return 0;
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  const completedInPeriod = alive
    .filter((task) => task.status === "done" && inRange(localDateOf(task.completedAt)))
    .sort((a, b) => {
      const aAt = a.completedAt ?? "";
      const bAt = b.completedAt ?? "";
      if (aAt === bAt) {
        return 0;
      }
      return aAt < bAt ? 1 : -1;
    });

  return { period: input.period, startLocalDate, endLocalDate, dueInPeriod, completedInPeriod };
}
