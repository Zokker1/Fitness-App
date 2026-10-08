// T095: hakemistoprojektion unit-testit (data-paketti, ei IO:ta).
// Kriteeri: "Hakuindeksi syntyy soveltuvista paikallisista entiteeteistä".
// - Kaikki 9 §22-lajia indeksoituvat (tasks/projects/tags/goals/routines/
//   journal/foods/recipes/measurements); poistetut/arkistoidut EIVÄT;
// - normalisointi: isot kirjaimet + diakriitit ("Maito" ← "maito",
//   "sää" ← "saa"? ei — vaatii kaikki kirjaimet, testaa "säästä" ← "säästä");
// - AND-semantiikka usealle sanalle; tyhjä kysely → tyhjä (ei vuotoa);
// - ryhmittely lajeittain, max 20/laji.
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import {
  buildSearchIndex,
  normalizeSearchText,
  searchIndex,
  type SearchIndexInput,
} from "@lifeos/data";

const AT = "2026-09-18T09:00:00.000Z";

function task(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title,
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<SearchIndexInput> = {}): SearchIndexInput {
  return {
    tasks: [],
    projects: [],
    tags: [],
    goals: [],
    routines: [],
    routineSteps: [],
    journalEntries: [],
    foods: [],
    recipes: [],
    measurements: [],
    ...overrides,
  };
}

describe("normalizeSearchText", () => {
  it("pienentää, poistaa diakriitit ja tiivistää välit", () => {
    expect(normalizeSearchText("  Maito  KAURA ")).toBe("maito kaura");
    expect(normalizeSearchText("SÄÄSTÄ")).toBe("saasta");
    expect(normalizeSearchText("Ångström")).toBe("angstrom");
  });
});

describe("buildSearchIndex + searchIndex (T095)", () => {
  it("kaikki 9 lajia löytyvät; poistetut/arkistoidut eivät", () => {
    const index = buildSearchIndex(
      baseInput({
        tasks: [task("t-1", "Osta maitoa"), task("t-del", "Poistettu tehtävä", { deletedAt: AT })],
        projects: [
          {
            id: "p-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            name: "Maitokauppa",
            colorKey: null,
            archivedAt: null,
            deletedAt: null,
          },
        ],
        tags: [
          {
            id: "g-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            name: "maito",
            colorKey: null,
            deletedAt: null,
          },
        ],
        goals: [
          {
            id: "go-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            title: "Maitoa joka päivä",
            description: null,
            archivedAt: null,
            deletedAt: null,
          },
          {
            id: "go-arch",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            title: "Maitoarkisto",
            description: null,
            archivedAt: AT,
            deletedAt: null,
          },
        ],
        routines: [
          {
            id: "r-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            title: "Aamumaito",
            archivedAt: null,
            deletedAt: null,
          },
        ],
        routineSteps: [
          {
            id: "s-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            routineId: "r-1",
            title: "Kaada maito",
            sortOrder: 0,
            deletedAt: null,
          },
        ],
        journalEntries: [
          {
            id: "j-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            writtenAt: AT,
            title: "Maitopäivä",
            body: "Join maitoa.",
            reflectionSuccess: null,
            reflectionDifficult: null,
            reflectionTomorrow: null,
            deletedAt: null,
          },
        ],
        foods: [
          {
            id: "f-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            name: "Maito",
            caloriesPer100G: 64,
            proteinPer100G: 3.3,
            carbsPer100G: 4.8,
            fatPer100G: 3.5,
            deletedAt: null,
          },
        ],
        recipes: [
          {
            id: "rc-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            name: "Maitopuuro",
            foodIds: ["f-1"],
            deletedAt: null,
          },
        ],
        measurements: [
          {
            id: "m-1",
            createdAt: AT,
            updatedAt: AT,
            version: 1,
            type: "weight",
            value: 75,
            secondaryValue: null,
            unit: "kg",
            measuredAt: AT,
            note: "aamumaito",
          },
        ],
      }),
    );
    const results = searchIndex(index, "maito");
    expect(results.task.map((hit) => hit.id)).toEqual(["t-1"]);
    expect(results.project.map((hit) => hit.id)).toEqual(["p-1"]);
    expect(results.tag.map((hit) => hit.id)).toEqual(["g-1"]);
    expect(results.goal.map((hit) => hit.id)).toEqual(["go-1"]);
    expect(results.routine.map((hit) => hit.id)).toEqual(["r-1"]);
    expect(results.journal.map((hit) => hit.id)).toEqual(["j-1"]);
    expect(results.food.map((hit) => hit.id)).toEqual(["f-1"]);
    expect(results.recipe.map((hit) => hit.id)).toEqual(["rc-1"]);
    expect(results.measurement.map((hit) => hit.id)).toEqual(["m-1"]);
  });

  it("AND-semantiikka: molempien sanojen esiinnyttävä", () => {
    const index = buildSearchIndex(
      baseInput({ tasks: [task("t-1", "Osta maitoa"), task("t-2", "Osta leipää")] }),
    );
    expect(searchIndex(index, "osta maitoa").task.map((hit) => hit.id)).toEqual(["t-1"]);
    expect(searchIndex(index, "osta").task).toHaveLength(2);
  });

  it("tyhjä kysely → tyhjä tulos kaikissa lajeissa (ei vuotoa)", () => {
    const index = buildSearchIndex(baseInput({ tasks: [task("t-1", "Osta maitoa")] }));
    const results = searchIndex(index, "   ");
    for (const hits of Object.values(results)) {
      expect(hits).toEqual([]);
    }
  });

  it("max 20 osumaa/laji", () => {
    const tasks = Array.from({ length: 25 }, (_, i) =>
      task(`t-${String(i)}`, `Maito ${String(i)}`),
    );
    const index = buildSearchIndex(baseInput({ tasks }));
    expect(searchIndex(index, "maito").task).toHaveLength(20);
  });
});
