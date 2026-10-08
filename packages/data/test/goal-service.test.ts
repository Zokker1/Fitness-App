// T140: Goal/HabitRule-service testit repository-rajan molemmilta puolilta.
import { describe, expect, it } from "vitest";
import type { Goal, HabitRule } from "@lifeos/domain";
import {
  InMemoryStore,
  archiveGoalService,
  createEntityRepository,
  createGoal,
  createHabitRule,
  deleteGoalService,
  fixedClock,
  sequentialIdGenerator,
  updateGoalService,
} from "@lifeos/data";

const AT = "2026-09-21T12:00:00.000Z";

function deps() {
  const goals = createEntityRepository<Goal>(new InMemoryStore<Goal>("goal"), {
    clock: fixedClock(AT),
    ids: sequentialIdGenerator("goal"),
  });
  const habitRules = createEntityRepository<HabitRule>(new InMemoryStore<HabitRule>("habit-rule"), {
    clock: fixedClock(AT),
    ids: sequentialIdGenerator("rule"),
  });
  return { clock: fixedClock(AT), goals, habitRules };
}

describe("Goal service (T140)", () => {
  it("CRUD-validointi trimmaa ja säilyttää aktiivisuusalueen päivityksessä", async () => {
    const service = deps();
    const created = await createGoal(service, {
      title: "  Kesän tavoite ",
      description: "kuvaus",
      activeFrom: "2026-06-01",
      activeUntil: "2026-08-31",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.title).toBe("Kesän tavoite");
    expect(created.value.version).toBe(1);

    const updated = await updateGoalService(service, created.value.id, {
      description: null,
      activeUntil: null,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.description).toBeNull();
    expect(updated.value.activeFrom).toBe("2026-06-01");
    expect(updated.value.activeUntil).toBeNull();
    expect(updated.value.version).toBe(2);
  });

  it("arkistointi ja pehmeä poisto eivät tuhoa repository-riviä", async () => {
    const service = deps();
    const created = await createGoal(service, { title: "Palautettava" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const archived = await archiveGoalService(service, created.value.id);
    expect(archived.ok && archived.value.archivedAt).toBe(AT);
    const deleted = await deleteGoalService(service, created.value.id);
    expect(deleted.ok && deleted.value.deletedAt).toBe(AT);
    const listed = await service.goals.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("HabitRule vaatii aktiivisen linkitetyn tavoitteen", async () => {
    const service = deps();
    const missing = await createHabitRule(service, {
      goalId: "missing",
      title: "Kävely",
      cadence: "weekly",
      targetPerPeriod: 3,
    });
    expect(missing.ok).toBe(false);

    const goal = await createGoal(service, { title: "Liiku" });
    expect(goal.ok).toBe(true);
    if (!goal.ok) return;
    const rule = await createHabitRule(service, {
      goalId: goal.value.id,
      title: "  Kävely ",
      cadence: "weekly",
      targetPerPeriod: 3,
    });
    expect(rule.ok).toBe(true);
    if (rule.ok) {
      expect(rule.value.title).toBe("Kävely");
      expect(rule.value.version).toBe(1);
    }
  });
});
