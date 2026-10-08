// T149: Routine-service. Rutiinin sisältö, aikataulu ja suoritushistoria
// pysyvät erillään toisistaan; UI ja tuleva routine player käyttävät tätä
// rajaa eivätkä kirjoita repositoryihin suoraan.

import type {
  Routine,
  RoutineRunDayMode,
  RoutineRun,
  RoutineSchedule,
  RoutineStep,
  RoutineStepRun,
  XPTransaction,
} from "@lifeos/domain";
import {
  isRoutineScheduledOnLocalDate,
  isValidLocalDateKey,
  routineStepRunIsComplete,
  validateRoutineScheduleValues,
  validateRoutineStepValues,
  validateRoutineValues,
} from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import { getRoutineTemplate, type RoutineTemplateKey } from "./routine-templates.ts";
import type { UnitOfWork } from "./store.ts";
import { calculateXpAward, DEFAULT_XP_RULES, type XpRules } from "./xp-rules.ts";
import { createXpAward } from "./xp-ledger.ts";

export interface RoutineServiceDeps {
  readonly clock: Clock;
  readonly routines: EntityRepository<Routine>;
  readonly routineSteps: EntityRepository<RoutineStep>;
  readonly routineSchedules: EntityRepository<RoutineSchedule>;
  readonly routineRuns: EntityRepository<RoutineRun>;
  readonly routineStepRuns: EntityRepository<RoutineStepRun>;
  /** T156: valmis rutiinipäivä → yksi idempotentti XP-tapahtuma. */
  readonly xpTransactions?: EntityRepository<XPTransaction>;
  /** T180: injektoitavat XP-säännöt. */
  readonly xpRules?: XpRules;
  /** In-memory tests and future persistent adapters may provide atomic writes. */
  readonly unitOfWork?: UnitOfWork;
}

export interface CreateRoutineInput {
  readonly title: string;
}

export interface CreateRoutineFromTemplateInput {
  readonly templateKey: RoutineTemplateKey;
  readonly title?: string;
}

export interface CreatedRoutineTemplate {
  readonly routine: Routine;
  readonly steps: readonly RoutineStep[];
}

export interface UpdateRoutineInput {
  readonly title?: string;
}

export interface CreateRoutineStepInput {
  readonly routineId: string;
  readonly title: string;
  readonly sortOrder?: number;
  readonly optional?: boolean;
}

export interface UpdateRoutineStepInput {
  readonly title?: string;
  readonly sortOrder?: number;
  readonly optional?: boolean;
}

export interface CreateRoutineScheduleInput {
  readonly routineId: string;
  readonly cadence: RoutineSchedule["cadence"];
  readonly weekdays?: readonly number[];
  readonly localTime?: string | null;
  readonly enabled?: boolean;
}

export interface UpdateRoutineScheduleInput {
  readonly cadence?: RoutineSchedule["cadence"];
  readonly weekdays?: readonly number[];
  readonly localTime?: string | null;
  readonly enabled?: boolean;
}

export interface RoutineHistoryEntry {
  readonly run: RoutineRun;
  readonly steps: readonly RoutineStepRun[];
}

export interface StartRoutineRunInput {
  readonly routineId: string;
  readonly localDate: string;
  readonly dayMode?: RoutineRunDayMode;
}

/** Täysi rutiinipäivä palkitsee sisällön laajuuden mukaan, minimipäivä kevyemmin. */
export const ROUTINE_COMPLETION_XP = DEFAULT_XP_RULES.routineCompletion;
export const ROUTINE_MINIMUM_DAY_XP = DEFAULT_XP_RULES.routineMinimumDay;

function validationError<T>(message: string, diagnosticCode: string): DataResult<T> {
  return { ok: false, error: invalidInput(diagnosticCode, message) };
}

async function getRoutine(
  deps: RoutineServiceDeps,
  routineId: string,
): Promise<DataResult<Routine>> {
  if (routineId.trim().length === 0) {
    return validationError("Rutiinin tunniste puuttuu.", "data.routine.validation.empty-id");
  }
  return deps.routines.getById(routineId);
}

async function getActiveRoutine(
  deps: RoutineServiceDeps,
  routineId: string,
): Promise<DataResult<Routine>> {
  const routine = await getRoutine(deps, routineId);
  if (!routine.ok) {
    return routine;
  }
  if (routine.value.deletedAt !== null || routine.value.archivedAt !== null) {
    return validationError(
      "Toiminto vaatii aktiivisen rutiinin.",
      "data.routine.validation.inactive",
    );
  }
  return routine;
}

async function withOptionalTransaction<T>(
  deps: RoutineServiceDeps,
  operation: () => Promise<DataResult<T>>,
): Promise<DataResult<T>> {
  if (deps.unitOfWork === undefined) {
    return operation();
  }
  return deps.unitOfWork.runInTransaction(operation);
}

export async function createRoutine(
  deps: RoutineServiceDeps,
  input: CreateRoutineInput,
): Promise<DataResult<Routine>> {
  const validated = validateRoutineValues(input);
  if (!validated.ok) {
    return validationError(validated.error.message, "data.routine.validation.invalid");
  }
  return deps.routines.create({
    ...validated.value,
    archivedAt: null,
    deletedAt: null,
  });
}

export async function createRoutineFromTemplate(
  deps: RoutineServiceDeps,
  input: CreateRoutineFromTemplateInput,
): Promise<DataResult<CreatedRoutineTemplate>> {
  const template = getRoutineTemplate(input.templateKey);
  if (template === null) {
    return validationError("Rutiinimallia ei löytynyt.", "data.routine-template.not-found");
  }
  return withOptionalTransaction(deps, async () => {
    const createdRoutine = await createRoutine(deps, {
      title: input.title?.trim() || template.title,
    });
    if (!createdRoutine.ok) {
      return createdRoutine;
    }
    const createdSteps: RoutineStep[] = [];
    for (const [sortOrder, templateStep] of template.steps.entries()) {
      const createdStep = await createRoutineStep(deps, {
        routineId: createdRoutine.value.id,
        title: templateStep.title,
        sortOrder,
        optional: templateStep.optional,
      });
      if (!createdStep.ok) {
        return createdStep;
      }
      createdSteps.push(createdStep.value);
    }
    return { ok: true, value: { routine: createdRoutine.value, steps: createdSteps } };
  });
}

export async function updateRoutineService(
  deps: RoutineServiceDeps,
  id: string,
  patch: UpdateRoutineInput,
): Promise<DataResult<Routine>> {
  const existing = await getRoutine(deps, id);
  if (!existing.ok) {
    return existing;
  }
  const validated = validateRoutineValues({
    title: patch.title ?? existing.value.title,
  });
  if (!validated.ok) {
    return validationError(validated.error.message, "data.routine.validation.invalid");
  }
  return deps.routines.update(id, validated.value);
}

export async function archiveRoutineService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<Routine>> {
  const existing = await getRoutine(deps, id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError(
      "Poistettua rutiinia ei voi arkistoida.",
      "data.routine.archive.deleted",
    );
  }
  return deps.routines.update(id, { archivedAt: deps.clock.nowIso() });
}

export async function unarchiveRoutineService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<Routine>> {
  const existing = await getRoutine(deps, id);
  if (!existing.ok) {
    return existing;
  }
  return deps.routines.update(id, { archivedAt: null });
}

export async function deleteRoutineService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<Routine>> {
  const existing = await getRoutine(deps, id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError("Rutiini on jo poistettu.", "data.routine.delete.invalid-transition");
  }
  return deps.routines.update(id, { deletedAt: deps.clock.nowIso() });
}

export async function restoreRoutineService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<Routine>> {
  const existing = await getRoutine(deps, id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt === null) {
    return validationError(
      "Vain poistettu rutiini voidaan palauttaa.",
      "data.routine.restore.invalid-transition",
    );
  }
  return deps.routines.update(id, { deletedAt: null });
}

export async function listRoutineSteps(
  deps: RoutineServiceDeps,
  routineId: string,
): Promise<DataResult<readonly RoutineStep[]>> {
  const routine = await getRoutine(deps, routineId);
  if (!routine.ok) {
    return routine;
  }
  const listed = await deps.routineSteps.list();
  if (!listed.ok) {
    return listed;
  }
  return {
    ok: true,
    value: listed.value
      .filter((step) => step.routineId === routineId && step.deletedAt === null)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
  };
}

export async function createRoutineStep(
  deps: RoutineServiceDeps,
  input: CreateRoutineStepInput,
): Promise<DataResult<RoutineStep>> {
  const routine = await getActiveRoutine(deps, input.routineId);
  if (!routine.ok) {
    return routine;
  }
  const steps = await listRoutineSteps(deps, input.routineId);
  if (!steps.ok) {
    return steps;
  }
  const sortOrder = input.sortOrder ?? steps.value.length;
  const validated = validateRoutineStepValues({ ...input, sortOrder });
  if (!validated.ok) {
    return validationError(validated.error.message, "data.routine-step.validation.invalid");
  }
  return deps.routineSteps.create({ ...validated.value, deletedAt: null });
}

export async function updateRoutineStepService(
  deps: RoutineServiceDeps,
  id: string,
  patch: UpdateRoutineStepInput,
): Promise<DataResult<RoutineStep>> {
  const existing = await deps.routineSteps.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const routine = await getActiveRoutine(deps, existing.value.routineId);
  if (!routine.ok) {
    return routine;
  }
  const validated = validateRoutineStepValues({
    routineId: existing.value.routineId,
    title: patch.title ?? existing.value.title,
    sortOrder: patch.sortOrder ?? existing.value.sortOrder,
    optional: patch.optional ?? existing.value.optional ?? false,
  });
  if (!validated.ok) {
    return validationError(validated.error.message, "data.routine-step.validation.invalid");
  }
  return deps.routineSteps.update(id, {
    title: validated.value.title,
    sortOrder: validated.value.sortOrder,
    optional: validated.value.optional,
  });
}

export async function deleteRoutineStepService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<RoutineStep>> {
  const existing = await deps.routineSteps.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError(
      "Rutiinin askel on jo poistettu.",
      "data.routine-step.delete.invalid-transition",
    );
  }
  return deps.routineSteps.update(id, { deletedAt: deps.clock.nowIso() });
}

export async function restoreRoutineStepService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<RoutineStep>> {
  const existing = await deps.routineSteps.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt === null) {
    return validationError(
      "Vain poistettu rutiinin askel voidaan palauttaa.",
      "data.routine-step.restore.invalid-transition",
    );
  }
  const routine = await getActiveRoutine(deps, existing.value.routineId);
  if (!routine.ok) {
    return routine;
  }
  return deps.routineSteps.update(id, { deletedAt: null });
}

export async function reorderRoutineSteps(
  deps: RoutineServiceDeps,
  routineId: string,
  orderedStepIds: readonly string[],
): Promise<DataResult<readonly RoutineStep[]>> {
  const routine = await getActiveRoutine(deps, routineId);
  if (!routine.ok) {
    return routine;
  }
  const steps = await listRoutineSteps(deps, routineId);
  if (!steps.ok) {
    return steps;
  }
  if (
    orderedStepIds.length !== steps.value.length ||
    new Set(orderedStepIds).size !== orderedStepIds.length ||
    orderedStepIds.some((id) => !steps.value.some((step) => step.id === id))
  ) {
    return validationError(
      "Järjestyslistan on sisällettävä jokainen rutiinin aktiivinen askel täsmälleen kerran.",
      "data.routine-step.reorder.invalid-list",
    );
  }
  return withOptionalTransaction(deps, async () => {
    const updated: RoutineStep[] = [];
    for (const [sortOrder, stepId] of orderedStepIds.entries()) {
      const result = await deps.routineSteps.update(stepId, { sortOrder });
      if (!result.ok) {
        return result;
      }
      updated.push(result.value);
    }
    return { ok: true, value: updated.sort((left, right) => left.sortOrder - right.sortOrder) };
  });
}

export async function listRoutineSchedules(
  deps: RoutineServiceDeps,
  routineId: string,
): Promise<DataResult<readonly RoutineSchedule[]>> {
  const routine = await getRoutine(deps, routineId);
  if (!routine.ok) {
    return routine;
  }
  const listed = await deps.routineSchedules.list();
  if (!listed.ok) {
    return listed;
  }
  return {
    ok: true,
    value: listed.value
      .filter((schedule) => schedule.routineId === routineId && schedule.deletedAt === null)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
  };
}

export async function createRoutineSchedule(
  deps: RoutineServiceDeps,
  input: CreateRoutineScheduleInput,
): Promise<DataResult<RoutineSchedule>> {
  const routine = await getActiveRoutine(deps, input.routineId);
  if (!routine.ok) {
    return routine;
  }
  const validated = validateRoutineScheduleValues({
    ...input,
    weekdays: input.weekdays ?? [],
  });
  if (!validated.ok) {
    return validationError(validated.error.message, "data.routine-schedule.validation.invalid");
  }
  return deps.routineSchedules.create({ ...validated.value, deletedAt: null });
}

export async function updateRoutineScheduleService(
  deps: RoutineServiceDeps,
  id: string,
  patch: UpdateRoutineScheduleInput,
): Promise<DataResult<RoutineSchedule>> {
  const existing = await deps.routineSchedules.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const routine = await getActiveRoutine(deps, existing.value.routineId);
  if (!routine.ok) {
    return routine;
  }
  const validated = validateRoutineScheduleValues({
    routineId: existing.value.routineId,
    cadence: patch.cadence ?? existing.value.cadence,
    weekdays: patch.weekdays ?? existing.value.weekdays,
    localTime: patch.localTime !== undefined ? patch.localTime : existing.value.localTime,
    enabled: patch.enabled ?? existing.value.enabled,
  });
  if (!validated.ok) {
    return validationError(validated.error.message, "data.routine-schedule.validation.invalid");
  }
  return deps.routineSchedules.update(id, validated.value);
}

export async function deleteRoutineScheduleService(
  deps: RoutineServiceDeps,
  id: string,
): Promise<DataResult<RoutineSchedule>> {
  const existing = await deps.routineSchedules.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return validationError(
      "Rutiinin aikataulu on jo poistettu.",
      "data.routine-schedule.delete.invalid-transition",
    );
  }
  return deps.routineSchedules.update(id, { deletedAt: deps.clock.nowIso() });
}

export function routineScheduledOnLocalDate(
  schedule: Pick<RoutineSchedule, "cadence" | "weekdays" | "enabled">,
  localDate: string,
): boolean {
  return isRoutineScheduledOnLocalDate(schedule, localDate);
}

export async function startRoutineRun(
  deps: RoutineServiceDeps,
  input: StartRoutineRunInput,
): Promise<DataResult<RoutineHistoryEntry>> {
  const routine = await getActiveRoutine(deps, input.routineId);
  if (!routine.ok) {
    return routine;
  }
  if (!isValidLocalDateKey(input.localDate)) {
    return validationError(
      "Rutiinin suoritukselle tarvitaan kelvollinen paikallinen päivä.",
      "data.routine-run.validation.invalid-date",
    );
  }
  const runs = await deps.routineRuns.list();
  if (!runs.ok) {
    return runs;
  }
  if (
    runs.value.some(
      (run) =>
        run.routineId === input.routineId &&
        run.localDate === input.localDate &&
        run.status !== "cancelled",
    )
  ) {
    return validationError(
      "Rutiinille on jo kirjattu suoritus tälle päivälle.",
      "data.routine-run.duplicate-date",
    );
  }
  const steps = await listRoutineSteps(deps, input.routineId);
  if (!steps.ok) {
    return steps;
  }
  return withOptionalTransaction(deps, async () => {
    const dayMode = input.dayMode ?? "full";
    const startedAt = deps.clock.nowIso();
    const run = await deps.routineRuns.create({
      routineId: input.routineId,
      localDate: input.localDate,
      status: "running",
      dayMode,
      startedAt,
      completedAt: null,
      skipReason: null,
    });
    if (!run.ok) {
      return run;
    }
    const stepRuns: RoutineStepRun[] = [];
    for (const [stepIndex, step] of steps.value.entries()) {
      const minimumDayStep = dayMode === "minimum" && stepIndex > 0;
      const stepRun = await deps.routineStepRuns.create({
        routineRunId: run.value.id,
        routineStepId: step.id,
        status: minimumDayStep ? "skipped" : "pending",
        completedAt: minimumDayStep ? startedAt : null,
        skipReason: minimumDayStep ? "Minimipäivä: kevyt tavoite." : null,
      });
      if (!stepRun.ok) {
        return stepRun;
      }
      stepRuns.push(stepRun.value);
    }
    return { ok: true, value: { run: run.value, steps: stepRuns } };
  });
}

export async function completeRoutineStep(
  deps: RoutineServiceDeps,
  stepRunId: string,
): Promise<DataResult<RoutineStepRun>> {
  const existing = await deps.routineStepRuns.getById(stepRunId);
  if (!existing.ok) {
    return existing;
  }
  if (routineStepRunIsComplete(existing.value)) {
    return validationError(
      "Rutiinin askel on jo käsitelty.",
      "data.routine-step-run.invalid-transition",
    );
  }
  const run = await deps.routineRuns.getById(existing.value.routineRunId);
  if (!run.ok) {
    return run;
  }
  if (run.value.status !== "running") {
    return validationError(
      "Vain käynnissä olevan rutiinin askelia voi käsitellä.",
      "data.routine-step-run.run-not-active",
    );
  }
  return deps.routineStepRuns.update(stepRunId, {
    status: "completed",
    completedAt: deps.clock.nowIso(),
    skipReason: null,
  });
}

export async function skipRoutineStep(
  deps: RoutineServiceDeps,
  stepRunId: string,
  reason: string,
): Promise<DataResult<RoutineStepRun>> {
  const existing = await deps.routineStepRuns.getById(stepRunId);
  if (!existing.ok) {
    return existing;
  }
  if (routineStepRunIsComplete(existing.value)) {
    return validationError(
      "Rutiinin askel on jo käsitelty.",
      "data.routine-step-run.invalid-transition",
    );
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return validationError(
      "Ohita askel antamalla lyhyt syy.",
      "data.routine-step-run.validation.empty-reason",
    );
  }
  const run = await deps.routineRuns.getById(existing.value.routineRunId);
  if (!run.ok) {
    return run;
  }
  if (run.value.status !== "running") {
    return validationError(
      "Vain käynnissä olevan rutiinin askelia voi käsitellä.",
      "data.routine-step-run.run-not-active",
    );
  }
  return deps.routineStepRuns.update(stepRunId, {
    status: "skipped",
    completedAt: deps.clock.nowIso(),
    skipReason: trimmedReason,
  });
}

export async function completeRoutineRun(
  deps: RoutineServiceDeps,
  runId: string,
): Promise<DataResult<RoutineRun>> {
  const existing = await deps.routineRuns.getById(runId);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.status !== "running") {
    return validationError(
      "Vain käynnissä oleva rutiini voidaan päättää.",
      "data.routine-run.invalid-transition",
    );
  }
  const listed = await deps.routineStepRuns.list();
  if (!listed.ok) {
    return listed;
  }
  if (
    listed.value.some(
      (stepRun) => stepRun.routineRunId === runId && !routineStepRunIsComplete(stepRun),
    )
  ) {
    return validationError(
      "Rutiinin kaikki askeleet on käsiteltävä ennen päättämistä.",
      "data.routine-run.pending-steps",
    );
  }
  const completed = await deps.routineRuns.update(runId, {
    status: "completed",
    completedAt: deps.clock.nowIso(),
    skipReason: null,
  });
  if (!completed.ok) {
    return completed;
  }

  // T156/T181: palkinto syntyy vasta kun koko suoritus on aidosti valmis.
  // Run-tunniste tekee retryistä idempotentteja eikä minimipäivä saa täyden
  // päivän määrää XP:tä.
  if (deps.xpTransactions !== undefined) {
    const amount = calculateXpAward(
      { kind: "routine-completed", dayMode: completed.value.dayMode ?? "full" },
      deps.xpRules,
    );
    if (amount !== null) {
      await createXpAward(deps.xpTransactions, {
        source: "routine",
        sourceEntityId: completed.value.id,
        amount,
        earnedAt: completed.value.completedAt ?? deps.clock.nowIso(),
        reason:
          completed.value.dayMode === "minimum" ? "Minimipäivä valmis." : "Rutiinipäivä valmis.",
      });
    }
  }
  return completed;
}

export async function skipRoutineRun(
  deps: RoutineServiceDeps,
  runId: string,
  reason: string,
): Promise<DataResult<RoutineRun>> {
  const existing = await deps.routineRuns.getById(runId);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.status !== "running") {
    return validationError(
      "Vain käynnissä oleva rutiini voidaan ohittaa.",
      "data.routine-run.invalid-transition",
    );
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length === 0) {
    return validationError(
      "Ohita rutiini antamalla lyhyt syy.",
      "data.routine-run.validation.empty-reason",
    );
  }
  return deps.routineRuns.update(runId, {
    status: "skipped",
    completedAt: deps.clock.nowIso(),
    skipReason: trimmedReason,
  });
}

export async function listRoutineHistory(
  deps: RoutineServiceDeps,
  routineId: string,
): Promise<DataResult<readonly RoutineHistoryEntry[]>> {
  const routine = await getRoutine(deps, routineId);
  if (!routine.ok) {
    return routine;
  }
  const [runs, stepRuns, steps] = await Promise.all([
    deps.routineRuns.list(),
    deps.routineStepRuns.list(),
    deps.routineSteps.list(),
  ]);
  if (!runs.ok) {
    return runs;
  }
  if (!stepRuns.ok) {
    return stepRuns;
  }
  if (!steps.ok) {
    return steps;
  }
  const sortOrderByStepId = new Map(
    steps.value
      .filter((step) => step.routineId === routineId)
      .map((step) => [step.id, step.sortOrder] as const),
  );
  return {
    ok: true,
    value: runs.value
      .filter((run) => run.routineId === routineId)
      .sort(
        (left, right) =>
          right.localDate.localeCompare(left.localDate) || right.id.localeCompare(left.id),
      )
      .map((run) => ({
        run,
        steps: stepRuns.value
          .filter((stepRun) => stepRun.routineRunId === run.id)
          .sort(
            (left, right) =>
              (sortOrderByStepId.get(left.routineStepId) ?? Number.MAX_SAFE_INTEGER) -
                (sortOrderByStepId.get(right.routineStepId) ?? Number.MAX_SAFE_INTEGER) ||
              left.id.localeCompare(right.id),
          ),
      })),
  };
}
