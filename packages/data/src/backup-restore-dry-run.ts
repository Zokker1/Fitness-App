// T324: validate an authenticated backup in an isolated, memory-only restore workspace.
import type {
  Achievement,
  ActivityEntry,
  BreathingSession,
  CalendarBlock,
  Collectible,
  Distraction,
  FocusSession,
  Food,
  Goal,
  GoalDay,
  HabitRule,
  HydrationEntry,
  JournalEntry,
  LevelState,
  Measurement,
  MoodCheckin,
  NutritionEntry,
  NotificationState,
  Project,
  Quest,
  QuestProgress,
  Recipe,
  Reminder,
  Routine,
  RoutineRun,
  RoutineSchedule,
  RoutineStep,
  RoutineStepRun,
  SleepEntry,
  Supplement,
  SupplementLog,
  Tag,
  Task,
  TaskChecklistItem,
  UserReward,
  VaultReward,
  VaultRewardClaim,
  XPTransaction,
} from "@lifeos/domain";
import {
  validateHeightCm,
  validateHydrationReminderTime,
  validateHydrationTargetMl,
  validateMacroTargets,
  validateMealSlots,
  validateReminderRule,
  validateWeightTarget,
} from "@lifeos/domain";
import type { BackupManifest } from "@lifeos/domain";
import { CURRENT_SCHEMA_VERSION } from "./migrations.ts";
import {
  PORTABLE_DATA_COLLECTION_KEYS,
  type PortableDataCollections,
  type PortableDataSnapshot,
} from "./portable-data-export.ts";
import type { DataKeySession } from "./key-material.ts";
import { openEncryptedBackup, type EncryptedBackupError } from "./encrypted-backup.ts";
import { validAchievement } from "./sqliteAchievementStore.ts";
import { validActivityEntry } from "./sqliteActivityEntryStore.ts";
import { validBreathingSession } from "./sqliteBreathingSessionStore.ts";
import { validCalendarBlock } from "./sqliteCalendarBlockStore.ts";
import { validCollectible } from "./sqliteCollectibleStore.ts";
import { validDistraction } from "./sqliteDistractionStore.ts";
import { validFocusSession } from "./sqliteFocusSessionStore.ts";
import { validFood } from "./sqliteFoodStore.ts";
import { validGoal } from "./sqliteGoalStore.ts";
import { validGoalDay } from "./sqliteGoalDayStore.ts";
import { validHabitRule } from "./sqliteHabitRuleStore.ts";
import { validEntity as validHydrationEntry } from "./sqliteHydrationEntryStore.ts";
import { validJournalEntry } from "./sqliteJournalEntryStore.ts";
import { validLevelState } from "./sqliteLevelStateStore.ts";
import { validMeasurement } from "./sqliteMeasurementStore.ts";
import { validMoodCheckin } from "./sqliteMoodCheckinStore.ts";
import { validNotificationState } from "./sqliteNotificationStateStore.ts";
import { validNutritionEntry } from "./sqliteNutritionEntryStore.ts";
import { validProject } from "./sqliteProjectStore.ts";
import { validProgress as validQuestProgress, validQuest } from "./sqliteQuestStore.ts";
import { validRecipe } from "./sqliteRecipeStore.ts";
import { validReminder } from "./sqliteReminderStore.ts";
import { validRoutine } from "./sqliteRoutineStore.ts";
import { validRoutineRun } from "./sqliteRoutineRunStore.ts";
import { validRoutineSchedule } from "./sqliteRoutineScheduleStore.ts";
import { validRoutineStepRun } from "./sqliteRoutineStepRunStore.ts";
import { validRoutineStep } from "./sqliteRoutineStepStore.ts";
import { validSleepEntry } from "./sqliteSleepEntryStore.ts";
import { validSupplement } from "./sqliteSupplementStore.ts";
import { validSupplementLog } from "./sqliteSupplementLogStore.ts";
import { validTag } from "./sqliteTagStore.ts";
import { validChecklistItem } from "./sqliteTaskChecklistItemStore.ts";
import { validTask } from "./sqliteTaskStore.ts";
import { validClaim as validVaultClaim } from "./sqliteVaultRewardClaimStore.ts";
import { validUserReward } from "./sqliteUserRewardStore.ts";
import { validReward as validVaultReward } from "./sqliteVaultRewardStore.ts";
import { validXpTransaction } from "./sqliteXpTransactionStore.ts";

type CollectionName = keyof PortableDataCollections;
type RecordValidator = (value: unknown) => boolean;
type RestoreIssue =
  | { readonly code: "snapshot-shape" }
  | { readonly code: "settings-invalid" }
  | { readonly code: "collection-invalid"; readonly collection: CollectionName }
  | { readonly code: "duplicate-id"; readonly collection: CollectionName }
  | { readonly code: "reference-missing"; readonly collection: CollectionName };

export interface BackupRestoreDryRunSummary {
  readonly manifest: BackupManifest;
  readonly checkedCollectionCount: number;
  readonly checkedRecordCount: number;
}

export interface BackupRestoreValidationSummary extends BackupRestoreDryRunSummary {
  /** Authenticated and validated payload; kept internal to the data package. */
  readonly snapshot: PortableDataSnapshot;
}

export type BackupRestoreDryRunResult =
  | { readonly ok: true; readonly value: BackupRestoreDryRunSummary }
  | {
      readonly ok: false;
      readonly error:
        EncryptedBackupError | (EncryptedBackupError & { readonly issue: RestoreIssue });
    };

interface CollectionRule {
  readonly allowedFields: readonly string[];
  readonly validate: RecordValidator;
}

const BASE_FIELDS = ["id", "createdAt", "updatedAt", "version"] as const;
const SOFT_DELETE_FIELDS = [...BASE_FIELDS, "deletedAt"] as const;

function fields(...groups: readonly (readonly string[])[]): readonly string[] {
  return [...new Set(groups.flat())];
}

function validateAs<T>(validator: (value: T) => boolean): (value: unknown) => value is T {
  return (value): value is T => {
    if (!isRecord(value)) return false;
    try {
      return validator(value as T);
    } catch {
      return false;
    }
  };
}

const COLLECTION_RULES: Readonly<Record<CollectionName, CollectionRule>> = {
  tasks: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "title",
      "notes",
      "status",
      "priority",
      "dueAt",
      "projectId",
      "tagIds",
      "completedAt",
      "reopenedAt",
      "recurrence",
      "estimateMinutes",
      "actualSeconds",
    ]),
    validate: validateAs<Task>(validTask),
  },
  taskChecklistItems: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["taskId", "title", "done", "sortOrder"]),
    validate: validateAs<TaskChecklistItem>(validChecklistItem),
  },
  calendarBlocks: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "kind",
      "title",
      "startsAt",
      "endsAt",
      "linkedTaskId",
      "linkedRoutineId",
    ]),
    validate: validateAs<CalendarBlock>(validCalendarBlock),
  },
  focusSessions: {
    allowedFields: fields(BASE_FIELDS, [
      "taskId",
      "routineId",
      "calendarBlockId",
      "phase",
      "startedAt",
      "endedAt",
      "durationSeconds",
      "activeElapsedSeconds",
      "activeSegmentStartedAt",
      "accumulatedPauseSeconds",
      "interruptionCount",
    ]),
    validate: validateAs<FocusSession>(validFocusSession),
  },
  distractions: {
    allowedFields: fields(BASE_FIELDS, ["focusSessionId", "notedAt", "note"]),
    validate: validateAs<Distraction>(validDistraction),
  },
  routines: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["title", "archivedAt"]),
    validate: validateAs<Routine>(validRoutine),
  },
  routineSteps: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["routineId", "title", "sortOrder", "optional"]),
    validate: validateAs<RoutineStep>(validRoutineStep),
  },
  routineSchedules: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "routineId",
      "cadence",
      "weekdays",
      "localTime",
      "enabled",
    ]),
    validate: validateAs<RoutineSchedule>(validRoutineSchedule),
  },
  routineRuns: {
    allowedFields: fields(BASE_FIELDS, [
      "routineId",
      "localDate",
      "status",
      "dayMode",
      "startedAt",
      "completedAt",
      "skipReason",
    ]),
    validate: validateAs<RoutineRun>(validRoutineRun),
  },
  routineStepRuns: {
    allowedFields: fields(BASE_FIELDS, [
      "routineRunId",
      "routineStepId",
      "status",
      "completedAt",
      "skipReason",
    ]),
    validate: validateAs<RoutineStepRun>(validRoutineStepRun),
  },
  goals: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "title",
      "description",
      "activeFrom",
      "activeUntil",
      "archivedAt",
    ]),
    validate: validateAs<Goal>(validGoal),
  },
  goalDays: {
    allowedFields: fields(BASE_FIELDS, ["goalId", "localDate", "completed"]),
    validate: validateAs<GoalDay>(validGoalDay),
  },
  habitRules: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["goalId", "title", "cadence", "targetPerPeriod"]),
    validate: validateAs<HabitRule>(validHabitRule),
  },
  sleepEntries: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["sleepStart", "sleepEnd", "quality", "isNap"]),
    validate: validateAs<SleepEntry>(validSleepEntry),
  },
  breathingSessions: {
    allowedFields: fields(BASE_FIELDS, ["startedAt", "endedAt", "patternKey"]),
    validate: validateAs<BreathingSession>(validBreathingSession),
  },
  activityEntries: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "activityAt",
      "kind",
      "durationSeconds",
      "distanceMeters",
      "note",
    ]),
    validate: validateAs<ActivityEntry>(validActivityEntry),
  },
  moodCheckins: {
    allowedFields: fields(BASE_FIELDS, [
      "mood",
      "stress",
      "energy",
      "motivation",
      "focus",
      "checkedAt",
      "note",
    ]),
    validate: validateAs<MoodCheckin>(validMoodCheckin),
  },
  reminders: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "kind",
      "route",
      "title",
      "rule",
      "fireAt",
      "snoozedUntil",
      "categoryKey",
      "enabled",
    ]),
    validate: validateAs<Reminder>(validReminder),
  },
  notificationStates: {
    allowedFields: fields(BASE_FIELDS, [
      "reminderId",
      "categoryKey",
      "delivery",
      "lastEvaluatedAt",
    ]),
    validate: validateAs<NotificationState>(validNotificationState),
  },
  supplements: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "name",
      "doseLabel",
      "amount",
      "unit",
      "schedule",
      "stockAmount",
      "stockUnit",
      "stockCountedAt",
    ]),
    validate: validateAs<Supplement>(validSupplement),
  },
  supplementLogs: {
    allowedFields: fields(BASE_FIELDS, [
      "supplementId",
      "status",
      "scheduledAt",
      "doseAmount",
      "doseUnit",
      "takenAt",
    ]),
    validate: validateAs<SupplementLog>(validSupplementLog),
  },
  hydrationEntries: {
    allowedFields: fields(BASE_FIELDS, ["drunkAt", "milliliters"]),
    validate: validateAs<HydrationEntry>(validHydrationEntry),
  },
  measurements: {
    allowedFields: fields(BASE_FIELDS, [
      "type",
      "value",
      "secondaryValue",
      "unit",
      "metricName",
      "pulseBpm",
      "context",
      "measuredAt",
      "note",
    ]),
    validate: validateAs<Measurement>(validMeasurement),
  },
  xpTransactions: {
    allowedFields: fields(BASE_FIELDS, [
      "source",
      "sourceEntityId",
      "amount",
      "earnedAt",
      "reason",
    ]),
    validate: validateAs<XPTransaction>(validXpTransaction),
  },
  levelStates: {
    allowedFields: fields(BASE_FIELDS, ["totalXp", "level", "computedAt"]),
    validate: validateAs<LevelState>(validLevelState),
  },
  quests: {
    allowedFields: fields(BASE_FIELDS, [
      "title",
      "description",
      "activeFrom",
      "activeUntil",
      "condition",
    ]),
    validate: validateAs<Quest>(validQuest),
  },
  questProgress: {
    allowedFields: fields(BASE_FIELDS, ["questId", "progress", "goal", "completedAt"]),
    validate: validateAs<QuestProgress>(validQuestProgress),
  },
  achievements: {
    allowedFields: fields(BASE_FIELDS, ["key", "title", "description"]),
    validate: validateAs<Achievement>(validAchievement),
  },
  userRewards: {
    allowedFields: fields(BASE_FIELDS, ["achievementId", "collectibleId", "earnedAt"]),
    validate: validateAs<UserReward>(validUserReward),
  },
  vaultRewards: {
    allowedFields: fields(BASE_FIELDS, ["title", "note", "xpThreshold"]),
    validate: validateAs<VaultReward>(validVaultReward),
  },
  vaultClaims: {
    allowedFields: fields(BASE_FIELDS, ["rewardId", "claimedAt", "xpDeducted"]),
    validate: validateAs<VaultRewardClaim>(validVaultClaim),
  },
  collectibles: {
    allowedFields: fields(BASE_FIELDS, ["key", "title", "unlocksThemeKey"]),
    validate: validateAs<Collectible>(validCollectible),
  },
  projects: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["name", "colorKey", "archivedAt"]),
    validate: validateAs<Project>(validProject),
  },
  tags: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["name", "colorKey"]),
    validate: validateAs<Tag>(validTag),
  },
  journalEntries: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "writtenAt",
      "title",
      "body",
      "reflectionSuccess",
      "reflectionDifficult",
      "reflectionTomorrow",
    ]),
    validate: validateAs<JournalEntry>(validJournalEntry),
  },
  foods: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "name",
      "caloriesPer100G",
      "proteinPer100G",
      "carbsPer100G",
      "fatPer100G",
      "fiberPer100G",
      "servingSizeG",
    ]),
    validate: validateAs<Food>(validFood),
  },
  recipes: {
    allowedFields: fields(SOFT_DELETE_FIELDS, ["name", "ingredients", "servings", "foodIds"]),
    validate: validateAs<Recipe>(validRecipe),
  },
  nutritionEntries: {
    allowedFields: fields(SOFT_DELETE_FIELDS, [
      "eatenAt",
      "foodId",
      "amountG",
      "mealSlotId",
      "label",
      "calories",
      "proteinG",
      "carbsG",
      "fatG",
      "fiberG",
    ]),
    validate: validateAs<NutritionEntry>(validNutritionEntry),
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isUniqueStringList(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0) &&
    new Set(value).size === value.length
  );
}

function hasUniqueValues(
  rows: Iterable<Record<string, unknown>>,
  keyOf: (row: Record<string, unknown>) => string | undefined,
): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key === undefined) continue;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

function hasUniqueCompositeValues(
  rows: Iterable<Record<string, unknown>>,
  fields: readonly string[],
  include: (row: Record<string, unknown>) => boolean = () => true,
): boolean {
  return hasUniqueValues(rows, (row) =>
    include(row) ? JSON.stringify(fields.map((field) => row[field])) : undefined,
  );
}

function validateSettings(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "theme",
      "dayStartHour",
      "gamificationVisible",
      "enabledSections",
      "notificationDefaultsEnabled",
      "appLockEnabled",
      "weightTarget",
      "heightCm",
      "mealSlots",
      "macroTargets",
      "hydrationTargetMl",
      "hydrationReminderTime",
      "favoriteFoodIds",
    ]) ||
    (value.theme !== "light" && value.theme !== "dark" && value.theme !== "system") ||
    (value.dayStartHour !== null &&
      (typeof value.dayStartHour !== "number" ||
        !Number.isInteger(value.dayStartHour) ||
        value.dayStartHour < 0 ||
        value.dayStartHour > 23)) ||
    typeof value.gamificationVisible !== "boolean" ||
    (value.enabledSections !== null && !isUniqueStringList(value.enabledSections)) ||
    (value.notificationDefaultsEnabled !== null &&
      typeof value.notificationDefaultsEnabled !== "boolean") ||
    (value.appLockEnabled !== null && typeof value.appLockEnabled !== "boolean") ||
    !validateWeightTarget(value.weightTarget).ok ||
    !validateHeightCm(value.heightCm).ok ||
    !validateMealSlots(value.mealSlots).ok ||
    !validateMacroTargets(value.macroTargets).ok ||
    !validateHydrationTargetMl(value.hydrationTargetMl).ok ||
    !validateHydrationReminderTime(value.hydrationReminderTime).ok ||
    !isUniqueStringList(value.favoriteFoodIds) ||
    value.favoriteFoodIds.length > 500
  ) {
    return false;
  }
  if (value.weightTarget !== null && isRecord(value.weightTarget)) {
    if (!hasExactKeys(value.weightTarget, ["value", "unit"])) return false;
  }
  if (
    isRecord(value.macroTargets) &&
    !hasExactKeys(value.macroTargets, ["caloriesKcal", "proteinG", "carbsG", "fatG", "fiberG"])
  ) {
    return false;
  }
  if (Array.isArray(value.mealSlots)) {
    for (const slot of value.mealSlots) {
      if (!isRecord(slot) || !hasExactKeys(slot, ["id", "label", "sortOrder", "archived"])) {
        return false;
      }
    }
  }
  return true;
}

function validateNestedShapes(collection: CollectionName, value: Record<string, unknown>): boolean {
  if (collection === "tasks" && isRecord(value.recurrence)) {
    const keysByKind: Readonly<Record<string, readonly string[]>> = {
      daily: ["kind", "everyDays"],
      weekly: ["kind", "everyWeeks", "weekdays"],
      monthly: ["kind", "everyMonths", "dayOfMonth"],
      custom: ["kind", "every", "unit"],
    };
    const fieldsForKind = keysByKind[String(value.recurrence.kind)];
    return fieldsForKind !== undefined && hasExactKeys(value.recurrence, fieldsForKind);
  }
  if (collection === "reminders" && value.rule !== null) {
    return validateReminderRule(value.rule).ok;
  }
  if (collection === "recipes") {
    if (Array.isArray(value.ingredients)) {
      for (const ingredient of value.ingredients) {
        if (
          !isRecord(ingredient) ||
          !hasOnlyKeys(ingredient, ["foodId", "amountG"]) ||
          Object.keys(ingredient).length !== 2
        ) {
          return false;
        }
      }
    }
    return true;
  }
  if (collection === "quests" && isRecord(value.condition)) {
    return (
      hasOnlyKeys(value.condition, ["kind", "goal", "minimumAmount"]) &&
      Object.keys(value.condition).length >= 2
    );
  }
  return true;
}

function validateRestoreSnapshot(
  value: unknown,
  manifest: BackupManifest,
):
  | {
      readonly ok: true;
      readonly value: Omit<BackupRestoreDryRunSummary, "manifest"> & {
        readonly snapshot: PortableDataSnapshot;
      };
    }
  | {
      readonly ok: false;
      readonly issue: RestoreIssue;
    } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "format",
      "formatVersion",
      "sourceSchemaVersion",
      "exportedAt",
      "settings",
      "collections",
    ]) ||
    value.format !== "lifeos-portable-export" ||
    value.formatVersion !== 1 ||
    typeof value.sourceSchemaVersion !== "number" ||
    !Number.isSafeInteger(value.sourceSchemaVersion) ||
    value.sourceSchemaVersion < 1 ||
    value.sourceSchemaVersion !== manifest.schemaVersion ||
    value.sourceSchemaVersion > CURRENT_SCHEMA_VERSION ||
    !isCanonicalTimestamp(value.exportedAt) ||
    value.exportedAt !== manifest.createdAt ||
    !validateSettings(value.settings) ||
    !isRecord(value.collections) ||
    !hasExactKeys(value.collections, PORTABLE_DATA_COLLECTION_KEYS)
  ) {
    return { ok: false, issue: { code: "snapshot-shape" } };
  }

  const collections = value.collections;
  const rowsByCollection = new Map<CollectionName, Map<string, Record<string, unknown>>>();
  let recordCount = 0;

  for (const collection of PORTABLE_DATA_COLLECTION_KEYS) {
    const rows = collections[collection];
    const rule = COLLECTION_RULES[collection];
    if (!Array.isArray(rows)) {
      return { ok: false, issue: { code: "collection-invalid", collection } };
    }
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rows as unknown[]) {
      if (
        !isRecord(row) ||
        !hasOnlyKeys(row, rule.allowedFields) ||
        !validateNestedShapes(collection, row) ||
        !rule.validate(row) ||
        typeof row.id !== "string"
      ) {
        return { ok: false, issue: { code: "collection-invalid", collection } };
      }
      if (byId.has(row.id)) {
        return { ok: false, issue: { code: "duplicate-id", collection } };
      }
      byId.set(row.id, row);
      recordCount += 1;
    }
    rowsByCollection.set(collection, byId);
  }

  const has = (collection: CollectionName, id: unknown): boolean =>
    typeof id === "string" && (rowsByCollection.get(collection)?.has(id) ?? false);
  const refs = (collection: CollectionName, ids: readonly unknown[]): boolean =>
    ids.every((id) => has(collection, id));
  const hasUniqueComposite = (
    collection: CollectionName,
    uniqueFields: readonly string[],
    include?: (row: Record<string, unknown>) => boolean,
  ): boolean =>
    hasUniqueCompositeValues(
      rowsByCollection.get(collection)?.values() ?? [],
      uniqueFields,
      include,
    );
  const hasUniqueField = (collection: CollectionName, field: string): boolean =>
    hasUniqueValues(rowsByCollection.get(collection)?.values() ?? [], (row) =>
      typeof row[field] === "string" ? row[field] : undefined,
    );
  const failCollection = (collection: CollectionName) => ({
    ok: false as const,
    issue: { code: "collection-invalid" as const, collection },
  });
  const failReference = (
    collection: CollectionName,
  ): { readonly ok: false; readonly issue: RestoreIssue } => ({
    ok: false,
    issue: { code: "reference-missing", collection },
  });

  // Mirror the important unique indexes and table constraints before any real restore transaction.
  if (!hasUniqueField("tags", "name")) return failCollection("tags");
  if (!hasUniqueField("achievements", "key")) return failCollection("achievements");
  if (!hasUniqueField("collectibles", "key")) return failCollection("collectibles");
  if (!hasUniqueComposite("goalDays", ["goalId", "localDate"])) {
    return failCollection("goalDays");
  }
  if (
    !hasUniqueComposite(
      "supplementLogs",
      ["supplementId", "scheduledAt"],
      (row) => row.scheduledAt !== null,
    )
  )
    return failCollection("supplementLogs");
  if (
    !hasUniqueComposite(
      "routineRuns",
      ["routineId", "localDate"],
      (row) => row.status !== "cancelled",
    )
  )
    return failCollection("routineRuns");
  if (!hasUniqueComposite("routineStepRuns", ["routineRunId", "routineStepId"])) {
    return failCollection("routineStepRuns");
  }
  for (const recipe of rowsByCollection.get("recipes")?.values() ?? []) {
    const foodIds = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.flatMap((ingredient) =>
          isRecord(ingredient) ? [ingredient.foodId] : [],
        )
      : ((recipe.foodIds as readonly unknown[] | undefined) ?? []);
    if (new Set(foodIds).size !== foodIds.length) return failCollection("recipes");
  }

  for (const task of rowsByCollection.get("tasks")?.values() ?? []) {
    if (
      (task.projectId !== null && !has("projects", task.projectId)) ||
      !refs("tags", task.tagIds as readonly unknown[])
    )
      return failReference("tasks");
  }
  for (const item of rowsByCollection.get("taskChecklistItems")?.values() ?? []) {
    if (!has("tasks", item.taskId)) return failReference("taskChecklistItems");
  }
  for (const block of rowsByCollection.get("calendarBlocks")?.values() ?? []) {
    if (
      (block.linkedTaskId !== null && !has("tasks", block.linkedTaskId)) ||
      (block.linkedRoutineId !== null && !has("routines", block.linkedRoutineId))
    )
      return failReference("calendarBlocks");
  }
  for (const session of rowsByCollection.get("focusSessions")?.values() ?? []) {
    if (
      (session.taskId !== null && !has("tasks", session.taskId)) ||
      (session.routineId !== null && !has("routines", session.routineId)) ||
      (session.calendarBlockId !== null &&
        session.calendarBlockId !== undefined &&
        !has("calendarBlocks", session.calendarBlockId))
    )
      return failReference("focusSessions");
  }
  for (const distraction of rowsByCollection.get("distractions")?.values() ?? []) {
    if (!has("focusSessions", distraction.focusSessionId)) return failReference("distractions");
  }
  for (const collection of ["routineSteps", "routineSchedules", "routineRuns"] as const) {
    for (const row of rowsByCollection.get(collection)?.values() ?? []) {
      if (!has("routines", row.routineId)) return failReference(collection);
    }
  }
  for (const stepRun of rowsByCollection.get("routineStepRuns")?.values() ?? []) {
    const run = rowsByCollection.get("routineRuns")?.get(String(stepRun.routineRunId));
    const step = rowsByCollection.get("routineSteps")?.get(String(stepRun.routineStepId));
    if (run === undefined || step === undefined || run.routineId !== step.routineId) {
      return failReference("routineStepRuns");
    }
  }
  for (const collection of ["goalDays", "habitRules"] as const) {
    for (const row of rowsByCollection.get(collection)?.values() ?? []) {
      if (row.goalId !== null && row.goalId !== undefined && !has("goals", row.goalId)) {
        return failReference(collection);
      }
    }
  }
  for (const reminder of rowsByCollection.get("reminders")?.values() ?? []) {
    if (isRecord(reminder.rule) && isRecord(reminder.rule.subject)) {
      const subject = reminder.rule.subject;
      const collection =
        subject.kind === "task" ? "tasks" : subject.kind === "routine" ? "routines" : "goals";
      if (!has(collection, subject.id)) return failReference("reminders");
    }
  }
  for (const state of rowsByCollection.get("notificationStates")?.values() ?? []) {
    if (state.reminderId !== null && !has("reminders", state.reminderId)) {
      return failReference("notificationStates");
    }
  }
  for (const log of rowsByCollection.get("supplementLogs")?.values() ?? []) {
    if (!has("supplements", log.supplementId)) return failReference("supplementLogs");
  }
  for (const progress of rowsByCollection.get("questProgress")?.values() ?? []) {
    if (!has("quests", progress.questId)) return failReference("questProgress");
  }
  for (const reward of rowsByCollection.get("userRewards")?.values() ?? []) {
    if (
      (reward.achievementId !== null && !has("achievements", reward.achievementId)) ||
      (reward.collectibleId !== null && !has("collectibles", reward.collectibleId))
    )
      return failReference("userRewards");
  }
  for (const claim of rowsByCollection.get("vaultClaims")?.values() ?? []) {
    if (!has("vaultRewards", claim.rewardId)) return failReference("vaultClaims");
  }
  for (const recipe of rowsByCollection.get("recipes")?.values() ?? []) {
    const foodIds = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.flatMap((ingredient) =>
          isRecord(ingredient) ? [ingredient.foodId] : [],
        )
      : ((recipe.foodIds as readonly unknown[] | undefined) ?? []);
    if (!refs("foods", foodIds)) return failReference("recipes");
  }
  for (const entry of rowsByCollection.get("nutritionEntries")?.values() ?? []) {
    if (entry.foodId !== null && entry.foodId !== undefined && !has("foods", entry.foodId))
      return failReference("nutritionEntries");
  }
  return {
    ok: true,
    value: {
      checkedCollectionCount: PORTABLE_DATA_COLLECTION_KEYS.length,
      checkedRecordCount: recordCount,
      snapshot: value as unknown as PortableDataSnapshot,
    },
  };
}

/** Shared authenticated open + full validation path for dry-run and restore. */
export async function decryptAndValidateBackupForRestore(
  value: unknown,
  keySession: DataKeySession,
): Promise<
  | { readonly ok: true; readonly value: BackupRestoreValidationSummary }
  | {
      readonly ok: false;
      readonly error: EncryptedBackupError & { readonly issue?: RestoreIssue };
    }
> {
  const opened = await openEncryptedBackup(value, keySession);
  if (!opened.ok) return opened;
  const validated = validateRestoreSnapshot(opened.value.payload, opened.value.manifest);
  if (!validated.ok) {
    return {
      ok: false,
      error: {
        code: "invalid-format",
        diagnosticCode: `encrypted-backup.restore.${validated.issue.code}`,
        userMessage: "Varmuuskopion sisältö ei läpäissyt palautuksen dry-run-validointia.",
        issue: validated.issue,
      },
    };
  }
  return {
    ok: true,
    value: { manifest: opened.value.manifest, ...validated.value },
  };
}

/** Decrypt and validate in a temporary memory-only workspace; return no record payload. */
export async function dryRunEncryptedBackupRestore(
  value: unknown,
  keySession: DataKeySession,
): Promise<BackupRestoreDryRunResult> {
  const validated = await decryptAndValidateBackupForRestore(value, keySession);
  if (!validated.ok) return validated;
  return {
    ok: true,
    value: {
      manifest: validated.value.manifest,
      checkedCollectionCount: validated.value.checkedCollectionCount,
      checkedRecordCount: validated.value.checkedRecordCount,
    },
  };
}
