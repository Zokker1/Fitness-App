// T275: versionoitu, alustariippumaton snapshot käyttäjän paikallisesta datasta.
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
  MacroTargets,
  MealSlotPreference,
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
  ThemePreference,
  UserReward,
  VaultReward,
  VaultRewardClaim,
  WeightTarget,
  XPTransaction,
} from "@lifeos/domain";
import { CURRENT_SCHEMA_VERSION } from "./migrations.ts";

export interface PortableDataCollections {
  readonly tasks: readonly Task[];
  readonly taskChecklistItems: readonly TaskChecklistItem[];
  readonly calendarBlocks: readonly CalendarBlock[];
  readonly focusSessions: readonly FocusSession[];
  readonly distractions: readonly Distraction[];
  readonly routines: readonly Routine[];
  readonly routineSteps: readonly RoutineStep[];
  readonly routineSchedules: readonly RoutineSchedule[];
  readonly routineRuns: readonly RoutineRun[];
  readonly routineStepRuns: readonly RoutineStepRun[];
  readonly goals: readonly Goal[];
  readonly goalDays: readonly GoalDay[];
  readonly habitRules: readonly HabitRule[];
  readonly sleepEntries: readonly SleepEntry[];
  readonly breathingSessions: readonly BreathingSession[];
  readonly activityEntries: readonly ActivityEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
  readonly reminders: readonly Reminder[];
  readonly notificationStates: readonly NotificationState[];
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
  readonly hydrationEntries: readonly HydrationEntry[];
  readonly measurements: readonly Measurement[];
  readonly xpTransactions: readonly XPTransaction[];
  readonly levelStates: readonly LevelState[];
  readonly quests: readonly Quest[];
  readonly questProgress: readonly QuestProgress[];
  readonly achievements: readonly Achievement[];
  readonly userRewards: readonly UserReward[];
  readonly vaultRewards: readonly VaultReward[];
  readonly vaultClaims: readonly VaultRewardClaim[];
  readonly collectibles: readonly Collectible[];
  readonly projects: readonly Project[];
  readonly tags: readonly Tag[];
  readonly journalEntries: readonly JournalEntry[];
  readonly foods: readonly Food[];
  readonly recipes: readonly Recipe[];
  readonly nutritionEntries: readonly NutritionEntry[];
}

export const PORTABLE_DATA_COLLECTION_KEYS = [
  "tasks",
  "taskChecklistItems",
  "calendarBlocks",
  "focusSessions",
  "distractions",
  "routines",
  "routineSteps",
  "routineSchedules",
  "routineRuns",
  "routineStepRuns",
  "goals",
  "goalDays",
  "habitRules",
  "sleepEntries",
  "breathingSessions",
  "activityEntries",
  "moodCheckins",
  "reminders",
  "notificationStates",
  "supplements",
  "supplementLogs",
  "hydrationEntries",
  "measurements",
  "xpTransactions",
  "levelStates",
  "quests",
  "questProgress",
  "achievements",
  "userRewards",
  "vaultRewards",
  "vaultClaims",
  "collectibles",
  "projects",
  "tags",
  "journalEntries",
  "foods",
  "recipes",
  "nutritionEntries",
] as const satisfies readonly (keyof PortableDataCollections)[];

export interface PortableDataSettings {
  readonly theme: ThemePreference;
  readonly dayStartHour: number | null;
  readonly gamificationVisible: boolean;
  readonly enabledSections: readonly string[] | null;
  readonly notificationDefaultsEnabled: boolean | null;
  readonly appLockEnabled: boolean | null;
  readonly weightTarget: WeightTarget | null;
  readonly heightCm: number | null;
  readonly mealSlots: readonly MealSlotPreference[];
  readonly macroTargets: MacroTargets;
  readonly hydrationTargetMl: number | null;
  readonly hydrationReminderTime: string | null;
  readonly favoriteFoodIds: readonly string[];
}

export interface PortableDataSnapshotInput {
  readonly exportedAt: string;
  readonly settings: PortableDataSettings;
  readonly collections: PortableDataCollections;
}

export interface PortableDataSnapshot extends PortableDataSnapshotInput {
  readonly format: "lifeos-portable-export";
  readonly formatVersion: 1;
  readonly sourceSchemaVersion: number;
}

function sortById<T extends { readonly id: string }>(records: readonly T[]): readonly T[] {
  return [...records].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/**
 * Builds an explicit allowlisted snapshot of the app's user-owned entities.
 * Sync operations, browser installation identifiers, backup manifests, OAuth
 * credentials, encryption keys, and diagnostics are intentionally excluded.
 */
export function buildPortableDataSnapshot(input: PortableDataSnapshotInput): PortableDataSnapshot {
  const { collections } = input;
  return {
    format: "lifeos-portable-export",
    formatVersion: 1,
    sourceSchemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: input.exportedAt,
    settings: {
      theme: input.settings.theme,
      dayStartHour: input.settings.dayStartHour,
      gamificationVisible: input.settings.gamificationVisible,
      enabledSections:
        input.settings.enabledSections === null ? null : [...input.settings.enabledSections],
      notificationDefaultsEnabled: input.settings.notificationDefaultsEnabled,
      appLockEnabled: input.settings.appLockEnabled,
      weightTarget:
        input.settings.weightTarget === null
          ? null
          : { value: input.settings.weightTarget.value, unit: input.settings.weightTarget.unit },
      heightCm: input.settings.heightCm,
      mealSlots: input.settings.mealSlots.map((slot) => ({
        id: slot.id,
        label: slot.label,
        sortOrder: slot.sortOrder,
        archived: slot.archived,
      })),
      macroTargets: {
        caloriesKcal: input.settings.macroTargets.caloriesKcal,
        proteinG: input.settings.macroTargets.proteinG,
        carbsG: input.settings.macroTargets.carbsG,
        fatG: input.settings.macroTargets.fatG,
        fiberG: input.settings.macroTargets.fiberG,
      },
      hydrationTargetMl: input.settings.hydrationTargetMl,
      hydrationReminderTime: input.settings.hydrationReminderTime,
      favoriteFoodIds: [...input.settings.favoriteFoodIds],
    },
    collections: {
      tasks: sortById(collections.tasks),
      taskChecklistItems: sortById(collections.taskChecklistItems),
      calendarBlocks: sortById(collections.calendarBlocks),
      focusSessions: sortById(collections.focusSessions),
      distractions: sortById(collections.distractions),
      routines: sortById(collections.routines),
      routineSteps: sortById(collections.routineSteps),
      routineSchedules: sortById(collections.routineSchedules),
      routineRuns: sortById(collections.routineRuns),
      routineStepRuns: sortById(collections.routineStepRuns),
      goals: sortById(collections.goals),
      goalDays: sortById(collections.goalDays),
      habitRules: sortById(collections.habitRules),
      sleepEntries: sortById(collections.sleepEntries),
      breathingSessions: sortById(collections.breathingSessions),
      activityEntries: sortById(collections.activityEntries),
      moodCheckins: sortById(collections.moodCheckins),
      reminders: sortById(collections.reminders),
      notificationStates: sortById(collections.notificationStates),
      supplements: sortById(collections.supplements),
      supplementLogs: sortById(collections.supplementLogs),
      hydrationEntries: sortById(collections.hydrationEntries),
      measurements: sortById(collections.measurements),
      xpTransactions: sortById(collections.xpTransactions),
      levelStates: sortById(collections.levelStates),
      quests: sortById(collections.quests),
      questProgress: sortById(collections.questProgress),
      achievements: sortById(collections.achievements),
      userRewards: sortById(collections.userRewards),
      vaultRewards: sortById(collections.vaultRewards),
      vaultClaims: sortById(collections.vaultClaims),
      collectibles: sortById(collections.collectibles),
      projects: sortById(collections.projects),
      tags: sortById(collections.tags),
      journalEntries: sortById(collections.journalEntries),
      foods: sortById(collections.foods),
      recipes: sortById(collections.recipes),
      nutritionEntries: sortById(collections.nutritionEntries),
    },
  };
}

/** Returns the full snapshot as indented UTF-8-ready JSON text. */
export function serializePortableDataSnapshot(input: PortableDataSnapshotInput): string {
  return `${JSON.stringify(buildPortableDataSnapshot(input), null, 2)}\n`;
}
