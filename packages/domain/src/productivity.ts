// T026: tuottavuus-domain (tasks, projektit, tagit, kalenteri,
// tavoitteet, tavat, rutiinit, fokus). Lähde §33 + B05–B08.
// Ajoitus säilytetään UTC:ssa; toistuvuus kuvataan deklaratiivisesti
// (laajennus B05–B07:ssä), ei ajastinlogiikkana domainissa.

import type { BaseEntity, EntityId, SoftDeletable, UtcTimestamp } from "./base.ts";

export type TaskStatus = "open" | "done";
export type TaskPriority = "low" | "normal" | "high";

/** T110: toistuvuussääntö (deklaratiivinen). Seuraava instanssi lasketaan
    deterministisesti valmistuneen instanssin paikallispäivästä (§50).
    weekdays: 1 = maanantai … 7 = sunnuntai. dayOfMonth: 1..31, clamp
    kuukauden pituuteen (31.1. → 28.2./29.2.). */
export type TaskRecurrence =
  | { readonly kind: "daily"; readonly everyDays: number }
  | {
      readonly kind: "weekly";
      readonly everyWeeks: number;
      readonly weekdays: readonly number[];
    }
  | { readonly kind: "monthly"; readonly everyMonths: number; readonly dayOfMonth: number }
  | { readonly kind: "custom"; readonly every: number; readonly unit: "day" | "week" | "month" };

export interface Task extends BaseEntity, SoftDeletable {
  readonly title: string;
  readonly notes: string | null;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly dueAt: UtcTimestamp | null;
  readonly projectId: EntityId | null;
  readonly tagIds: readonly EntityId[];
  readonly completedAt: UtcTimestamp | null;
  readonly reopenedAt: UtcTimestamp | null;
  /** T110: toistuvuussääntö; puuttuu/null → ei toistuva (vanha data ok). */
  readonly recurrence?: TaskRecurrence | null;
  /** T111: arvioitu kesto minuutteina (valinnainen; §5 suunnittelu +
      §8 timebox-ehdotus). Ei arviota → null/puuttuu. */
  readonly estimateMinutes?: number | null;
  /** T168: valmistuneista fokusistunnoista johdettu toteutunut aika sekunteina. */
  readonly actualSeconds?: number;
}

export interface TaskChecklistItem extends BaseEntity, SoftDeletable {
  readonly taskId: EntityId;
  readonly title: string;
  readonly done: boolean;
  readonly sortOrder: number;
}

export interface Project extends BaseEntity, SoftDeletable {
  readonly name: string;
  readonly colorKey: string | null;
  readonly archivedAt: UtcTimestamp | null;
}

export interface Tag extends BaseEntity, SoftDeletable {
  readonly name: string;
  readonly colorKey: string | null;
}

export type CalendarBlockKind = "task" | "routine" | "focus" | "event";

export interface CalendarBlock extends BaseEntity, SoftDeletable {
  readonly kind: CalendarBlockKind;
  readonly title: string;
  readonly startsAt: UtcTimestamp;
  readonly endsAt: UtcTimestamp;
  readonly linkedTaskId: EntityId | null;
  readonly linkedRoutineId: EntityId | null;
}

export interface Goal extends BaseEntity, SoftDeletable {
  readonly title: string;
  readonly description: string | null;
  /** T140: paikallinen kalenteripäivä "YYYY-MM-DD"; puuttuva = avoin alku. */
  readonly activeFrom?: string | null;
  /** T140: paikallinen kalenteripäivä "YYYY-MM-DD"; puuttuva = avoin loppu. */
  readonly activeUntil?: string | null;
  readonly archivedAt: UtcTimestamp | null;
}

export type HabitCadence = "daily" | "weekly" | "custom";

export interface HabitRule extends BaseEntity, SoftDeletable {
  readonly goalId: EntityId | null;
  readonly title: string;
  readonly cadence: HabitCadence;
  /** Kohdemäärä jaksoa kohti (esim. 5/vko). */
  readonly targetPerPeriod: number;
}

export interface GoalDay extends BaseEntity {
  readonly goalId: EntityId;
  /** Paikallinen kalenteripäivä "YYYY-MM-DD" (lähde: UI-kerroksen aikavyöhyke). */
  readonly localDate: string;
  readonly completed: boolean;
}

export interface Routine extends BaseEntity, SoftDeletable {
  readonly title: string;
  readonly archivedAt: UtcTimestamp | null;
}

export interface RoutineStep extends BaseEntity, SoftDeletable {
  readonly routineId: EntityId;
  readonly title: string;
  readonly sortOrder: number;
  /** T151: vaihe voidaan ohittaa perustellulla kirjauksella. Puuttuva arvo
      tulkitaan vanhassa datassa pakolliseksi. */
  readonly optional?: boolean;
}

/** T149: rutiinin aikataulu on erillinen rutiinin sisällöstä. */
export type RoutineScheduleCadence = "daily" | "weekly";

export interface RoutineSchedule extends BaseEntity, SoftDeletable {
  readonly routineId: EntityId;
  readonly cadence: RoutineScheduleCadence;
  /** ISO-viikonpäivät 1 = maanantai … 7 = sunnuntai; daily käyttää tyhjää listaa. */
  readonly weekdays: readonly number[];
  /** Paikallinen kellonaika HH:mm tai null, jos tarkkaa aikaa ei ole valittu. */
  readonly localTime: string | null;
  readonly enabled: boolean;
}

/** T149: rutiinin append-only suoritushistoria. */
export type RoutineRunStatus = "running" | "completed" | "skipped" | "cancelled";
/** T154: käyttäjän valitsema päivän tavoitetaso; puuttuva vanhassa datassa = full. */
export type RoutineRunDayMode = "full" | "minimum";

export interface RoutineRun extends BaseEntity {
  readonly routineId: EntityId;
  readonly localDate: string;
  readonly status: RoutineRunStatus;
  readonly dayMode?: RoutineRunDayMode;
  readonly startedAt: UtcTimestamp;
  readonly completedAt: UtcTimestamp | null;
  readonly skipReason: string | null;
}

export type RoutineStepRunStatus = "pending" | "completed" | "skipped";

export interface RoutineStepRun extends BaseEntity {
  readonly routineRunId: EntityId;
  readonly routineStepId: EntityId;
  readonly status: RoutineStepRunStatus;
  readonly completedAt: UtcTimestamp | null;
  readonly skipReason: string | null;
}

export type FocusPhase = "planned" | "running" | "paused" | "completed" | "cancelled";

export interface FocusSession extends BaseEntity {
  readonly taskId: EntityId | null;
  readonly routineId: EntityId | null;
  /** T170: suunniteltu kalenteriblokki, josta fokusistunto käynnistettiin. */
  readonly calendarBlockId?: EntityId | null;
  readonly phase: FocusPhase;
  readonly startedAt: UtcTimestamp | null;
  readonly endedAt: UtcTimestamp | null;
  /** Suunniteltu kesto aktiivisessa istunnossa; toteutunut kesto istunnon päätyttyä. */
  readonly durationSeconds: number | null;
  /** T168: toteutuneet aktiiviset fokussekunnit, tauot pois lukien. */
  readonly activeElapsedSeconds?: number;
  /** T168: käynnissä olevan aktiivisen jakson alku; null tauolla/valmiina. */
  readonly activeSegmentStartedAt?: UtcTimestamp | null;
  /** T168: kokonaiset taukosekunnit countdownin jatkamiseen. */
  readonly accumulatedPauseSeconds?: number;
  /** T172: käyttäjän itse kirjaamien keskeytysten määrä tässä istunnossa. */
  readonly interruptionCount?: number;
}

export interface Distraction extends BaseEntity {
  readonly focusSessionId: EntityId;
  readonly notedAt: UtcTimestamp;
  readonly note: string | null;
}
