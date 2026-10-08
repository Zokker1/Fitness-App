// T149: Routine-palvelun syötevalidointi ja aikataulun puhtaat säännöt.
// Päivämäärät ovat paikallisia päiväavaimia; kellonaika tallennetaan vain
// käyttäjän ilmoittamana HH:mm-arvona eikä sitä muuteta hetkeksi tässä kerroksessa.

import type { RoutineSchedule, RoutineScheduleCadence, RoutineStepRun } from "./productivity.ts";
import { isValidLocalDateKey } from "./goals.ts";
import type { UtcTimestamp } from "./base.ts";
import type { DomainResult } from "./rules.ts";

export interface RoutineValues {
  readonly title: string;
}

export interface RoutineStepValues {
  readonly routineId: string;
  readonly title: string;
  readonly sortOrder: number;
  readonly optional: boolean;
}

export interface RoutineScheduleValues {
  readonly routineId: string;
  readonly cadence: RoutineScheduleCadence;
  readonly weekdays: readonly number[];
  readonly localTime: string | null;
  readonly enabled: boolean;
}

function invalid(message: string): DomainResult<never> {
  return { ok: false, error: { code: "invalid-input", message } };
}

function validateTitle(title: string, subject: string): DomainResult<string> {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return invalid(`${subject} ei saa olla tyhjä.`);
  }
  if (trimmed.length > 200) {
    return invalid(`${subject} on liian pitkä (enintään 200 merkkiä).`);
  }
  return { ok: true, value: trimmed };
}

function validId(id: string, subject: string): DomainResult<string> {
  if (id.trim().length === 0) {
    return invalid(`${subject} puuttuu.`);
  }
  return { ok: true, value: id };
}

export function validateRoutineValues(input: { title: string }): DomainResult<RoutineValues> {
  const title = validateTitle(input.title, "Rutiinin nimi");
  return title.ok ? { ok: true, value: { title: title.value } } : title;
}

export function validateRoutineStepValues(input: {
  routineId: string;
  title: string;
  sortOrder: number;
  optional?: boolean;
}): DomainResult<RoutineStepValues> {
  const routineId = validId(input.routineId, "Rutiinin tunniste");
  if (!routineId.ok) {
    return routineId;
  }
  const title = validateTitle(input.title, "Askeleen nimi");
  if (!title.ok) {
    return title;
  }
  if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
    return invalid("Askeleen järjestysnumeron on oltava epänegatiivinen kokonaisluku.");
  }
  return {
    ok: true,
    value: {
      routineId: routineId.value,
      title: title.value,
      sortOrder: input.sortOrder,
      optional: input.optional ?? false,
    },
  };
}

function validateLocalTime(localTime: string | null): boolean {
  if (localTime === null) {
    return true;
  }
  if (!/^\d{2}:\d{2}$/.test(localTime)) {
    return false;
  }
  const [hoursText, minutesText] = localTime.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function validateRoutineScheduleValues(input: {
  routineId: string;
  cadence: RoutineScheduleCadence;
  weekdays: readonly number[];
  localTime?: string | null;
  enabled?: boolean;
}): DomainResult<RoutineScheduleValues> {
  const routineId = validId(input.routineId, "Rutiinin tunniste");
  if (!routineId.ok) {
    return routineId;
  }
  const supportedCadences: ReadonlySet<string> = new Set(["daily", "weekly"]);
  if (!supportedCadences.has(input.cadence)) {
    return invalid("Aikataulun on oltava päivittäinen tai viikoittainen.");
  }
  const weekdays = [...input.weekdays];
  if (
    weekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7) ||
    new Set(weekdays).size !== weekdays.length
  ) {
    return invalid("Viikonpäivien on oltava yksilöllisiä kokonaislukuja väliltä 1–7.");
  }
  if (input.cadence === "daily" && weekdays.length !== 0) {
    return invalid("Päivittäinen aikataulu ei tarvitse viikonpäiviä.");
  }
  if (input.cadence === "weekly" && weekdays.length === 0) {
    return invalid("Viikoittaiselle aikataululle on valittava vähintään yksi viikonpäivä.");
  }
  if (!validateLocalTime(input.localTime ?? null)) {
    return invalid("Kellonajan on oltava muodossa HH:mm.");
  }
  return {
    ok: true,
    value: {
      routineId: routineId.value,
      cadence: input.cadence,
      weekdays: weekdays.sort((left, right) => left - right),
      localTime: input.localTime ?? null,
      enabled: input.enabled ?? true,
    },
  };
}

function isoWeekday(localDate: string): number {
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export function isRoutineScheduledOnLocalDate(
  schedule: Pick<RoutineSchedule, "cadence" | "weekdays" | "enabled">,
  localDate: string,
): boolean {
  if (!schedule.enabled || !isValidLocalDateKey(localDate)) {
    return false;
  }
  return schedule.cadence === "daily" || schedule.weekdays.includes(isoWeekday(localDate));
}

export function routineStepRunIsComplete(stepRun: Pick<RoutineStepRun, "status">): boolean {
  return stepRun.status === "completed" || stepRun.status === "skipped";
}

export function routineRunCompletionTime(
  startedAt: UtcTimestamp,
  completedAt: UtcTimestamp | null,
): DomainResult<UtcTimestamp> {
  if (completedAt === null || completedAt >= startedAt) {
    return { ok: true, value: completedAt ?? startedAt };
  }
  return invalid("Rutiinin päättymisaika ei voi olla ennen alkamisaikaa.");
}
