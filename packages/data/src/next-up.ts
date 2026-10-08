// T082: "Mitä seuraavaksi?" -valinta (pure data-funktio, ei IO:ta).
// Kriteeri: priorisoitu seuraava toiminto on SELITETTÄVÄ eikä peitä
// käyttäjän omia valintoja. Siksi tulos sisältää aina perustelun (syy suomeksi)
// eikä auto-suorita mitään — kortti vain linkkaa kohteeseen.
// Järjestys (deterministinen, ei ML:ää, ei kelloa piilossa):
//  1. myöhässä oleva tehtävä (vanhin dueAt ensin, sitten prioriteetti);
//  2. seuraava alkanut timebox tänään (calendarBlock, kind!=event);
//  3. tänään erääntyvä tehtävä (prioriteetti, sitten dueAt);
//  4. seuraava tuleva timebox (kind!=event);
//  5. avoimet tehtävät ilman deadlinea (prioriteetti) — vain jos vaihtoehtoja
//     on VÄHEMMÄN kuin maxOpenOptions (ei koskaan loputonta listaa).
// Tyhjä candidate-joukko → null (UI näyttää tyhjätilan, ei keksittyä).
import type { CalendarBlock, Task, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

export type NextUpKind = "overdue-task" | "timebox-now" | "due-task" | "timebox-next" | "open-task";

export interface NextUpItem {
  readonly kind: NextUpKind;
  /** Selitys käyttäjälle (miksi juuri tämä ensin). */
  readonly reason: string;
  readonly taskId?: string | undefined;
  readonly timeboxId?: string | undefined;
}

export interface NextUpInput {
  readonly now: UtcTimestamp;
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly tasks: readonly Task[];
  readonly timeboxes: readonly CalendarBlock[];
}

const PRIORITY_ORDER: Readonly<Record<string, number>> = { high: 0, normal: 1, low: 2 };

function isAlive(deletedAt: UtcTimestamp | null): boolean {
  return deletedAt === null;
}

function compareTasks(a: Task, b: Task): number {
  const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
  if (priorityDiff !== 0) {
    return priorityDiff;
  }
  if (a.dueAt !== null && b.dueAt !== null) {
    return a.dueAt < b.dueAt ? -1 : a.dueAt > b.dueAt ? 1 : 0;
  }
  return a.createdAt < b.createdAt ? -1 : 1;
}

export function selectNextUp(input: NextUpInput): NextUpItem | null {
  const open = input.tasks.filter((task) => isAlive(task.deletedAt) && task.status === "open");
  const dueDateOf = (task: Task): string | null =>
    task.dueAt === null ? null : toLocalDateKey(task.dueAt, input.timezoneOffsetMinutes);
  const overdue = open
    .filter((task) => {
      const due = dueDateOf(task);
      return due !== null && due < input.localDate;
    })
    .sort((a, b) => {
      // Vanhin myöhässä ensin (dueAt), sitten prioriteetti.
      if (a.dueAt !== null && b.dueAt !== null && a.dueAt !== b.dueAt) {
        return a.dueAt < b.dueAt ? -1 : 1;
      }
      return compareTasks(a, b);
    });
  if (overdue.length > 0 && overdue[0] !== undefined) {
    const first = overdue[0];
    const extra = overdue.length - 1;
    return {
      kind: "overdue-task",
      reason:
        extra > 0
          ? `Myöhässä ${String(overdue.length)} tehtävää — alinna vanhin.`
          : "Myöhässä oleva tehtävä ensin.",
      taskId: first.id,
    };
  }

  const actionable = input.timeboxes.filter(
    (block) => isAlive(block.deletedAt) && block.kind !== "event",
  );
  const started = actionable
    .filter((block) => block.startsAt <= input.now && block.endsAt >= input.now)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  if (started.length > 0 && started[0] !== undefined) {
    return {
      kind: "timebox-now",
      reason: "Käynnissä oleva timebox jatkuu nyt.",
      timeboxId: started[0].id,
    };
  }

  const dueToday = open.filter((task) => dueDateOf(task) === input.localDate).sort(compareTasks);
  if (dueToday.length > 0 && dueToday[0] !== undefined) {
    const first = dueToday[0];
    const extra = dueToday.length - 1;
    return {
      kind: "due-task",
      reason:
        extra > 0
          ? `Tänään ${String(dueToday.length)} tehtävää — tärkein ensin.`
          : "Tänään erääntyvä tehtävä.",
      taskId: first.id,
    };
  }

  const upcoming = actionable
    .filter((block) => block.startsAt > input.now)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  if (upcoming.length > 0 && upcoming[0] !== undefined) {
    return {
      kind: "timebox-next",
      reason: "Seuraava aikataulutettu tekeminen.",
      timeboxId: upcoming[0].id,
    };
  }

  const openNoDue = open.filter((task) => task.dueAt === null).sort(compareTasks);
  if (openNoDue.length > 0 && openNoDue[0] !== undefined) {
    return {
      kind: "open-task",
      reason: "Ei aikataulutettua — vapaa valinta avoinna olevista.",
      taskId: openNoDue[0].id,
    };
  }
  return null;
}
