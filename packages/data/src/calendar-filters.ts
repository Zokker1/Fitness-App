// T136: kalenterin johdetut suodattimet (projektit/tagit/rutiinit).
// Suodatus ei muuta repository-dataa eikä kopioi linkityksiä blockkeihin:
// projektit ja tagit ratkaistaan linkitetyn tehtävän kautta, rutiinit suoraan
// linkedRoutineId:stä. Tyhjä suodatin palauttaa kaikki blockit, myös
// linkittämättömät tapahtumat.
import type { CalendarBlock, Task } from "@lifeos/domain";

export interface CalendarBlockFilters {
  readonly projectId?: string | null;
  readonly tagId?: string | null;
  readonly routineId?: string | null;
}

function selected(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && value !== "";
}

/** Onko vähintään yksi kalenterisuodatin päällä? */
export function hasCalendarBlockFilters(filters: CalendarBlockFilters): boolean {
  return selected(filters.projectId) || selected(filters.tagId) || selected(filters.routineId);
}

/**
 * Palauttaa näkyvät calendar blockit alkuperäisessä järjestyksessä.
 *
 * Projektisuodatin ja tagisuodatin kohdistuvat vain tehtävälinkitettyihin
 * blockkeihin. Rutiinisuodatin kohdistuu vain rutiinilinkitettyihin
 * blockkeihin. Useampi valinta on AND-rajaus. Ilman valintoja palautetaan
 * sama block-olioiden lista suodatettuna vain kopiona, joten kutsuja ei voi
 * vahingossa muuttaa alkuperäistä dataa.
 */
export function filterCalendarBlocks(input: {
  readonly blocks: readonly CalendarBlock[];
  readonly tasks: readonly Task[];
  readonly filters?: CalendarBlockFilters;
}): readonly CalendarBlock[] {
  const filters = input.filters ?? {};
  const projectId = selected(filters.projectId) ? filters.projectId : null;
  const tagId = selected(filters.tagId) ? filters.tagId : null;
  const routineId = selected(filters.routineId) ? filters.routineId : null;

  if (projectId === null && tagId === null && routineId === null) {
    return [...input.blocks];
  }

  const taskById = new Map(input.tasks.map((task) => [task.id, task] as const));
  return input.blocks.filter((block) => {
    if (routineId !== null && block.linkedRoutineId !== routineId) {
      return false;
    }

    if (projectId === null && tagId === null) {
      return true;
    }

    if (block.linkedTaskId === null) {
      return false;
    }
    const linkedTask = taskById.get(block.linkedTaskId);
    if (linkedTask === undefined) {
      return false;
    }
    if (projectId !== null && linkedTask.projectId !== projectId) {
      return false;
    }
    if (tagId !== null && !linkedTask.tagIds.includes(tagId)) {
      return false;
    }
    return true;
  });
}
