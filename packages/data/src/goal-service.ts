// T140: Goal/HabitRule-service. UI käyttää tätä rajaa repositoryn päällä;
// domain-validointi pysyy @lifeos/domainissa ja kellot injektoidaan.
import type { Goal, HabitRule } from "@lifeos/domain";
import { validateGoalValues, validateHabitRuleValues } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export interface GoalServiceDeps {
  readonly clock: Clock;
  readonly goals: EntityRepository<Goal>;
  readonly habitRules?: EntityRepository<HabitRule>;
}

export interface CreateGoalInput {
  readonly title: string;
  readonly description?: string | null;
  readonly activeFrom?: string | null;
  readonly activeUntil?: string | null;
}

export interface UpdateGoalInput {
  readonly title?: string;
  readonly description?: string | null;
  readonly activeFrom?: string | null;
  readonly activeUntil?: string | null;
}

export interface CreateHabitRuleInput {
  readonly goalId?: string | null;
  readonly title: string;
  readonly cadence: HabitRule["cadence"];
  readonly targetPerPeriod: number;
}

export interface UpdateHabitRuleInput {
  readonly goalId?: string | null;
  readonly title?: string;
  readonly cadence?: HabitRule["cadence"];
  readonly targetPerPeriod?: number;
}

function validationError<T>(message: string, diagnosticCode: string): DataResult<T> {
  return { ok: false, error: invalidInput(diagnosticCode, message) };
}

async function assertLinkedGoal(
  deps: GoalServiceDeps,
  goalId: string | null,
): Promise<DataResult<true>> {
  if (goalId === null) {
    return { ok: true, value: true };
  }
  const goal = await deps.goals.getById(goalId);
  if (!goal.ok) {
    return { ok: false, error: goal.error };
  }
  if (goal.value.deletedAt !== null || goal.value.archivedAt !== null) {
    return validationError(
      "Tavan sääntö voi liittyä vain aktiiviseen tavoitteeseen.",
      "data.habit-rule.validation.inactive-goal",
    );
  }
  return { ok: true, value: true };
}

export async function createGoal(
  deps: GoalServiceDeps,
  input: CreateGoalInput,
): Promise<DataResult<Goal>> {
  const validated = validateGoalValues(input);
  if (!validated.ok) {
    return validationError(validated.error.message, "data.goal.validation.invalid");
  }
  return deps.goals.create({
    ...validated.value,
    archivedAt: null,
    deletedAt: null,
  });
}

export async function updateGoalService(
  deps: GoalServiceDeps,
  id: string,
  patch: UpdateGoalInput,
): Promise<DataResult<Goal>> {
  const existing = await deps.goals.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const candidate = validateGoalValues({
    title: patch.title !== undefined ? patch.title : existing.value.title,
    description: patch.description !== undefined ? patch.description : existing.value.description,
    activeFrom:
      patch.activeFrom !== undefined ? patch.activeFrom : (existing.value.activeFrom ?? null),
    activeUntil:
      patch.activeUntil !== undefined ? patch.activeUntil : (existing.value.activeUntil ?? null),
  });
  if (!candidate.ok) {
    return validationError(candidate.error.message, "data.goal.validation.invalid");
  }
  return deps.goals.update(id, candidate.value);
}

export async function archiveGoalService(
  deps: GoalServiceDeps,
  id: string,
): Promise<DataResult<Goal>> {
  const existing = await deps.goals.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError("Poistettua tavoitetta ei voi arkistoida.", "data.goal.archive.deleted");
  }
  return deps.goals.update(id, { archivedAt: deps.clock.nowIso() });
}

export async function unarchiveGoalService(
  deps: GoalServiceDeps,
  id: string,
): Promise<DataResult<Goal>> {
  const existing = await deps.goals.getById(id);
  if (!existing.ok) {
    return existing;
  }
  return deps.goals.update(id, { archivedAt: null });
}

export async function deleteGoalService(
  deps: GoalServiceDeps,
  id: string,
): Promise<DataResult<Goal>> {
  const existing = await deps.goals.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError("Tavoite on jo poistettu.", "data.goal.delete.invalid-transition");
  }
  return deps.goals.update(id, { deletedAt: deps.clock.nowIso() });
}

export async function restoreGoalService(
  deps: GoalServiceDeps,
  id: string,
): Promise<DataResult<Goal>> {
  const existing = await deps.goals.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt === null) {
    return validationError(
      "Vain poistettu tavoite voidaan palauttaa.",
      "data.goal.restore.invalid-transition",
    );
  }
  return deps.goals.update(id, { deletedAt: null });
}

export async function createHabitRule(
  deps: GoalServiceDeps,
  input: CreateHabitRuleInput,
): Promise<DataResult<HabitRule>> {
  if (deps.habitRules === undefined) {
    return validationError(
      "Tavan sääntöjen repository ei ole käytettävissä.",
      "data.habit-rule.unavailable",
    );
  }
  const validated = validateHabitRuleValues(input);
  if (!validated.ok) {
    return validationError(validated.error.message, "data.habit-rule.validation.invalid");
  }
  const linked = await assertLinkedGoal(deps, validated.value.goalId);
  if (!linked.ok) {
    return { ok: false, error: linked.error };
  }
  return deps.habitRules.create({ ...validated.value, deletedAt: null });
}

export async function updateHabitRuleService(
  deps: GoalServiceDeps,
  id: string,
  patch: UpdateHabitRuleInput,
): Promise<DataResult<HabitRule>> {
  if (deps.habitRules === undefined) {
    return validationError(
      "Tavan sääntöjen repository ei ole käytettävissä.",
      "data.habit-rule.unavailable",
    );
  }
  const existing = await deps.habitRules.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const validated = validateHabitRuleValues({
    goalId: patch.goalId !== undefined ? patch.goalId : existing.value.goalId,
    title: patch.title !== undefined ? patch.title : existing.value.title,
    cadence: patch.cadence !== undefined ? patch.cadence : existing.value.cadence,
    targetPerPeriod:
      patch.targetPerPeriod !== undefined ? patch.targetPerPeriod : existing.value.targetPerPeriod,
  });
  if (!validated.ok) {
    return validationError(validated.error.message, "data.habit-rule.validation.invalid");
  }
  const linked = await assertLinkedGoal(deps, validated.value.goalId);
  if (!linked.ok) {
    return { ok: false, error: linked.error };
  }
  return deps.habitRules.update(id, validated.value);
}

export async function deleteHabitRuleService(
  deps: GoalServiceDeps,
  id: string,
): Promise<DataResult<HabitRule>> {
  if (deps.habitRules === undefined) {
    return validationError(
      "Tavan sääntöjen repository ei ole käytettävissä.",
      "data.habit-rule.unavailable",
    );
  }
  const existing = await deps.habitRules.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError(
      "Tavan sääntö on jo poistettu.",
      "data.habit-rule.delete.invalid-transition",
    );
  }
  return deps.habitRules.update(id, { deletedAt: deps.clock.nowIso() });
}
