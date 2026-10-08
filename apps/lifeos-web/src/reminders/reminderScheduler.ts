// T281: selainajastin laskee muistutukset nykytilasta, joten välilehden
// herääminen ei riipu aiemman setTimeout-ketjun ajoituksesta.
import type {
  HydrationEntry,
  Reminder,
  ReminderKind,
  ReminderRuleEvaluation,
  UtcTimestamp,
} from "@lifeos/domain";
import { evaluateReminderRule, resolveNotificationCategoryKey } from "@lifeos/domain";
import type { NotificationCategoryKey } from "@lifeos/domain";
import {
  summarizeHydrationDay,
  systemClock,
  type Clock,
  type EntityRepository,
} from "@lifeos/data";
import { currentLocalReminderTime, resolveLocalReminderOccurrence } from "./reminder-time.ts";
import type { LocalReminderTime } from "./reminder-time.ts";

export const REMINDER_DUE_EVENT = "lifeos:reminder-due";
const SCAN_INTERVAL_MS = 15_000;
// Polling runs every 15 seconds; allow several missed scans before recovery copy.
const MISSED_REMINDER_GRACE_MS = 60_000;
const REMEMBERED_OCCURRENCES_MAXIMUM = 256;

/** Sisältää vain tunnisteet ja ajastuksen metatiedot, ei otsikkoa tai terveysarvoja. */
export interface ReminderDueDetail {
  readonly reminderId: string;
  readonly kind: ReminderKind;
  readonly categoryKey: NotificationCategoryKey;
  readonly occurrenceKey: string;
  readonly scheduledAt: UtcTimestamp | null;
  readonly missed: boolean;
}

function localNowParts(now: Date): LocalReminderTime {
  return currentLocalReminderTime(now);
}

function resolveRecurringEvaluation(
  evaluation: ReminderRuleEvaluation,
  local: LocalReminderTime,
  now: UtcTimestamp,
): ReminderRuleEvaluation {
  if (!evaluation.due || evaluation.localDate === null || evaluation.localTime === null) {
    return evaluation;
  }
  const scheduledAt = resolveLocalReminderOccurrence(
    evaluation.localDate,
    evaluation.localTime,
    local.timeZone,
  );
  if (scheduledAt === null || Date.parse(now) < Date.parse(scheduledAt)) {
    return { due: false, reason: "not-scheduled" };
  }
  return { ...evaluation, scheduledAt };
}

function evaluateOne(
  reminder: Reminder,
  now: UtcTimestamp,
  local: LocalReminderTime,
  hydrationMillilitersToday: number | null,
): ReminderRuleEvaluation | null {
  const rule = reminder.rule;
  if (rule === null || rule.kind !== reminder.kind) return null;

  let snoozeKey = "";
  let snoozedAt: string | null = null;
  if (reminder.snoozedUntil !== null) {
    const timestamp = Date.parse(reminder.snoozedUntil);
    if (!Number.isFinite(timestamp) || Date.parse(now) < timestamp) return null;
    snoozedAt = new Date(timestamp).toISOString();
    snoozeKey = `:snooze:${snoozedAt}`;
  }

  const withSnooze = (evaluation: ReminderRuleEvaluation): ReminderRuleEvaluation =>
    evaluation.due && snoozedAt !== null
      ? {
          ...evaluation,
          occurrenceKey: `${evaluation.occurrenceKey}${snoozeKey}`,
          scheduledAt: snoozedAt,
        }
      : evaluation;
  const common = {
    reminderId: reminder.id,
    enabled: reminder.enabled,
    deletedAt: reminder.deletedAt,
    now,
  };
  if (rule.kind === "time") {
    const result = evaluateReminderRule({ ...common, rule });
    return result.ok ? withSnooze(result.value) : null;
  }
  if (rule.kind === "deadline") {
    const result = evaluateReminderRule({ ...common, rule });
    return result.ok ? withSnooze(result.value) : null;
  }
  if (rule.kind === "recurring") {
    const result = evaluateReminderRule({
      ...common,
      rule,
      localDate: local.date,
      // The domain validates schedule day/state; this caller resolves the actual
      // local wall-clock occurrence below, including DST gaps and overlaps.
      localTime: rule.schedule.localTime,
    });
    return result.ok ? withSnooze(resolveRecurringEvaluation(result.value, local, now)) : null;
  }
  const result = evaluateReminderRule({
    ...common,
    rule,
    localDate: local.date,
    localTime: rule.schedule.localTime,
    hydrationMillilitersToday,
  });
  return result.ok ? withSnooze(resolveRecurringEvaluation(result.value, local, now)) : null;
}

/** Laskee due-muistutukset puhtaasti annetusta tilannekuvasta. */
export function evaluateDueReminders(input: {
  readonly reminders: readonly Reminder[];
  readonly now: UtcTimestamp;
  readonly hydrationMillilitersToday?: number | null;
  readonly localContext?: LocalReminderTime;
}): readonly ReminderDueDetail[] {
  const nowDate = new Date(input.now);
  if (!Number.isFinite(nowDate.getTime())) return [];
  const local = input.localContext ?? localNowParts(nowDate);
  const due: ReminderDueDetail[] = [];
  for (const reminder of input.reminders) {
    const categoryKey = resolveNotificationCategoryKey(reminder.categoryKey);
    if (categoryKey === null) continue;
    const evaluation = evaluateOne(
      reminder,
      input.now,
      local,
      input.hydrationMillilitersToday ?? null,
    );
    if (evaluation?.due !== true) continue;
    const scheduledTime =
      evaluation.scheduledAt === null ? Number.NaN : Date.parse(evaluation.scheduledAt);
    due.push({
      reminderId: reminder.id,
      kind: reminder.kind,
      categoryKey,
      occurrenceKey: evaluation.occurrenceKey,
      scheduledAt: evaluation.scheduledAt,
      missed:
        Number.isFinite(scheduledTime) &&
        nowDate.getTime() - scheduledTime > MISSED_REMINDER_GRACE_MS,
    });
  }
  return due.sort((left, right) => {
    const leftTime = left.scheduledAt ?? "";
    const rightTime = right.scheduledAt ?? "";
    return leftTime.localeCompare(rightTime) || left.reminderId.localeCompare(right.reminderId);
  });
}

export interface ReminderSchedulerServices {
  readonly reminders: EntityRepository<Reminder>;
  readonly hydrationEntries: EntityRepository<HydrationEntry>;
}

export interface ReminderSchedulerOptions {
  readonly clock?: Clock;
  readonly onDue?: (detail: ReminderDueDetail) => void;
  readonly isCategoryEnabled?: (categoryKey: NotificationCategoryKey) => boolean;
}

/** Käynnistää näkyvän selainvälilehden ajastimen ja palauttaa sen pysäytysfunktion. */
export function startReminderScheduler(
  services: ReminderSchedulerServices,
  options: ReminderSchedulerOptions = {},
): () => void {
  const clock = options.clock ?? systemClock();
  const seenOccurrences = new Set<string>();
  let stopped = false;
  let scanning = false;
  let scanAgain = false;

  const isStopped = (): boolean => stopped;
  const hasRequestedScan = (): boolean => scanAgain && !stopped;
  const remember = (key: string): void => {
    seenOccurrences.add(key);
    if (seenOccurrences.size > REMEMBERED_OCCURRENCES_MAXIMUM) {
      const oldest = seenOccurrences.values().next().value;
      if (oldest !== undefined) seenOccurrences.delete(oldest);
    }
  };

  const scan = async (): Promise<void> => {
    if (isStopped() || document.visibilityState === "hidden") return;
    if (scanning) {
      scanAgain = true;
      return;
    }
    scanning = true;
    try {
      const now = clock.nowIso();
      const local = localNowParts(new Date(now));
      const listedReminders = await services.reminders.list();
      if (isStopped()) return;
      if (!listedReminders.ok) return;
      const activeConditional = listedReminders.value.some(
        (reminder) =>
          reminder.enabled && reminder.deletedAt === null && reminder.rule?.kind === "conditional",
      );

      let hydrationMillilitersToday: number | null = null;
      if (activeConditional) {
        const listedHydration = await services.hydrationEntries.list();
        if (!isStopped() && listedHydration.ok) {
          hydrationMillilitersToday = summarizeHydrationDay({
            entries: listedHydration.value,
            localDate: local.date,
            timezoneOffsetMinutes: local.timezoneOffsetMinutes,
            timeZone: local.timeZone,
            now,
          }).milliliters;
        }
      }
      if (isStopped()) return;

      for (const detail of evaluateDueReminders({
        reminders: listedReminders.value,
        now,
        hydrationMillilitersToday,
        localContext: local,
      })) {
        if (options.isCategoryEnabled?.(detail.categoryKey) === false) continue;
        if (seenOccurrences.has(detail.occurrenceKey)) continue;
        try {
          if (options.onDue !== undefined) options.onDue(detail);
          else
            window.dispatchEvent(
              new CustomEvent<ReminderDueDetail>(REMINDER_DUE_EVENT, { detail }),
            );
          remember(detail.occurrenceKey);
        } catch {
          // Yksittäinen kuluttajavirhe ei estä muita due-muistutuksia.
        }
      }
    } catch {
      // Ajastimen virhe ei saa pysäyttää aktiivisen sovelluksen muita toimintoja.
    } finally {
      scanning = false;
      if (hasRequestedScan()) {
        scanAgain = false;
        void scan();
      }
    }
  };

  const requestScan = (): void => {
    void scan();
  };
  const onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") requestScan();
  };

  const interval = window.setInterval(requestScan, SCAN_INTERVAL_MS);
  window.addEventListener("focus", requestScan);
  window.addEventListener("online", requestScan);
  window.addEventListener("pageshow", requestScan);
  window.addEventListener("lifeos:data-changed", requestScan);
  document.addEventListener("visibilitychange", onVisibilityChange);
  requestScan();

  return () => {
    stopped = true;
    window.clearInterval(interval);
    window.removeEventListener("focus", requestScan);
    window.removeEventListener("online", requestScan);
    window.removeEventListener("pageshow", requestScan);
    window.removeEventListener("lifeos:data-changed", requestScan);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
