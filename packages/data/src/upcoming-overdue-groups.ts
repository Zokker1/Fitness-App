// T103: Seuraavat/Myöhässä-ryhmittely (pure data-funktio, ei IO:ta).
// Kriteeri: "Upcoming ja overdue eivät sekoita valmistuneita tehtäviä."
// Ryhmät (kaikki status open, paikallispäivällä kutsujan vyöhykkeellä):
// - overdue: dueAt < tänään, vanhin eräpäivä ensin (näytä kiireellisin ensin);
// - upcoming: dueAt >= tänään (= tänään + tulevat yhdessä), SAMAN PÄIVÄN
//   sisällä prioriteetti high→low, sitten dueAt; eri päivät läheisyydessä
//   (lähin ensin); dueAt null viimeisenä prioriteetilla (ei deadlinea, ei
//   arvailua kiireestä).
// YKSIKÄÄN done-rivi ei päädy kumpaankaan ryhmään (status-suodatus).
// Poistetut (tombstone) eivät näy missään.
import type { Task } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

const PRIORITY_ORDER: Readonly<Record<Task["priority"], number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

export interface UpcomingOverdueGroups {
  readonly overdue: readonly Task[];
  readonly upcoming: readonly Task[];
}

export function groupTasksUpcoming(input: {
  readonly tasks: readonly Task[];
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
}): UpcomingOverdueGroups {
  const alive = input.tasks.filter((task) => task.deletedAt === null);
  const open = alive.filter((task) => task.status === "open");
  const localDateOf = (dueAt: Task["dueAt"]): string | null => {
    if (dueAt === null || Number.isNaN(Date.parse(dueAt))) {
      return null;
    }
    return toLocalDateKey(dueAt, input.timezoneOffsetMinutes);
  };

  const overdue = open
    .filter((task) => {
      const due = localDateOf(task.dueAt);
      return due !== null && due < input.localDate;
    })
    .sort((a, b) => {
      if (a.dueAt !== null && b.dueAt !== null && a.dueAt !== b.dueAt) {
        return a.dueAt < b.dueAt ? -1 : 1;
      }
      if (a.createdAt === b.createdAt) {
        return 0;
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  const upcoming = open
    .filter((task) => {
      const due = localDateOf(task.dueAt);
      return due === null || due >= input.localDate;
    })
    .sort((a, b) => {
      const aDue = localDateOf(a.dueAt);
      const bDue = localDateOf(b.dueAt);
      if (aDue !== null && bDue !== null && aDue !== bDue) {
        return aDue < bDue ? -1 : 1;
      }
      if (aDue !== null && bDue === null) {
        return -1;
      }
      if (aDue === null && bDue !== null) {
        return 1;
      }
      // Sama päivä (tai ei kummallakaan): prioriteetti, sitten createdAt.
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      if (a.createdAt === b.createdAt) {
        return 0;
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });

  return { overdue, upcoming };
}
