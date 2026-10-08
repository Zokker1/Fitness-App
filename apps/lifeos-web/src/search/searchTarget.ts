// T097: hakunavigaation kohdekartta — puhdas funktio (ei IO:ta, ei Routeria).
// Hakutulos (kind+id) → olemassa oleva reitti. Kriteeri: "avaa oikean
// entiteetin/näkymän ilman raakadatan paljastusta":
// - Kohde on VAIN reittipolku (ei dataa URL:ssa — ei raakadataa).
// - Entiteettikohtaisia syväreittejä ei vielä ole (B05–B12 rakentavat
//   näkymät); siksi kohde on looginen päänäkymä per laji (§3):
//   - task → /tasks, project/tag → /tasks (suodatus B05:ssä), goal/routine →
//     /goals, journal/measurement → /health, food/recipe → /nutrition.
// - Tuntematon laji → null (kutsuja ei navigoi — ei arvailua, ei 404:ää).
// - Olemassa olevat reitit (routes.ts/appRoutes) — kartta validoituu niitä
//   vasten testeissä; uudet reitit B-lohkoissa päivittävät kartan silloin.
import type { SearchResultKind } from "@lifeos/data";
import { appRoutes } from "../routes.ts";

export type SearchTargetKind = Extract<
  SearchResultKind,
  "task" | "project" | "tag" | "goal" | "routine" | "journal" | "food" | "recipe" | "measurement"
>;

const KIND_TO_ROUTE: Readonly<Record<SearchTargetKind, string>> = {
  task: "/tasks",
  project: "/tasks",
  tag: "/tasks",
  goal: "/goals",
  routine: "/goals",
  journal: "/health",
  food: "/nutrition",
  recipe: "/nutrition",
  measurement: "/health",
};

const KNOWN_PATHS = new Set<string>(appRoutes.map((route) => route.path));

function isSearchTargetKind(kind: string): kind is SearchTargetKind {
  return (
    kind === "task" ||
    kind === "project" ||
    kind === "tag" ||
    kind === "goal" ||
    kind === "routine" ||
    kind === "journal" ||
    kind === "food" ||
    kind === "recipe" ||
    kind === "measurement"
  );
}

/**
 * Hakutuloksen kohdereitti tai null. Palauttaa VAIN tunnettuja polkuja
 * (routes.ts) — ei koskaan raakadataa, ei koskaan tuntematonta.
 */
export function searchTargetFor(kind: string, id: string): string | null {
  if (id.trim().length === 0 || !isSearchTargetKind(kind)) {
    return null;
  }
  const path = KIND_TO_ROUTE[kind];
  if (!KNOWN_PATHS.has(path)) {
    return null;
  }
  return path;
}
