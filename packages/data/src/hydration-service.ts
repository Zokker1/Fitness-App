// T230: nestekirjausten validoitu palveluraja ja yhtenäinen päivän yhteenveto.

import type { HydrationEntry, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import { awardHealthTrackingXp, type HealthTrackingXpDeps } from "./health-tracking-xp.ts";
import type { EntityRepository } from "./repositories.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";

export const HYDRATION_ENTRY_MILLILITERS_MAXIMUM = 5_000;

export interface HydrationServiceDeps extends HealthTrackingXpDeps {
  readonly hydrationEntries: EntityRepository<HydrationEntry>;
}

export interface CreateHydrationEntryInput {
  readonly milliliters: number;
  readonly drunkAt?: UtcTimestamp | undefined;
}

export interface HydrationDaySummary {
  readonly milliliters: number;
  readonly entryCount: number;
  readonly targetMilliliters: number | null;
  /** Null kun tavoitetta ei ole; muuten kokonaisluku 0–100. */
  readonly progressPercent: number | null;
}

export interface SummarizeHydrationDayInput {
  readonly entries: readonly HydrationEntry[];
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  /** Jos annettu, kukin kirjaus luokitellaan sen oman IANA-offsetin mukaan. */
  readonly timeZone?: string | undefined;
  readonly targetMilliliters?: number | null | undefined;
  readonly now?: UtcTimestamp | undefined;
}

export interface HydrationReminderConditionInput {
  readonly entries: readonly HydrationEntry[];
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly timeZone?: string | undefined;
  readonly now: UtcTimestamp;
  readonly targetMilliliters: number | null;
  readonly reminderTime: string | null;
}

export interface HydrationReminderCondition {
  readonly status: "disabled" | "not-due" | "goal-met" | "below-target";
  readonly shouldRemind: boolean;
  readonly millilitersToday: number;
  readonly targetMilliliters: number | null;
  readonly shortfallMilliliters: number;
}

export function hydrationProgressPercent(
  milliliters: number,
  targetMilliliters: number | null,
): number | null {
  return targetMilliliters === null
    ? null
    : Math.min(100, Math.round((milliliters / targetMilliliters) * 100));
}

const UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string") {
    return false;
  }
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null || match[1] === undefined) {
    return false;
  }
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === `${match[1]}.${(match[2] ?? "").padEnd(3, "0")}Z`
  );
}

/** Luo juomakirjauksen vain järkevälle määrälle ja UTC-hetkelle. */
export async function createHydrationEntryService(
  deps: HydrationServiceDeps,
  input: CreateHydrationEntryInput,
): Promise<DataResult<HydrationEntry>> {
  if (
    typeof input.milliliters !== "number" ||
    !Number.isInteger(input.milliliters) ||
    input.milliliters < 1 ||
    input.milliliters > HYDRATION_ENTRY_MILLILITERS_MAXIMUM
  ) {
    return Promise.resolve({
      ok: false,
      error: invalidInput(
        "data.hydration.validation.milliliters",
        `Määrän on oltava kokonaisluku välillä 1–${String(HYDRATION_ENTRY_MILLILITERS_MAXIMUM)} ml.`,
      ),
    });
  }
  const drunkAt = input.drunkAt ?? deps.clock.nowIso();
  if (!isValidUtcTimestamp(drunkAt)) {
    return Promise.resolve({
      ok: false,
      error: invalidInput("data.hydration.validation.drunk-at", "Kirjausaika ei ole kelvollinen."),
    });
  }
  const created = await deps.hydrationEntries.create({ drunkAt, milliliters: input.milliliters });
  if (created.ok) {
    await awardHealthTrackingXp(deps, "hydration", created.value.drunkAt);
  }
  return created;
}

/** Laskee paikallispäivän saldon ja tavoite-etenemän samoilla säännöillä kaikissa näkymissä. */
export function summarizeHydrationDay(input: SummarizeHydrationDayInput): HydrationDaySummary {
  const entries = input.entries.filter((entry) => {
    const timezoneOffsetMinutes =
      input.timeZone === undefined
        ? input.timezoneOffsetMinutes
        : (timezoneOffsetMinutesAtInstant(entry.drunkAt, input.timeZone) ??
          input.timezoneOffsetMinutes);
    return (
      toLocalDateKey(entry.drunkAt, timezoneOffsetMinutes) === input.localDate &&
      (input.now === undefined || entry.drunkAt <= input.now)
    );
  });
  const milliliters = entries.reduce((sum, entry) => sum + entry.milliliters, 0);
  const targetMilliliters = input.targetMilliliters ?? null;
  return {
    milliliters,
    entryCount: entries.length,
    targetMilliliters,
    progressPercent: hydrationProgressPercent(milliliters, targetMilliliters),
  };
}

/** Arvioi käyttäjän paikallisen ajan nesteehdon nykyisen päivän kirjauksista. */
export function evaluateHydrationReminderCondition(
  input: HydrationReminderConditionInput,
): HydrationReminderCondition {
  const summary = summarizeHydrationDay({
    entries: input.entries,
    localDate: input.localDate,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    timeZone: input.timeZone,
    targetMilliliters: input.targetMilliliters,
    now: input.now,
  });
  const base = {
    millilitersToday: summary.milliliters,
    targetMilliliters: input.targetMilliliters,
    shortfallMilliliters:
      input.targetMilliliters === null
        ? 0
        : Math.max(0, input.targetMilliliters - summary.milliliters),
  };
  const reminderMatch =
    input.reminderTime === null ? null : /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(input.reminderTime);
  if (input.targetMilliliters === null || reminderMatch === null) {
    return { ...base, status: "disabled", shouldRemind: false };
  }
  const localNow = new Date(Date.parse(input.now) + input.timezoneOffsetMinutes * 60_000);
  const currentMinute = localNow.getUTCHours() * 60 + localNow.getUTCMinutes();
  const reminderHour = Number(reminderMatch[1]);
  const reminderMinute = Number(reminderMatch[2]);
  const reminderMinuteOfDay = reminderHour * 60 + reminderMinute;
  if (currentMinute < reminderMinuteOfDay) {
    return { ...base, status: "not-due", shouldRemind: false };
  }
  if (base.shortfallMilliliters === 0) {
    return { ...base, status: "goal-met", shouldRemind: false };
  }
  return { ...base, status: "below-target", shouldRemind: true };
}
