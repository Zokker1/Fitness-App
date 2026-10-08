// T083: päivän tehtävien yhteenveto (pure data-funktio, ei IO:ta).
// Kriteeri: task-progress ja tärkeimmät tehtävät näkyvät ja päivittyvät
// aidosta datasta. Tämä laskee mitä näytetään; kortti renderöi.
// - visible: ensin myöhässä (vanhin dueAt ensin), sitten tänään erääntyvät
//   (T080-järjestyksessä), katkaistu maxVisibleen — loput laskurissa.
// - progress: valmiit / (valmiit + avoimet) päivän joukosta prosentteina;
//   tyhjä joukko → null (UI näyttää tyhjätilan, ei 0 %-palkkia).
import type { TodayTaskView } from "./today.ts";

export interface TodayTasksSummary {
  /** Näytettävät rivit järjestyksessä (myöhässä ensin). */
  readonly visible: readonly TodayTaskView[];
  /** Piilotettujen lukumäärä (katkaisu maxVisiblen takia). */
  readonly hiddenCount: number;
  /** Edistyminen 0–100 tai null kun joukko on tyhjä. */
  readonly progressPercent: number | null;
  readonly openCount: number;
  readonly doneCount: number;
}

export function summarizeTodayTasks(
  dueToday: readonly TodayTaskView[],
  overdue: readonly TodayTaskView[],
  completedToday: readonly TodayTaskView[],
  maxVisible: number,
): TodayTasksSummary {
  const visible = [...overdue, ...dueToday].slice(0, Math.max(0, maxVisible));
  const hiddenCount = overdue.length + dueToday.length - visible.length;
  const openCount = overdue.length + dueToday.length;
  const doneCount = completedToday.length;
  const total = openCount + doneCount;
  return {
    visible,
    hiddenCount,
    progressPercent: total === 0 ? null : Math.round((doneCount / total) * 100),
    openCount,
    doneCount,
  };
}
