// T272: yhteisen paikallisen historiavirran projektio selausnäkymään.

import type {
  Achievement,
  ActivityEntry,
  BreathingSession,
  FocusSession,
  Goal,
  GoalDay,
  HydrationEntry,
  JournalEntry,
  Measurement,
  MoodCheckin,
  NutritionEntry,
  Routine,
  RoutineRun,
  SleepEntry,
  Supplement,
  SupplementLog,
  Task,
  UserReward,
  VaultReward,
  VaultRewardClaim,
  XPTransaction,
  Collectible,
} from "@lifeos/domain";

export type HistoryRecordKind =
  | "task"
  | "focus"
  | "goal"
  | "routine"
  | "measurement"
  | "food"
  | "hydration"
  | "sleep"
  | "activity"
  | "mood"
  | "journal"
  | "supplement"
  | "breathing"
  | "gamification";

export interface HistoryRecord {
  readonly key: string;
  readonly kind: HistoryRecordKind;
  readonly occurredAt: string;
  /** Päivämäärä annetaan suoraan paikallispäiväentiteeteille. */
  readonly localDate?: string | undefined;
  readonly dateOnly: boolean;
  readonly title: string;
  readonly detail: string;
}

export interface HistoryBrowserInput {
  readonly locale?: string;
  readonly tasks: readonly Task[];
  readonly focusSessions: readonly FocusSession[];
  readonly goals: readonly Goal[];
  readonly goalDays: readonly GoalDay[];
  readonly routines: readonly Routine[];
  readonly routineRuns: readonly RoutineRun[];
  readonly measurements: readonly Measurement[];
  readonly nutritionEntries: readonly NutritionEntry[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly sleepEntries: readonly SleepEntry[];
  readonly activityEntries: readonly ActivityEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
  readonly journalEntries: readonly JournalEntry[];
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
  readonly breathingSessions: readonly BreathingSession[];
  readonly xpTransactions: readonly XPTransaction[];
  readonly vaultClaims: readonly VaultRewardClaim[];
  readonly vaultRewards: readonly VaultReward[];
  readonly userRewards: readonly UserReward[];
  readonly achievements: readonly Achievement[];
  readonly collectibles: readonly Collectible[];
}

function validTimestamp(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && Number.isFinite(Date.parse(value));
}

function validLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00.000Z`));
}

function dateRecord(
  key: string,
  kind: HistoryRecordKind,
  localDate: string,
  title: string,
  detail: string,
): HistoryRecord | null {
  if (!validLocalDate(localDate)) return null;
  return {
    key,
    kind,
    occurredAt: `${localDate}T12:00:00.000Z`,
    localDate,
    dateOnly: true,
    title,
    detail,
  };
}

function timedRecord(
  key: string,
  kind: HistoryRecordKind,
  occurredAt: string | null | undefined,
  title: string,
  detail: string,
): HistoryRecord | null {
  if (!validTimestamp(occurredAt)) return null;
  return { key, kind, occurredAt, dateOnly: false, title, detail };
}

function numberLabel(value: number, digits = 1, locale = "fi-FI"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
}

function durationLabel(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return "Kestoa ei tallentunut";
  }
  const minutes = Math.floor((seconds + 30) / 60);
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(remainder)} min`;
}

function measurementLabel(entry: Measurement): string {
  switch (entry.type) {
    case "weight":
      return "Paino";
    case "blood-pressure":
      return "Verenpaine";
    case "blood-sugar":
      return "Verensokeri";
    case "temperature":
      return "Lämpötila";
    case "spo2":
      return "Happisaturaatio";
    case "body-measure":
      return entry.metricName?.trim() || "Kehon mitta";
    case "custom":
      return entry.metricName?.trim() || "Oma mittaus";
  }
}

function measurementDetail(entry: Measurement, locale: string): string {
  if (entry.type === "blood-pressure" && entry.secondaryValue !== null) {
    const pressure = `${numberLabel(entry.value, 0, locale)} / ${numberLabel(entry.secondaryValue, 0, locale)} ${entry.unit}`;
    return entry.pulseBpm === null || entry.pulseBpm === undefined
      ? pressure
      : `${pressure}, pulssi ${String(entry.pulseBpm)}/min`;
  }
  return `${numberLabel(entry.value, 1, locale)} ${entry.unit}`;
}

function xpSourceLabel(source: XPTransaction["source"]): string {
  switch (source) {
    case "task":
      return "Tehtävästä";
    case "routine":
      return "Rutiinista";
    case "focus":
      return "Fokuksesta";
    case "habit":
      return "Tavasta";
    case "health":
      return "Terveyskirjauksesta";
    case "quest":
      return "Tehtävähaasteesta";
    case "manual":
      return "Kirjauksesta";
  }
}

/** Yhdistää tallennetut tapahtumat yhteen aikajanaan, uusimmat ensin. */
export function buildHistoryRecords(input: HistoryBrowserInput): readonly HistoryRecord[] {
  const locale = input.locale ?? "fi-FI";
  const records: HistoryRecord[] = [];
  const goalTitles = new Map(input.goals.map((goal) => [goal.id, goal.title]));
  const routineTitles = new Map(input.routines.map((routine) => [routine.id, routine.title]));
  const supplementNames = new Map(
    input.supplements.map((supplement) => [supplement.id, supplement.name]),
  );
  const vaultTitles = new Map(input.vaultRewards.map((reward) => [reward.id, reward.title]));
  const achievementTitles = new Map(input.achievements.map((item) => [item.id, item.title]));
  const collectibleTitles = new Map(input.collectibles.map((item) => [item.id, item.title]));

  for (const task of input.tasks) {
    if (validTimestamp(task.completedAt)) {
      const record = timedRecord(
        `task-completed:${task.id}`,
        "task",
        task.completedAt,
        task.title,
        "Tehtävä valmistui",
      );
      if (record !== null) records.push(record);
    }
    if (
      validTimestamp(task.reopenedAt) &&
      (!validTimestamp(task.completedAt) ||
        Date.parse(task.reopenedAt) > Date.parse(task.completedAt))
    ) {
      const record = timedRecord(
        `task-reopened:${task.id}`,
        "task",
        task.reopenedAt,
        task.title,
        "Tehtävä avattiin uudelleen",
      );
      if (record !== null) records.push(record);
    }
  }

  for (const session of input.focusSessions) {
    if (session.phase !== "completed" && session.phase !== "cancelled") continue;
    const endedAt = session.endedAt ?? session.updatedAt;
    const duration = session.activeElapsedSeconds ?? session.durationSeconds;
    const status = session.phase === "completed" ? "Fokusistunto valmis" : "Fokusistunto peruttiin";
    const record = timedRecord(
      `focus:${session.id}`,
      "focus",
      endedAt,
      "Fokusistunto",
      `${status}, ${durationLabel(duration)}`,
    );
    if (record !== null) records.push(record);
  }

  for (const day of input.goalDays) {
    const title = goalTitles.get(day.goalId) ?? "Poistettu tavoite";
    const record = dateRecord(
      `goal:${day.id}`,
      "goal",
      day.localDate,
      title,
      day.completed ? "Tavoitepäivä valmis" : "Tavoitepäivä merkitty keskeneräiseksi",
    );
    if (record !== null) records.push(record);
  }

  const routineStatuses = {
    completed: "Rutiini tehty",
    running: "Rutiini kesken",
    skipped: "Rutiini ohitettu",
    cancelled: "Rutiini peruttu",
  } as const;
  for (const run of input.routineRuns) {
    if (run.status === "running") continue;
    const title = routineTitles.get(run.routineId) ?? "Poistettu rutiini";
    const record = dateRecord(
      `routine:${run.id}`,
      "routine",
      run.localDate,
      title,
      routineStatuses[run.status],
    );
    if (record !== null) records.push(record);
  }

  for (const entry of input.measurements) {
    const record = timedRecord(
      `measurement:${entry.id}`,
      "measurement",
      entry.measuredAt,
      measurementLabel(entry),
      measurementDetail(entry, locale),
    );
    if (record !== null) records.push(record);
  }

  for (const entry of input.nutritionEntries) {
    if (entry.deletedAt !== null) continue;
    const detail =
      entry.calories === null
        ? "Ateria kirjattu"
        : `${numberLabel(entry.calories, 0, locale)} kcal`;
    const record = timedRecord(`food:${entry.id}`, "food", entry.eatenAt, entry.label, detail);
    if (record !== null) records.push(record);
  }

  for (const entry of input.hydrationEntries) {
    const record = timedRecord(
      `hydration:${entry.id}`,
      "hydration",
      entry.drunkAt,
      "Vesimerkintä",
      `${String(entry.milliliters)} ml`,
    );
    if (record !== null) records.push(record);
  }

  for (const entry of input.sleepEntries) {
    if (entry.deletedAt !== null) continue;
    const seconds = (Date.parse(entry.sleepEnd) - Date.parse(entry.sleepStart)) / 1000;
    const detail =
      entry.quality === null
        ? durationLabel(seconds)
        : `${durationLabel(seconds)}, laatuarvio ${String(entry.quality)}/5`;
    const record = timedRecord(
      `sleep:${entry.id}`,
      "sleep",
      entry.sleepEnd,
      entry.isNap === true ? "Päiväunet" : "Uni",
      detail,
    );
    if (record !== null) records.push(record);
  }

  for (const entry of input.activityEntries) {
    if (entry.deletedAt !== null) continue;
    const duration = entry.durationSeconds === null ? null : durationLabel(entry.durationSeconds);
    const distance =
      entry.distanceMeters === null
        ? null
        : entry.distanceMeters >= 1000
          ? `${numberLabel(entry.distanceMeters / 1000, 2, locale)} km`
          : `${numberLabel(entry.distanceMeters, 0, locale)} m`;
    const detail =
      [duration, distance].filter((part) => part !== null).join(", ") || "Liikunta kirjattu";
    const record = timedRecord(
      `activity:${entry.id}`,
      "activity",
      entry.activityAt,
      entry.kind.trim() || "Liikunta",
      detail,
    );
    if (record !== null) records.push(record);
  }

  for (const entry of input.moodCheckins) {
    const record = timedRecord(
      `mood:${entry.id}`,
      "mood",
      entry.checkedAt,
      "Hyvinvoinnin tarkistus",
      `Mieliala ${String(entry.mood)}/5`,
    );
    if (record !== null) records.push(record);
  }

  for (const entry of input.journalEntries) {
    if (entry.deletedAt !== null) continue;
    const record = timedRecord(
      `journal:${entry.id}`,
      "journal",
      entry.writtenAt,
      entry.title?.trim() || "Päiväkirjamerkintä",
      "Merkintä tallennettu",
    );
    if (record !== null) records.push(record);
  }

  for (const log of input.supplementLogs) {
    const status = log.status ?? "taken";
    if (status === "pending") continue;
    const timestamp = log.takenAt ?? log.scheduledAt ?? log.createdAt;
    const record = timedRecord(
      `supplement:${log.id}`,
      "supplement",
      timestamp,
      supplementNames.get(log.supplementId) ?? "Lisäravinne",
      status === "taken" ? "Otettu" : "Ohitettu",
    );
    if (record !== null) records.push(record);
  }

  for (const session of input.breathingSessions) {
    if (!validTimestamp(session.endedAt)) continue;
    const record = timedRecord(
      `breathing:${session.id}`,
      "breathing",
      session.endedAt,
      "Hengitysharjoitus",
      session.patternKey,
    );
    if (record !== null) records.push(record);
  }

  for (const transaction of input.xpTransactions) {
    const amount =
      transaction.amount > 0 ? `+${String(transaction.amount)}` : String(transaction.amount);
    const record = timedRecord(
      `xp:${transaction.id}`,
      "gamification",
      transaction.earnedAt,
      `${amount} XP`,
      xpSourceLabel(transaction.source),
    );
    if (record !== null) records.push(record);
  }

  for (const claim of input.vaultClaims) {
    const detail =
      claim.xpDeducted > 0
        ? `Lunastettu, ${String(claim.xpDeducted)} XP käytetty`
        : "Palkinto lunastettu";
    const record = timedRecord(
      `reward-claim:${claim.id}`,
      "gamification",
      claim.claimedAt,
      vaultTitles.get(claim.rewardId) ?? "Palkinto",
      detail,
    );
    if (record !== null) records.push(record);
  }

  for (const reward of input.userRewards) {
    const title =
      reward.achievementId === null
        ? reward.collectibleId === null
          ? "Palkinto ansaittu"
          : (collectibleTitles.get(reward.collectibleId) ?? "Keräilyesine avattu")
        : (achievementTitles.get(reward.achievementId) ?? "Saavutus ansaittu");
    const record = timedRecord(
      `reward:${reward.id}`,
      "gamification",
      reward.earnedAt,
      title,
      "Palkinto ansaittu",
    );
    if (record !== null) records.push(record);
  }

  return records.sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt));
}
