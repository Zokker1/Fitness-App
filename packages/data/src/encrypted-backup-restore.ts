// T325: apply an authenticated portable backup in one SQLite transaction.
import { DEFAULT_PREFERENCE_VALUES, validateUserPreferencesValues } from "@lifeos/domain";
import type { UserPreferences } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { EncryptedBackupError } from "./encrypted-backup.ts";
import type { IdGenerator } from "./ids.ts";
import type { DataKeySession } from "./key-material.ts";
import {
  decryptAndValidateBackupForRestore,
  type BackupRestoreValidationSummary,
} from "./backup-restore-dry-run.ts";
import { preferencesToParams, readPreferences } from "./preferences.ts";
import type { DbRestoreWrite, DbRestoreWriteOp } from "./sqliteProtocol.ts";
import { MAX_RESTORE_WRITE_OPS } from "./sqliteProtocol.ts";
import { sendDbRequest } from "./sqliteClient.ts";
import { putAchievementOp } from "./sqliteAchievementStore.ts";
import { putActivityEntryOp } from "./sqliteActivityEntryStore.ts";
import { putBreathingSessionOp } from "./sqliteBreathingSessionStore.ts";
import { putCalendarBlockOp } from "./sqliteCalendarBlockStore.ts";
import { putCollectibleOp } from "./sqliteCollectibleStore.ts";
import { putDistractionOp } from "./sqliteDistractionStore.ts";
import { putFocusSessionOp } from "./sqliteFocusSessionStore.ts";
import { putFoodOp } from "./sqliteFoodStore.ts";
import { putGoalOp } from "./sqliteGoalStore.ts";
import { putGoalDayOp } from "./sqliteGoalDayStore.ts";
import { putHabitRuleOp } from "./sqliteHabitRuleStore.ts";
import { putEntryOp } from "./sqliteHydrationEntryStore.ts";
import { putJournalEntryOp } from "./sqliteJournalEntryStore.ts";
import { putLevelStateOp } from "./sqliteLevelStateStore.ts";
import { putMeasurementOp } from "./sqliteMeasurementStore.ts";
import { putMoodCheckinOp } from "./sqliteMoodCheckinStore.ts";
import { putNotificationStateOp } from "./sqliteNotificationStateStore.ts";
import { putNutritionEntryOp } from "./sqliteNutritionEntryStore.ts";
import { putProjectOp } from "./sqliteProjectStore.ts";
import { putProgressOp, putQuestOp } from "./sqliteQuestStore.ts";
import { putRecipeOp } from "./sqliteRecipeStore.ts";
import { putReminderOp } from "./sqliteReminderStore.ts";
import { putRoutineOp } from "./sqliteRoutineStore.ts";
import { putRoutineRunOp } from "./sqliteRoutineRunStore.ts";
import { putRoutineScheduleOp } from "./sqliteRoutineScheduleStore.ts";
import { putRoutineStepRunOp } from "./sqliteRoutineStepRunStore.ts";
import { putRoutineStepOp } from "./sqliteRoutineStepStore.ts";
import { putSleepEntryOp } from "./sqliteSleepEntryStore.ts";
import { putSupplementOp } from "./sqliteSupplementStore.ts";
import { putSupplementLogOp } from "./sqliteSupplementLogStore.ts";
import { putTagOp } from "./sqliteTagStore.ts";
import { putChecklistItemOp } from "./sqliteTaskChecklistItemStore.ts";
import { putTaskOp } from "./sqliteTaskStore.ts";
import { putClaimOp } from "./sqliteVaultRewardClaimStore.ts";
import { putUserRewardOp } from "./sqliteUserRewardStore.ts";
import { putRewardOp } from "./sqliteVaultRewardStore.ts";
import { putXpTransactionOp } from "./sqliteXpTransactionStore.ts";

export interface EncryptedBackupRestoreDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export interface EncryptedBackupRestoreSummary {
  readonly manifest: BackupRestoreValidationSummary["manifest"];
  readonly checkedCollectionCount: number;
  readonly restoredRecordCount: number;
  readonly settings: {
    readonly theme: BackupRestoreValidationSummary["snapshot"]["settings"]["theme"];
    readonly mealSlots: BackupRestoreValidationSummary["snapshot"]["settings"]["mealSlots"];
    readonly macroTargets: BackupRestoreValidationSummary["snapshot"]["settings"]["macroTargets"];
    readonly favoriteFoodIds: BackupRestoreValidationSummary["snapshot"]["settings"]["favoriteFoodIds"];
  };
}

export type EncryptedBackupRestoreResult =
  | { readonly ok: true; readonly value: EncryptedBackupRestoreSummary }
  | {
      readonly ok: false;
      readonly error: EncryptedBackupError;
    };

function failed(diagnosticCode: string): EncryptedBackupRestoreResult {
  return {
    ok: false,
    error: {
      code: "invalid-input",
      diagnosticCode,
      userMessage: "Varmuuskopiota ei voitu palauttaa. Nykyistä tietokantaa ei muutettu.",
    },
  };
}

function addRows<T>(
  target: DbRestoreWrite[],
  rows: readonly T[],
  create: (row: T) => {
    readonly op: string;
    readonly params: Record<string, string | number | boolean>;
  },
): void {
  for (const row of rows) {
    const write = create(row);
    target.push({ op: write.op as DbRestoreWriteOp, params: write.params });
  }
}

async function buildPreferences(
  settings: BackupRestoreValidationSummary["snapshot"]["settings"],
  deps: EncryptedBackupRestoreDeps,
): Promise<UserPreferences | null> {
  const existing = await readPreferences();
  if (!existing.ok) return null;
  const current = existing.value;
  const values = validateUserPreferencesValues({
    theme: settings.theme,
    dayStartHour:
      settings.dayStartHour ?? current?.dayStartHour ?? DEFAULT_PREFERENCE_VALUES.dayStartHour,
    weightTarget: settings.weightTarget,
    heightCm: settings.heightCm,
    mealSlots: settings.mealSlots,
    macroTargets: settings.macroTargets,
    hydrationTargetMl: settings.hydrationTargetMl,
    hydrationReminderTime: settings.hydrationReminderTime,
    notificationCategories:
      current?.notificationCategories ?? DEFAULT_PREFERENCE_VALUES.notificationCategories,
  });
  if (!values.ok) return null;

  const nextVersion = current === null ? 1 : current.version + 1;
  if (!Number.isSafeInteger(nextVersion) || nextVersion < 1) return null;
  return {
    id: current?.id ?? deps.ids.next(),
    ...values.value,
    gamificationVisible: settings.gamificationVisible,
    enabledSections: settings.enabledSections ??
      current?.enabledSections ?? [...DEFAULT_PREFERENCE_VALUES.enabledSections],
    notificationDefaults: {
      enabled:
        settings.notificationDefaultsEnabled ??
        current?.notificationDefaults.enabled ??
        DEFAULT_PREFERENCE_VALUES.notificationDefaults.enabled,
    },
    appLockEnabled:
      settings.appLockEnabled ??
      current?.appLockEnabled ??
      DEFAULT_PREFERENCE_VALUES.appLockEnabled,
    createdAt: current?.createdAt ?? deps.clock.nowIso(),
    updatedAt: deps.clock.nowIso(),
    version: nextVersion,
  };
}

function buildRestoreWrites(
  snapshot: BackupRestoreValidationSummary["snapshot"],
  preferences: UserPreferences,
): DbRestoreWrite[] {
  const writes: DbRestoreWrite[] = [
    { op: "putPreferences", params: preferencesToParams(preferences) },
  ];
  const rows = snapshot.collections;

  // Parent rows first so the database's foreign-key checks pass during commit.
  addRows(writes, rows.projects, putProjectOp);
  addRows(writes, rows.tags, putTagOp);
  addRows(writes, rows.routines, putRoutineOp);
  addRows(writes, rows.goals, putGoalOp);
  addRows(writes, rows.foods, putFoodOp);
  addRows(writes, rows.supplements, putSupplementOp);
  addRows(writes, rows.vaultRewards, putRewardOp);
  addRows(writes, rows.quests, putQuestOp);
  addRows(writes, rows.achievements, putAchievementOp);
  addRows(writes, rows.collectibles, putCollectibleOp);

  addRows(writes, rows.tasks, putTaskOp);
  addRows(writes, rows.routineSteps, putRoutineStepOp);
  addRows(writes, rows.routineSchedules, putRoutineScheduleOp);
  addRows(writes, rows.routineRuns, putRoutineRunOp);
  addRows(writes, rows.goalDays, putGoalDayOp);
  addRows(writes, rows.habitRules, putHabitRuleOp);
  addRows(writes, rows.calendarBlocks, putCalendarBlockOp);
  addRows(writes, rows.focusSessions, putFocusSessionOp);
  addRows(writes, rows.distractions, putDistractionOp);
  addRows(writes, rows.taskChecklistItems, putChecklistItemOp);
  addRows(writes, rows.routineStepRuns, putRoutineStepRunOp);
  addRows(writes, rows.sleepEntries, putSleepEntryOp);
  addRows(writes, rows.breathingSessions, putBreathingSessionOp);
  addRows(writes, rows.activityEntries, putActivityEntryOp);
  addRows(writes, rows.moodCheckins, putMoodCheckinOp);
  addRows(writes, rows.reminders, putReminderOp);
  addRows(writes, rows.notificationStates, putNotificationStateOp);
  addRows(writes, rows.supplementLogs, putSupplementLogOp);
  addRows(writes, rows.hydrationEntries, putEntryOp);
  addRows(writes, rows.measurements, putMeasurementOp);
  addRows(writes, rows.recipes, putRecipeOp);
  addRows(writes, rows.nutritionEntries, putNutritionEntryOp);
  addRows(writes, rows.questProgress, putProgressOp);
  addRows(writes, rows.userRewards, putUserRewardOp);
  addRows(writes, rows.vaultClaims, putClaimOp);
  addRows(writes, rows.levelStates, putLevelStateOp);
  addRows(writes, rows.journalEntries, putJournalEntryOp);
  // XP ledgers are append-only and therefore written last after duplicate checks.
  addRows(writes, rows.xpTransactions, putXpTransactionOp);

  return writes;
}

/** Restores a validated backup by merging records with matching IDs in one SQLite transaction. */
export async function restoreEncryptedBackup(
  value: unknown,
  keySession: DataKeySession,
  deps: EncryptedBackupRestoreDeps,
): Promise<EncryptedBackupRestoreResult> {
  const validated = await decryptAndValidateBackupForRestore(value, keySession);
  if (!validated.ok) return validated;

  let preferences: UserPreferences | null;
  try {
    preferences = await buildPreferences(validated.value.snapshot.settings, deps);
  } catch {
    return failed("encrypted-backup.restore.preferences-read-failed");
  }
  if (preferences === null) return failed("encrypted-backup.restore.preferences-invalid");

  let writes: DbRestoreWrite[];
  try {
    writes = buildRestoreWrites(validated.value.snapshot, preferences);
  } catch {
    return failed("encrypted-backup.restore.write-build-failed");
  }
  if (writes.length > MAX_RESTORE_WRITE_OPS) {
    return failed("encrypted-backup.restore.write-limit-exceeded");
  }

  const response = await sendDbRequest({ kind: "restore", ops: writes });
  if (!response.ok) {
    return failed(response.diagnosticCode);
  }
  return {
    ok: true,
    value: {
      manifest: validated.value.manifest,
      checkedCollectionCount: validated.value.checkedCollectionCount,
      restoredRecordCount: validated.value.checkedRecordCount,
      settings: {
        theme: validated.value.snapshot.settings.theme,
        mealSlots: validated.value.snapshot.settings.mealSlots,
        macroTargets: validated.value.snapshot.settings.macroTargets,
        favoriteFoodIds: validated.value.snapshot.settings.favoriteFoodIds,
      },
    },
  };
}
