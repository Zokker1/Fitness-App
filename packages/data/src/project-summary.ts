// T107: Project-yhteenveto (pure data-funktio, ei IO:ta).
// Kriteeri: "Tehtäväryhmällä on progress, status ja historia." (§5
// kategoriat/projektit -näkymä)
// - Progress: valmiit / kaikki tehtävät projektissa (tombstonet pois);
//   0 tehtävää → 0 % (ei keksittyä progressia, §51).
// - Status: archived (archivedAt asetettu) > complete (kaikki valmiit ja
//   vähintään yksi tehtävä) > active. Johdettu rehellisesti datasta.
// - Historia: valmistumiset completedAt-arvolla, uusin ensin.
import type { Project, Task } from "@lifeos/domain";

export type ProjectStatus = "active" | "complete" | "archived";

export interface ProjectHistoryEntry {
  readonly taskId: string;
  readonly title: string;
  readonly completedAt: string;
}

export interface ProjectSummary {
  readonly projectId: string;
  readonly name: string;
  readonly colorKey: string | null;
  /** Kaikki projektin tehtävät (open + done, tombstonet pois). */
  readonly total: number;
  readonly doneCount: number;
  readonly openCount: number;
  /** 0..100; 0 tehtävää → 0 (ei arvioidua etenemistä). */
  readonly progressPercent: number;
  readonly status: ProjectStatus;
  /** Valmistumishistoria, uusin ensin. */
  readonly history: readonly ProjectHistoryEntry[];
}

export function summarizeProject(project: Project, tasks: readonly Task[]): ProjectSummary {
  const linked = tasks.filter((task) => task.projectId === project.id && task.deletedAt === null);
  const done = linked.filter((task) => task.status === "done");
  const openCount = linked.length - done.length;
  const total = linked.length;
  const progressPercent = total === 0 ? 0 : Math.round((done.length / total) * 100);
  const status: ProjectStatus =
    project.archivedAt !== null ? "archived" : total > 0 && openCount === 0 ? "complete" : "active";
  const history = done
    .filter((task) => task.completedAt !== null)
    .sort((a, b) => {
      const aAt = a.completedAt ?? "";
      const bAt = b.completedAt ?? "";
      if (aAt === bAt) {
        return 0;
      }
      return aAt < bAt ? 1 : -1;
    })
    .map((task) => ({
      taskId: task.id,
      title: task.title,
      completedAt: task.completedAt as string,
    }));
  return {
    projectId: project.id,
    name: project.name,
    colorKey: project.colorKey,
    total,
    doneCount: done.length,
    openCount,
    progressPercent,
    status,
    history,
  };
}

/** Kaikki elävät projektit yhteenvetoina, nimen mukaan (fi-aakkosissa). */
export function summarizeProjects(
  projects: readonly Project[],
  tasks: readonly Task[],
): readonly ProjectSummary[] {
  return projects
    .filter((project) => project.deletedAt === null)
    .map((project) => summarizeProject(project, tasks))
    .sort((a, b) => a.name.localeCompare(b.name, "fi"));
}
