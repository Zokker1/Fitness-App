// T149: Routine-service pitää sisällön, aikataulun ja historian erillään.
import { describe, expect, it } from "vitest";
import type {
  Routine,
  RoutineRun,
  RoutineSchedule,
  RoutineStep,
  RoutineStepRun,
  XPTransaction,
} from "@lifeos/domain";
import {
  InMemoryStore,
  completeRoutineRun,
  completeRoutineStep,
  createEntityRepository,
  createRoutine,
  createRoutineFromTemplate,
  createRoutineSchedule,
  createRoutineStep,
  fixedClock,
  listRoutineHistory,
  listRoutineSchedules,
  listRoutineSteps,
  listRoutineTemplates,
  reorderRoutineSteps,
  createXpRules,
  routineScheduledOnLocalDate,
  sequentialIdGenerator,
  skipRoutineStep,
  startRoutineRun,
  type RoutineServiceDeps,
  updateRoutineStepService,
} from "@lifeos/data";

const AT = "2026-09-21T07:00:00.000Z";

function deps(): RoutineServiceDeps {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator("routine");
  return {
    clock,
    routines: createEntityRepository<Routine>(new InMemoryStore<Routine>("routine"), {
      clock,
      ids,
    }),
    routineSteps: createEntityRepository<RoutineStep>(
      new InMemoryStore<RoutineStep>("routine-step"),
      {
        clock,
        ids,
      },
    ),
    routineSchedules: createEntityRepository<RoutineSchedule>(
      new InMemoryStore<RoutineSchedule>("routine-schedule"),
      { clock, ids },
    ),
    routineRuns: createEntityRepository<RoutineRun>(new InMemoryStore<RoutineRun>("routine-run"), {
      clock,
      ids,
    }),
    routineStepRuns: createEntityRepository<RoutineStepRun>(
      new InMemoryStore<RoutineStepRun>("routine-step-run"),
      { clock, ids },
    ),
  };
}

function depsWithXp(xpRules?: RoutineServiceDeps["xpRules"]): {
  readonly service: RoutineServiceDeps;
  readonly xpStore: InMemoryStore<XPTransaction>;
} {
  const service = deps();
  const xpStore = new InMemoryStore<XPTransaction>("xp-transaction");
  return {
    service: {
      ...service,
      xpTransactions: createEntityRepository<XPTransaction>(xpStore, {
        clock: service.clock,
        ids: sequentialIdGenerator("routine-xp"),
      }),
      ...(xpRules === undefined ? {} : { xpRules }),
    },
    xpStore,
  };
}

describe("Routine service (T149)", () => {
  it("pitää mallikirjaston kirjoittamattomana ja luo mallin vain pyynnöstä (T152)", async () => {
    const service = deps();
    expect(listRoutineTemplates().map((template) => template.key)).toEqual(["morning", "evening"]);
    const beforeRoutines = await service.routines.list();
    const beforeSteps = await service.routineSteps.list();
    expect(beforeRoutines.ok && beforeRoutines.value).toHaveLength(0);
    expect(beforeSteps.ok && beforeSteps.value).toHaveLength(0);

    const created = await createRoutineFromTemplate(service, { templateKey: "morning" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.routine.title).toBe("Aamun rauhallinen alku");
    expect(created.value.steps.map((step) => step.title)).toEqual([
      "Juo lasi vettä",
      "Valitse päivän tärkein tehtävä",
      "Venyttele hetki",
    ]);
    expect(created.value.steps.map((step) => step.optional)).toEqual([false, false, true]);
  });

  it("luo rutiinin, järjestää askeleet ja pitää aikataulun erillisenä", async () => {
    const service = deps();
    const created = await createRoutine(service, { title: "  Aamu  " });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const first = await createRoutineStep(service, {
      routineId: created.value.id,
      title: "Vettä",
    });
    const second = await createRoutineStep(service, {
      routineId: created.value.id,
      title: "Venyttele",
      optional: true,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const reordered = await reorderRoutineSteps(service, created.value.id, [
      second.value.id,
      first.value.id,
    ]);
    expect(reordered.ok).toBe(true);
    if (reordered.ok) {
      expect(reordered.value.map((step) => step.title)).toEqual(["Venyttele", "Vettä"]);
      expect(reordered.value.map((step) => step.sortOrder)).toEqual([0, 1]);
      expect(reordered.value[0]?.optional).toBe(true);
    }

    const madeRequired = await updateRoutineStepService(service, second.value.id, {
      optional: false,
    });
    expect(madeRequired.ok && madeRequired.value.optional).toBe(false);

    const schedule = await createRoutineSchedule(service, {
      routineId: created.value.id,
      cadence: "weekly",
      weekdays: [1, 3, 5],
      localTime: "07:30",
    });
    expect(schedule.ok).toBe(true);
    if (!schedule.ok) return;
    expect(schedule.value.routineId).toBe(created.value.id);
    expect(schedule.value.weekdays).toEqual([1, 3, 5]);
    expect(routineScheduledOnLocalDate(schedule.value, "2026-09-21")).toBe(true);
    expect(routineScheduledOnLocalDate(schedule.value, "2026-09-22")).toBe(false);

    const listedSchedules = await listRoutineSchedules(service, created.value.id);
    expect(listedSchedules.ok && listedSchedules.value).toHaveLength(1);
    const listedSteps = await listRoutineSteps(service, created.value.id);
    expect(listedSteps.ok).toBe(true);
    if (!listedSteps.ok) return;
    expect(listedSteps.value.map((step) => step.title)).toEqual(["Venyttele", "Vettä"]);
  });

  it("aloittaa erillisen suoritus- ja askelhistorian ja estää keskeneräisen päättämisen", async () => {
    const service = deps();
    const routine = await createRoutine(service, { title: "Ilta" });
    expect(routine.ok).toBe(true);
    if (!routine.ok) return;
    await createRoutineStep(service, { routineId: routine.value.id, title: "Kirjaa päivä" });
    await createRoutineStep(service, {
      routineId: routine.value.id,
      title: "Valmistele aamu",
      optional: true,
    });

    const started = await startRoutineRun(service, {
      routineId: routine.value.id,
      localDate: "2026-09-21",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.run.status).toBe("running");
    expect(started.value.steps.map((step) => step.status)).toEqual(["pending", "pending"]);

    const premature = await completeRoutineRun(service, started.value.run.id);
    expect(premature.ok).toBe(false);

    const completedStep = await completeRoutineStep(service, started.value.steps[0]?.id ?? "");
    const skippedStep = await skipRoutineStep(
      service,
      started.value.steps[1]?.id ?? "",
      "Aikaa ei ollut tänään",
    );
    expect(completedStep.ok).toBe(true);
    expect(skippedStep.ok && skippedStep.value.skipReason).toBe("Aikaa ei ollut tänään");

    const completed = await completeRoutineRun(service, started.value.run.id);
    expect(completed.ok && completed.value.status).toBe("completed");

    const history = await listRoutineHistory(service, routine.value.id);
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    const historyEntry = history.value[0];
    expect(historyEntry).toBeDefined();
    if (historyEntry === undefined) return;
    expect(historyEntry.run.status).toBe("completed");
    expect(historyEntry.run.localDate).toBe("2026-09-21");
    expect(historyEntry.steps.map((step) => step.status)).toEqual(["completed", "skipped"]);
    expect(historyEntry.steps[1]?.skipReason).toBe("Aikaa ei ollut tänään");

    const duplicate = await startRoutineRun(service, {
      routineId: routine.value.id,
      localDate: "2026-09-21",
    });
    expect(duplicate.ok).toBe(false);
  });

  it("aloittaa minimipäivän vain ensimmäisellä vaiheella ja säilyttää perustelun historiassa", async () => {
    const service = deps();
    const routine = await createRoutine(service, { title: "Raskaan päivän aamu" });
    expect(routine.ok).toBe(true);
    if (!routine.ok) return;
    const first = await createRoutineStep(service, {
      routineId: routine.value.id,
      title: "Juo vettä",
    });
    await createRoutineStep(service, { routineId: routine.value.id, title: "Venyttele" });
    await createRoutineStep(service, { routineId: routine.value.id, title: "Kirjaa päivä" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const started = await startRoutineRun(service, {
      routineId: routine.value.id,
      localDate: "2026-09-21",
      dayMode: "minimum",
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.run.dayMode).toBe("minimum");
    expect(started.value.steps.map((step) => step.status)).toEqual([
      "pending",
      "skipped",
      "skipped",
    ]);
    expect(started.value.steps[1]?.skipReason).toBe("Minimipäivä: kevyt tavoite.");

    const completedStep = await completeRoutineStep(service, started.value.steps[0]?.id ?? "");
    expect(completedStep.ok).toBe(true);
    const completedRun = await completeRoutineRun(service, started.value.run.id);
    expect(completedRun.ok && completedRun.value.status).toBe("completed");

    const history = await listRoutineHistory(service, routine.value.id);
    expect(history.ok).toBe(true);
    if (!history.ok) return;
    expect(history.value[0]?.run.dayMode).toBe("minimum");
    expect(history.value[0]?.steps.map((step) => step.status)).toEqual([
      "completed",
      "skipped",
      "skipped",
    ]);
  });

  it("antaa täydestä ja minimipäivästä oman XP-määrän vain kerran", async () => {
    const { service, xpStore } = depsWithXp(
      createXpRules({ routineCompletion: 18, routineMinimumDay: 7 }),
    );
    const fullRoutine = await createRoutine(service, { title: "Täysi aamu" });
    expect(fullRoutine.ok).toBe(true);
    if (!fullRoutine.ok) return;
    await createRoutineStep(service, { routineId: fullRoutine.value.id, title: "Vesi" });
    await createRoutineStep(service, { routineId: fullRoutine.value.id, title: "Venyttele" });
    const fullStart = await startRoutineRun(service, {
      routineId: fullRoutine.value.id,
      localDate: "2026-09-21",
    });
    expect(fullStart.ok).toBe(true);
    if (!fullStart.ok) return;
    for (const step of fullStart.value.steps) {
      await completeRoutineStep(service, step.id);
    }
    const fullDone = await completeRoutineRun(service, fullStart.value.run.id);
    expect(fullDone.ok).toBe(true);

    const minimumRoutine = await createRoutine(service, { title: "Kevyt aamu" });
    expect(minimumRoutine.ok).toBe(true);
    if (!minimumRoutine.ok) return;
    const minimumStep = await createRoutineStep(service, {
      routineId: minimumRoutine.value.id,
      title: "Hengitä",
    });
    await createRoutineStep(service, { routineId: minimumRoutine.value.id, title: "Vesi" });
    expect(minimumStep.ok).toBe(true);
    if (!minimumStep.ok) return;
    const minimumStart = await startRoutineRun(service, {
      routineId: minimumRoutine.value.id,
      localDate: "2026-09-22",
      dayMode: "minimum",
    });
    expect(minimumStart.ok).toBe(true);
    if (!minimumStart.ok) return;
    await completeRoutineStep(service, minimumStart.value.steps[0]?.id ?? "");
    const minimumDone = await completeRoutineRun(service, minimumStart.value.run.id);
    expect(minimumDone.ok).toBe(true);

    const listed = await xpStore.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(2);
    expect(listed.value.map((transaction) => transaction.amount)).toEqual([18, 7]);
    expect(listed.value.map((transaction) => transaction.source)).toEqual(["routine", "routine"]);
    expect(listed.value[1]?.reason).toBe("Minimipäivä valmis.");
  });
});
