// T085: toggleGoalDay unit-testit (data-paketti, ei IO:ta). Kriteeri:
// - Vain tämä päivä (tai mennyt) vaihdettavissa; TULEVAN päivän completion
//   hylätään — ei väärää completionia.
// - Uusi pari → create-ohje; olemassa → update-ohje; ei massamerkintöjä
//   (yksi pari kerrallaan); arkistoitu/poistettu/tuntematon goal hylätään.
import { describe, expect, it } from "vitest";
import type { Goal, GoalDay } from "@lifeos/domain";
import { toggleGoalDay } from "@lifeos/data";

const AT = "2026-09-18T09:00:00.000Z";
const TODAY = "2026-09-18";
const FUTURE = "2026-09-19";
const PAST = "2026-09-17";

function goal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: id,
    description: null,
    archivedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function day(id: string, goalId: string, localDate: string, completed: boolean): GoalDay {
  return { id, createdAt: AT, updatedAt: AT, version: 1, goalId, localDate, completed };
}

describe("toggleGoalDay (T085)", () => {
  it("uusi pari → create-ohje tälle päivälle", () => {
    const result = toggleGoalDay({
      goalId: "g-1",
      localDate: TODAY,
      completed: true,
      todayKey: TODAY,
      existing: [],
      goals: [goal("g-1")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.completed).toBe(true);
    expect(result.value.create).toMatchObject({ goalId: "g-1", localDate: TODAY, completed: true });
    expect(result.value.updateId).toBeNull();
  });

  it("olemassa oleva → update-ohje (ei uutta riviä)", () => {
    const result = toggleGoalDay({
      goalId: "g-1",
      localDate: TODAY,
      completed: false,
      todayKey: TODAY,
      existing: [day("d-1", "g-1", TODAY, true)],
      goals: [goal("g-1")],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.completed).toBe(false);
    expect(result.value.create).toBeNull();
    expect(result.value.updateId).toBe("d-1");
    expect(result.value.updateCompleted).toBe(false);
  });

  it("tulevan päivän completion HYLÄTÄÄN (ei väärää completionia)", () => {
    const result = toggleGoalDay({
      goalId: "g-1",
      localDate: FUTURE,
      completed: true,
      todayKey: TODAY,
      existing: [],
      goals: [goal("g-1")],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("etukäteen");
    }
  });

  it("menneen päivän jälkikirjaus sallitaan (rehellinen korjaus)", () => {
    const result = toggleGoalDay({
      goalId: "g-1",
      localDate: PAST,
      completed: true,
      todayKey: TODAY,
      existing: [],
      goals: [goal("g-1")],
    });
    expect(result.ok).toBe(true);
  });

  it("tuntematon/arkistoitu/poistettu tavoite hylätään", () => {
    const base = { localDate: TODAY, completed: true, todayKey: TODAY, existing: [] as GoalDay[] };
    expect(toggleGoalDay({ ...base, goalId: "tuntematon", goals: [goal("g-1")] }).ok).toBe(false);
    expect(
      toggleGoalDay({ ...base, goalId: "g-1", goals: [goal("g-1", { archivedAt: AT })] }).ok,
    ).toBe(false);
    expect(
      toggleGoalDay({ ...base, goalId: "g-1", goals: [goal("g-1", { deletedAt: AT })] }).ok,
    ).toBe(false);
  });

  it("virheellinen päivämäärämuoto hylätään", () => {
    const result = toggleGoalDay({
      goalId: "g-1",
      localDate: "18.9.2026",
      completed: true,
      todayKey: TODAY,
      existing: [],
      goals: [goal("g-1")],
    });
    expect(result.ok).toBe(false);
  });
});
