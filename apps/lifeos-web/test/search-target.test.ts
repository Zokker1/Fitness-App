// T097: searchTargetFor unit-testit (web-paketti, happy-dom — puhdas
// funktio, ei IO:ta, ei Routeria). Kriteeri: "avaa oikean entiteetin/
// näkymän ilman raakadatan paljastusta".
// - Joka T095-laji → looginen päänäkymä (§3): task/project/tag → /tasks,
//   goal/routine → /goals, journal/measurement → /health, food/recipe → /nutrition;
// - kohde on VAIN polku (ei id:tä, ei dataa URL:ssa);
// - tuntematon laji / tyhjä id → null (ei arvailua, ei 404:ää).
import { describe, expect, it } from "vitest";
import { searchTargetFor } from "../src/search/searchTarget.ts";

describe("searchTargetFor (T097)", () => {
  it("tehtäväkonteksti → /tasks", () => {
    expect(searchTargetFor("task", "t-1")).toBe("/tasks");
    expect(searchTargetFor("project", "p-1")).toBe("/tasks");
    expect(searchTargetFor("tag", "g-1")).toBe("/tasks");
  });

  it("tavoitekonteksti → /goals", () => {
    expect(searchTargetFor("goal", "go-1")).toBe("/goals");
    expect(searchTargetFor("routine", "r-1")).toBe("/goals");
  });

  it("terveys- ja ravintokontekstit kohdistuvat omiin näkymiinsä", () => {
    expect(searchTargetFor("journal", "j-1")).toBe("/health");
    expect(searchTargetFor("food", "f-1")).toBe("/nutrition");
    expect(searchTargetFor("recipe", "rc-1")).toBe("/nutrition");
    expect(searchTargetFor("measurement", "m-1")).toBe("/health");
  });

  it("kohde on vain polku — ei id:tä, ei raakadataa", () => {
    const target = searchTargetFor("task", "t-salainen-id-123");
    expect(target).toBe("/tasks");
    expect(target).not.toContain("t-salainen-id-123");
  });

  it("tuntematon laji tai tyhjä id → null (ei arvailua)", () => {
    expect(searchTargetFor("avaruusalus", "x-1")).toBeNull();
    expect(searchTargetFor("", "x-1")).toBeNull();
    expect(searchTargetFor("task", "")).toBeNull();
    expect(searchTargetFor("task", "   ")).toBeNull();
  });
});
