// T131: ajastamattomien tehtävien valinta (pure data-funktio, ei IO:ta).
// Kriteeri: "Ajastamattomat tehtävät voidaan vetää kalenteriin." (§6:
// "tehtävä voidaan vetää ajalle").
// - Ajastamaton = avoin, elävä tehtävä johon ei viittaa yksikään elävä
//   kalenteriblokki (linkedTaskId) — tehtävän data pysyy tasks-repossa,
//   blockkiin ei kopioida mitään (T125-kaava, ei duplikaattia §6).
// - Poistetut (tombstone) ja valmistuneet eivät näy; poistetun blockin
//   linkki ei pidä tehtävää ajastettuna (historia säilyy, §6).
// - Järjestys: prioriteetti high→low, sitten createdAt (sama sääntö kuin
//   T103 upcoming saman päivän sisällä — deterministinen, ei arvailua).
// - Aikavyöhykettä ei tarvita (vain id-vertailu, ei päiväavaimia §50).
import type { CalendarBlock, Task } from "@lifeos/domain";

const PRIORITY_ORDER: Readonly<Record<Task["priority"], number>> = {
  high: 0,
  normal: 1,
  low: 2,
};

/** Avoimet tehtävät joilla ei ole elävää kalenteriblokkia. */
export function selectUnscheduledTasks(input: {
  readonly tasks: readonly Task[];
  readonly blocks: readonly CalendarBlock[];
}): readonly Task[] {
  const linkedTaskIds = new Set<string>();
  for (const block of input.blocks) {
    if (block.deletedAt !== null) {
      continue;
    }
    if (block.linkedTaskId !== null) {
      linkedTaskIds.add(block.linkedTaskId);
    }
  }
  return input.tasks
    .filter(
      (task) => task.deletedAt === null && task.status === "open" && !linkedTaskIds.has(task.id),
    )
    .sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      if (a.createdAt === b.createdAt) {
        return 0;
      }
      return a.createdAt < b.createdAt ? -1 : 1;
    });
}
