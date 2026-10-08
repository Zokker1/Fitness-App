// T102: Tänään-tehtävänäkymän ryhmittely (pure data-funktio, ei IO:ta).
// Kriteeri: "Due/scheduled/today-tehtävät ryhmitellään ymmärrettävästi".
// Ryhmät (§5 näkymät Tänään + Myöhässä yhdistettynä päivänäkemukseksi):
// - overdue: dueAt < tänään (status open) — vanhin ensin (dueAt nouseva);
// - dueToday: dueAt == tänään (status open) — prioriteetti high→low, sitten
//   dueAt aikajärjestyksessä (sama sääntö kuin T080-projektiossa);
// - scheduled: dueAt > tänään (status open) — läheisyysjärjestyksessä
//   (lähin ensin); ei sekoteta valmistuneita;
// - completedToday: completedAt paikallispäivänä — uusin ensin.
// Aikavyöhyke tulee kutsujalta (toLocalDateKey, sama sääntö kuin T080).
// Poistetut eivät näy missään ryhmässä.
import type { Task, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

const PRIORITY_ORDER: Readonly<Record<Task["priority"], number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

export interface TodayTaskGroups {
  readonly overdue: readonly Task[];
  readonly dueToday: readonly Task[];
  readonly scheduled: readonly Task[];
  readonly completedToday: readonly Task[];
}

export function groupTasksForToday(input: {
  readonly tasks: readonly Task[];
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly now: UtcTimestamp;
}): TodayTaskGroups {
  const alive = input.tasks.filter((task) => task.deletedAt === null);
  const localDateOf = (utc: UtcTimestamp): string =>
    toLocalDateKey(utc, input.timezoneOffsetMinutes);

  const overdue = alive
    .filter((task) => {
      if (task.status !== "open" || task.dueAt === null) {
        return false;
      }
      return localDateOf(task.dueAt) < input.localDate;
    })
    .sort((a, b) => (a.dueAt !== null && b.dueAt !== null && a.dueAt < b.dueAt ? -1 : 1));

  const dueToday = alive
    .filter((task) => {
      if (task.status !== "open" || task.dueAt === null) {
        return false;
      }
      return localDateOf(task.dueAt) === input.localDate;
    })
    .sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      if (a.dueAt !== null && b.dueAt !== null && a.dueAt !== b.dueAt) {
        return a.dueAt < b.dueAt ? -1 : 1;
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  const scheduled = alive
    .filter((task) => {
      if (task.status !== "open" || task.dueAt === null) {
        return false;
      }
      return localDateOf(task.dueAt) > input.localDate;
    })
    .sort((a, b) => (a.dueAt !== null && b.dueAt !== null && a.dueAt < b.dueAt ? -1 : 1));

  const completedToday = alive
    .filter(
      (task) =>
        task.status === "done" &&
        task.completedAt !== null &&
        localDateOf(task.completedAt) === input.localDate,
    )
    .sort((a, b) => ((a.completedAt ?? AT_FALLBACK) < (b.completedAt ?? AT_FALLBACK) ? 1 : -1));

  return { overdue, dueToday, scheduled, completedToday };
}

const AT_FALLBACK = "1970-01-01T00:00:00.000Z";
