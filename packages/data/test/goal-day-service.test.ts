// T155: GoalDay-success antaa rajatun XP:n vain kerran.
import { describe, expect, it } from "vitest";
import type { Goal, GoalDay, XPTransaction } from "@lifeos/domain";
import {
  GOAL_DAY_COMPLETION_XP,
  InMemoryStore,
  createXpRules,
  createEntityRepository,
  fixedClock,
  sequentialIdGenerator,
  toggleGoalDayService,
  type GoalDayServiceDeps,
} from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";
const TODAY = "2026-09-21";

function goal(): Goal {
  return {
    id: "goal-t155",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "T155-tavoite",
    description: null,
    activeFrom: TODAY,
    activeUntil: null,
    archivedAt: null,
    deletedAt: null,
  };
}

function makeDeps(
  withXp = true,
  xpRules?: GoalDayServiceDeps["xpRules"],
): {
  readonly goalDays: InMemoryStore<GoalDay>;
  readonly xp: InMemoryStore<XPTransaction>;
  readonly deps: GoalDayServiceDeps;
} {
  const goalStore = new InMemoryStore<Goal>("goal", [goal()]);
  const goalDays = new InMemoryStore<GoalDay>("goal-day");
  const xp = new InMemoryStore<XPTransaction>("xp-transaction");
  const ids = sequentialIdGenerator("t155");
  const clock = fixedClock(AT);
  const deps: GoalDayServiceDeps = {
    clock,
    goals: createEntityRepository<Goal>(goalStore, { clock, ids }),
    goalDays: createEntityRepository<GoalDay>(goalDays, { clock, ids }),
    ...(withXp
      ? { xpTransactions: createEntityRepository<XPTransaction>(xp, { clock, ids }) }
      : {}),
    ...(xpRules === undefined ? {} : { xpRules }),
  };
  return { goalDays, xp, deps };
}

describe("toggleGoalDayService + XP (T155)", () => {
  it("onnistunut tavoitepäivä tuottaa 5 XP:tä kerran", async () => {
    const { goalDays, xp, deps } = makeDeps();
    const completed = await toggleGoalDayService(deps, {
      goalId: "goal-t155",
      localDate: TODAY,
      todayKey: TODAY,
      completed: true,
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) {
      return;
    }

    const listed = await xp.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]).toMatchObject({
      source: "habit",
      sourceEntityId: completed.value.id,
      amount: GOAL_DAY_COMPLETION_XP,
      earnedAt: AT,
      reason: "Tavoitepäivä valmis.",
    });

    await toggleGoalDayService(deps, {
      goalId: "goal-t155",
      localDate: TODAY,
      todayKey: TODAY,
      completed: false,
    });
    await toggleGoalDayService(deps, {
      goalId: "goal-t155",
      localDate: TODAY,
      todayKey: TODAY,
      completed: true,
    });
    const afterRetry = await xp.list();
    expect(afterRetry.ok && afterRetry.value).toHaveLength(1);

    const savedDays = await goalDays.list();
    expect(savedDays.ok && savedDays.value).toHaveLength(1);
  });

  it("tavoitepäivä valmistuu ilman XP-repoa", async () => {
    const { deps } = makeDeps(false);
    const completed = await toggleGoalDayService(deps, {
      goalId: "goal-t155",
      localDate: TODAY,
      todayKey: TODAY,
      completed: true,
    });
    expect(completed.ok).toBe(true);
  });

  it("käyttää tavoitepäivässä injektoitua XP-sääntöä", async () => {
    const { deps, xp } = makeDeps(true, createXpRules({ goalDayCompletion: 12 }));
    const completed = await toggleGoalDayService(deps, {
      goalId: "goal-t155",
      localDate: TODAY,
      todayKey: TODAY,
      completed: true,
    });
    expect(completed.ok).toBe(true);
    const listed = await xp.list();
    expect(listed.ok && listed.value[0]?.amount).toBe(12);
  });
});
