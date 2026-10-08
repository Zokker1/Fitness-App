// T275/T321: shared all-or-nothing read of the local data used by both exports.
import {
  readPreferences,
  type EntityRepository,
  type PortableDataCollections,
  type PortableDataSettings,
  type PortableDataSnapshotInput,
} from "@lifeos/data";
import type { BaseEntity, UserPreferences } from "@lifeos/domain";
import type { LifeosDataServices } from "../../dataContext.tsx";

type ExportSettings = Omit<
  PortableDataSettings,
  "dayStartHour" | "enabledSections" | "notificationDefaultsEnabled" | "appLockEnabled"
>;

async function readCollection<T extends BaseEntity>(
  repository: EntityRepository<T>,
): Promise<readonly T[]> {
  const result = await repository.list();
  if (!result.ok) throw new Error("portable-export.collection-read-failed");
  return result.value;
}

/** Reads every collection and required preference before either export can be created. */
export async function collectPortableSnapshotInput(
  data: LifeosDataServices,
  settings: ExportSettings,
  includeStoredPreferences: boolean,
): Promise<PortableDataSnapshotInput> {
  const [
    tasks,
    taskChecklistItems,
    calendarBlocks,
    focusSessions,
    distractions,
    routines,
    routineSteps,
    routineSchedules,
    routineRuns,
    routineStepRuns,
    goals,
    goalDays,
    habitRules,
    sleepEntries,
    breathingSessions,
    activityEntries,
    moodCheckins,
    reminders,
    notificationStates,
    supplements,
    supplementLogs,
    hydrationEntries,
    measurements,
    xpTransactions,
    levelStates,
    quests,
    questProgress,
    achievements,
    userRewards,
    vaultRewards,
    vaultClaims,
    collectibles,
    projects,
    tags,
    journalEntries,
    foods,
    recipes,
    nutritionEntries,
  ] = await Promise.all([
    readCollection(data.tasks),
    readCollection(data.taskChecklistItems),
    readCollection(data.calendarBlocks),
    readCollection(data.focusSessions),
    readCollection(data.distractions),
    readCollection(data.routines),
    readCollection(data.routineSteps),
    readCollection(data.routineSchedules),
    readCollection(data.routineRuns),
    readCollection(data.routineStepRuns),
    readCollection(data.goals),
    readCollection(data.goalDays),
    readCollection(data.habitRules),
    readCollection(data.sleepEntries),
    readCollection(data.breathingSessions),
    readCollection(data.activityEntries),
    readCollection(data.moodCheckins),
    readCollection(data.reminders),
    readCollection(data.notificationStates),
    readCollection(data.supplements),
    readCollection(data.supplementLogs),
    readCollection(data.hydrationEntries),
    readCollection(data.measurements),
    readCollection(data.xpTransactions),
    readCollection(data.levelStates),
    readCollection(data.quests),
    readCollection(data.questProgress),
    readCollection(data.achievements),
    readCollection(data.userRewards),
    readCollection(data.vaultRewards),
    readCollection(data.vaultClaims),
    readCollection(data.collectibles),
    readCollection(data.projects),
    readCollection(data.tags),
    readCollection(data.journalEntries),
    readCollection(data.foods),
    readCollection(data.recipes),
    readCollection(data.nutritionEntries),
  ]);

  const collections: PortableDataCollections = {
    tasks,
    taskChecklistItems,
    calendarBlocks,
    focusSessions,
    distractions,
    routines,
    routineSteps,
    routineSchedules,
    routineRuns,
    routineStepRuns,
    goals,
    goalDays,
    habitRules,
    sleepEntries,
    breathingSessions,
    activityEntries,
    moodCheckins,
    reminders,
    notificationStates,
    supplements,
    supplementLogs,
    hydrationEntries,
    measurements,
    xpTransactions,
    levelStates,
    quests,
    questProgress,
    achievements,
    userRewards,
    vaultRewards,
    vaultClaims,
    collectibles,
    projects,
    tags,
    journalEntries,
    foods,
    recipes,
    nutritionEntries,
  };

  let storedPreferences: UserPreferences | null = null;
  if (includeStoredPreferences) {
    const result = await readPreferences();
    if (!result.ok) throw new Error("portable-export.preferences-read-failed");
    storedPreferences = result.value;
  }

  return {
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      dayStartHour: storedPreferences?.dayStartHour ?? null,
      enabledSections: storedPreferences?.enabledSections ?? null,
      notificationDefaultsEnabled: storedPreferences?.notificationDefaults.enabled ?? null,
      appLockEnabled: storedPreferences?.appLockEnabled ?? null,
    },
    collections,
  };
}
