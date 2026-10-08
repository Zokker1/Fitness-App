// T026: packages/domain julkinen pinta. Yksi import-polku kuluttajille:
//   import type { Task } from "@lifeos/domain";
// Ei sivuimportteja suoraan alimoduuleihin (raja pysyy T027:ssa).
export type {
  EntityId,
  UtcTimestamp,
  EntityVersion,
  BaseEntity,
  SoftDeletable,
  EntityMetadata,
  SyncMetadata,
} from "./base.ts";
export type {
  ThemePreference,
  DayStartHour,
  WeightUnit,
  WeightTarget,
  MacroTargets,
  HydrationTargetMl,
  HydrationReminderTime,
  MealSlotPreference,
  UserPreferences,
  BrowserInstallation,
} from "./identity.ts";
export {
  DEFAULT_MEAL_SLOTS,
  DEFAULT_MACRO_TARGETS,
  MACRO_TARGET_MAXIMUMS,
  HYDRATION_TARGET_ML_MAXIMUM,
  DEFAULT_PREFERENCE_VALUES,
  HEIGHT_CM_RANGE,
  MEAL_SLOT_MAX_COUNT,
  MEAL_SLOT_NAME_MAX_LENGTH,
} from "./identity.ts";
export type { NotificationCategoryKey, NotificationCategorySettings } from "./notifications.ts";
export type { NotificationCopy } from "./notifications.ts";
export {
  DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  NOTIFICATION_CATEGORY_KEYS,
  redactNotificationCopy,
  resolveNotificationCategoryKey,
  validateNotificationCategorySettings,
} from "./notifications.ts";
export type { BmiWeight } from "./bmi.ts";
export { calculateBmi } from "./bmi.ts";
export type {
  TaskStatus,
  TaskPriority,
  TaskRecurrence,
  Task,
  TaskChecklistItem,
  Project,
  Tag,
  CalendarBlockKind,
  CalendarBlock,
  Goal,
  HabitCadence,
  HabitRule,
  GoalDay,
  Routine,
  RoutineStep,
  RoutineScheduleCadence,
  RoutineSchedule,
  RoutineRunDayMode,
  RoutineRunStatus,
  RoutineRun,
  RoutineStepRunStatus,
  RoutineStepRun,
  FocusPhase,
  FocusSession,
  Distraction,
} from "./productivity.ts";
export type { GoalValues, HabitRuleValues } from "./goals.ts";
export {
  isGoalActiveOnLocalDate,
  isValidLocalDateKey,
  validateGoalValues,
  validateHabitRuleValues,
} from "./goals.ts";
export type { RoutineValues, RoutineStepValues, RoutineScheduleValues } from "./routines.ts";
export {
  isRoutineScheduledOnLocalDate,
  routineRunCompletionTime,
  routineStepRunIsComplete,
  validateRoutineScheduleValues,
  validateRoutineStepValues,
  validateRoutineValues,
} from "./routines.ts";
export type {
  MeasurementType,
  BloodPressureContext,
  Measurement,
  NutritionEntry,
  Food,
  Recipe,
  RecipeIngredient,
  HydrationEntry,
  Supplement,
  SupplementLog,
  SupplementLogStatus,
  SleepEntry,
  ActivityEntry,
  MoodCheckin,
  MoodCheckinScales,
  JournalEntry,
  BreathingSession,
  BreathingPhaseKind,
  BreathingProtocolRisk,
  BreathingRiskContext,
  BreathingProtocolPhase,
  BreathingSafetyMetadata,
  BreathingProtocol,
} from "./health.ts";
export {
  JOURNAL_REFLECTION_FIELD_MAX_LENGTH,
  BREATHING_PHASE_KINDS,
  BREATHING_PROTOCOL_RISKS,
  BREATHING_RISK_CONTEXTS,
  BREATHING_PHASE_DURATION_MIN_SECONDS,
  BREATHING_PHASE_DURATION_MAX_SECONDS,
  BREATHING_PHASE_BREATH_MIN_SECONDS,
  BREATHING_PHASE_HOLD_MAX_SECONDS,
  BREATHING_PROTOCOL_MAX_PHASES,
  BREATHING_PROTOCOL_ROUNDS_MIN,
  BREATHING_PROTOCOL_ROUNDS_MAX,
  BREATHING_PROTOCOL_TOTAL_DURATION_MAX_SECONDS,
  BREATHING_PROTOCOL_KEY_MAX_LENGTH,
  BREATHING_PROTOCOL_NAME_MAX_LENGTH,
  BREATHING_SAFETY_WARNING_MAX_LENGTH,
} from "./health.ts";
export {
  MOOD_CHECKIN_SCALE_MAXIMUM,
  MOOD_CHECKIN_SCALE_MINIMUM,
  validateBreathingProtocol,
  validateMoodCheckinScales,
} from "./rules.ts";
export type {
  MeasurementTypeDefinition,
  MeasurementUnitDefinition,
} from "./measurement-registry.ts";
export {
  BLOOD_PRESSURE_CONTEXT_OPTIONS,
  BLOOD_PRESSURE_PULSE_RANGE,
  BODY_MEASURE_NAME_MAX_LENGTH,
  CUSTOM_METRIC_NAME_MAX_LENGTH,
  containsControlCharacters,
  MEASUREMENT_TYPE_REGISTRY,
  MEASUREMENT_UNIT_MAX_LENGTH,
  getDefaultMeasurementUnitDefinition,
  getMeasurementDisplayPrecision,
  getMeasurementTypeDefinition,
  getMeasurementUnitDefinition,
  isBloodPressureContext,
  isMeasurementType,
  normalizeBodyMeasureName,
  normalizeMeasurementMetricName,
} from "./measurement-registry.ts";
export type {
  ReminderKind,
  ReminderCadence,
  ReminderSubjectKind,
  ReminderSchedule,
  ReminderSubject,
  Reminder,
  TimeReminderRule,
  RecurringReminderRule,
  DeadlineReminderRule,
  ConditionalReminderRule,
  ReminderRule,
  ReminderRuleEvaluationInput,
  ReminderRuleNotDueReason,
  ReminderRuleEvaluation,
  NotificationDelivery,
  NotificationState,
} from "./reminders.ts";
export {
  REMINDER_DEADLINE_LEAD_MINUTES_MAXIMUM,
  validateReminderRule,
  evaluateReminderRule,
} from "./reminder-rules.ts";
export type {
  XpSource,
  XPTransaction,
  LevelState,
  QuestConditionKind,
  QuestCondition,
  Quest,
  QuestProgress,
  Achievement,
  Collectible,
  UserReward,
  VaultReward,
  VaultRewardClaim,
} from "./gamification.ts";
export type {
  SyncEntityType,
  SyncOperationKind,
  SyncOperation,
  SyncCursor,
  ConflictStatus,
  ConflictRecord,
  BackupManifest,
} from "./sync.ts";
export type { SearchIndexRecord } from "./search.ts";
export type { DomainErrorCode, DomainError, DomainResult } from "./rules.ts";
export {
  isBefore,
  completeTask,
  reopenTask,
  deleteTask,
  restoreTask,
  transitionFocus,
  filterUnseenOperations,
  isDuplicateOperation,
  toLocalDateKey,
  assertEntityId,
  validateHeightCm,
  validateMealSlots,
  validateMacroTargets,
  validateHydrationTargetMl,
  validateHydrationReminderTime,
  validateUserPreferencesValues,
  validateWeightTarget,
  assertInstallationActive,
  touchInstallation,
  revokeInstallation,
} from "./rules.ts";
