// T080: Today-projection unit-testit. Todistaa kriteerin "yksi palvelu
// kokoaa päivän tiedot ilman UI:n ad hoc -hakuketjuja":
// - dueToday/overdue/completedToday -ryhmittely paikallispäivällä (UTC+
//   offset, ei selaimen aikaa) + prioriteettijärjestys;
// - fokusminuutit, neste, kalorit ja lisäravinteiden takenToday päiväkohtaisesti;
// - goalViews: vain kyseryn päivän tila — TULEVA päivä ei ole completed (T085);
// - nextTimebox: aikaisin tuleva timebox, menneet ei;
// - XP derivoidaan virrasta (today + total);
// - virheellinen paikallispäivä → hallittu invalid-input, ei poikkeusta.
import { describe, expect, it } from "vitest";
import type {
  CalendarBlock,
  FocusSession,
  Goal,
  GoalDay,
  HydrationEntry,
  NutritionEntry,
  Supplement,
  SupplementLog,
  Task,
  XPTransaction,
} from "@lifeos/domain";
import { buildTodayProjection, type TodayProjectionInput } from "@lifeos/data";

const NOW = "2026-09-17T09:15:00.000Z"; // 12:15 Helsingin aikaa (UTC+3)
const OFFSET = 180; // minuuttia
const LOCAL_DATE = "2026-09-17";
const YESTERDAY = "2026-09-16";
const AT = NOW;

function baseInput(overrides: Partial<TodayProjectionInput> = {}): TodayProjectionInput {
  return {
    localDate: LOCAL_DATE,
    now: NOW,
    timezoneOffsetMinutes: OFFSET,
    tasks: [],
    checklistItems: [],
    focusSessions: [],
    hydrationEntries: [],
    nutritionEntries: [],
    supplements: [],
    supplementLogs: [],
    goals: [],
    goalDays: [],
    calendarBlocks: [],
    latestWeight: null,
    reminders: [],
    xpTransactions: [],
    ...overrides,
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Tehtävä",
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

describe("today projection (T080)", () => {
  it("ryhmittelee tehtävät paikallispäivällä: dueToday/overdue/completedToday", () => {
    const result = buildTodayProjection(
      baseInput({
        tasks: [
          task({ id: "t-due", dueAt: "2026-09-17T18:00:00.000Z" }),
          // Eilen päättyvä deadline paikallisena (15:00 UTC = 18:00 UTC+3) → overdue.
          task({ id: "t-over", dueAt: "2026-09-16T15:00:00.000Z", priority: "high" }),
          task({
            id: "t-done",
            status: "done",
            completedAt: "2026-09-17T07:00:00.000Z",
          }),
          // Huomenna → ei kummassakaan ryhmässä.
          task({ id: "t-future", dueAt: "2026-09-18T09:00:00.000Z" }),
          // Poistettu → ei näy.
          task({ id: "t-deleted", dueAt: "2026-09-17T18:00:00.000Z", deletedAt: AT }),
          // Ilman deadlinea → ei päiväryhmissä (mutta openTotal lasketaan alle).
          task({ id: "t-nodue" }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.tasks.dueToday.map((view) => view.task.id)).toEqual(["t-due"]);
    expect(result.value.tasks.overdue.map((view) => view.task.id)).toEqual(["t-over"]);
    expect(result.value.tasks.completedToday.map((view) => view.task.id)).toEqual(["t-done"]);
    expect(result.value.tasks.openTotal).toBe(2);
    expect(result.value.tasks.overdue[0]?.overdue).toBe(true);
  });

  it("priorisoi: high ennen normalia, sitten dueAt", () => {
    const result = buildTodayProjection(
      baseInput({
        tasks: [
          task({ id: "t-normal", priority: "normal", dueAt: "2026-09-17T10:00:00.000Z" }),
          task({ id: "t-high", priority: "high", dueAt: "2026-09-17T12:00:00.000Z" }),
          task({ id: "t-high-early", priority: "high", dueAt: "2026-09-17T08:00:00.000Z" }),
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.tasks.dueToday.map((view) => view.task.id)).toEqual([
      "t-high-early",
      "t-high",
      "t-normal",
    ]);
  });

  it("checklist-progress tulee projektion mukana", () => {
    const result = buildTodayProjection(
      baseInput({
        tasks: [task({ id: "t-c", dueAt: "2026-09-17T18:00:00.000Z" })],
        checklistItems: [
          { taskId: "t-c", done: true, deletedAt: null },
          { taskId: "t-c", done: false, deletedAt: null },
          { taskId: "t-c", done: true, deletedAt: AT }, // poistettu ei laske
          { taskId: "t-other", done: true, deletedAt: null },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.tasks.dueToday[0]?.checklistTotal).toBe(2);
    expect(result.value.tasks.dueToday[0]?.checklistDone).toBe(1);
  });

  it("fokus, neste ja kalorit summataan vain kyseiseltä paikallispäivältä", () => {
    const sessions: FocusSession[] = [
      {
        id: "f-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        taskId: null,
        routineId: null,
        phase: "completed",
        startedAt: "2026-09-17T08:00:00.000Z",
        endedAt: "2026-09-17T08:25:00.000Z",
        durationSeconds: 1500,
      },
      {
        id: "f-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        taskId: null,
        routineId: null,
        phase: "completed",
        startedAt: "2026-09-16T08:00:00.000Z",
        endedAt: "2026-09-16T08:25:00.000Z",
        durationSeconds: 3000,
      },
    ];
    const hydration: HydrationEntry[] = [
      {
        id: "h-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        drunkAt: "2026-09-17T07:00:00.000Z",
        milliliters: 250,
      },
      {
        id: "h-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        drunkAt: "2026-09-17T09:00:00.000Z",
        milliliters: 200,
      },
      {
        id: "h-3",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        drunkAt: "2026-09-16T09:00:00.000Z",
        milliliters: 500,
      },
    ];
    const nutrition: NutritionEntry[] = [
      {
        id: "n-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        eatenAt: "2026-09-17T07:30:00.000Z",
        label: "Aamiainen",
        calories: 420,
        proteinG: null,
        carbsG: null,
        fatG: null,
        deletedAt: null,
      },
      {
        id: "n-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        eatenAt: "2026-09-16T12:00:00.000Z",
        label: "Eilinen",
        calories: 900,
        proteinG: null,
        carbsG: null,
        fatG: null,
        deletedAt: null,
      },
    ];
    const result = buildTodayProjection(
      baseInput({
        focusSessions: sessions,
        hydrationEntries: hydration,
        nutritionEntries: nutrition,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.focus.minutesToday).toBe(25);
    expect(result.value.focus.sessionsToday).toBe(1);
    expect(result.value.hydration.millilitersToday).toBe(450);
    expect(result.value.nutrition.caloriesToday).toBe(420);
    expect(result.value.nutrition.entriesToday).toBe(1);
  });

  it("lisäravinteet: takenToday päiväkohtaisesti, poistetut ei näy", () => {
    const supplements: Supplement[] = [
      {
        id: "s-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        name: "D-vitamiini",
        doseLabel: "50 µg",
        deletedAt: null,
      },
      {
        id: "s-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        name: "Poistettu",
        doseLabel: null,
        deletedAt: AT,
      },
    ];
    const logs: SupplementLog[] = [
      {
        id: "sl-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        supplementId: "s-1",
        takenAt: "2026-09-17T08:00:00.000Z",
      },
    ];
    const result = buildTodayProjection(baseInput({ supplements, supplementLogs: logs }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.supplements).toHaveLength(1);
    expect(result.value.supplements[0]?.supplement.id).toBe("s-1");
    expect(result.value.supplements[0]?.takenToday).toBe(true);
  });

  it("tavoitteet: vain kyseryn päivän tila — tuleva/merkitsemätön on pending (T085)", () => {
    const goals: Goal[] = [
      {
        id: "g-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        title: "Liiku",
        description: null,
        archivedAt: null,
        deletedAt: null,
      },
      {
        id: "g-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        title: "Arkistoitu",
        description: null,
        archivedAt: AT,
        deletedAt: null,
      },
      {
        id: "g-3",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        title: "Poistettu",
        description: null,
        archivedAt: null,
        deletedAt: AT,
      },
    ];
    const goalDays: GoalDay[] = [
      {
        id: "gd-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        goalId: "g-1",
        localDate: LOCAL_DATE,
        completed: true,
      },
      {
        id: "gd-old",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        goalId: "g-1",
        localDate: YESTERDAY,
        completed: true,
      },
    ];
    const result = buildTodayProjection(baseInput({ goals, goalDays }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.goalViews).toHaveLength(1);
    expect(result.value.goalViews[0]?.goal.id).toBe("g-1");
    expect(result.value.goalViews[0]?.state).toBe("completed");
    expect(result.value.goalViews[0]?.day?.localDate).toBe(LOCAL_DATE);
  });

  it("nextTimebox: aikaisin tuleva, menneet ohitetaan", () => {
    const blocks: CalendarBlock[] = [
      {
        id: "b-past",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        kind: "task",
        title: "Mennyt",
        startsAt: "2026-09-17T06:00:00.000Z",
        endsAt: "2026-09-17T07:00:00.000Z",
        linkedTaskId: null,
        linkedRoutineId: null,
        deletedAt: null,
      },
      {
        id: "b-next",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        kind: "focus",
        title: "Seuraava",
        startsAt: "2026-09-17T10:00:00.000Z",
        endsAt: "2026-09-17T10:30:00.000Z",
        linkedTaskId: null,
        linkedRoutineId: null,
        deletedAt: null,
      },
      {
        id: "b-later",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        kind: "event",
        title: "Myöhemmin",
        startsAt: "2026-09-17T14:00:00.000Z",
        endsAt: "2026-09-17T15:00:00.000Z",
        linkedTaskId: null,
        linkedRoutineId: null,
        deletedAt: null,
      },
    ];
    const result = buildTodayProjection(baseInput({ calendarBlocks: blocks }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.nextTimebox?.id).toBe("b-next");
  });

  it("XP derivoidaan virrasta: today + total (negatiivinen korjaus sallittu)", () => {
    const transactions: XPTransaction[] = [
      {
        id: "x-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        source: "task",
        sourceEntityId: null,
        amount: 10,
        earnedAt: "2026-09-17T07:00:00.000Z",
        reason: null,
      },
      {
        id: "x-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        source: "focus",
        sourceEntityId: null,
        amount: 15,
        earnedAt: "2026-09-17T08:30:00.000Z",
        reason: null,
      },
      {
        id: "x-3",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        source: "manual",
        sourceEntityId: null,
        amount: -5,
        earnedAt: "2026-09-16T08:30:00.000Z",
        reason: "Korjaus",
      },
    ];
    const result = buildTodayProjection(baseInput({ xpTransactions: transactions }));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.xp.todayXp).toBe(25);
    expect(result.value.xp.totalXp).toBe(20);
  });

  it("phase määräytyy paikallisesta tunnista (UTC+3: 09:15 UTC = 12:15 paikallista)", () => {
    const result = buildTodayProjection(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.localHour).toBeCloseTo(12.25, 2);
    expect(result.value.phase).toBe("paiva");
  });

  it("virheellinen paikallispäivä → hallittu invalid-input", () => {
    const result = buildTodayProjection(baseInput({ localDate: "17.9.2026" }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnosticCode).toBe("data.today.bad-local-date");
    }
  });
});
