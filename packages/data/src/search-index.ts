// T095: paikallinen hakemistoprojektio (§22). Puhdas data-moduuli (ei IO:ta):
// buildSearchIndex(entiteetit) → SearchIndex; searchIndex(index, query) →
// ryhmitellyt osumat. Kriteeri: "Hakuindeksi syntyy soveltuvista
// paikallisista entiteeteistä" — UI (T096) syöttää repository-datan, tämä
// moduuli ei hae mitään itse (ei ad hoc -hakuketjuja, T080-malli).
//
// §22-kattavuus (vain nämä tyypit; arkaluonteinen pysyy paikallisena,
// ei ulkoista hakupalvelua):
// - tasks (title + notes), projects (name), tags (name), goals (title),
//   routines (title + steps), journal (title + body + reflections), foods/recipes (name),
//   measurements (metric name/type + note).
// Poistetut/arkistoidut EIVÄT indeksoidu (ei kummitusosumia).
// Normalisointi: lowerCase + diakriitit pois (NFD) + trim — "Maito" löytyy
// haulla "maito". Rajat: kysely max 100 merkkiä (leikataan), tyhjä kysely →
// tyhjä tulos (ei "näytä kaikki" -vuotoa); max 20 osumaa/ryhmä (UI ei huku).
import type {
  Food,
  Goal,
  JournalEntry,
  Measurement,
  Project,
  Recipe,
  Routine,
  RoutineStep,
  Tag,
  Task,
  UtcTimestamp,
} from "@lifeos/domain";

export type SearchResultKind =
  "task" | "project" | "tag" | "goal" | "routine" | "journal" | "food" | "recipe" | "measurement";

export const SEARCH_RESULT_LABELS: Readonly<Record<SearchResultKind, string>> = {
  task: "Tehtävät",
  project: "Projektit",
  tag: "Tagit",
  goal: "Tavoitteet",
  routine: "Rutiinit",
  journal: "Päiväkirja",
  food: "Ruoat",
  recipe: "Reseptit",
  measurement: "Mittaukset",
};

export interface SearchDocument {
  readonly kind: SearchResultKind;
  readonly id: string;
  /** Näytettävä otsikko (ei raakadataa enempää — T097 avaa kohteen). */
  readonly title: string;
  /** Normalisoitu hakuteksti (pienet, ei diakriittejä). */
  readonly text: string;
  /** Lyhyt paikallinen esikatselu; käytössä mittausmuistiinpanoille. */
  readonly preview?: string;
}

export interface SearchIndexInput {
  readonly tasks: readonly Task[];
  readonly projects: readonly Project[];
  readonly tags: readonly Tag[];
  readonly goals: readonly Goal[];
  readonly routines: readonly Routine[];
  readonly routineSteps: readonly RoutineStep[];
  readonly journalEntries: readonly JournalEntry[];
  readonly foods: readonly Food[];
  readonly recipes: readonly Recipe[];
  readonly measurements: readonly Measurement[];
}

export interface SearchIndex {
  readonly documents: readonly SearchDocument[];
}

export interface SearchHit {
  readonly kind: SearchResultKind;
  readonly id: string;
  readonly title: string;
  readonly preview?: string;
}

export type SearchResults = Readonly<Record<SearchResultKind, readonly SearchHit[]>>;

const MAX_QUERY_LENGTH = 100;
const MAX_HITS_PER_KIND = 20;

/** Normalisoi hakutekstin: pienet + diakriitit pois + ylimääräiset välit. */
export function normalizeSearchText(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAlive(deletedAt: UtcTimestamp | null): boolean {
  return deletedAt === null;
}

function doc(kind: SearchResultKind, id: string, title: string, extra: string): SearchDocument {
  return { kind, id, title, text: normalizeSearchText(`${title} ${extra}`) };
}

function makePreview(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 140 ? `${normalized.slice(0, 139).trimEnd()}…` : normalized;
}

/**
 * Rakentaa hakuindeksin paikallisista entiteeteistä. Puhdas funktio —
 * kutsuja (T096 UI) antaa repository-datan valmiina.
 */
export function buildSearchIndex(input: SearchIndexInput): SearchIndex {
  const documents: SearchDocument[] = [];
  for (const task of input.tasks) {
    if (isAlive(task.deletedAt)) {
      documents.push(doc("task", task.id, task.title, task.notes ?? ""));
    }
  }
  for (const project of input.projects) {
    if (isAlive(project.deletedAt)) {
      documents.push(doc("project", project.id, project.name, ""));
    }
  }
  for (const tag of input.tags) {
    if (isAlive(tag.deletedAt)) {
      documents.push(doc("tag", tag.id, tag.name, ""));
    }
  }
  for (const goal of input.goals) {
    if (isAlive(goal.deletedAt) && goal.archivedAt === null) {
      documents.push(doc("goal", goal.id, goal.title, goal.description ?? ""));
    }
  }
  const stepsByRoutine = new Map<string, string[]>();
  for (const step of input.routineSteps) {
    if (isAlive(step.deletedAt)) {
      const list = stepsByRoutine.get(step.routineId) ?? [];
      list.push(step.title);
      stepsByRoutine.set(step.routineId, list);
    }
  }
  for (const routine of input.routines) {
    if (isAlive(routine.deletedAt) && routine.archivedAt === null) {
      documents.push(
        doc("routine", routine.id, routine.title, (stepsByRoutine.get(routine.id) ?? []).join(" ")),
      );
    }
  }
  for (const entry of input.journalEntries) {
    if (isAlive(entry.deletedAt)) {
      documents.push(
        doc(
          "journal",
          entry.id,
          entry.title ?? "Päiväkirja",
          [
            entry.body,
            entry.reflectionSuccess ?? "",
            entry.reflectionDifficult ?? "",
            entry.reflectionTomorrow ?? "",
          ].join(" "),
        ),
      );
    }
  }
  for (const food of input.foods) {
    if (isAlive(food.deletedAt)) {
      documents.push(doc("food", food.id, food.name, ""));
    }
  }
  for (const recipe of input.recipes) {
    if (isAlive(recipe.deletedAt)) {
      documents.push(doc("recipe", recipe.id, recipe.name, ""));
    }
  }
  for (const measurement of input.measurements) {
    const measurementDocument = doc(
      "measurement",
      measurement.id,
      measurement.metricName ?? measurement.type,
      [measurement.type, measurement.unit, measurement.note ?? ""].join(" "),
    );
    documents.push({
      ...measurementDocument,
      ...(measurement.note === null ? {} : { preview: makePreview(measurement.note) }),
    });
  }
  return { documents };
}

/** Tyhjä ryhmitelty tulos (kaikki 9 lajia aina läsnä — UI ei arvaile). */
export function emptySearchResults(): SearchResults {
  return {
    task: [],
    project: [],
    tag: [],
    goal: [],
    routine: [],
    journal: [],
    food: [],
    recipe: [],
    measurement: [],
  };
}

/**
 * Hakee indeksistä. AND-semantiikka sanoille (kaikkien esiinnyttävä),
 * osumat ryhmiteltynä lajeittain (max 20/laji). Tyhjä kysely → tyhjä tulos.
 */
export function searchIndex(index: SearchIndex, rawQuery: string): SearchResults {
  const query = normalizeSearchText(rawQuery).slice(0, MAX_QUERY_LENGTH);
  const results = emptySearchResults();
  if (query === "") {
    return results;
  }
  const words = query.split(" ");
  const mutable: Record<SearchResultKind, SearchHit[]> = {
    task: [],
    project: [],
    tag: [],
    goal: [],
    routine: [],
    journal: [],
    food: [],
    recipe: [],
    measurement: [],
  };
  for (const document_ of index.documents) {
    if (!words.every((word) => document_.text.includes(word))) {
      continue;
    }
    const hits = mutable[document_.kind];
    if (hits.length >= MAX_HITS_PER_KIND) {
      continue;
    }
    hits.push({
      kind: document_.kind,
      id: document_.id,
      title: document_.title,
      ...(document_.preview === undefined ? {} : { preview: document_.preview }),
    });
  }
  return mutable;
}
