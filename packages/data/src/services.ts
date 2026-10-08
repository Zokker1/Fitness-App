// T032: service-kerros. Ainoa paikka jossa domain-säännöt (domain/rules.ts)
// yhdistyvät repository-kirjoituksiin. Komponentit kutsuvat vain näitä
// funktioita — ei completeTask/reopenTask/transitionFocus-kutsuja,
// ei version-kentän käsinlaskentaa komponenteissa.
//
// Säännöt:
// - Service validoi syötteen, hakee entiteetin, ajaa domain-säännön
//   eksplisiittisellä kellonajalla, tallentaa repositoryyn (version+1).
// - DomainResult-virhe -> DataResult invalid-input/invalid-transition;
//   tallennusvirhe läpi sellaisenaan.
// - Ei Reactia/selainta/SQL:ää/Drivea; ei Date.now:ta (kello injektoidaan).

import type {
  FocusPhase,
  FocusSession,
  Task,
  TaskRecurrence,
  XPTransaction,
  UtcTimestamp,
} from "@lifeos/domain";
import {
  completeTask,
  deleteTask,
  reopenTask,
  restoreTask,
  toLocalDateKey,
  transitionFocus,
} from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataError, type DataResult, invalidInput } from "./errors.ts";
import { nextRecurrenceDueAt } from "./recurrence.ts";
import type { EntityRepository } from "./repositories.ts";
import { calculateXpAward, DEFAULT_XP_RULES, type XpRules } from "./xp-rules.ts";
import { createXpAward, findXpAward } from "./xp-ledger.ts";

export interface ServiceDeps {
  readonly clock: Clock;
  /** T180: injektoitavat XP-säännöt; oletuksena käytetään keskitettyä configia. */
  readonly xpRules?: XpRules;
}

function domainErrorToData<T>(message: string, diagnosticCode: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(diagnosticCode, message),
  };
}

function nonEmptyTitle(title: string, entityType: string): DataError | null {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return invalidInput(`data.${entityType}.validation.empty-title`, "Otsikko ei saa olla tyhjä.");
  }
  if (trimmed.length > 200) {
    return invalidInput(
      `data.${entityType}.validation.title-too-long`,
      "Otsikko on liian pitkä (enintään 200 merkkiä).",
    );
  }
  return null;
}

export interface TaskServiceDeps extends ServiceDeps {
  readonly tasks: EntityRepository<Task>;
  /** T117: XP-repo — annetaan kun halutaan completion tuottavan XP:n
      (idempotentti: yksi XP-tapahtuma per tehtävä, ei XP-farmia reopenilla). */
  readonly xpTransactions?: EntityRepository<XPTransaction>;
}

/** T117: sääntöjen mukainen XP valmistuneesta tehtävästä (sama sääntö kuin
    seed-datassa: tasainen 10 XP per tehtävä — ei prioriteettikilpailua §9). */
export const TASK_COMPLETION_XP = DEFAULT_XP_RULES.taskCompletion;

export interface CreateTaskInput {
  readonly title: string;
  readonly notes?: string | null;
  readonly priority?: Task["priority"];
  readonly dueAt?: UtcTimestamp | null;
  readonly projectId?: Task["projectId"];
  readonly tagIds?: readonly string[];
  /** T110: toistuvuussääntö (valinnainen; vanha data ilman kenttää ok). */
  readonly recurrence?: TaskRecurrence | null;
  /** T111: arvioitu kesto minuutteina (valinnainen). */
  readonly estimateMinutes?: number | null;
}

export async function createTask(
  deps: TaskServiceDeps,
  input: CreateTaskInput,
): Promise<DataResult<Task>> {
  const titleError = nonEmptyTitle(input.title, "task");
  if (titleError !== null) {
    return { ok: false, error: titleError };
  }
  return deps.tasks.create({
    title: input.title.trim(),
    notes: input.notes ?? null,
    status: "open",
    priority: input.priority ?? "normal",
    dueAt: input.dueAt ?? null,
    projectId: input.projectId ?? null,
    tagIds: input.tagIds ?? [],
    deletedAt: null,
    completedAt: null,
    reopenedAt: null,
    recurrence: input.recurrence ?? null,
    estimateMinutes: input.estimateMinutes ?? null,
    actualSeconds: 0,
  });
}

/** T110-vaihtoehdot: offset vaaditaan toistuvan tehtävän seuraavan
    instanssin deterministiseen laskentaan (§50 — ei kellolta arvausta). */
export interface CompleteTaskOptions {
  readonly timezoneOffsetMinutes?: number;
}

export async function completeTaskService(
  deps: TaskServiceDeps,
  id: string,
  options: CompleteTaskOptions = {},
): Promise<DataResult<Task>> {
  const existing = await deps.tasks.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const at = deps.clock.nowIso();
  const transitioned = completeTask(existing.value, at);
  if (!transitioned.ok) {
    return domainErrorToData<Task>(
      transitioned.error.message,
      "data.task.complete.invalid-transition",
    );
  }
  const completed = await deps.tasks.update(id, {
    status: "done",
    completedAt: transitioned.value.completedAt,
  });
  // T110: toistuvassa tehtävässä luodaan seuraava instanssi deterministi-
  // sesti (sama sisältö, uusi id, dueAt = seuraava paikallispäivä samalla
  // kelloajalla). Ilman offsetia (vanhat kutsujat) instanssia ei luoda —
  // ei arvausta aikavyöhykkeestä (§50). Luontivirhe ei kumoa valmistumista.
  if (
    completed.ok &&
    completed.value.recurrence !== null &&
    completed.value.recurrence !== undefined &&
    options.timezoneOffsetMinutes !== undefined
  ) {
    const nextDueAt = nextRecurrenceDueAt(
      completed.value.recurrence,
      completed.value.dueAt,
      options.timezoneOffsetMinutes,
    );
    await deps.tasks.create({
      title: completed.value.title,
      notes: completed.value.notes,
      status: "open",
      priority: completed.value.priority,
      dueAt: nextDueAt,
      projectId: completed.value.projectId,
      tagIds: completed.value.tagIds,
      deletedAt: null,
      completedAt: null,
      reopenedAt: null,
      recurrence: completed.value.recurrence,
      estimateMinutes: completed.value.estimateMinutes ?? null,
      actualSeconds: 0,
    });
  }
  // T117/T181: XP idempotentisti — yksi XP-tapahtuma per tehtävä (sourceEntityId).
  // Reopen + uudelleen valmistuminen EI tuota uutta XP:tä (§9 ei XP-farmia).
  // XP-repo puuttuu → valmistuminen onnistuu ilman XP:tä (vanhat kutsujat).
  if (completed.ok && deps.xpTransactions !== undefined) {
    const amount = calculateXpAward({ kind: "task-completed" }, deps.xpRules);
    if (amount !== null) {
      await createXpAward(deps.xpTransactions, {
        source: "task",
        sourceEntityId: completed.value.id,
        amount,
        earnedAt: completed.value.completedAt ?? at,
        reason: null,
      });
    }
  }
  return completed;
}

/** T112: task detail -muokkaus. Vain mukana olleet kentät päivittyvät
    (Partial-patch); otsikko validoidaan; version+1 ja updatedAt reposta. */
export interface UpdateTaskInput {
  readonly title?: string;
  readonly notes?: string | null;
  readonly priority?: Task["priority"];
  readonly dueAt?: UtcTimestamp | null;
  readonly estimateMinutes?: number | null;
  readonly projectId?: Task["projectId"];
  readonly tagIds?: readonly string[];
  readonly recurrence?: TaskRecurrence | null;
}

export async function updateTaskService(
  deps: TaskServiceDeps,
  id: string,
  patch: UpdateTaskInput,
): Promise<DataResult<Task>> {
  const existing = await deps.tasks.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (patch.title !== undefined) {
    const titleError = nonEmptyTitle(patch.title, "task");
    if (titleError !== null) {
      return { ok: false, error: titleError };
    }
  }
  if (
    patch.estimateMinutes !== undefined &&
    patch.estimateMinutes !== null &&
    (!Number.isFinite(patch.estimateMinutes) || patch.estimateMinutes <= 0)
  ) {
    return {
      ok: false,
      error: invalidInput(
        "data.task.validation.bad-estimate",
        "Arvion on oltava positiivinen kokonaisluku minuutteina.",
      ),
    };
  }
  return deps.tasks.update(id, patch);
}

export async function reopenTaskService(
  deps: TaskServiceDeps,
  id: string,
): Promise<DataResult<Task>> {
  const existing = await deps.tasks.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const at = deps.clock.nowIso();
  const transitioned = reopenTask(existing.value, at);
  if (!transitioned.ok) {
    return domainErrorToData<Task>(
      transitioned.error.message,
      "data.task.reopen.invalid-transition",
    );
  }
  return deps.tasks.update(id, {
    status: "open",
    reopenedAt: transitioned.value.reopenedAt,
  });
}

// T100: pehmeä poisto + palautus — historian säilyttäminen (§8: tombstone,
// sync-kulutus B15/B16). Idempotenssi domain-säännöissä.
export async function deleteTaskService(
  deps: TaskServiceDeps,
  id: string,
): Promise<DataResult<Task>> {
  const existing = await deps.tasks.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const at = deps.clock.nowIso();
  const deleted = deleteTask(existing.value, at);
  if (!deleted.ok) {
    return domainErrorToData<Task>(deleted.error.message, "data.task.delete.invalid-transition");
  }
  return deps.tasks.update(id, { deletedAt: deleted.value.deletedAt });
}

export async function restoreTaskService(
  deps: TaskServiceDeps,
  id: string,
): Promise<DataResult<Task>> {
  const existing = await deps.tasks.getById(id);
  if (!existing.ok) {
    return existing;
  }
  const restored = restoreTask(existing.value);
  if (!restored.ok) {
    return domainErrorToData<Task>(restored.error.message, "data.task.restore.invalid-transition");
  }
  return deps.tasks.update(id, { deletedAt: null });
}

export interface FocusServiceDeps extends ServiceDeps {
  readonly sessions: EntityRepository<FocusSession>;
  /** T168: tarvitaan tehtävään linkitetyn valmistuneen fokuksen kirjaamiseen. */
  readonly tasks?: EntityRepository<Task>;
  /** T176: valmistunut fokus tuottaa XP-tapahtuman, kun repository on käytössä. */
  readonly xpTransactions?: EntityRepository<XPTransaction>;
  /** T176: paikallispäivän anti-gaming-raja lasketaan UI:n aikavyöhykkeellä. */
  readonly timezoneOffsetMinutes?: number;
}

export const FOCUS_SESSION_COMPLETION_XP = DEFAULT_XP_RULES.focusCompletion;
export const FOCUS_SESSION_MINIMUM_XP_SECONDS = DEFAULT_XP_RULES.focusMinimumActiveSeconds;
export const FOCUS_SESSION_DAILY_XP_CAP = DEFAULT_XP_RULES.focusDailyCap;

export interface StartFocusInput {
  readonly taskId?: FocusSession["taskId"];
  readonly routineId?: FocusSession["routineId"];
  readonly calendarBlockId?: NonNullable<FocusSession["calendarBlockId"]> | null;
  readonly plannedSeconds?: number | null;
}

function validatePlannedFocusSeconds(value: number | null | undefined): DataError | null {
  if (value !== undefined && value !== null && (!Number.isInteger(value) || value < 0)) {
    return invalidInput(
      "data.focus.validation.bad-planned-seconds",
      "Fokuksen suunnitellun keston on oltava vähintään nolla sekuntia.",
    );
  }
  return null;
}

export async function startFocusSession(
  deps: FocusServiceDeps,
  input: StartFocusInput = {},
): Promise<DataResult<FocusSession>> {
  const plannedSecondsError = validatePlannedFocusSeconds(input.plannedSeconds);
  if (plannedSecondsError !== null) {
    return { ok: false, error: plannedSecondsError };
  }
  return deps.sessions.create({
    taskId: input.taskId ?? null,
    routineId: input.routineId ?? null,
    calendarBlockId: input.calendarBlockId ?? null,
    phase: "planned",
    startedAt: null,
    endedAt: null,
    durationSeconds: input.plannedSeconds ?? null,
  });
}

async function transitionFocusSession(
  deps: FocusServiceDeps,
  id: string,
  to: FocusPhase,
  diagnosticCode = "data.focus.transition.invalid",
): Promise<DataResult<FocusSession>> {
  const existing = await deps.sessions.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (to === "completed" && existing.value.phase === "completed") {
    // Completion is safe to retry: recompute the task total from its completed
    // sessions instead of incrementing it a second time.
    const synchronized = await syncTaskActualSeconds(deps, existing.value);
    // XP is awarded only on the original running/paused -> completed transition;
    // replaying an imported or already-completed session must not mint XP.
    return synchronized.ok ? existing : synchronized;
  }
  if (to === "completed" && existing.value.taskId !== null && deps.tasks === undefined) {
    return {
      ok: false,
      error: invalidInput(
        "data.focus.finish.missing-task-repository",
        "Tehtävään liitetyn fokusajan kirjaaminen ei ole käytettävissä.",
      ),
    };
  }
  const transitioned = transitionFocus(existing.value, to);
  if (!transitioned.ok) {
    return domainErrorToData<FocusSession>(transitioned.error.message, diagnosticCode);
  }
  const now = deps.clock.nowIso();
  const activeStart = existing.value.activeSegmentStartedAt ?? existing.value.startedAt;
  const runningSegmentSeconds =
    existing.value.phase === "running" ? elapsedSeconds(activeStart, now) : 0;
  const elapsedBeforeTransition = existing.value.activeElapsedSeconds ?? 0;
  const base: Partial<FocusSession> = { phase: to };
  let patch: Partial<FocusSession>;
  if (to === "running") {
    const pauseSeconds =
      existing.value.phase === "paused" ? elapsedSeconds(existing.value.updatedAt, now) : 0;
    patch = {
      ...base,
      ...(existing.value.startedAt === null ? { startedAt: now } : {}),
      activeSegmentStartedAt: now,
      activeElapsedSeconds: elapsedBeforeTransition,
      accumulatedPauseSeconds: (existing.value.accumulatedPauseSeconds ?? 0) + pauseSeconds,
    };
  } else if (to === "paused") {
    patch = {
      ...base,
      activeSegmentStartedAt: null,
      activeElapsedSeconds: elapsedBeforeTransition + runningSegmentSeconds,
    };
  } else if (to === "completed") {
    const actualSeconds = elapsedBeforeTransition + runningSegmentSeconds;
    patch = {
      ...base,
      endedAt: now,
      durationSeconds: actualSeconds,
      activeElapsedSeconds: actualSeconds,
      activeSegmentStartedAt: null,
    };
  } else if (to === "cancelled") {
    patch = {
      ...base,
      endedAt: now,
      activeElapsedSeconds: elapsedBeforeTransition + runningSegmentSeconds,
      activeSegmentStartedAt: null,
    };
  } else {
    patch = base;
  }
  const updated = await deps.sessions.update(id, patch);
  if (!updated.ok || to !== "completed") {
    return updated;
  }
  const synchronized = await syncTaskActualSeconds(deps, updated.value);
  if (!synchronized.ok) {
    return synchronized;
  }
  await awardFocusCompletionXp(deps, updated.value);
  return updated;
}

async function awardFocusCompletionXp(
  deps: FocusServiceDeps,
  session: FocusSession,
): Promise<void> {
  const xpTransactions = deps.xpTransactions;
  const activeSeconds = session.activeElapsedSeconds ?? session.durationSeconds ?? 0;
  const earnedAt = session.endedAt;
  if (
    xpTransactions === undefined ||
    session.phase !== "completed" ||
    earnedAt === null ||
    !Number.isSafeInteger(activeSeconds)
  ) {
    return;
  }

  const listed = await xpTransactions.list();
  if (!listed.ok) {
    return;
  }
  if (findXpAward(listed.value, { source: "focus", sourceEntityId: session.id }) !== undefined) {
    return;
  }

  const timezoneOffsetMinutes = deps.timezoneOffsetMinutes ?? 0;
  const completionDay = toLocalDateKey(earnedAt, timezoneOffsetMinutes);
  const earnedToday = listed.value.reduce(
    (total, transaction) =>
      transaction.source === "focus" &&
      transaction.amount > 0 &&
      toLocalDateKey(transaction.earnedAt, timezoneOffsetMinutes) === completionDay
        ? total + transaction.amount
        : total,
    0,
  );
  const amount = calculateXpAward(
    { kind: "focus-completed", activeSeconds, earnedToday },
    deps.xpRules,
  );
  if (amount === null) {
    return;
  }

  await createXpAward(xpTransactions, {
    source: "focus",
    sourceEntityId: session.id,
    amount,
    earnedAt,
    reason: "Fokusjakso valmis.",
  });
}

function elapsedSeconds(start: string | null | undefined, end: string): number {
  if (start === null || start === undefined) {
    return 0;
  }
  const elapsed = Math.floor((Date.parse(end) - Date.parse(start)) / 1000);
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

async function syncTaskActualSeconds(
  deps: FocusServiceDeps,
  session: FocusSession,
): Promise<DataResult<FocusSession>> {
  if (session.taskId === null) {
    return { ok: true, value: session };
  }
  if (deps.tasks === undefined) {
    return {
      ok: false,
      error: invalidInput(
        "data.focus.finish.missing-task-repository",
        "Tehtävään liitetyn fokusajan kirjaaminen ei ole käytettävissä.",
      ),
    };
  }
  const task = await deps.tasks.getById(session.taskId);
  if (!task.ok) {
    return { ok: false, error: task.error };
  }
  const sessions = await deps.sessions.list();
  if (!sessions.ok) {
    return { ok: false, error: sessions.error };
  }
  const actualSeconds = sessions.value.reduce(
    (total, candidate) =>
      candidate.taskId === session.taskId &&
      candidate.phase === "completed" &&
      candidate.activeElapsedSeconds !== undefined
        ? total + Math.max(0, candidate.activeElapsedSeconds)
        : total,
    0,
  );
  const updatedTask = await deps.tasks.update(session.taskId, { actualSeconds });
  return updatedTask.ok ? { ok: true, value: session } : { ok: false, error: updatedTask.error };
}

/**
 * T160: planned-istunnon eksplisiittinen käynnistys.
 *
 * `startFocusSession` säilyttää T032-yhteensopivuuden ja luo suunnitellun
 * istunnon. Tämä operaatio tekee varsinaisen planned -> running -siirtymän.
 */
export async function beginFocusSession(
  deps: FocusServiceDeps,
  id: string,
): Promise<DataResult<FocusSession>> {
  return transitionFocusSession(deps, id, "running", "data.focus.begin.invalid-transition");
}

/** T160: running -> paused. */
export async function pauseFocusSession(
  deps: FocusServiceDeps,
  id: string,
): Promise<DataResult<FocusSession>> {
  return transitionFocusSession(deps, id, "paused", "data.focus.pause.invalid-transition");
}

/** T160: paused -> running. Alkuperäinen startedAt säilyy. */
export async function resumeFocusSession(
  deps: FocusServiceDeps,
  id: string,
): Promise<DataResult<FocusSession>> {
  return transitionFocusSession(deps, id, "running", "data.focus.resume.invalid-transition");
}

/** T160: running/paused -> completed. EndedAt täytetään kerran repository-päivityksessä. */
export async function finishFocusSession(
  deps: FocusServiceDeps,
  id: string,
): Promise<DataResult<FocusSession>> {
  return transitionFocusSession(deps, id, "completed", "data.focus.finish.invalid-transition");
}

/** T171: lisää käynnissä olevaan tai tauolla olevaan fokusjaksoon viisi minuuttia. */
export async function extendFocusSession(
  deps: FocusServiceDeps,
  id: string,
  additionalSeconds = 5 * 60,
): Promise<DataResult<FocusSession>> {
  if (!Number.isSafeInteger(additionalSeconds) || additionalSeconds <= 0) {
    return {
      ok: false,
      error: invalidInput(
        "data.focus.extend.invalid-duration",
        "Jatkon keston on oltava positiivinen kokonaismäärä sekunteja.",
      ),
    };
  }
  const existing = await deps.sessions.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (
    (existing.value.phase !== "running" && existing.value.phase !== "paused") ||
    existing.value.durationSeconds === null
  ) {
    return {
      ok: false,
      error: invalidInput(
        "data.focus.extend.invalid-transition",
        "Fokusjaksoa voi jatkaa vain käynnissä olevasta tai tauolla olevasta ajastetusta istunnosta.",
      ),
    };
  }
  return deps.sessions.update(id, {
    durationSeconds: existing.value.durationSeconds + additionalSeconds,
  });
}

/** T172: kirjaa yksi käyttäjän ilmoittama keskeytys aktiiviseen fokusistuntoon. */
export async function recordFocusInterruption(
  deps: FocusServiceDeps,
  id: string,
): Promise<DataResult<FocusSession>> {
  const existing = await deps.sessions.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.phase !== "running" && existing.value.phase !== "paused") {
    return {
      ok: false,
      error: invalidInput(
        "data.focus.interruption.invalid-transition",
        "Keskeytyksen voi kirjata käynnissä olevaan tai tauolla olevaan fokusistuntoon.",
      ),
    };
  }
  const count = existing.value.interruptionCount ?? 0;
  if (!Number.isSafeInteger(count) || count < 0 || count >= Number.MAX_SAFE_INTEGER) {
    return {
      ok: false,
      error: invalidInput(
        "data.focus.interruption.invalid-count",
        "Keskeytysten määrää ei voitu päivittää.",
      ),
    };
  }
  return deps.sessions.update(id, { interruptionCount: count + 1 });
}

/**
 * T160/T177: planned/running/paused -> cancelled. Historia ja aktiivinen aika
 * säilyvät, mutta peruutus ei tuota XP:tä eikä negatiivista jatkuvuusmerkintää.
 */
export async function cancelFocusSession(
  deps: FocusServiceDeps,
  id: string,
): Promise<DataResult<FocusSession>> {
  return transitionFocusSession(deps, id, "cancelled", "data.focus.cancel.invalid-transition");
}

/**
 * T032-yhteensopiva yleissiirtymä. Uusi tuotantokoodi käyttää nimettyjä
 * elinkaarifunktioita yllä; tämä jää vanhoille kutsujille ja matalan tason
 * integraatioille, jotka tarvitsevat domainin salliman siirtymän suoraan.
 */
export async function moveFocusSession(
  deps: FocusServiceDeps,
  id: string,
  to: FocusPhase,
): Promise<DataResult<FocusSession>> {
  return transitionFocusSession(deps, id, to);
}
