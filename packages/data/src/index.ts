// T027: packages/data julkinen pinta. Yksi import-polku:
//   import { InMemoryStore } from "@lifeos/data";
//   import type { Task } from "@lifeos/domain";
// Toteutukset (muisti nyt, SQLite/OPFS T030+) täyttävät EntityStore-
// ja UnitOfWork-sopimukset; sovelluskoodi ei importoi alimoduuleja suoraan.
export type { DataErrorCode, DataError, DataResult } from "./errors.ts";
export { notFound, invalidInput, alreadyExists } from "./errors.ts";
export type { Clock } from "./clock.ts";
export { systemClock, fixedClock } from "./clock.ts";
export type { IdGenerator } from "./ids.ts";
export { ulidLikeId, sequentialIdGenerator, isValidEntityId } from "./ids.ts";
export type {
  ActiveSyncWriteContext,
  EntityStore,
  SyncWriteContext,
  SyncWriteOperation,
  UnitOfWork,
} from "./store.ts";
export { createAppendOnlyEntityStore } from "./appendOnlyStore.ts";
export { InMemoryStore, InMemoryUnitOfWork } from "./memory.ts";
// T032: repository/service boundary (UI ei SQL:ää, logiikka pois komponenteista).
export type { RepositoryDeps, EntityRepository } from "./repositories.ts";
export { createEntityRepository } from "./repositories.ts";
export type {
  ServiceDeps,
  TaskServiceDeps,
  CreateTaskInput,
  FocusServiceDeps,
  StartFocusInput,
} from "./services.ts";
export {
  FOCUS_SESSION_COMPLETION_XP,
  FOCUS_SESSION_DAILY_XP_CAP,
  FOCUS_SESSION_MINIMUM_XP_SECONDS,
} from "./services.ts";
export {
  createTask,
  completeTaskService,
  reopenTaskService,
  deleteTaskService,
  restoreTaskService,
  startFocusSession,
  beginFocusSession,
  pauseFocusSession,
  resumeFocusSession,
  finishFocusSession,
  extendFocusSession,
  recordFocusInterruption,
  cancelFocusSession,
  moveFocusSession,
} from "./services.ts";
// T167: fokusistunnon distraction parking lot.
export type { DistractionServiceDeps, RecordDistractionInput } from "./distraction-service.ts";
export { recordFocusDistraction } from "./distraction-service.ts";
// T060: UserPreferences-palvelu (get-or-create singleton + versionoitu päivitys).
export type { PreferencesDeps, PreferencesPatch } from "./preferences.ts";
export { ensurePreferences, readPreferences, updatePreferences } from "./preferences.ts";
// T061: BrowserInstallation-palvelu (pysyvä installationId + turvallinen metadata).
export type {
  InstallationDeps,
  RenameInstallationInput,
  RevokeOtherInstallationInput,
} from "./installation.ts";
export {
  BROWSER_INSTALLATION_ENTITY_TYPE,
  DEFAULT_INSTALLATION_NAME,
  ensureInstallation,
  listInstallations,
  markInstallationSynced,
  readInstallationSyncSnapshot,
  renameInstallation,
  revokeOtherInstallation,
  revokeInstallationService,
  writeInstallationSyncSnapshot,
} from "./installation.ts";
// T076/T301: atomiset domain-kirjoitukset; synkattava kirjoitus liittää outbox-rivin samaan transaktioon.
export type { DomainTransactionWrite, TransactionWrite } from "./transactions.ts";
export {
  appendRemoteSyncOperation,
  appendSyncOperation,
  resolveSyncConflict,
  runAtomicSyncWrite,
  runAtomicWrite,
} from "./transactions.ts";
// T313: persistent, idempotent records for same-field sync conflicts.
export {
  listConflictRecords,
  putOpenConflictRecord,
  saveSyncFieldConflict,
} from "./conflict-records.ts";
export type {
  DbNamedWriteOp,
  DbSyncOperationTransactionOp,
  DbTransactionOp,
  DbTransactionWrite,
} from "./sqliteProtocol.ts";
// T078: deterministinen synthetic seed (vuoden historiaa, ei PII:tä).
export type { SyntheticSeedData, SyntheticSeedOptions } from "./seed.ts";
export { createSyntheticSeed } from "./seed.ts";
// T182: level curve — level ja tason etenemä deterministisesti kokonais-XP:stä.
export type { LevelProgress } from "./level-curve.ts";
export { levelForTotalXp, levelProgress, totalXpForLevel } from "./level-curve.ts";
// T184: momentum score — liukuva 7/14 päivän jatkuvuus, paluu painottuu.
export type { MomentumInput, MomentumScore } from "./momentum.ts";
export { calculateMomentumScore } from "./momentum.ts";
// T185: quest engine — ehto, ajanjakso, progress ja claim/completion.
export type {
  ClaimQuestInput,
  ClaimQuestResult,
  ComputeQuestProgressOptions,
  QuestCondition,
  QuestConditionKind,
  QuestEngineDeps,
  QuestEventSample,
  QuestProgressSnapshot,
  QuestStateInput,
  QuestStatus,
  QuestWindow,
  UpdateQuestProgressInput,
} from "./quest-engine.ts";
export {
  claimQuestService,
  computeQuestProgress,
  evaluateQuestState,
  updateQuestProgressService,
} from "./quest-engine.ts";
// T186: weekly challenges — viikkotehtävät vain aktivoiduista moduuleista.
export type {
  EnsureWeeklyChallengesInput,
  EnsureWeeklyChallengesResult,
  WeeklyChallengeDeps,
  WeeklyChallengeInstance,
  WeeklyChallengePlan,
  WeeklyChallengeTemplate,
} from "./weekly-challenges.ts";
export {
  WEEKLY_CHALLENGE_TEMPLATES,
  ensureWeeklyChallenges,
  planWeeklyChallenges,
  weeklyChallengeProgressId,
  weeklyChallengeQuestId,
} from "./weekly-challenges.ts";
// T187: Recovery Bonus — tauon jälkeinen paluu palkitaan hallitusti (§57.14).
export type {
  GrantRecoveryBonusInput,
  RecoveryBonusDeps,
  RecoveryBonusResult,
  RecoveryReturnEvaluation,
  RecoveryReturnInput,
} from "./recovery-bonus.ts";
export {
  RECOVERY_BONUS_BASE_XP,
  RECOVERY_BONUS_MAX_XP,
  RECOVERY_BONUS_MESSAGE,
  evaluateRecoveryReturn,
  grantRecoveryBonusService,
  recoveryReturnEventId,
} from "./recovery-bonus.ts";
// T188: Achievement engine — kertasaavutukset idempotentteja ja versionoitavia.
export type {
  AchievementDefinition,
  AchievementEngineDeps,
  EarnAchievementInput,
  EarnAchievementResult,
  RegisterAchievementResult,
} from "./achievement-engine.ts";
export {
  achievementEntityId,
  achievementRewardId,
  earnAchievementService,
  findEarnedReward,
  listEarnedAchievementIds,
  registerAchievementService,
} from "./achievement-engine.ts";
// T190: Collectible-malli — keräilyesine avataan saavutuksesta/levelistä.
export type {
  CollectibleDefinition,
  CollectibleEngineDeps,
  CollectibleUnlockRule,
  CollectibleUnlockState,
  RegisterCollectibleResult,
  UnlockCollectibleInput,
  UnlockCollectibleResult,
  UnlockEligibleInput,
  UnlockEligibleResult,
  UnlockedCollectible,
} from "./collectible-engine.ts";
export {
  COLLECTIBLE_DEFINITIONS,
  collectibleEntityId,
  collectibleRewardId,
  evaluateCollectibleUnlocks,
  findCollectedReward,
  listUnlockedThemeKeys,
  registerCollectibleService,
  unlockCollectibleService,
  unlockEligibleCollectiblesService,
} from "./collectible-engine.ts";
// T192: Reward Vault — käyttäjän oma palkinto XP-kynnykselle (§9, ei rahaa).
export type {
  CreateVaultRewardInput,
  UpdateVaultRewardInput,
  VaultRewardDeps,
  VaultRewardStatus,
} from "./vault-reward.ts";
export {
  createVaultRewardService,
  isVaultRewardReached,
  updateVaultRewardService,
  vaultRewardEventId,
  vaultRewardStatus,
} from "./vault-reward.ts";
// T193: reward unlock/claim — lunastus säilyttää historian, XP vähenee vain
// erikseen valittaessa (§51).
export type {
  ClaimVaultRewardInput,
  ClaimVaultRewardResult,
  VaultClaimDeps,
  VaultClaimStatus,
} from "./vault-claim.ts";
export {
  claimVaultRewardService,
  findVaultClaim,
  vaultClaimEntityId,
  vaultClaimStatus,
} from "./vault-claim.ts";
// T088: gamification summary -kooste (XP/level/momentum/seuraava reward, §51 reilu).
export type { TodayGamificationInput, TodayGamificationSummary } from "./today-gamification.ts";
export { summarizeTodayGamification } from "./today-gamification.ts";
// T087: focus summary -kooste (minuutit suoraan, käynnissä erikseen).
export type { TodayFocusInput, TodayFocusSummary } from "./today-focus.ts";
export { summarizeTodayFocus } from "./today-focus.ts";
// T086: health summary -kooste (aktivoidut luvut minimidatalla, terveysneutraali).
export type { TodayHealthInput, TodayHealthRow, TodayHealthSummary } from "./today-health.ts";
export { summarizeTodayHealth } from "./today-health.ts";
// T200: aktivoitujen terveysmoduulien overview-projektio (§10, §52).
export type {
  HealthOverviewCard,
  HealthOverviewBloodPressureCard,
  CustomMetricHistory,
  HealthOverviewHydrationCard,
  HealthOverviewInput,
  HealthOverviewMeasurementCard,
  HealthOverviewMoodCard,
  HealthOverviewSleepCard,
  HealthOverviewSummary,
  HealthOverviewSupplementsCard,
  HealthOverviewWeightCard,
  HealthOverviewWeightSummary,
} from "./health-overview.ts";
export { summarizeHealthOverview } from "./health-overview.ts";
// T206: paikallisiin päiviin ryhmitelty painon 7 päivän liukuva keskiarvo.
export type { WeightTrend, WeightTrendInput, WeightTrendPoint } from "./weight-trend.ts";
export { calculateWeightTrend, WEIGHT_TREND_WINDOW_DAYS } from "./weight-trend.ts";
// T201: validoitu, append-only numeeristen mittausten palveluraja.
export type {
  CreateMeasurementInput,
  ListMeasurementsOptions,
  MeasurementServiceDeps,
} from "./measurement-service.ts";
export {
  createMeasurementService,
  getMeasurementService,
  listMeasurementsService,
} from "./measurement-service.ts";
// T220: ruoat tallentavat ravintoarvot per 100 g; syöttö voi olla myös annoskohtainen.
export type {
  CreateFoodInput,
  FoodNutritionInput,
  FoodNutritionValues,
  FoodServiceDeps,
  ListFoodsOptions,
  UpdateFoodInput,
} from "./food-service.ts";
export {
  createFoodService,
  deleteFoodService,
  getFoodService,
  listFoodsService,
  restoreFoodService,
  updateFoodService,
} from "./food-service.ts";
// T224: ruokakirjaus kopioi annoskohtaiset ravintoarvot pysyväksi merkinnäksi.
export type {
  CreateNutritionEntryInput,
  ListNutritionEntriesOptions,
  NutritionEntryServiceDeps,
} from "./nutrition-entry-service.ts";
export {
  createNutritionEntryService,
  listNutritionEntriesService,
} from "./nutrition-entry-service.ts";
// T230: juomakirjauksen validointi ja yhteinen päiväsumman laskenta.
export type {
  CreateHydrationEntryInput,
  HydrationReminderCondition,
  HydrationReminderConditionInput,
  HydrationDaySummary,
  HydrationServiceDeps,
  SummarizeHydrationDayInput,
} from "./hydration-service.ts";
export {
  createHydrationEntryService,
  evaluateHydrationReminderCondition,
  hydrationProgressPercent,
  HYDRATION_ENTRY_MILLILITERS_MAXIMUM,
  summarizeHydrationDay,
} from "./hydration-service.ts";
// T233: lisäravinteen suunnitelma, käyttäjän annostieto ja päivittäiset ottoajat.
export type {
  CreateSupplementInput,
  ListSupplementsOptions,
  SupplementServiceDeps,
  UpdateSupplementInput,
} from "./supplement-service.ts";
export {
  createSupplementService,
  deleteSupplementService,
  getSupplementService,
  listSupplementsService,
  restoreSupplementService,
  updateSupplementService,
} from "./supplement-service.ts";
// T234: päiväkohtaiset lisäravinneaikataulut ja eksplisiittiset lokitilat.
export type {
  CreateSupplementLogInput,
  EnsureSupplementScheduleInput,
  ListSupplementLogsOptions,
  SupplementLogServiceDeps,
} from "./supplement-log-service.ts";
export {
  createSupplementLogService,
  ensureSupplementScheduleForDateService,
  getSupplementLogActivityAt,
  getSupplementLogService,
  getSupplementLogStatus,
  listSupplementLogsService,
  recordSupplementTakenService,
  updateSupplementLogStatusService,
} from "./supplement-log-service.ts";
// T235: käyttäjän laskema saldo ja lokipohjainen jäljellä olevan määrän arvio.
export type {
  SupplementStockEstimate,
  SupplementStockServiceDeps,
} from "./supplement-stock-service.ts";
export {
  clearSupplementStockService,
  estimateSupplementStock,
  setSupplementStockService,
  SUPPLEMENT_STOCK_AMOUNT_MAXIMUM,
} from "./supplement-stock-service.ts";
// T222: reseptit tallentavat ainesosat grammoina ja laskevat kokonais- sekä annosarvot Foodista.
export type {
  CreateRecipeInput,
  ListRecipesOptions,
  RecipeNutrition,
  RecipeNutrients,
  RecipeServiceDeps,
  UpdateRecipeInput,
} from "./recipe-service.ts";
export {
  createRecipeService,
  deleteRecipeService,
  getRecipeNutritionService,
  getRecipeService,
  listRecipesService,
  restoreRecipeService,
  updateRecipeService,
} from "./recipe-service.ts";
// T085: goal-day-toggle (vain tämä päivä vaihdettavissa; ei tulevien completionia).
export type { GoalDayToggle, GoalDayWrite } from "./goal-day.ts";
export { localDateKey, toggleGoalDay } from "./goal-day.ts";
// T155: GoalDay-success → yksi rajattu XP-tapahtuma per päivämerkintä.
export type { GoalDayServiceDeps, ToggleGoalDayServiceInput } from "./goal-day-service.ts";
export { GOAL_DAY_COMPLETION_XP, toggleGoalDayService } from "./goal-day-service.ts";
// T180: XP-rule engine — config ja puhdas tapahtumapalkkion laskenta.
export type { XpAwardEvent, XpRuleOverrides, XpRules } from "./xp-rules.ts";
export { calculateXpAward, createXpRules, DEFAULT_XP_RULES } from "./xp-rules.ts";
// T181: idempotentti XP-kirjaus (deterministinen palkkioavain, ei XP:tä kahdesti).
export type { CreateXpAwardInput, XpAwardKey, XpAwardResult } from "./xp-ledger.ts";
export { createXpAward, findXpAward, xpAwardEventId } from "./xp-ledger.ts";
// T145: eksplisiittinen GoalDay-tilakone.
export type { GoalDayEvidence, GoalDayStateEvaluation, GoalDayStatus } from "./goal-day-state.ts";
export { evaluateGoalDayState } from "./goal-day-state.ts";
// T084: päivän rutiiniyhteenveto (rakenne rehellisesti, ei keksittyä progressia).
export type { TodayRoutineView, TodayRoutinesSummary } from "./today-routines.ts";
export { summarizeTodayRoutines } from "./today-routines.ts";
// T083: päivän tehtäväyhteenveto (progress + tärkeimmät, katkaistu lista).
export type { TodayTasksSummary } from "./today-tasks.ts";
export { summarizeTodayTasks } from "./today-tasks.ts";
// T102: Tänään-tehtävien ryhmittely (due/today/scheduled/completed).
export type { TodayTaskGroups } from "./today-tasks-groups.ts";
export { groupTasksForToday } from "./today-tasks-groups.ts";
// T103: Seuraavat/Myöhässä-ryhmittely (upcoming erikseen, ei donesekoitusta).
export type { UpcomingOverdueGroups } from "./upcoming-overdue-groups.ts";
export { groupTasksUpcoming } from "./upcoming-overdue-groups.ts";
// T104: päivä/viikko/kuukausi-listat (valittu ajanjakso, §5 näkymät).
export type { TaskPeriodGroups, TaskPeriodKey } from "./task-period.ts";
export { groupTasksInPeriod, taskPeriodRange } from "./task-period.ts";
// T107: Project-yhteenveto (progress, status, historia — §5 projektit).
export type { ProjectHistoryEntry, ProjectStatus, ProjectSummary } from "./project-summary.ts";
export { summarizeProject, summarizeProjects } from "./project-summary.ts";
// T108: checklist/subtasks-logiikka (järjestys + completion, §5).
export type {
  ChecklistMoveDirection,
  ChecklistMoveResult,
  ChecklistProgress,
  ChecklistSortUpdate,
} from "./checklist.ts";
export {
  checklistProgress,
  moveChecklistItem,
  nextChecklistSortOrder,
  parseStepTitles,
  reorderChecklistItems,
  sortChecklistItems,
} from "./checklist.ts";
// T109: deadline/due time -apurit (aikavyöhyke, locale, overdue §50).
export { dueAtFromLocalParts, formatDueDateTime, isOverdue, localDueParts } from "./due-time.ts";
// T110: recurring task -säännöt (deterministinen seuraava instanssi).
export type { TaskRecurrence, XPTransaction } from "@lifeos/domain";
export {
  addDaysIso,
  hasRecurrence,
  isoWeekday,
  nextRecurrenceDate,
  nextRecurrenceDueAt,
} from "./recurrence.ts";
// T111: arvioitu kesto + timebox-ehdotus (§5, §8).
export type { TimeboxSuggestion } from "./timebox.ts";
export { formatMinutes, sumEstimateMinutes, timeboxSuggestion } from "./timebox.ts";
// T161: Pomodoro-oletukset ja validoitu custom-työ/tauko-preset.
export type { CustomPomodoroInput, PomodoroPreset, PomodoroPresetId } from "./focus-presets.ts";
export {
  DEFAULT_POMODORO_PRESET,
  FIVE_MINUTE_START_SECONDS,
  POMODORO_LIMITS,
  POMODORO_PRESETS,
  createCustomPomodoroPreset,
  getPomodoroPreset,
} from "./focus-presets.ts";
// T162: timestamp-pohjainen countdown ilman interval-driftiä.
export type { FocusCountdownInput, FocusCountdownSnapshot } from "./focus-countdown.ts";
export { calculateFocusCountdown, remainingFocusSeconds } from "./focus-countdown.ts";
// T112: task detail -muokkaus.
export type { UpdateTaskInput } from "./services.ts";
export { updateTaskService, TASK_COMPLETION_XP } from "./services.ts";
// T140: Goal/HabitRule CRUD + aktiivisuusalueen ja sääntöjen validointi.
export type {
  CreateGoalInput,
  CreateHabitRuleInput,
  GoalServiceDeps,
  UpdateGoalInput,
  UpdateHabitRuleInput,
} from "./goal-service.ts";
// T141: määräaikaisen tavoitteen kalenteripäiväprogress.
export type { GoalProgress } from "./goal-progress.ts";
export { summarizeGoalProgress } from "./goal-progress.ts";
// T157: goal- ja routine-historia samasta haettavasta/vietävästä koosteesta.
export type {
  GoalRoutineHistoryExportFormat,
  GoalRoutineHistoryInput,
  GoalRoutineHistoryKind,
  GoalRoutineHistoryRecord,
  GoalRoutineHistoryStatus,
} from "./goal-routine-history.ts";
export {
  GOAL_ROUTINE_HISTORY_CSV_SCHEMA,
  buildGoalRoutineHistory,
  filterGoalRoutineHistory,
  serializeGoalRoutineHistory,
} from "./goal-routine-history.ts";
// T273: vakaan skeeman mukainen, alustariippumaton CSV-sarjoitin.
export type { CsvCellValue, CsvColumn, CsvSchema } from "./csv-export.ts";
export { serializeCsv } from "./csv-export.ts";
// T274: paikalliset terveyskirjaukset moduulikohtaisiin CSV-skeemoihin.
export type {
  HealthCsvExportDefinition,
  HealthCsvExportInput,
  HealthCsvExportKind,
  HealthCsvExportResult,
} from "./health-csv-exports.ts";
export { createHealthCsvExport, HEALTH_CSV_EXPORT_DEFINITIONS } from "./health-csv-exports.ts";
// T276–T277: paikallinen CSV-parsing, kartoitus, validointi, deduplikointi ja commit.
export type {
  CsvImportDelimiter,
  CsvImportField,
  HealthCsvImportCommitResult,
  HealthCsvImportExistingRecord,
  HealthCsvImportKind,
  HealthCsvImportPreview,
  HealthCsvImportRepositories,
  HealthCsvImportRow,
  HealthCsvImportValue,
  ParsedCsvRow,
  ParsedCsvTable,
} from "./health-csv-imports.ts";
export {
  commitHealthCsvImport,
  HEALTH_CSV_IMPORT_FIELDS,
  HEALTH_CSV_IMPORT_LABELS,
  isActiveSupplement,
  listHealthCsvImportExistingRecords,
  parseHealthCsv,
  previewHealthCsvImport,
  suggestHealthCsvColumnMapping,
  suggestHealthCsvImportKind,
} from "./health-csv-imports.ts";
// T275: koko oman datan eksplisiittinen portable JSON snapshot.
export type {
  PortableDataCollections,
  PortableDataSettings,
  PortableDataSnapshot,
  PortableDataSnapshotInput,
} from "./portable-data-export.ts";
export {
  buildPortableDataSnapshot,
  PORTABLE_DATA_COLLECTION_KEYS,
  serializePortableDataSnapshot,
} from "./portable-data-export.ts";
// T320: versioned AES-GCM backup envelope; manifest fields are authenticated as AAD.
export type {
  EncryptedBackup,
  EncryptedBackupError,
  EncryptedBackupErrorCode,
  EncryptedBackupResult,
  OpenedEncryptedBackup,
} from "./encrypted-backup.ts";
export {
  createEncryptedBackup,
  ENCRYPTED_BACKUP_CRYPTO_VERSION,
  ENCRYPTED_BACKUP_FORMAT,
  ENCRYPTED_BACKUP_FORMAT_VERSION,
  isEncryptedBackup,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  openEncryptedBackup,
  parseEncryptedBackup,
  serializeEncryptedBackup,
  verifyEncryptedBackupIntegrity,
} from "./encrypted-backup.ts";
// T324: authenticated restore validation in a temporary, in-memory workspace.
export type {
  BackupRestoreDryRunResult,
  BackupRestoreDryRunSummary,
} from "./backup-restore-dry-run.ts";
export { dryRunEncryptedBackupRestore } from "./backup-restore-dry-run.ts";
export type {
  EncryptedBackupRestoreDeps,
  EncryptedBackupRestoreResult,
  EncryptedBackupRestoreSummary,
} from "./encrypted-backup-restore.ts";
export { restoreEncryptedBackup } from "./encrypted-backup-restore.ts";
// T322: period buckets and retention policy for active-app encrypted backup rotation.
export type {
  BackupRotationBuckets,
  BackupRotationPeriods,
  BackupRotationRecord,
} from "./backup-rotation.ts";
export {
  BACKUP_ROTATION_RETENTION,
  backupRotationBuckets,
  dueBackupRotationPeriods,
  retainBackupRotationRecords,
} from "./backup-rotation.ts";
// T272: yhteinen local-first historia päivämäärä- ja tyypinmukaiseen selaamiseen.
export type { HistoryBrowserInput, HistoryRecord, HistoryRecordKind } from "./history-browser.ts";
export { buildHistoryRecords } from "./history-browser.ts";
// T142: tapahtuma- ja mittaushavaintoihin perustuva daily-määrätavoite.
export type {
  DailyQuantityEvaluation,
  DailyQuantityObservation,
  DailyQuantitySource,
} from "./goal-daily.ts";
export { evaluateDailyQuantityGoal } from "./goal-daily.ts";
// T143: ISO-viikon (ma–su) frekvenssitavoite.
export type { WeeklyFrequencyEvaluation, WeeklyFrequencyObservation } from "./goal-weekly.ts";
export { evaluateWeeklyFrequencyGoal, weekStartLocalDate } from "./goal-weekly.ts";
// T144: no-event-success ilman tulevien päivien väärää onnistumista.
export type { AvoidanceEvaluation, AvoidanceObservation } from "./goal-avoidance.ts";
export { evaluateAvoidanceGoal } from "./goal-avoidance.ts";
export {
  archiveGoalService,
  createGoal,
  createHabitRule,
  deleteGoalService,
  deleteHabitRuleService,
  restoreGoalService,
  unarchiveGoalService,
  updateGoalService,
  updateHabitRuleService,
} from "./goal-service.ts";
// T149: rutiinin sisältö, aikataulu ja append-only suoritushistoria erillisinä.
export type {
  CreateRoutineFromTemplateInput,
  CreateRoutineInput,
  CreateRoutineScheduleInput,
  CreateRoutineStepInput,
  CreatedRoutineTemplate,
  RoutineHistoryEntry,
  RoutineServiceDeps,
  StartRoutineRunInput,
  UpdateRoutineInput,
  UpdateRoutineScheduleInput,
  UpdateRoutineStepInput,
} from "./routine-service.ts";
export {
  archiveRoutineService,
  completeRoutineRun,
  completeRoutineStep,
  createRoutine,
  createRoutineFromTemplate,
  createRoutineSchedule,
  createRoutineStep,
  deleteRoutineScheduleService,
  deleteRoutineStepService,
  deleteRoutineService,
  listRoutineHistory,
  listRoutineSchedules,
  listRoutineSteps,
  reorderRoutineSteps,
  restoreRoutineService,
  restoreRoutineStepService,
  ROUTINE_COMPLETION_XP,
  ROUTINE_MINIMUM_DAY_XP,
  routineScheduledOnLocalDate,
  skipRoutineRun,
  skipRoutineStep,
  startRoutineRun,
  unarchiveRoutineService,
  updateRoutineScheduleService,
  updateRoutineService,
  updateRoutineStepService,
} from "./routine-service.ts";
export type {
  RoutineTemplate,
  RoutineTemplateKey,
  RoutineTemplateStep,
} from "./routine-templates.ts";
export { getRoutineTemplate, listRoutineTemplates } from "./routine-templates.ts";
// T130: pysyvä SQLite entity-doc store (EntityStore-sopimus workerin yli).
export { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
export {
  deleteEntityDoc,
  getEntityDoc,
  listEntityDocs,
  putEntityDoc,
} from "./sqliteEntityClient.ts";
export { createSqliteFoodStore } from "./sqliteFoodStore.ts";
export { createSqliteHydrationEntryStore } from "./sqliteHydrationEntryStore.ts";
export { createSqliteActivityEntryStore } from "./sqliteActivityEntryStore.ts";
export { createSqliteSleepEntryStore } from "./sqliteSleepEntryStore.ts";
// T245: manuaalinen askelmäärä käyttää yhteistä append-only Measurement-mallia.
export type {
  CreateManualStepCountInput,
  ManualStepCountServiceDeps,
} from "./step-count-service.ts";
export {
  createManualStepCountService,
  isManualStepCountMeasurement,
  isManualStepCountMetric,
  MANUAL_STEP_COUNT_METRIC_NAME,
  MANUAL_STEP_COUNT_UNIT,
} from "./step-count-service.ts";
// T240: UTC-pohjainen unitietopalvelu ja DST-turvallinen keston laskenta.
export type {
  CreateSleepEntryInput,
  ListSleepEntriesOptions,
  SleepEntryServiceDeps,
  UpdateSleepEntryInput,
} from "./sleep-entry-service.ts";
// T243: UTC-aikaleimallinen aktiviteettipalvelu ja rajattu muistiinpano.
export type {
  ActivityEntryServiceDeps,
  CreateActivityEntryInput,
  ListActivityEntriesOptions,
  UpdateActivityEntryInput,
} from "./activity-entry-service.ts";
export {
  ACTIVITY_KIND_MAX_LENGTH,
  ACTIVITY_NOTE_MAX_LENGTH,
  createActivityEntryService,
  deleteActivityEntryService,
  getActivityEntryService,
  listActivityEntriesService,
  restoreActivityEntryService,
  updateActivityEntryService,
} from "./activity-entry-service.ts";
export {
  calculateSleepDurationMinutes,
  createSleepEntryService,
  deleteSleepEntryService,
  getSleepEntryService,
  listSleepEntriesService,
  restoreSleepEntryService,
  SLEEP_QUALITY_MAXIMUM,
  SLEEP_QUALITY_MINIMUM,
  updateSleepEntryService,
} from "./sleep-entry-service.ts";
export { createSqliteMeasurementStore } from "./sqliteMeasurementStore.ts";
export { createSqliteMoodCheckinStore } from "./sqliteMoodCheckinStore.ts";
// T247: mieliala-/stressi-/energia-/motivaatio-/keskittymisasteikkojen palvelu.
export type { CreateMoodCheckinInput, MoodCheckinServiceDeps } from "./mood-checkin-service.ts";
export { createMoodCheckinService } from "./mood-checkin-service.ts";
// T248: käyttäjän nimeämät oireasteikot (1–5), tallennettuna append-only-mittauksina.
export type {
  CreateCustomSymptomMetricInput,
  CustomSymptomMetricServiceDeps,
} from "./custom-symptom-metric.ts";
export {
  createCustomSymptomMetricService,
  CUSTOM_SYMPTOM_SCALE_MAXIMUM,
  CUSTOM_SYMPTOM_SCALE_MINIMUM,
  CUSTOM_SYMPTOM_SCALE_UNIT,
} from "./custom-symptom-metric.ts";
export { createSqliteJournalEntryStore } from "./sqliteJournalEntryStore.ts";
// T250: vapaan päiväkirjatekstin ja ohjattujen reflektiokenttien luontipalvelu.
export type { CreateJournalEntryInput, JournalEntryServiceDeps } from "./journal-entry-service.ts";
export { createJournalEntryService } from "./journal-entry-service.ts";
export { createSqliteBreathingSessionStore } from "./sqliteBreathingSessionStore.ts";
export { createSqliteReminderStore } from "./sqliteReminderStore.ts";
export { createSqliteNotificationStateStore } from "./sqliteNotificationStateStore.ts";
export { createSqliteQuestStore, createSqliteQuestProgressStore } from "./sqliteQuestStore.ts";
export { createSqliteVaultRewardStore } from "./sqliteVaultRewardStore.ts";
export { createSqliteVaultRewardClaimStore } from "./sqliteVaultRewardClaimStore.ts";
export { createSqliteXpTransactionStore } from "./sqliteXpTransactionStore.ts";
export { createSqliteLevelStateStore } from "./sqliteLevelStateStore.ts";
export { createSqliteAchievementStore } from "./sqliteAchievementStore.ts";
export { createSqliteCollectibleStore } from "./sqliteCollectibleStore.ts";
export { createSqliteUserRewardStore } from "./sqliteUserRewardStore.ts";
export { createSqliteProjectStore } from "./sqliteProjectStore.ts";
export { createSqliteTagStore } from "./sqliteTagStore.ts";
export { createSqliteTaskStore } from "./sqliteTaskStore.ts";
export { createSqliteTaskChecklistItemStore } from "./sqliteTaskChecklistItemStore.ts";
export { createSqliteRoutineStore } from "./sqliteRoutineStore.ts";
export { createSqliteRoutineStepStore } from "./sqliteRoutineStepStore.ts";
export { createSqliteRoutineScheduleStore } from "./sqliteRoutineScheduleStore.ts";
export { createSqliteRoutineRunStore } from "./sqliteRoutineRunStore.ts";
export { createSqliteRoutineStepRunStore } from "./sqliteRoutineStepRunStore.ts";
export { createSqliteCalendarBlockStore } from "./sqliteCalendarBlockStore.ts";
export { createSqliteFocusSessionStore } from "./sqliteFocusSessionStore.ts";
export { createSqliteDistractionStore } from "./sqliteDistractionStore.ts";
export { createSqliteNutritionEntryStore } from "./sqliteNutritionEntryStore.ts";
export { createSqliteRecipeStore } from "./sqliteRecipeStore.ts";
export { createSqliteSupplementStore } from "./sqliteSupplementStore.ts";
export { createSqliteSupplementLogStore } from "./sqliteSupplementLogStore.ts";
export { createSqliteGoalStore } from "./sqliteGoalStore.ts";
export { createSqliteHabitRuleStore } from "./sqliteHabitRuleStore.ts";
export { createSqliteGoalDayStore } from "./sqliteGoalDayStore.ts";
// T120: calendar query model (yksi aikamalli päivä/viikko/kuukausi — §6).
export type { CalendarDay, CalendarModel, CalendarViewKind } from "./calendar-model.ts";
export { buildCalendarModel } from "./calendar-model.ts";
// T121: päiväkalenterin layout (tunnit, nykyhetki, päällekkäisyyskaistat).
export type { DayBlockPosition, DayLayout } from "./calendar-day.ts";
export {
  blockUtcFromLocal,
  blocksOnDay,
  layoutDayBlocks,
  nowMinutesLocal,
  shiftBlockUtc,
} from "./calendar-day.ts";
// T133: valitun paikallispäivän/hetken DST-offset, ei nykyhetken offset-arvausta.
export {
  timezoneOffsetMinutesAtInstant,
  timezoneOffsetMinutesAtLocalDateTime,
} from "./calendar-timezone.ts";
// T131: ajastamattomien tehtävien valinta (unscheduled-paneeli, §6 vetäminen).
export { selectUnscheduledTasks } from "./calendar-unscheduled.ts";
// T136: kalenterin projekt/tag/rutiini-rajaus ilman datamutaatiota.
export type { CalendarBlockFilters } from "./calendar-filters.ts";
export { filterCalendarBlocks, hasCalendarBlockFilters } from "./calendar-filters.ts";
// T137: provider-neutraali ulkoisen kalenterin adapteriraja.
export type {
  CalendarProvider,
  CalendarProviderCalendar,
  CalendarProviderError,
  CalendarProviderErrorCode,
  CalendarProviderEvent,
  CalendarProviderEventInput,
  CalendarProviderEventPatch,
  CalendarProviderEventRange,
  CalendarProviderResult,
} from "./calendar-provider.ts";
// T300: provider-neutraali rajapinta salattujen synkka-artefaktien kuljetukseen.
export type {
  SyncProvider,
  SyncProviderErrorCode,
  SyncProviderError,
  SyncProviderResult,
  SyncProviderObjectRef,
  SyncProviderChangePage,
  SyncProviderUpload,
  SyncProviderDownload,
  SyncProviderListChanges,
} from "./sync-provider.ts";
export type { MockSyncProviderOptions, MockSyncProviderSeed } from "./mock-sync-provider.ts";
export { createMockSyncProvider } from "./mock-sync-provider.ts";
// T311: salatun operaation luonti ja append-only replica-vaihto.
export type {
  CommitSyncableChangeInput,
  CreateEncryptedSyncOperationInput,
  SyncCoordinatorError,
  SyncCoordinatorResult,
  SyncReplicaSummary,
  SyncEntityStoreAdapter,
  SyncConflictVersionValues,
} from "./sync-engine.ts";
export {
  commitSyncableChange,
  createEncryptedSyncOperation,
  readConflictVersionValues,
  syncReplica,
} from "./sync-engine.ts";
export { listSyncOperations } from "./sync-operations.ts";
export { getSyncCursor, saveSyncCursor, MAX_SYNC_PROVIDER_CURSOR_LENGTH } from "./sync-cursors.ts";
export type { SaveSyncCursorInput } from "./sync-cursors.ts";
// T312: paikallisen tietokantaversion ulkopuolella versioitu merge-payload JSON -codec.
export type {
  SyncPayload,
  SyncPayloadEntity,
  SyncPayloadJsonValue,
  SyncPayloadV1,
  SyncPayloadV2,
} from "./sync-payload.ts";
export {
  CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION,
  decodeSyncPayload,
  encodeSyncPayload,
} from "./sync-payload.ts";
export type {
  MergeSyncEntityChangesInput,
  SyncEntityChange,
  SyncEntityMergeResult,
  SyncFieldClock,
  SyncFieldConflict,
} from "./sync-merge.ts";
export { mergeSyncEntityChanges, SYNC_LWW_FIELDS } from "./sync-merge.ts";
// T304: AES-GCM adapter over WebCrypto with versioned envelope and bound operation metadata.
export type {
  SyncCryptoAdapter,
  SyncCryptoDecryptInput,
  SyncCryptoEncryptInput,
  SyncCryptoError,
  SyncCryptoResult,
  SyncPayloadContext,
} from "./sync-crypto.ts";
export { createSyncCryptoAdapter, SYNC_CRYPTO_VERSION } from "./sync-crypto.ts";
// T305: DEKs exist persistently only as passphrase/recovery-wrapped envelopes.
export type {
  DataKeySession,
  KeyEnvelope,
  KeyEnvelopeStore,
  KeyMaterialError,
  KeyMaterialErrorCode,
  KeyMaterialResult,
  KeyWrappingCredential,
  PassphraseKeyEnvelopeWrapping,
  RecoveryKeyEnvelopeWrapping,
} from "./key-material.ts";
export {
  createDataKeySession,
  createKeyEnvelope,
  createWrappedDataKey,
  generateRecoveryKey,
  isKeyEnvelope,
  unlockDataKeySession,
  DATA_ENCRYPTION_KEY_BYTES,
  DATA_KEY_SESSION_MAX_USES,
  KEY_ENVELOPE_CIPHER,
  KEY_ENVELOPE_FORMAT,
  KEY_ENVELOPE_VERSION,
} from "./key-material.ts";
// T306: portable recovery bundle contains the wrapped envelope, never its credential.
export type {
  KeyRecoveryBundle,
  KeyRecoveryBundleError,
  KeyRecoveryBundleResult,
  RecoveryWrappedEnvelope,
} from "./key-recovery.ts";
export {
  decodeKeyRecoveryBundle,
  encodeKeyRecoveryBundle,
  formatRecoveryKeyHex,
  parseRecoveryKeyHex,
  KEY_RECOVERY_BUNDLE_FORMAT,
  KEY_RECOVERY_BUNDLE_MAX_BYTES,
  KEY_RECOVERY_BUNDLE_VERSION,
  RECOVERY_KEY_HEX_LENGTH,
} from "./key-recovery.ts";
// T246: tulevan Health Connect-/wearable-tuonnin provider-neutraali lukuraja.
export type {
  WearableProvider,
  WearableProviderAvailability,
  WearableProviderError,
  WearableProviderErrorCode,
  WearableProviderRecord,
  WearableProviderRecordPage,
  WearableProviderRecordRange,
  WearableProviderResult,
  WearableReadAccess,
} from "./wearable-provider.ts";
// T082: Mitä seuraavaksi -valinta (selitettävä priorisointi, ei auto-suoritusta).
export type { NextUpInput, NextUpItem, NextUpKind } from "./next-up.ts";
export { selectNextUp } from "./next-up.ts";
// T080: Today-projection (yksi palvelu kokoaa päivän tiedot — ei UI:n hakuketjuja).
export type {
  GoalDayState,
  TodayGoalView,
  TodayPhase,
  TodayProjection,
  TodayProjectionInput,
  TodaySupplementView,
  TodayTaskView,
  TaskChecklistItemLike,
} from "./today.ts";
export { buildTodayProjection } from "./today.ts";
// T260: paikalliset, puhtaat analytiikkaprojektiot valitulle päiväjaksolle.
export type {
  AnalyticsProjection,
  AnalyticsProjectionDay,
  AnalyticsProjectionInput,
  AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
export {
  ANALYTICS_PROJECTION_MAX_DAYS,
  ANALYTICS_TIMEZONE_OFFSET_MINUTES_MAX,
  ANALYTICS_TIMEZONE_OFFSET_MINUTES_MIN,
  buildAnalyticsProjection,
} from "./analytics-projection.ts";
// T261: paikallisesti lasketut tehtävien completion-mittarit ja päivittäinen trendi.
export type {
  TaskCompletionDayMetric,
  TaskCompletionMetrics,
  TaskCompletionMetricsInput,
} from "./analytics-task-metrics.ts";
export { calculateTaskCompletionMetrics } from "./analytics-task-metrics.ts";
// T262: paikallisesti lasketut fokustunnusluvut ja päivittäinen trendi.
export type { FocusDayMetric, FocusMetrics, FocusMetricsInput } from "./analytics-focus-metrics.ts";
export { calculateFocusMetrics } from "./analytics-focus-metrics.ts";
// T263: tavoitteiden, rutiinien ja momentum-historian consistency-mittarit.
export type {
  CumulativeGoalProgressMetric,
  DailyGoalConsistencyMetric,
  GoalConsistencyMetric,
  GoalRoutineConsistencyDayMetric,
  GoalRoutineConsistencyMetrics,
  GoalRoutineConsistencyMetricsInput,
  MomentumHistoryMetric,
  RoutineConsistencyMetric,
  WeeklyGoalConsistencyMetric,
  WeeklyGoalPeriodMetric,
} from "./analytics-consistency-metrics.ts";
export { calculateGoalRoutineConsistencyMetrics } from "./analytics-consistency-metrics.ts";
// T264: XP/level-historia ledgeristä ja lähdetapahtumiin perustuva quest-progressio.
export type {
  GamificationMetrics,
  GamificationMetricsInput,
  GamificationXpDayMetric,
  QuestProgressEventStream,
  QuestProgressHistoryDayMetric,
  QuestProgressMetric,
  QuestProgressMetricSource,
} from "./analytics-gamification-metrics.ts";
export { calculateGamificationMetrics } from "./analytics-gamification-metrics.ts";
// T265: painotrendi, paikallinen viikkovauhti ja mittauspäivien vaihtelu.
export type {
  WeightInsightDayMetric,
  WeightInsightMetrics,
  WeightInsightMetricsInput,
} from "./analytics-weight-metrics.ts";
export { calculateWeightInsightMetrics } from "./analytics-weight-metrics.ts";
// T266: ravinto-/nestepäivien ja -viikkojen keskiarvot sekä tavoiteosumat.
export type {
  HydrationDailyMetric,
  HydrationPeriodMetric,
  NutritionDailyMetric,
  NutritionDailyTotals,
  NutritionHydrationDayMetric,
  NutritionHydrationMetrics,
  NutritionHydrationMetricsInput,
  NutritionHydrationWeekMetric,
  NutritionPeriodMetric,
  NutritionTargetStatus,
  NutrientPeriodMetric,
} from "./analytics-nutrition-hydration-metrics.ts";
export { calculateNutritionHydrationMetrics } from "./analytics-nutrition-hydration-metrics.ts";
// T267: unen ja aktiviteetin paikalliset päivätrendit sekä ISO-viikkokoosteet.
export type {
  ActivityDayMetric,
  ActivityKindMetric,
  ActivityPeriodMetric,
  SleepActivityDayMetric,
  SleepActivityMetrics,
  SleepActivityMetricsInput,
  SleepActivityWeekMetric,
  SleepDayMetric,
  SleepPeriodMetric,
} from "./analytics-sleep-activity-metrics.ts";
export { calculateSleepActivityMetrics } from "./analytics-sleep-activity-metrics.ts";
// T268: verenpaineen ja muiden vitaalien yksikkökohtaiset tilastot ja historia.
export type {
  VitalMeasurementDayMetric,
  VitalMeasurementHistoryEntry,
  VitalMeasurementSeriesMetric,
  VitalSeriesType,
  VitalValueStatistics,
  VitalsMetrics,
  VitalsMetricsInput,
} from "./analytics-vitals-metrics.ts";
export { calculateVitalsMetrics } from "./analytics-vitals-metrics.ts";
// T269: käyttäjän mieliala- ja itsearvioasteikkojen paikalliset päivä-/viikkotrendit.
export type {
  MoodEnergyDayMetric,
  MoodEnergyMetrics,
  MoodEnergyMetricsInput,
  MoodEnergyPeriodSummary,
  MoodEnergyWeekMetric,
  MoodScaleStatistics,
  MoodScaleSummary,
} from "./analytics-mood-energy-metrics.ts";
export { calculateMoodEnergyMetrics } from "./analytics-mood-energy-metrics.ts";
// T270: kahden valitun paikallispäivän aikasarjan kuvaileva korrelaatio.
export type {
  CrossMetricCorrelation,
  CrossMetricCorrelationInput,
  CrossMetricCorrelationStatus,
  CrossMetricDailyPoint,
  CrossMetricPairedDay,
  CrossMetricSeriesInput,
} from "./analytics-cross-metric-correlation.ts";
export {
  calculateCrossMetricCorrelation,
  CROSS_METRIC_CORRELATION_MINIMUM_PAIRED_DAYS,
} from "./analytics-cross-metric-correlation.ts";
// T030: SQLite/OPFS-worker-tietokanta (avaus/health/meta-probe).
// T031: + versionoidut migraatiot (M001-ketju, idempotentti runner).
export type {
  DbRequestKind,
  DbRequest,
  DbRequestNoId,
  DbResponse,
  DbBackend,
  DbSuccessResponse,
  DbFailureResponse,
} from "./sqliteProtocol.ts";
export { isDbRequest, isDbResponse } from "./sqliteProtocol.ts";
export type { MigrationStep, MigrationChainIssue } from "./migrations.ts";
export {
  MIGRATIONS,
  CURRENT_SCHEMA_VERSION,
  validateMigrationChain,
  pendingMigrations,
  entityMetadataColumns,
  entityMetadataColumnNames,
} from "./migrations.ts";
export type { DatabaseHealth } from "./database.ts";
export type { MigrationResult } from "./database.ts";
// T095: paikallinen hakemistoprojektio (§22, puhdas — ei IO:ta).
export type {
  SearchDocument,
  SearchHit,
  SearchIndex,
  SearchIndexInput,
  SearchResultKind,
  SearchResults,
} from "./search-index.ts";
export {
  SEARCH_RESULT_LABELS,
  buildSearchIndex,
  emptySearchResults,
  normalizeSearchText,
  searchIndex,
} from "./search-index.ts";
export {
  openDatabase,
  closeDatabase,
  migrateDatabase,
  getSchemaVersion,
  probeDatabaseWrite,
  writeMeta,
  readMeta,
  isLocalContentEncrypted,
  unlockLocalContent,
  lockLocalContent,
  configureDatabaseWorker,
  resetDatabaseWorkerForTests,
} from "./database.ts";
