// T032: sovelluksen data-konteksti. Ainoa React-kerroksen reitti dataan:
// - DataProvider rakentaa repositoryt + servicet injektoiduista storeista
//   (muisti nyt; SQLite-repositoryt T036+:ssa samalla rajalla).
// - Komponentit kuluttavat useData()-hookin kautta service-funktioita;
//   ne eivät importoi @lifeos/data-storeja, domain-sääntöjä, SQL:ää,
//   Worker-clientia tai capability-adaptereita suoraan (vartioitu skannilla).
// - Ei domain-logiikkaa tässä tiedostossa: pelkkä DI-kokoonpano.

import { t } from "./language.tsx";
import { getActiveSyncWriteContext } from "./sync/syncRuntime.ts";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  ActivityEntry,
  Achievement,
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
  NotificationState,
  NutritionEntry,
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
  createAppendOnlyEntityStore,
  InMemoryStore,
  createSqliteFoodStore,
  createSqliteHydrationEntryStore,
  createSqliteActivityEntryStore,
  createSqliteSleepEntryStore,
  createSqliteMeasurementStore,
  createSqliteMoodCheckinStore,
  createSqliteJournalEntryStore,
  createSqliteBreathingSessionStore,
  createSqliteReminderStore,
  createSqliteNotificationStateStore,
  createSqliteQuestStore,
  createSqliteQuestProgressStore,
  createSqliteVaultRewardStore,
  createSqliteVaultRewardClaimStore,
  createSqliteXpTransactionStore,
  createSqliteLevelStateStore,
  createSqliteAchievementStore,
  createSqliteCollectibleStore,
  createSqliteUserRewardStore,
  createSqliteProjectStore,
  createSqliteTagStore,
  createSqliteTaskStore,
  createSqliteTaskChecklistItemStore,
  createSqliteRoutineStore,
  createSqliteRoutineStepStore,
  createSqliteRoutineScheduleStore,
  createSqliteRoutineRunStore,
  createSqliteRoutineStepRunStore,
  createSqliteCalendarBlockStore,
  createSqliteFocusSessionStore,
  createSqliteDistractionStore,
  createSqliteNutritionEntryStore,
  createSqliteRecipeStore,
  createSqliteGoalStore,
  createSqliteHabitRuleStore,
  createSqliteGoalDayStore,
  createSqliteSupplementStore,
  createSqliteSupplementLogStore,
  migrateDatabase,
  openDatabase,
  systemClock,
  type Clock,
  type EntityStore,
  type EntityRepository,
  type IdGenerator,
  createEntityRepository,
} from "@lifeos/data";

export interface LifeosDataServices {
  readonly tasks: EntityRepository<Task>;
  /** T108: tehtävien muistilistan alitehtävät (checklist/subtasks). */
  readonly taskChecklistItems: EntityRepository<TaskChecklistItem>;
  /** T121: kalenterin timeboxit (§6). */
  readonly calendarBlocks: EntityRepository<CalendarBlock>;
  readonly focusSessions: EntityRepository<FocusSession>;
  readonly distractions: EntityRepository<Distraction>;
  readonly routines: EntityRepository<Routine>;
  readonly routineSteps: EntityRepository<RoutineStep>;
  /** T149: rutiinin aikataulu on erillään sisällöstä. */
  readonly routineSchedules: EntityRepository<RoutineSchedule>;
  /** T149: rutiinin suoritukset ovat append-only historiaa. */
  readonly routineRuns: EntityRepository<RoutineRun>;
  readonly routineStepRuns: EntityRepository<RoutineStepRun>;
  readonly goals: EntityRepository<Goal>;
  readonly goalDays: EntityRepository<GoalDay>;
  /** T147: tavoitteeseen liitetty selkokielinen tapa-/rytmisääntö. */
  readonly habitRules: EntityRepository<HabitRule>;
  readonly sleepEntries: EntityRepository<SleepEntry>;
  readonly breathingSessions: EntityRepository<BreathingSession>;
  readonly activityEntries: EntityRepository<ActivityEntry>;
  readonly moodCheckins: EntityRepository<MoodCheckin>;
  readonly reminders: EntityRepository<Reminder>;
  readonly notificationStates: EntityRepository<NotificationState>;
  readonly supplements: EntityRepository<Supplement>;
  readonly supplementLogs: EntityRepository<SupplementLog>;
  readonly hydrationEntries: EntityRepository<HydrationEntry>;
  readonly measurements: EntityRepository<Measurement>;
  readonly xpTransactions: EntityRepository<XPTransaction>;
  readonly levelStates: EntityRepository<LevelState>;
  readonly quests: EntityRepository<Quest>;
  readonly questProgress: EntityRepository<QuestProgress>;
  readonly achievements: EntityRepository<Achievement>;
  /** T189: ansaitut palkinnot (saavutusgallerian avatut/lukitut). */
  readonly userRewards: EntityRepository<UserReward>;
  /** T192: käyttäjän itse määrittämät XP-kynnyksen Reward Vault -palkinnot. */
  readonly vaultRewards: EntityRepository<VaultReward>;
  /** T193: append-only lunastushistoria. */
  readonly vaultClaims: EntityRepository<VaultRewardClaim>;
  /** T191: keräilyesineet (tähtikartan tähdet ja alueet). */
  readonly collectibles: EntityRepository<Collectible>;
  // T096: hakemistoprojektion syöte — vain T095:n §22-lajit (ei arkaluonteista
  // enempää; ks. search-index.ts).
  readonly projects: EntityRepository<Project>;
  readonly tags: EntityRepository<Tag>;
  readonly journalEntries: EntityRepository<JournalEntry>;
  readonly foods: EntityRepository<Food>;
  readonly recipes: EntityRepository<Recipe>;
  readonly nutritionEntries: EntityRepository<NutritionEntry>;
}

const LifeosDataContext = createContext<LifeosDataServices | null>(null);

export interface DataProviderProps {
  readonly children: ReactNode;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  /** T130: pysyvä tila — entiteettirepot SQLite/OPFS-workerin yli
      (entity_docs ja käyttöönotetut relaatiostoret). Epäonnistuessa fallback InMemoryStoreen (best-effort,
      StorageStatus näyttää tilan). Oletus: muisti (testit + vanha käytös). */
  readonly persistent?: boolean;
  readonly taskStore?: InMemoryStore<Task>;
  readonly taskChecklistStore?: InMemoryStore<TaskChecklistItem>;
  readonly calendarBlockStore?: InMemoryStore<CalendarBlock>;
  readonly focusStore?: InMemoryStore<FocusSession>;
  readonly distractionStore?: InMemoryStore<Distraction>;
  readonly routineStore?: InMemoryStore<Routine>;
  readonly routineStepStore?: InMemoryStore<RoutineStep>;
  readonly routineScheduleStore?: InMemoryStore<RoutineSchedule>;
  readonly routineRunStore?: InMemoryStore<RoutineRun>;
  readonly routineStepRunStore?: InMemoryStore<RoutineStepRun>;
  readonly goalStore?: InMemoryStore<Goal>;
  readonly goalDayStore?: InMemoryStore<GoalDay>;
  readonly habitRuleStore?: InMemoryStore<HabitRule>;
  readonly sleepStore?: InMemoryStore<SleepEntry>;
  readonly breathingSessionStore?: InMemoryStore<BreathingSession>;
  readonly activityStore?: InMemoryStore<ActivityEntry>;
  readonly moodStore?: InMemoryStore<MoodCheckin>;
  readonly reminderStore?: InMemoryStore<Reminder>;
  readonly notificationStateStore?: InMemoryStore<NotificationState>;
  readonly supplementStore?: InMemoryStore<Supplement>;
  readonly supplementLogStore?: InMemoryStore<SupplementLog>;
  readonly hydrationStore?: InMemoryStore<HydrationEntry>;
  readonly measurementStore?: InMemoryStore<Measurement>;
  readonly xpStore?: InMemoryStore<XPTransaction>;
  readonly levelStore?: InMemoryStore<LevelState>;
  readonly questStore?: InMemoryStore<Quest>;
  readonly questProgressStore?: InMemoryStore<QuestProgress>;
  readonly achievementStore?: InMemoryStore<Achievement>;
  readonly userRewardStore?: InMemoryStore<UserReward>;
  readonly vaultRewardStore?: InMemoryStore<VaultReward>;
  readonly vaultClaimStore?: EntityStore<VaultRewardClaim>;
  readonly collectibleStore?: InMemoryStore<Collectible>;
  readonly projectStore?: InMemoryStore<Project>;
  readonly tagStore?: InMemoryStore<Tag>;
  readonly journalStore?: InMemoryStore<JournalEntry>;
  readonly foodStore?: InMemoryStore<Food>;
  readonly recipeStore?: InMemoryStore<Recipe>;
  readonly nutritionEntryStore?: InMemoryStore<NutritionEntry>;
}

let fallbackCounter = 0;
function fallbackIds(prefix: string): IdGenerator {
  return {
    next(): string {
      fallbackCounter += 1;
      return `${prefix}-${String(Date.now())}-${String(fallbackCounter).padStart(4, "0")}`;
    },
  };
}

export function DataProvider({
  children,
  clock,
  ids,
  persistent = false,
  taskStore,
  taskChecklistStore,
  calendarBlockStore,
  focusStore,
  distractionStore,
  routineStore,
  routineStepStore,
  routineScheduleStore,
  routineRunStore,
  routineStepRunStore,
  goalStore,
  goalDayStore,
  habitRuleStore,
  sleepStore,
  breathingSessionStore,
  activityStore,
  moodStore,
  reminderStore,
  notificationStateStore,
  supplementStore,
  supplementLogStore,
  hydrationStore,
  measurementStore,
  xpStore,
  levelStore,
  questStore,
  questProgressStore,
  achievementStore,
  userRewardStore,
  vaultRewardStore,
  vaultClaimStore,
  collectibleStore,
  projectStore,
  tagStore,
  journalStore,
  foodStore,
  recipeStore,
  nutritionEntryStore,
}: DataProviderProps): React.JSX.Element {
  // T130: pysyvä tila — avaa tietokanta + ajaa migraatiot ENNEN kuin lapset
  // (ja niiden ensimmäiset kirjoitukset) renderöityvät. Epäonnistuessa
  // jatketaan silti (operaatiot palauttavat DataErroria näkymiin; workerin
  // avausretry + StorageStatus hoitavat raportoinnin).
  const [persistentReady, setPersistentReady] = useState(!persistent);
  useEffect(() => {
    if (!persistent) {
      return;
    }
    const guard = { cancelled: false };
    void (async () => {
      try {
        const opened = await openDatabase();
        if (opened.ok) {
          await migrateDatabase();
        }
      } catch {
        // Best-effort: virhetilanne näkyy operaatioiden DataErroreina.
      }
      if (!guard.cancelled) {
        setPersistentReady(true);
      }
    })();
    return () => {
      guard.cancelled = true;
    };
  }, [persistent]);

  const value = useMemo<LifeosDataServices>(() => {
    const resolvedClock = clock ?? systemClock();
    const resolvedIds = ids ?? fallbackIds("lifeos");
    const deps = {
      clock: resolvedClock,
      ids: resolvedIds,
      getSyncContext: getActiveSyncWriteContext,
      onSyncWrite: () => {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("lifeos:data-changed"));
        }
      },
    };
    // T130: pysyvä tila — EntityStoret SQLite/OPFS-workerin yli
    // (entity_docs + relaatioleikkaukset). IO on laiskaa (avaus ensimmäisellä operaatiolla),
    // joten rakennus on synkroninen; operaatiovirheet kulkevat DataResultina
    // (näkymien virhetilat), ei fallbackia kesken ajon.
    if (persistent) {
      return {
        tasks: createEntityRepository<Task>(createSqliteTaskStore(), deps),
        taskChecklistItems: createEntityRepository<TaskChecklistItem>(
          createSqliteTaskChecklistItemStore(),
          deps,
        ),
        calendarBlocks: createEntityRepository<CalendarBlock>(
          createSqliteCalendarBlockStore(),
          deps,
        ),
        focusSessions: createEntityRepository<FocusSession>(createSqliteFocusSessionStore(), deps),
        distractions: createEntityRepository<Distraction>(createSqliteDistractionStore(), deps),
        routines: createEntityRepository<Routine>(createSqliteRoutineStore(), deps),
        routineSteps: createEntityRepository<RoutineStep>(createSqliteRoutineStepStore(), deps),
        routineSchedules: createEntityRepository<RoutineSchedule>(
          createSqliteRoutineScheduleStore(),
          deps,
        ),
        routineRuns: createEntityRepository<RoutineRun>(createSqliteRoutineRunStore(), deps),
        routineStepRuns: createEntityRepository<RoutineStepRun>(
          createSqliteRoutineStepRunStore(),
          deps,
        ),
        goals: createEntityRepository<Goal>(createSqliteGoalStore(), deps),
        goalDays: createEntityRepository<GoalDay>(createSqliteGoalDayStore(), deps),
        habitRules: createEntityRepository<HabitRule>(createSqliteHabitRuleStore(), deps),
        sleepEntries: createEntityRepository<SleepEntry>(createSqliteSleepEntryStore(), deps),
        breathingSessions: createEntityRepository<BreathingSession>(
          createSqliteBreathingSessionStore(),
          deps,
        ),
        activityEntries: createEntityRepository<ActivityEntry>(
          createSqliteActivityEntryStore(),
          deps,
        ),
        moodCheckins: createEntityRepository<MoodCheckin>(createSqliteMoodCheckinStore(), deps),
        reminders: createEntityRepository<Reminder>(createSqliteReminderStore(), deps),
        notificationStates: createEntityRepository<NotificationState>(
          createSqliteNotificationStateStore(),
          deps,
        ),
        supplements: createEntityRepository<Supplement>(createSqliteSupplementStore(), deps),
        supplementLogs: createEntityRepository<SupplementLog>(
          createSqliteSupplementLogStore(),
          deps,
        ),
        hydrationEntries: createEntityRepository<HydrationEntry>(
          createSqliteHydrationEntryStore(),
          deps,
        ),
        measurements: createEntityRepository<Measurement>(createSqliteMeasurementStore(), deps),
        xpTransactions: createEntityRepository<XPTransaction>(
          createSqliteXpTransactionStore(),
          deps,
        ),
        levelStates: createEntityRepository<LevelState>(createSqliteLevelStateStore(), deps),
        quests: createEntityRepository<Quest>(createSqliteQuestStore(), deps),
        questProgress: createEntityRepository<QuestProgress>(
          createSqliteQuestProgressStore(),
          deps,
        ),
        achievements: createEntityRepository<Achievement>(createSqliteAchievementStore(), deps),
        userRewards: createEntityRepository<UserReward>(
          createAppendOnlyEntityStore(createSqliteUserRewardStore()),
          deps,
        ),
        vaultRewards: createEntityRepository<VaultReward>(createSqliteVaultRewardStore(), deps),
        vaultClaims: createEntityRepository<VaultRewardClaim>(
          createSqliteVaultRewardClaimStore(),
          deps,
        ),
        collectibles: createEntityRepository<Collectible>(createSqliteCollectibleStore(), deps),
        projects: createEntityRepository<Project>(createSqliteProjectStore(), deps),
        tags: createEntityRepository<Tag>(createSqliteTagStore(), deps),
        journalEntries: createEntityRepository<JournalEntry>(createSqliteJournalEntryStore(), deps),
        foods: createEntityRepository<Food>(createSqliteFoodStore(), deps),
        recipes: createEntityRepository<Recipe>(createSqliteRecipeStore(), deps),
        nutritionEntries: createEntityRepository<NutritionEntry>(
          createSqliteNutritionEntryStore(),
          deps,
        ),
      };
    }
    return {
      tasks: createEntityRepository<Task>(taskStore ?? new InMemoryStore<Task>("task"), deps),
      taskChecklistItems: createEntityRepository<TaskChecklistItem>(
        taskChecklistStore ?? new InMemoryStore<TaskChecklistItem>("task-checklist-item"),
        deps,
      ),
      calendarBlocks: createEntityRepository<CalendarBlock>(
        calendarBlockStore ?? new InMemoryStore<CalendarBlock>("calendar-block"),
        deps,
      ),
      focusSessions: createEntityRepository<FocusSession>(
        focusStore ?? new InMemoryStore<FocusSession>("focus-session"),
        deps,
      ),
      distractions: createEntityRepository<Distraction>(
        distractionStore ?? new InMemoryStore<Distraction>("distraction"),
        deps,
      ),
      routines: createEntityRepository<Routine>(
        routineStore ?? new InMemoryStore<Routine>("routine"),
        deps,
      ),
      routineSteps: createEntityRepository<RoutineStep>(
        routineStepStore ?? new InMemoryStore<RoutineStep>("routine-step"),
        deps,
      ),
      routineSchedules: createEntityRepository<RoutineSchedule>(
        routineScheduleStore ?? new InMemoryStore<RoutineSchedule>("routine-schedule"),
        deps,
      ),
      routineRuns: createEntityRepository<RoutineRun>(
        routineRunStore ?? new InMemoryStore<RoutineRun>("routine-run"),
        deps,
      ),
      routineStepRuns: createEntityRepository<RoutineStepRun>(
        routineStepRunStore ?? new InMemoryStore<RoutineStepRun>("routine-step-run"),
        deps,
      ),
      goals: createEntityRepository<Goal>(goalStore ?? new InMemoryStore<Goal>("goal"), deps),
      goalDays: createEntityRepository<GoalDay>(
        goalDayStore ?? new InMemoryStore<GoalDay>("goal-day"),
        deps,
      ),
      habitRules: createEntityRepository<HabitRule>(
        habitRuleStore ?? new InMemoryStore<HabitRule>("habit-rule"),
        deps,
      ),
      sleepEntries: createEntityRepository<SleepEntry>(
        sleepStore ?? new InMemoryStore<SleepEntry>("sleep-entry"),
        deps,
      ),
      breathingSessions: createEntityRepository<BreathingSession>(
        breathingSessionStore ?? new InMemoryStore<BreathingSession>("breathing-session"),
        deps,
      ),
      activityEntries: createEntityRepository<ActivityEntry>(
        activityStore ?? new InMemoryStore<ActivityEntry>("activity-entry"),
        deps,
      ),
      moodCheckins: createEntityRepository<MoodCheckin>(
        moodStore ?? new InMemoryStore<MoodCheckin>("mood-checkin"),
        deps,
      ),
      reminders: createEntityRepository<Reminder>(
        reminderStore ?? new InMemoryStore<Reminder>("reminder"),
        deps,
      ),
      notificationStates: createEntityRepository<NotificationState>(
        notificationStateStore ?? new InMemoryStore<NotificationState>("notification-state"),
        deps,
      ),
      supplements: createEntityRepository<Supplement>(
        supplementStore ?? new InMemoryStore<Supplement>("supplement"),
        deps,
      ),
      supplementLogs: createEntityRepository<SupplementLog>(
        supplementLogStore ?? new InMemoryStore<SupplementLog>("supplement-log"),
        deps,
      ),
      hydrationEntries: createEntityRepository<HydrationEntry>(
        hydrationStore ?? new InMemoryStore<HydrationEntry>("hydration-entry"),
        deps,
      ),
      measurements: createEntityRepository<Measurement>(
        measurementStore ?? new InMemoryStore<Measurement>("measurement"),
        deps,
      ),
      xpTransactions: createEntityRepository<XPTransaction>(
        createAppendOnlyEntityStore(xpStore ?? new InMemoryStore<XPTransaction>("xp-transaction")),
        deps,
      ),
      levelStates: createEntityRepository<LevelState>(
        levelStore ?? new InMemoryStore<LevelState>("level-state"),
        deps,
      ),
      quests: createEntityRepository<Quest>(questStore ?? new InMemoryStore<Quest>("quest"), deps),
      questProgress: createEntityRepository<QuestProgress>(
        questProgressStore ?? new InMemoryStore<QuestProgress>("quest-progress"),
        deps,
      ),
      achievements: createEntityRepository<Achievement>(
        achievementStore ?? new InMemoryStore<Achievement>("achievement"),
        deps,
      ),
      userRewards: createEntityRepository<UserReward>(
        createAppendOnlyEntityStore(
          userRewardStore ?? new InMemoryStore<UserReward>("user-reward"),
        ),
        deps,
      ),
      vaultRewards: createEntityRepository<VaultReward>(
        vaultRewardStore ?? new InMemoryStore<VaultReward>("vault-reward"),
        deps,
      ),
      vaultClaims: createEntityRepository<VaultRewardClaim>(
        createAppendOnlyEntityStore(
          vaultClaimStore ?? new InMemoryStore<VaultRewardClaim>("vault-claim"),
        ),
        deps,
      ),
      collectibles: createEntityRepository<Collectible>(
        collectibleStore ?? new InMemoryStore<Collectible>("collectible"),
        deps,
      ),
      projects: createEntityRepository<Project>(
        projectStore ?? new InMemoryStore<Project>("project"),
        deps,
      ),
      tags: createEntityRepository<Tag>(tagStore ?? new InMemoryStore<Tag>("tag"), deps),
      journalEntries: createEntityRepository<JournalEntry>(
        journalStore ?? new InMemoryStore<JournalEntry>("journal"),
        deps,
      ),
      foods: createEntityRepository<Food>(foodStore ?? new InMemoryStore<Food>("food"), deps),
      recipes: createEntityRepository<Recipe>(
        recipeStore ?? new InMemoryStore<Recipe>("recipe"),
        deps,
      ),
      nutritionEntries: createEntityRepository<NutritionEntry>(
        nutritionEntryStore ?? new InMemoryStore<NutritionEntry>("nutrition-entry"),
        deps,
      ),
    };
  }, [
    persistent,
    clock,
    ids,
    taskStore,
    taskChecklistStore,
    calendarBlockStore,
    focusStore,
    distractionStore,
    activityStore,
    routineStore,
    routineStepStore,
    routineScheduleStore,
    routineRunStore,
    routineStepRunStore,
    goalStore,
    goalDayStore,
    habitRuleStore,
    sleepStore,
    breathingSessionStore,
    moodStore,
    reminderStore,
    notificationStateStore,
    supplementStore,
    supplementLogStore,
    hydrationStore,
    measurementStore,
    xpStore,
    levelStore,
    questStore,
    questProgressStore,
    achievementStore,
    userRewardStore,
    vaultRewardStore,
    vaultClaimStore,
    collectibleStore,
    projectStore,
    tagStore,
    journalStore,
    foodStore,
    recipeStore,
    nutritionEntryStore,
  ]);
  if (persistent && !persistentReady) {
    return (
      <div data-testid="data-loading" role="status">
        <p>{t("Valmistellaan tallennusta…")}</p>
      </div>
    );
  }
  return <LifeosDataContext.Provider value={value}>{children}</LifeosDataContext.Provider>;
}

/** Ainoa sallittu data-hook komponenteille (T032-raja). */
export function useData(): LifeosDataServices {
  const services = useContext(LifeosDataContext);
  if (services === null) {
    throw new Error("useData vaatii DataProviderin yläpuolelleen.");
  }
  return services;
}
