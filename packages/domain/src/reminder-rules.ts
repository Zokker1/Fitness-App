// T280: puhdas muistutussääntöjen validointi ja arviointi.
// Kutsu antaa kellonajan sekä paikallisen päivä-/aikakontekstin eksplisiittisesti;
// tässä kerroksessa ei käytetä selainta, tallennusta, ajastinta tai Date.now():ta.

import { HYDRATION_TARGET_ML_MAXIMUM } from "./identity.ts";
import type {
  ConditionalReminderRule,
  DeadlineReminderRule,
  ReminderRule,
  ReminderRuleEvaluation,
  ReminderRuleEvaluationInput,
  ReminderRuleNotDueReason,
  ReminderSchedule,
  ReminderSubject,
  RecurringReminderRule,
  TimeReminderRule,
} from "./reminders.ts";
import type { DomainResult } from "./rules.ts";
import type { UtcTimestamp } from "./base.ts";

export const REMINDER_DEADLINE_LEAD_MINUTES_MAXIMUM = 10_080;

const UTC_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every((key) => allowed.includes(key));
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function invalid<T>(message: string): DomainResult<T> {
  return { ok: false, error: { code: "invalid-input", message } };
}

function canonicalUtcTimestamp(value: unknown): UtcTimestamp | null {
  if (typeof value !== "string") return null;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null || Number.isNaN(Date.parse(value))) return null;

  const [, year, month, day, hour, minute, second, fractionText] = match;
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }

  const fraction = (fractionText ?? "").padEnd(3, "0");
  const canonical = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction}Z`;
  return new Date(value).toISOString() === canonical ? canonical : null;
}

function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) return false;
  const instant = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(instant) && new Date(instant).toISOString().slice(0, 10) === value;
}

function isValidLocalTime(value: unknown): value is string {
  return typeof value === "string" && LOCAL_TIME_PATTERN.test(value);
}

function validateSubject(value: unknown): ReminderSubject | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !hasOnlyKeys(value, ["kind", "id"])) return null;
  if (
    (value.kind !== "task" && value.kind !== "routine" && value.kind !== "goal") ||
    typeof value.id !== "string" ||
    value.id.trim().length === 0 ||
    value.id.length > 200 ||
    hasControlCharacters(value.id)
  ) {
    return null;
  }
  return { kind: value.kind, id: value.id };
}

function validateSchedule(value: unknown): ReminderSchedule | null {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["cadence", "localTime", "weekdays"]) ||
    (value.cadence !== "daily" && value.cadence !== "weekly") ||
    !isValidLocalTime(value.localTime) ||
    !Array.isArray(value.weekdays)
  ) {
    return null;
  }

  const weekdays = value.weekdays as unknown[];
  if (
    weekdays.some(
      (day) => typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 7,
    ) ||
    new Set(weekdays).size !== weekdays.length ||
    (value.cadence === "daily" && weekdays.length !== 0) ||
    (value.cadence === "weekly" && weekdays.length === 0)
  ) {
    return null;
  }

  return {
    cadence: value.cadence,
    localTime: value.localTime,
    weekdays: weekdays.map((day) => Number(day)).sort((left, right) => left - right),
  };
}

/** Validoi ja normalisoi epäluotetun, sarjoitettavan muistutussäännön. */
export function validateReminderRule(input: unknown): DomainResult<ReminderRule> {
  if (!isRecord(input) || typeof input.kind !== "string") {
    return invalid("Muistutussääntö on virheellinen.");
  }

  const subject = validateSubject(input.subject);
  if (subject === null) return invalid("Muistutuksen kohdeviite ei kelpaa.");
  const withSubject = subject === undefined ? {} : { subject };

  if (input.kind === "time") {
    if (!hasOnlyKeys(input, ["kind", "at", "subject"])) {
      return invalid("Kertamuistutuksessa on tuntemattomia tietoja.");
    }
    const at = canonicalUtcTimestamp(input.at);
    return at === null
      ? invalid("Kertamuistutuksen ajankohta ei ole kelvollinen UTC-aikaleima.")
      : { ok: true, value: { kind: "time", at, ...withSubject } satisfies TimeReminderRule };
  }

  if (input.kind === "deadline") {
    if (!hasOnlyKeys(input, ["kind", "dueAt", "minutesBefore", "subject"])) {
      return invalid("Deadline-muistutuksessa on tuntemattomia tietoja.");
    }
    const dueAt = canonicalUtcTimestamp(input.dueAt);
    const minutesBefore = input.minutesBefore;
    if (dueAt === null) return invalid("Deadlinen ajankohta ei ole kelvollinen UTC-aikaleima.");
    if (
      typeof minutesBefore !== "number" ||
      !Number.isInteger(minutesBefore) ||
      minutesBefore < 0 ||
      minutesBefore > REMINDER_DEADLINE_LEAD_MINUTES_MAXIMUM
    ) {
      return invalid(
        `Deadlinen ennakkoajan tulee olla kokonaisluku väliltä 0–${String(REMINDER_DEADLINE_LEAD_MINUTES_MAXIMUM)} minuuttia.`,
      );
    }
    return {
      ok: true,
      value: {
        kind: "deadline",
        dueAt,
        minutesBefore,
        ...withSubject,
      } satisfies DeadlineReminderRule,
    };
  }

  if (input.kind === "recurring") {
    if (!hasOnlyKeys(input, ["kind", "schedule", "subject"])) {
      return invalid("Toistuvassa muistutuksessa on tuntemattomia tietoja.");
    }
    const schedule = validateSchedule(input.schedule);
    return schedule === null
      ? invalid("Toistuvan muistutuksen päivä, kellonaika tai viikonpäivät eivät kelpaa.")
      : {
          ok: true,
          value: { kind: "recurring", schedule, ...withSubject } satisfies RecurringReminderRule,
        };
  }

  if (input.kind === "conditional") {
    if (!hasOnlyKeys(input, ["kind", "schedule", "condition", "subject"])) {
      return invalid("Ehtomuistutuksessa on tuntemattomia tietoja.");
    }
    const schedule = validateSchedule(input.schedule);
    if (schedule === null) {
      return invalid("Ehtomuistutuksen päivä, kellonaika tai viikonpäivät eivät kelpaa.");
    }
    if (
      !isRecord(input.condition) ||
      !hasOnlyKeys(input.condition, ["kind", "targetMilliliters"]) ||
      input.condition.kind !== "hydration-below"
    ) {
      return invalid("Ehtomuistutuksen ehto ei ole tuettu.");
    }
    const targetMilliliters = input.condition.targetMilliliters;
    if (
      typeof targetMilliliters !== "number" ||
      !Number.isInteger(targetMilliliters) ||
      targetMilliliters < 1 ||
      targetMilliliters > HYDRATION_TARGET_ML_MAXIMUM
    ) {
      return invalid(
        `Nestemäärän rajan tulee olla kokonaisluku väliltä 1–${String(HYDRATION_TARGET_ML_MAXIMUM)} ml.`,
      );
    }
    return {
      ok: true,
      value: {
        kind: "conditional",
        schedule,
        condition: { kind: "hydration-below", targetMilliliters },
        ...withSubject,
      } satisfies ConditionalReminderRule,
    };
  }

  return invalid("Muistutuksen tyyppi ei ole tuettu.");
}

interface NormalizedEvaluationInput {
  readonly reminderId: string;
  readonly enabled: boolean;
  readonly deletedAt: UtcTimestamp | null;
  readonly now: UtcTimestamp;
  readonly rule: ReminderRule;
  readonly localDate: string | null;
  readonly localTime: string | null;
  readonly hydrationMillilitersToday: number | null;
}

function normalizeEvaluationInput(input: unknown): DomainResult<NormalizedEvaluationInput> {
  const allowedKeys = [
    "reminderId",
    "rule",
    "enabled",
    "deletedAt",
    "now",
    "localDate",
    "localTime",
    "hydrationMillilitersToday",
  ];
  if (!isRecord(input) || !hasOnlyKeys(input, allowedKeys)) {
    return invalid("Muistutuksen arviointitiedot ovat virheelliset.");
  }

  if (
    typeof input.reminderId !== "string" ||
    input.reminderId.trim().length === 0 ||
    input.reminderId.length > 200 ||
    hasControlCharacters(input.reminderId) ||
    typeof input.enabled !== "boolean"
  ) {
    return invalid("Muistutuksen tunniste tai käyttötila ei kelpaa.");
  }
  const now = canonicalUtcTimestamp(input.now);
  if (now === null) return invalid("Arviointihetki ei ole kelvollinen UTC-aikaleima.");

  let deletedAt: UtcTimestamp | null;
  if (input.deletedAt === null) {
    deletedAt = null;
  } else {
    deletedAt = canonicalUtcTimestamp(input.deletedAt);
    if (deletedAt === null) return invalid("Poistoaika ei ole kelvollinen UTC-aikaleima.");
  }

  const ruleResult = validateReminderRule(input.rule);
  if (!ruleResult.ok) return ruleResult;
  const base = {
    reminderId: input.reminderId,
    enabled: input.enabled,
    deletedAt,
    now,
  };

  if (ruleResult.value.kind === "recurring" || ruleResult.value.kind === "conditional") {
    if (!isValidLocalDate(input.localDate) || !isValidLocalTime(input.localTime)) {
      return invalid("Toistuva muistutus tarvitsee kelvollisen paikallisen päivän ja kellonajan.");
    }
    if (ruleResult.value.kind === "recurring") {
      if (Object.hasOwn(input, "hydrationMillilitersToday")) {
        return invalid("Toistuvan muistutuksen arvioinnissa on tarpeettomia ehtotietoja.");
      }
      return {
        ok: true,
        value: {
          ...base,
          rule: ruleResult.value,
          localDate: input.localDate,
          localTime: input.localTime,
          hydrationMillilitersToday: null,
        },
      };
    }

    const hydrationMillilitersToday = input.hydrationMillilitersToday;
    if (
      hydrationMillilitersToday !== null &&
      (typeof hydrationMillilitersToday !== "number" ||
        !Number.isSafeInteger(hydrationMillilitersToday) ||
        hydrationMillilitersToday < 0)
    ) {
      return invalid("Paikallisen päivän nestemäärä ei kelpaa.");
    }
    return {
      ok: true,
      value: {
        ...base,
        rule: ruleResult.value,
        localDate: input.localDate,
        localTime: input.localTime,
        hydrationMillilitersToday,
      },
    };
  }

  if (
    Object.hasOwn(input, "localDate") ||
    Object.hasOwn(input, "localTime") ||
    Object.hasOwn(input, "hydrationMillilitersToday")
  ) {
    return invalid("Kertamuistutuksen arvioinnissa on tarpeettomia paikallisaikatietoja.");
  }
  return {
    ok: true,
    value: {
      ...base,
      rule: ruleResult.value,
      localDate: null,
      localTime: null,
      hydrationMillilitersToday: null,
    },
  };
}

function makeNotDue(reason: ReminderRuleNotDueReason): ReminderRuleEvaluation {
  return { due: false, reason };
}

function isScheduledOnLocalDate(schedule: ReminderSchedule, localDate: string): boolean {
  if (schedule.cadence === "daily") return true;
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  const isoWeekday = day === 0 ? 7 : day;
  return schedule.weekdays.includes(isoWeekday);
}

/** Arvioi yhden muistutuksen yhden ajokerran; tulos ei tee IO:ta eikä lue kelloa. */
export function evaluateReminderRule(
  input: ReminderRuleEvaluationInput,
): DomainResult<ReminderRuleEvaluation> {
  const normalized = normalizeEvaluationInput(input);
  if (!normalized.ok) return normalized;

  const value = normalized.value;
  if (!value.enabled) return { ok: true, value: makeNotDue("disabled") };
  if (value.deletedAt !== null) return { ok: true, value: makeNotDue("deleted") };

  const nowMillis = Date.parse(value.now);
  if (value.rule.kind === "time") {
    const at = canonicalUtcTimestamp(value.rule.at);
    if (at === null) return invalid("Kertamuistutuksen ajankohta ei kelpaa.");
    if (nowMillis < Date.parse(at)) return { ok: true, value: makeNotDue("not-scheduled") };
    return {
      ok: true,
      value: {
        due: true,
        occurrenceKey: `${value.reminderId}:time:${at}`,
        scheduledAt: at,
        localDate: null,
        localTime: null,
      },
    };
  }

  if (value.rule.kind === "deadline") {
    const dueAt = canonicalUtcTimestamp(value.rule.dueAt);
    if (
      dueAt === null ||
      !Number.isInteger(value.rule.minutesBefore) ||
      value.rule.minutesBefore < 0 ||
      value.rule.minutesBefore > REMINDER_DEADLINE_LEAD_MINUTES_MAXIMUM
    ) {
      return invalid("Deadline-muistutuksen säännössä on virheellisiä arvoja.");
    }
    const scheduledAt = new Date(
      Date.parse(dueAt) - value.rule.minutesBefore * 60_000,
    ).toISOString();
    if (nowMillis < Date.parse(scheduledAt)) {
      return { ok: true, value: makeNotDue("not-scheduled") };
    }
    return {
      ok: true,
      value: {
        due: true,
        occurrenceKey: `${value.reminderId}:deadline:${dueAt}:${String(value.rule.minutesBefore)}`,
        scheduledAt,
        localDate: null,
        localTime: null,
      },
    };
  }

  if (value.localDate === null || value.localTime === null) {
    return invalid("Toistuva muistutus tarvitsee paikallisen päivä- ja aikatiedon.");
  }

  const { localDate, localTime } = value;
  const rule = value.rule;
  const schedule = rule.schedule;
  const isExpectedWeekday = isScheduledOnLocalDate(schedule, localDate);
  if (localTime !== schedule.localTime || !isExpectedWeekday) {
    return { ok: true, value: makeNotDue("not-scheduled") };
  }

  if (rule.kind === "conditional") {
    if (value.hydrationMillilitersToday === null) {
      return { ok: true, value: makeNotDue("condition-unavailable") };
    }
    if (value.hydrationMillilitersToday >= rule.condition.targetMilliliters) {
      return { ok: true, value: makeNotDue("condition-not-met") };
    }
  }

  return {
    ok: true,
    value: {
      due: true,
      occurrenceKey: `${value.reminderId}:${rule.kind}:${localDate}:${schedule.localTime}`,
      scheduledAt: null,
      localDate,
      localTime: schedule.localTime,
    },
  };
}
