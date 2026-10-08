import { hasControlCharacters } from "./text-validation.ts";
// T030: worker-protokolla. Yksi viestimuoto main <-> db-worker -välille.
// - Kaikki viestit validoidaan molemmissa päissä (runtime-tarkistus, ei
//   luottamusta postMessage-sisältöön) — T033 tuo Zod-vahvistuksen.
// - SQL:ää ei kulje vapaana sovelluskoodista: client tarjoaa vain nimettyjä
//   operaatioita (ping/open/exec/query/close/migrate); worker omistaa SQL-lauseet.
// - Domain-data kulkee JSON-serialisoituvana (ei funktioita/luokkia).
// - Virheet käännetään DataError-koodeiksi jo workerissa (§32/T027).
// - close on oma pyyntölaji (ei query-op): se ei vaadi avointa kantaa.
// - T031: migrate ajaa versionoidut migraatiot idempotentisti (ei ensureMeta-
//   ad-hoc-operaatiota: skeema syntyy vain migraatioketjusta).

// - T039: "opfs"-haaraa ei ole kytketty (ei async-proxya); worker avaa
//   aina sahpoolin (tai memory-fallbackin). DbBackend-unioni säilyttää
//   "opfs":n vastaisuuden varalta, mutta tuotantopolku on opfs-sahpool.
//   E2E-smoke vaatii pysyvyyttä pool-backendillä ("opfs-sahpool").

export function isValidLocalDateKeyValue(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export type DbRequestKind =
  | "ping"
  | "open"
  | "exec"
  | "query"
  | "close"
  | "local-key"
  | "migrate"
  | "transaction"
  | "restore";

export interface DbRequestBase {
  readonly requestId: string;
  readonly kind: DbRequestKind;
}

export interface DbPingRequest extends DbRequestBase {
  readonly kind: "ping";
}

export interface DbOpenRequest extends DbRequestBase {
  readonly kind: "open";
}

export interface DbExecRequest extends DbRequestBase {
  readonly kind: "exec";
  /** Nimetty kirjoitusoperaatio — ei raakaa SQL:ää clientiltä (§32). */
  readonly op:
    | "putMeta"
    | "putPreferences"
    | "putInstallation"
    | "putEntity"
    | "deleteEntity"
    | "putHydrationEntry"
    | "deleteHydrationEntry"
    | "putSleepEntry"
    | "putActivityEntry"
    | "putMoodCheckin"
    | "deleteMoodCheckin"
    | "putJournalEntry"
    | "putBreathingSession"
    | "deleteBreathingSession"
    | "putReminder"
    | "putNotificationState"
    | "deleteNotificationState"
    | "putQuest"
    | "deleteQuest"
    | "putQuestProgress"
    | "deleteQuestProgress"
    | "putVaultReward"
    | "deleteVaultReward"
    | "putVaultRewardClaim"
    | "putXpTransaction"
    | "putLevelState"
    | "deleteLevelState"
    | "putAchievement"
    | "deleteAchievement"
    | "putCollectible"
    | "deleteCollectible"
    | "putUserReward"
    | "putProject"
    | "putSyncCursor"
    | "putTag"
    | "putTask"
    | "putTaskChecklistItem"
    | "putRoutine"
    | "putRoutineStep"
    | "putRoutineSchedule"
    | "putRoutineRun"
    | "deleteRoutineRun"
    | "putRoutineStepRun"
    | "deleteRoutineStepRun"
    | "putCalendarBlock"
    | "putFocusSession"
    | "deleteFocusSession"
    | "putDistraction"
    | "deleteDistraction"
    | "putGoal"
    | "putHabitRule"
    | "putGoalDay"
    | "deleteGoalDay"
    | "putMeasurement"
    | "putFood"
    | "putNutritionEntry"
    | "putRecipe"
    | "putSupplement"
    | "putSupplementLog"
    | "deleteSupplementLog";
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

/** T076: yksi nimmu kirjoitus atomisessa transaktiossa (ei raakaa SQL:ää). */
export type DbNamedWriteOp =
  | "putMeta"
  | "putPreferences"
  | "putInstallation"
  | "putEntity"
  | "deleteEntity"
  | "putHydrationEntry"
  | "deleteHydrationEntry"
  | "putSleepEntry"
  | "putActivityEntry"
  | "putMoodCheckin"
  | "deleteMoodCheckin"
  | "putJournalEntry"
  | "putBreathingSession"
  | "deleteBreathingSession"
  | "putReminder"
  | "putNotificationState"
  | "deleteNotificationState"
  | "putQuest"
  | "deleteQuest"
  | "putQuestProgress"
  | "deleteQuestProgress"
  | "putVaultReward"
  | "deleteVaultReward"
  | "putVaultRewardClaim"
  | "putXpTransaction"
  | "putLevelState"
  | "deleteLevelState"
  | "putAchievement"
  | "deleteAchievement"
  | "putCollectible"
  | "deleteCollectible"
  | "putUserReward"
  | "putProject"
  | "putSyncCursor"
  | "putTag"
  | "putTask"
  | "putTaskChecklistItem"
  | "putRoutine"
  | "putRoutineStep"
  | "putRoutineSchedule"
  | "putRoutineRun"
  | "deleteRoutineRun"
  | "putRoutineStepRun"
  | "deleteRoutineStepRun"
  | "putCalendarBlock"
  | "putFocusSession"
  | "deleteFocusSession"
  | "putDistraction"
  | "deleteDistraction"
  | "putGoal"
  | "putHabitRule"
  | "putGoalDay"
  | "deleteGoalDay"
  | "putMeasurement"
  | "putFood"
  | "putNutritionEntry"
  | "putRecipe"
  | "putSupplement"
  | "putSupplementLog"
  | "deleteSupplementLog";

export interface DbTransactionOp {
  readonly op: DbNamedWriteOp;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface DbSyncOperationTransactionOp {
  readonly op: "putSyncOperation";
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface DbConflictRecordTransactionOp {
  readonly op: "putConflictRecord";
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface DbResolveConflictTransactionOp {
  readonly op: "resolveConflictRecord";
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export type DbTransactionWrite =
  | DbTransactionOp
  | DbSyncOperationTransactionOp
  | DbConflictRecordTransactionOp
  | DbResolveConflictTransactionOp;

export interface DbTransactionRequest extends DbRequestBase {
  readonly kind: "transaction";
  /** Ei tyhjä, enintään 64 kirjoitusta (worker validoi; §32 atomisuus). */
  readonly ops: readonly DbTransactionWrite[];
}

export type DbRestoreWriteOp =
  | "putPreferences"
  | "putHydrationEntry"
  | "putSleepEntry"
  | "putActivityEntry"
  | "putMoodCheckin"
  | "putJournalEntry"
  | "putBreathingSession"
  | "putReminder"
  | "putNotificationState"
  | "putQuest"
  | "putQuestProgress"
  | "putVaultReward"
  | "putVaultRewardClaim"
  | "putXpTransaction"
  | "putLevelState"
  | "putAchievement"
  | "putCollectible"
  | "putUserReward"
  | "putProject"
  | "putTag"
  | "putTask"
  | "putTaskChecklistItem"
  | "putRoutine"
  | "putRoutineStep"
  | "putRoutineSchedule"
  | "putRoutineRun"
  | "putRoutineStepRun"
  | "putCalendarBlock"
  | "putFocusSession"
  | "putDistraction"
  | "putGoal"
  | "putHabitRule"
  | "putGoalDay"
  | "putMeasurement"
  | "putFood"
  | "putNutritionEntry"
  | "putRecipe"
  | "putSupplement"
  | "putSupplementLog";

export interface DbRestoreWrite {
  readonly op: DbRestoreWriteOp;
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export const MAX_RESTORE_WRITE_OPS = 100_000;

export interface DbRestoreRequest extends DbRequestBase {
  readonly kind: "restore";
  /** Yksi erikseen rajattu atominen restore, ilman sync-outbox-operaatioita. */
  readonly ops: readonly DbRestoreWrite[];
}

export interface DbQueryRequest extends DbRequestBase {
  readonly kind: "query";
  readonly op:
    | "getMeta"
    | "listMetaKeys"
    | "integrityCheck"
    | "probeWrite"
    | "getSchemaVersion"
    | "getPreferences"
    | "getActiveInstallation"
    | "listInstallations"
    | "getHydrationEntry"
    | "listHydrationEntries"
    | "getSleepEntry"
    | "listSleepEntries"
    | "getActivityEntry"
    | "listActivityEntries"
    | "getMoodCheckin"
    | "listMoodCheckins"
    | "getJournalEntry"
    | "listJournalEntries"
    | "getBreathingSession"
    | "listBreathingSessions"
    | "getReminder"
    | "listReminders"
    | "getNotificationState"
    | "listNotificationStates"
    | "getQuest"
    | "listQuests"
    | "getQuestProgress"
    | "listQuestProgress"
    | "getVaultReward"
    | "listVaultRewards"
    | "getVaultRewardClaim"
    | "listVaultRewardClaims"
    | "getXpTransaction"
    | "listXpTransactions"
    | "getLevelState"
    | "listLevelStates"
    | "getAchievement"
    | "listAchievements"
    | "getAchievementRewardReference"
    | "getCollectible"
    | "listCollectibles"
    | "getCollectibleRewardReference"
    | "getUserReward"
    | "listUserRewards"
    | "getSyncCursor"
    | "getProject"
    | "listProjects"
    | "getTag"
    | "listTags"
    | "getTask"
    | "listTasks"
    | "listTaskTags"
    | "getTaskChecklistItem"
    | "listTaskChecklistItems"
    | "getRoutine"
    | "listRoutines"
    | "getRoutineStep"
    | "listRoutineSteps"
    | "getRoutineSchedule"
    | "listRoutineSchedules"
    | "getRoutineRun"
    | "listRoutineRuns"
    | "getRoutineStepRun"
    | "listRoutineStepRuns"
    | "getCalendarBlock"
    | "listCalendarBlocks"
    | "getFocusSession"
    | "listFocusSessions"
    | "getDistraction"
    | "listDistractions"
    | "getGoal"
    | "listGoals"
    | "getHabitRule"
    | "listHabitRules"
    | "getGoalDay"
    | "listGoalDays"
    | "getMeasurement"
    | "listMeasurements"
    | "getFood"
    | "listFoods"
    | "getNutritionEntry"
    | "listNutritionEntries"
    | "getRecipe"
    | "listRecipes"
    | "getSupplement"
    | "listSupplements"
    | "getSupplementLog"
    | "listSupplementLogs"
    | "getEntity"
    | "listEntities"
    | "listSyncOperations"
    | "listConflictRecords";
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export interface DbCloseRequest extends DbRequestBase {
  readonly kind: "close";
}

export type DbLocalKeyRequest =
  | (DbRequestBase & {
      readonly kind: "local-key";
      readonly action: "unlock";
      readonly key: Uint8Array;
    })
  | (DbRequestBase & { readonly kind: "local-key"; readonly action: "lock" });

type DbLocalKeyRequestNoId =
  | { readonly kind: "local-key"; readonly action: "unlock"; readonly key: Uint8Array }
  | { readonly kind: "local-key"; readonly action: "lock" };

export interface DbMigrateRequest extends DbRequestBase {
  readonly kind: "migrate";
  /** Kohdeskeemaversio — worker validoi ketjun (aukoton 1..N) ennen ajoa. */
  readonly targetVersion: number;
}

export type DbRequest =
  | DbPingRequest
  | DbOpenRequest
  | DbExecRequest
  | DbQueryRequest
  | DbCloseRequest
  | DbLocalKeyRequest
  | DbMigrateRequest
  | DbTransactionRequest
  | DbRestoreRequest;

/** Clientin lähettämä pyyntö ilman requestId:tä (client täyttää sen). */
export type DbRequestNoId =
  | Omit<DbPingRequest, "requestId">
  | Omit<DbOpenRequest, "requestId">
  | Omit<DbExecRequest, "requestId">
  | Omit<DbQueryRequest, "requestId">
  | Omit<DbCloseRequest, "requestId">
  | DbLocalKeyRequestNoId
  | Omit<DbMigrateRequest, "requestId">
  | Omit<DbTransactionRequest, "requestId">
  | Omit<DbRestoreRequest, "requestId">;

export type DbBackend = "opfs-sahpool" | "opfs" | "memory";

export interface DbSuccessResponse {
  readonly requestId: string;
  readonly ok: true;
  readonly rows: readonly unknown[];
  readonly backend: DbBackend;
  readonly persisted: boolean;
  /** Skeemaversio migrate-vastauksissa (muuten workerin tuntema versio). */
  readonly schemaVersion?: number;
  /** T038: poolin diagnostiikka (kapasiteetti/lukumäärä/onko DB mäppätty). */
  readonly poolCapacity?: number | null;
  readonly poolFileCount?: number | null;
  readonly poolHasDb?: boolean;
}

export type DbFailureCode =
  "storage-unavailable" | "quota-exceeded" | "transient-failure" | "invalid-input";

export interface DbFailureResponse {
  readonly requestId: string;
  readonly ok: false;
  readonly code: DbFailureCode;
  /** Koneellinen diagnostiikka (ei PII:tä, ei sisältöä). */
  readonly diagnosticCode: string;
}

export type DbResponse = DbSuccessResponse | DbFailureResponse;

/**
 * T060-T076: entity-put-oppien paramvalidointi (täsmälleen odotetut avaimet
 * oikeilla tyypeillä; ei extra-kenttiä).
 */
function isEntityParams(
  value: unknown,
  schema: {
    readonly strings: readonly string[];
    readonly optionalStrings?: readonly string[];
    readonly numbers: readonly string[];
    readonly finiteNumbers?: readonly string[];
    readonly numberOrEmpty?: readonly string[];
    readonly booleans: readonly string[];
  },
): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const params: Record<string, unknown> = { ...value };
  const expected =
    schema.strings.length +
    schema.numbers.length +
    (schema.finiteNumbers?.length ?? 0) +
    (schema.numberOrEmpty?.length ?? 0) +
    schema.booleans.length;
  const maximum = expected + (schema.optionalStrings?.length ?? 0);
  if (Object.keys(params).length < expected || Object.keys(params).length > maximum) {
    return false;
  }
  const allowedKeys = new Set([
    ...schema.strings,
    ...(schema.optionalStrings ?? []),
    ...schema.numbers,
    ...(schema.finiteNumbers ?? []),
    ...(schema.numberOrEmpty ?? []),
    ...schema.booleans,
  ]);
  if (Object.keys(params).some((key) => !allowedKeys.has(key))) {
    return false;
  }
  for (const key of schema.strings) {
    if (typeof params[key] !== "string") {
      return false;
    }
  }
  for (const key of schema.optionalStrings ?? []) {
    if (key in params && typeof params[key] !== "string") {
      return false;
    }
  }
  for (const key of schema.numbers) {
    if (typeof params[key] !== "number" || !Number.isInteger(params[key])) {
      return false;
    }
  }
  for (const key of schema.finiteNumbers ?? []) {
    if (typeof params[key] !== "number" || !Number.isFinite(params[key])) {
      return false;
    }
  }
  for (const key of schema.numberOrEmpty ?? []) {
    if (params[key] !== "" && (typeof params[key] !== "number" || !Number.isFinite(params[key]))) {
      return false;
    }
  }
  for (const key of schema.booleans) {
    if (typeof params[key] !== "boolean") {
      return false;
    }
  }
  return true;
}

/** T076: yhden nimetyn kirjoitusopin validointi (exec + transaction jakavat).
 * params voi ajonaikaisesti olla null (tulee unknown-castin läpi) — silloin
 * spread tuottaa tyhjän objektin ja kenttälaskurit hylkäävät sen. */
function isValidNamedOp(
  op: unknown,
  params: Readonly<Record<string, string | number | boolean>> | undefined,
): boolean {
  if (typeof op !== "string" || params === undefined) {
    return false;
  }
  if (op === "putMeta") {
    const copy: Record<string, unknown> = { ...params };
    if (Object.keys(copy).length !== 2) {
      return false;
    }
    // Avain ei saa olla tyhjä (vrt. database.ts writeMeta-rajapinta).
    return (
      typeof copy.key === "string" && copy.key.trim().length > 0 && typeof copy.value === "string"
    );
  }
  // T060: putPreferences vaatii täsmälleen entity-kentät oikeilla tyypeillä.
  if (op === "putPreferences") {
    return isEntityParams(params, {
      strings: [
        "id",
        "theme",
        "enabled_sections",
        "created_at",
        "updated_at",
        "weight_target",
        "height_cm",
        "meal_slots",
        "macro_targets",
        "hydration_target_ml",
        "hydration_reminder_time",
        "notification_categories",
      ],
      numbers: ["day_start_hour", "version"],
      booleans: ["gamification_visible", "notification_defaults_enabled", "app_lock_enabled"],
    });
  }
  // T061: putInstallation — NULL-olielot kulkevat tyhjänä merkkijonona
  // (worker bindei SQL NULL:ksi).
  if (op === "putInstallation") {
    return isEntityParams(params, {
      strings: [
        "id",
        "installation_id",
        "installation_name",
        "last_seen_app_version",
        "last_sync_at",
        "revoked_at",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      booleans: ["is_local"],
    });
  }
  // T315: provider cursor is an opaque, bounded checkpoint written transactionally.
  if (op === "putSyncCursor") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "installation_id",
        "provider_id",
        "provider_cursor",
        "last_seen_operation_id",
        "updated_through",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      booleans: [],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.installation_id === "string" &&
      params.installation_id.length > 0 &&
      params.installation_id.length <= 128 &&
      typeof params.provider_id === "string" &&
      params.provider_id.length > 0 &&
      params.provider_id.length <= 128 &&
      typeof params.provider_cursor === "string" &&
      params.provider_cursor.length <= 1_400_000 &&
      typeof params.last_seen_operation_id === "string" &&
      params.last_seen_operation_id.length <= 128 &&
      typeof params.updated_through === "string" &&
      Number.isFinite(Date.parse(params.updated_through)) &&
      typeof params.created_at === "string" &&
      Number.isFinite(Date.parse(params.created_at)) &&
      typeof params.updated_at === "string" &&
      Number.isFinite(Date.parse(params.updated_at)) &&
      Number.isInteger(params.version) &&
      params.version === 1
    );
  }
  // T301: SyncOperation kuuluu ainoastaan atomiseen transaktioon. Viitteet
  // ovat opaakkeja; payloadin salaus ja eheystiiviste tuotetaan omissa vaiheissaan.
  if (op === "putSyncOperation") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "operation_id",
        "installation_id",
        "entity_type",
        "entity_id",
        "operation",
        "occurred_at",
        "encrypted_payload_ref",
        "integrity_ref",
        "created_at",
        "updated_at",
      ],
      numbers: ["entity_version", "version"],
      booleans: [],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.operation_id === "string" &&
      params.operation_id.length > 0 &&
      params.operation_id.length <= 128 &&
      typeof params.installation_id === "string" &&
      params.installation_id.length > 0 &&
      typeof params.entity_type === "string" &&
      params.entity_type.length > 0 &&
      params.entity_type.length <= 60 &&
      typeof params.entity_id === "string" &&
      params.entity_id.length > 0 &&
      (params.operation === "create" ||
        params.operation === "update" ||
        params.operation === "delete" ||
        params.operation === "resolve") &&
      Number.isInteger(params.entity_version) &&
      (params.entity_version as number) >= 1 &&
      typeof params.occurred_at === "string" &&
      params.occurred_at.length > 0 &&
      typeof params.encrypted_payload_ref === "string" &&
      params.encrypted_payload_ref.length > 0 &&
      typeof params.integrity_ref === "string" &&
      params.integrity_ref.length > 0 &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1
    );
  }
  // T313: conflict versions are opaque operation references, never payload values.
  if (op === "putConflictRecord") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "entity_type",
        "entity_id",
        "status",
        "local_version_ref",
        "remote_version_ref",
        "resolved_at",
        "resolution_operation_id",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      booleans: [],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.entity_type === "string" &&
      params.entity_type.length > 0 &&
      params.entity_type.length <= 60 &&
      typeof params.entity_id === "string" &&
      params.entity_id.length > 0 &&
      (params.status === "open" || params.status === "resolved") &&
      typeof params.local_version_ref === "string" &&
      params.local_version_ref.length > 0 &&
      params.local_version_ref.length <= 2048 &&
      typeof params.remote_version_ref === "string" &&
      params.remote_version_ref.length > 0 &&
      params.remote_version_ref.length <= 2048 &&
      typeof params.resolved_at === "string" &&
      typeof params.resolution_operation_id === "string" &&
      ((params.status === "open" &&
        params.resolved_at.length === 0 &&
        params.resolution_operation_id.length === 0) ||
        (params.status === "resolved" &&
          params.resolved_at.length > 0 &&
          params.resolution_operation_id.length > 0)) &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1
    );
  }
  if (op === "resolveConflictRecord") {
    const validParams = isEntityParams(params, {
      strings: ["id", "resolution_operation_id", "updated_at"],
      numbers: [],
      booleans: [],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.resolution_operation_id === "string" &&
      params.resolution_operation_id.length > 0 &&
      params.resolution_operation_id.length <= 128 &&
      typeof params.updated_at === "string" &&
      Number.isFinite(Date.parse(params.updated_at))
    );
  }
  // T130: entity-doc -tallenne (appin EntityStoreille; doc kokonaisentiteetti
  // JSONinä — repos hallitsevat version/updatedAt-invariantit).
  if (op === "putEntity") {
    return isEntityParams(params, {
      strings: ["entity_type", "id", "doc", "created_at", "updated_at"],
      numbers: ["doc_version"],
      booleans: [],
    });
  }
  if (op === "putHydrationEntry") {
    return isEntityParams(params, {
      strings: ["id", "drunk_at", "created_at", "updated_at"],
      numbers: ["milliliters", "version"],
      booleans: [],
    });
  }
  if (op === "deleteHydrationEntry") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putSleepEntry") {
    return isEntityParams(params, {
      strings: ["id", "sleep_start", "sleep_end", "created_at", "updated_at", "deleted_at"],
      numbers: ["version", "is_nap"],
      numberOrEmpty: ["quality"],
      booleans: [],
    });
  }
  if (op === "putActivityEntry") {
    return isEntityParams(params, {
      strings: ["id", "activity_at", "kind", "created_at", "updated_at", "deleted_at"],
      optionalStrings: ["note"],
      numbers: ["version"],
      numberOrEmpty: ["duration_seconds", "distance_meters"],
      booleans: [],
    });
  }
  if (op === "putMoodCheckin") {
    return isEntityParams(params, {
      strings: ["id", "checked_at", "note", "created_at", "updated_at"],
      numbers: ["mood", "version"],
      numberOrEmpty: ["stress", "energy", "motivation", "focus"],
      booleans: [],
    });
  }
  if (op === "putJournalEntry") {
    return isEntityParams(params, {
      strings: [
        "id",
        "written_at",
        "title",
        "body",
        "reflection_success",
        "reflection_difficult",
        "reflection_tomorrow",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["version"],
      booleans: ["title_is_null"],
    });
  }
  if (op === "putBreathingSession") {
    return isEntityParams(params, {
      strings: ["id", "started_at", "ended_at", "pattern_key", "created_at", "updated_at"],
      numbers: ["version"],
      booleans: [],
    });
  }
  if (op === "deleteBreathingSession") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putReminder") {
    return isEntityParams(params, {
      strings: [
        "id",
        "kind",
        "route",
        "title",
        "fire_at",
        "snoozed_until",
        "rule_json",
        "category_key",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["enabled", "version"],
      booleans: [],
    });
  }
  if (op === "putNotificationState") {
    return isEntityParams(params, {
      strings: [
        "id",
        "reminder_id",
        "category_key",
        "delivery",
        "last_evaluated_at",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      booleans: [],
    });
  }
  if (op === "deleteNotificationState") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putQuest") {
    return isEntityParams(params, {
      strings: [
        "id",
        "title",
        "description",
        "active_from",
        "active_until",
        "condition_kind",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      numberOrEmpty: ["condition_goal", "minimum_amount"],
      booleans: [],
    });
  }
  if (op === "deleteQuest") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putQuestProgress") {
    return isEntityParams(params, {
      strings: ["id", "quest_id", "completed_at", "created_at", "updated_at"],
      numbers: ["progress", "goal", "version"],
      booleans: [],
    });
  }
  if (op === "deleteQuestProgress") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putVaultReward") {
    return isEntityParams(params, {
      strings: ["id", "title", "note", "created_at", "updated_at"],
      numbers: ["xp_threshold", "version"],
      booleans: [],
    });
  }
  if (op === "deleteVaultReward") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putVaultRewardClaim") {
    const validParams = isEntityParams(params, {
      strings: ["id", "reward_id", "claimed_at", "created_at", "updated_at"],
      numbers: ["xp_deducted", "version"],
      booleans: [],
    });
    return validParams && (params.xp_deducted as number) >= 0 && (params.version as number) >= 1;
  }
  if (op === "putXpTransaction") {
    return isEntityParams(params, {
      strings: [
        "id",
        "source",
        "source_entity_id",
        "earned_at",
        "reason",
        "created_at",
        "updated_at",
      ],
      numbers: ["amount", "version"],
      booleans: ["reason_is_null"],
    });
  }
  if (op === "putLevelState") {
    return isEntityParams(params, {
      strings: ["id", "computed_at", "created_at", "updated_at"],
      numbers: ["total_xp", "level", "version"],
      booleans: [],
    });
  }
  if (op === "deleteLevelState") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putAchievement") {
    const validParams = isEntityParams(params, {
      strings: ["id", "key", "title", "description", "created_at", "updated_at"],
      numbers: ["version"],
      booleans: ["description_is_null"],
    });
    return validParams && (params.description_is_null !== true || params.description === "");
  }
  if (op === "deleteAchievement") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putCollectible") {
    const validParams = isEntityParams(params, {
      strings: ["id", "key", "title", "unlocks_theme_key", "created_at", "updated_at"],
      numbers: ["version"],
      booleans: ["unlocks_theme_key_is_null"],
    });
    return (
      validParams && (params.unlocks_theme_key_is_null !== true || params.unlocks_theme_key === "")
    );
  }
  if (op === "deleteCollectible") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putUserReward") {
    const validParams = isEntityParams(params, {
      strings: ["id", "achievement_id", "collectible_id", "earned_at", "created_at", "updated_at"],
      numbers: ["version"],
      booleans: ["achievement_id_is_null", "collectible_id_is_null"],
    });
    return (
      validParams &&
      (params.achievement_id_is_null !== true || params.achievement_id === "") &&
      (params.collectible_id_is_null !== true || params.collectible_id === "") &&
      (params.achievement_id_is_null !== true || params.collectible_id_is_null !== true)
    );
  }
  if (op === "deleteMoodCheckin") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putGoal") {
    return isEntityParams(params, {
      strings: [
        "id",
        "title",
        "description",
        "active_from",
        "active_until",
        "archived_at",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["version"],
      booleans: [],
    });
  }
  if (op === "putHabitRule") {
    const validParams = isEntityParams(params, {
      strings: ["id", "goal_id", "title", "cadence", "created_at", "updated_at", "deleted_at"],
      numbers: ["target_per_period", "version"],
      booleans: ["goal_id_is_null", "deleted_at_is_null"],
    });
    if (!validParams) return false;
    return (
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.goal_id_is_null === "boolean" &&
      (params.goal_id_is_null
        ? params.goal_id === ""
        : typeof params.goal_id === "string" && params.goal_id.length > 0) &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 200 &&
      (params.cadence === "daily" || params.cadence === "weekly" || params.cadence === "custom") &&
      typeof params.target_per_period === "number" &&
      Number.isInteger(params.target_per_period) &&
      params.target_per_period >= 1 &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      typeof params.deleted_at_is_null === "boolean" &&
      (!params.deleted_at_is_null || params.deleted_at === "") &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1
    );
  }
  if (op === "putProject") {
    const validParams = isEntityParams(params, {
      strings: ["id", "name", "color_key", "archived_at", "created_at", "updated_at", "deleted_at"],
      numbers: ["version"],
      booleans: ["color_key_is_null", "archived_at_is_null", "deleted_at_is_null"],
    });
    return (
      validParams &&
      (params.color_key_is_null !== true || params.color_key === "") &&
      (params.archived_at_is_null !== true || params.archived_at === "") &&
      (params.deleted_at_is_null !== true || params.deleted_at === "")
    );
  }
  if (op === "putTag") {
    const validParams = isEntityParams(params, {
      strings: ["id", "name", "color_key", "created_at", "updated_at", "deleted_at"],
      numbers: ["version"],
      booleans: ["color_key_is_null", "deleted_at_is_null"],
    });
    return (
      validParams &&
      (params.color_key_is_null !== true || params.color_key === "") &&
      (params.deleted_at_is_null !== true || params.deleted_at === "")
    );
  }
  if (op === "putTask") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "title",
        "notes",
        "status",
        "priority",
        "due_at",
        "project_id",
        "completed_at",
        "reopened_at",
        "recurrence_json",
        "tag_ids_json",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["version"],
      finiteNumbers: ["estimate_minutes", "actual_seconds"],
      booleans: [
        "notes_is_null",
        "due_at_is_null",
        "project_id_is_null",
        "completed_at_is_null",
        "reopened_at_is_null",
        "recurrence_is_null",
        "estimate_minutes_is_null",
        "deleted_at_is_null",
      ],
    });
    if (!validParams) return false;
    return (
      (params.notes_is_null !== true || params.notes === "") &&
      (params.due_at_is_null !== true || params.due_at === "") &&
      (params.project_id_is_null !== true || params.project_id === "") &&
      (params.completed_at_is_null !== true || params.completed_at === "") &&
      (params.reopened_at_is_null !== true || params.reopened_at === "") &&
      (params.recurrence_is_null !== true || params.recurrence_json === "") &&
      (params.estimate_minutes_is_null !== true || params.estimate_minutes === 0) &&
      (params.deleted_at_is_null !== true || params.deleted_at === "")
    );
  }
  if (op === "putTaskChecklistItem") {
    const validParams = isEntityParams(params, {
      strings: ["id", "task_id", "title", "created_at", "updated_at", "deleted_at"],
      numbers: ["done", "sort_order", "version"],
      booleans: ["deleted_at_is_null"],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.task_id === "string" &&
      params.task_id.length > 0 &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 200 &&
      (params.done === 0 || params.done === 1) &&
      Number.isInteger(params.sort_order) &&
      (params.sort_order as number) >= 0 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1 &&
      typeof params.deleted_at === "string" &&
      (params.deleted_at_is_null !== true || params.deleted_at === "") &&
      (params.deleted_at_is_null === true || params.deleted_at.length > 0) &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0
    );
  }
  if (op === "putRoutine") {
    const validParams = isEntityParams(params, {
      strings: ["id", "title", "archived_at", "created_at", "updated_at", "deleted_at"],
      numbers: ["version"],
      booleans: ["archived_at_is_null", "deleted_at_is_null"],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 200 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1 &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      typeof params.archived_at === "string" &&
      (params.archived_at_is_null !== true || params.archived_at === "") &&
      typeof params.deleted_at === "string" &&
      (params.deleted_at_is_null !== true || params.deleted_at === "") &&
      (params.deleted_at_is_null === true || params.deleted_at.length > 0)
    );
  }
  if (op === "putRoutineStep") {
    const validParams = isEntityParams(params, {
      strings: ["id", "routine_id", "title", "created_at", "updated_at", "deleted_at"],
      numbers: ["sort_order", "optional", "version"],
      booleans: ["deleted_at_is_null"],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.routine_id === "string" &&
      params.routine_id.length > 0 &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 200 &&
      Number.isInteger(params.sort_order) &&
      (params.sort_order as number) >= 0 &&
      (params.optional === 0 || params.optional === 1) &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1 &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      typeof params.deleted_at === "string" &&
      (params.deleted_at_is_null !== true || params.deleted_at === "")
    );
  }
  if (op === "putRoutineSchedule") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "routine_id",
        "cadence",
        "weekdays_json",
        "local_time",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["enabled", "version"],
      booleans: ["local_time_is_null", "deleted_at_is_null"],
    });
    if (!validParams) return false;
    if (
      typeof params.id !== "string" ||
      params.id.length === 0 ||
      typeof params.routine_id !== "string" ||
      params.routine_id.length === 0 ||
      (params.cadence !== "daily" && params.cadence !== "weekly") ||
      typeof params.weekdays_json !== "string" ||
      (params.enabled !== 0 && params.enabled !== 1) ||
      typeof params.local_time !== "string" ||
      typeof params.local_time_is_null !== "boolean" ||
      (params.local_time_is_null && params.local_time !== "") ||
      (!params.local_time_is_null &&
        !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(params.local_time)) ||
      typeof params.created_at !== "string" ||
      params.created_at.length === 0 ||
      typeof params.updated_at !== "string" ||
      params.updated_at.length === 0 ||
      !Number.isInteger(params.version) ||
      (params.version as number) < 1 ||
      typeof params.deleted_at !== "string" ||
      typeof params.deleted_at_is_null !== "boolean" ||
      (params.deleted_at_is_null && params.deleted_at !== "") ||
      (!params.deleted_at_is_null && params.deleted_at.length === 0)
    ) {
      return false;
    }
    let weekdays: unknown;
    try {
      weekdays = JSON.parse(params.weekdays_json);
    } catch {
      return false;
    }
    return (
      Array.isArray(weekdays) &&
      (params.cadence === "daily"
        ? weekdays.length === 0
        : weekdays.length >= 1 && weekdays.length <= 7) &&
      weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) &&
      new Set(weekdays).size === weekdays.length
    );
  }
  if (op === "putRoutineRun") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "routine_id",
        "local_date",
        "status",
        "day_mode",
        "started_at",
        "completed_at",
        "skip_reason",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      booleans: ["day_mode_is_null", "completed_at_is_null", "skip_reason_is_null"],
    });
    if (!validParams) return false;
    return (
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.routine_id === "string" &&
      params.routine_id.length > 0 &&
      isValidLocalDateKeyValue(params.local_date) &&
      (params.status === "running" ||
        params.status === "completed" ||
        params.status === "skipped" ||
        params.status === "cancelled") &&
      typeof params.day_mode_is_null === "boolean" &&
      (params.day_mode_is_null
        ? params.day_mode === ""
        : params.day_mode === "full" || params.day_mode === "minimum") &&
      typeof params.started_at === "string" &&
      params.started_at.length > 0 &&
      typeof params.completed_at_is_null === "boolean" &&
      typeof params.completed_at === "string" &&
      (params.completed_at_is_null ? params.completed_at === "" : params.completed_at.length > 0) &&
      typeof params.skip_reason_is_null === "boolean" &&
      (params.skip_reason_is_null ? params.skip_reason === "" : true) &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1 &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0
    );
  }
  if (op === "deleteRoutineRun") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putRoutineStepRun") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "routine_run_id",
        "routine_step_id",
        "status",
        "completed_at",
        "skip_reason",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      booleans: ["completed_at_is_null", "skip_reason_is_null"],
    });
    if (!validParams) return false;
    const statusValid =
      params.status === "pending" || params.status === "completed" || params.status === "skipped";
    const completedAtValid =
      typeof params.completed_at === "string" &&
      typeof params.completed_at_is_null === "boolean" &&
      (params.completed_at_is_null ? params.completed_at === "" : params.completed_at.length > 0);
    const skipReasonValid =
      typeof params.skip_reason === "string" &&
      typeof params.skip_reason_is_null === "boolean" &&
      (params.skip_reason_is_null
        ? params.skip_reason === ""
        : params.skip_reason.trim().length > 0);
    return (
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.routine_run_id === "string" &&
      params.routine_run_id.length > 0 &&
      typeof params.routine_step_id === "string" &&
      params.routine_step_id.length > 0 &&
      statusValid &&
      completedAtValid &&
      skipReasonValid &&
      (params.status === "pending"
        ? params.completed_at_is_null === true && params.skip_reason_is_null === true
        : params.status === "completed"
          ? params.completed_at_is_null === false && params.skip_reason_is_null === true
          : params.completed_at_is_null === false && params.skip_reason_is_null === false) &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1
    );
  }
  if (op === "deleteRoutineStepRun") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putCalendarBlock") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "kind",
        "title",
        "starts_at",
        "ends_at",
        "linked_task_id",
        "linked_routine_id",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["version"],
      booleans: ["linked_task_id_is_null", "linked_routine_id_is_null", "deleted_at_is_null"],
    });
    if (!validParams) return false;
    const validKind =
      params.kind === "task" ||
      params.kind === "routine" ||
      params.kind === "focus" ||
      params.kind === "event";
    return (
      validKind &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.title === "string" &&
      params.title.trim().length > 0 &&
      params.title.length <= 200 &&
      typeof params.starts_at === "string" &&
      params.starts_at.length > 0 &&
      typeof params.ends_at === "string" &&
      params.ends_at.length > 0 &&
      params.ends_at >= params.starts_at &&
      typeof params.linked_task_id === "string" &&
      typeof params.linked_task_id_is_null === "boolean" &&
      (!params.linked_task_id_is_null || params.linked_task_id === "") &&
      (params.linked_task_id_is_null || params.linked_task_id.length > 0) &&
      typeof params.linked_routine_id === "string" &&
      typeof params.linked_routine_id_is_null === "boolean" &&
      (!params.linked_routine_id_is_null || params.linked_routine_id === "") &&
      (params.linked_routine_id_is_null || params.linked_routine_id.length > 0) &&
      !(!params.linked_task_id_is_null && !params.linked_routine_id_is_null) &&
      (params.linked_task_id_is_null || params.kind === "task") &&
      (params.linked_routine_id_is_null || params.kind === "routine") &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1 &&
      typeof params.deleted_at === "string" &&
      typeof params.deleted_at_is_null === "boolean" &&
      (!params.deleted_at_is_null || params.deleted_at === "")
    );
  }
  if (op === "putFocusSession") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "task_id",
        "routine_id",
        "calendar_block_id",
        "phase",
        "started_at",
        "ended_at",
        "active_segment_started_at",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      finiteNumbers: [
        "duration_seconds",
        "active_elapsed_seconds",
        "accumulated_pause_seconds",
        "interruption_count",
      ],
      booleans: [
        "task_id_is_null",
        "routine_id_is_null",
        "calendar_block_id_is_null",
        "started_at_is_null",
        "ended_at_is_null",
        "duration_seconds_is_null",
        "active_elapsed_seconds_is_null",
        "active_segment_started_at_is_null",
        "accumulated_pause_seconds_is_null",
        "interruption_count_is_null",
      ],
    });
    if (!validParams) return false;
    const validPhase =
      params.phase === "planned" ||
      params.phase === "running" ||
      params.phase === "paused" ||
      params.phase === "completed" ||
      params.phase === "cancelled";
    const nullableIdIsValid = (key: string, nullKey: string): boolean =>
      typeof params[key] === "string" &&
      typeof params[nullKey] === "boolean" &&
      (!params[nullKey] || params[key] === "") &&
      (params[nullKey] || params[key].length > 0);
    const nullableTextIsValid = (key: string, nullKey: string): boolean =>
      typeof params[key] === "string" &&
      typeof params[nullKey] === "boolean" &&
      (!params[nullKey] || params[key] === "") &&
      (params[nullKey] || params[key].length > 0);
    const nullableCountIsValid = (key: string, nullKey: string): boolean =>
      typeof params[key] === "number" &&
      Number.isSafeInteger(params[key]) &&
      (params[nullKey] === true ? params[key] === 0 : params[key] >= 0);
    return (
      validPhase &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      nullableIdIsValid("task_id", "task_id_is_null") &&
      nullableIdIsValid("routine_id", "routine_id_is_null") &&
      nullableIdIsValid("calendar_block_id", "calendar_block_id_is_null") &&
      nullableTextIsValid("started_at", "started_at_is_null") &&
      nullableTextIsValid("ended_at", "ended_at_is_null") &&
      (params.started_at_is_null === true ||
        params.ended_at_is_null === true ||
        (params.ended_at as string) >= (params.started_at as string)) &&
      nullableCountIsValid("duration_seconds", "duration_seconds_is_null") &&
      nullableCountIsValid("active_elapsed_seconds", "active_elapsed_seconds_is_null") &&
      nullableTextIsValid("active_segment_started_at", "active_segment_started_at_is_null") &&
      nullableCountIsValid("accumulated_pause_seconds", "accumulated_pause_seconds_is_null") &&
      nullableCountIsValid("interruption_count", "interruption_count_is_null") &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1 &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0
    );
  }
  if (op === "deleteFocusSession") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putDistraction") {
    const validParams = isEntityParams(params, {
      strings: ["id", "focus_session_id", "noted_at", "note", "created_at", "updated_at"],
      numbers: ["version"],
      booleans: ["note_is_null"],
    });
    return (
      validParams &&
      typeof params.id === "string" &&
      params.id.length > 0 &&
      typeof params.focus_session_id === "string" &&
      params.focus_session_id.length > 0 &&
      typeof params.noted_at === "string" &&
      params.noted_at.length > 0 &&
      (params.note_is_null !== true || params.note === "") &&
      typeof params.created_at === "string" &&
      params.created_at.length > 0 &&
      typeof params.updated_at === "string" &&
      params.updated_at.length > 0 &&
      Number.isInteger(params.version) &&
      (params.version as number) >= 1
    );
  }
  if (op === "deleteDistraction") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putGoalDay") {
    const validParams = isEntityParams(params, {
      strings: ["id", "goal_id", "local_date", "created_at", "updated_at"],
      numbers: ["completed", "version"],
      booleans: [],
    });
    return validParams && (params.completed === 0 || params.completed === 1);
  }
  if (op === "deleteGoalDay") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "putMeasurement") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "type",
        "unit",
        "metric_name",
        "context",
        "measured_at",
        "note",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      finiteNumbers: ["value"],
      numberOrEmpty: ["secondary_value", "pulse_bpm"],
      booleans: [],
    });
    return validParams;
  }
  if (op === "putFood") {
    return isEntityParams(params, {
      strings: ["id", "name", "created_at", "updated_at", "deleted_at"],
      numbers: ["version"],
      numberOrEmpty: [
        "calories_per_100g",
        "protein_per_100g",
        "carbs_per_100g",
        "fat_per_100g",
        "fiber_per_100g",
        "serving_size_g",
      ],
      booleans: [],
    });
  }
  if (op === "putNutritionEntry") {
    return isEntityParams(params, {
      strings: [
        "id",
        "eaten_at",
        "food_id",
        "meal_slot_id",
        "label",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["version"],
      numberOrEmpty: ["amount_g", "calories", "protein_g", "carbs_g", "fat_g", "fiber_g"],
      booleans: [],
    });
  }
  if (op === "putRecipe") {
    const validParams = isEntityParams(params, {
      strings: ["id", "name", "ingredients_json", "created_at", "updated_at", "deleted_at"],
      numbers: ["version"],
      numberOrEmpty: ["servings"],
      booleans: [],
    });
    if (!validParams) {
      return false;
    }
    try {
      const ingredients: unknown = JSON.parse(String(params.ingredients_json));
      return (
        Array.isArray(ingredients) &&
        ingredients.every((ingredient, index) => {
          if (typeof ingredient !== "object" || ingredient === null || Array.isArray(ingredient)) {
            return false;
          }
          const row = ingredient as Record<string, unknown>;
          return (
            Object.keys(row).length === 3 &&
            typeof row.food_id === "string" &&
            row.food_id.trim().length > 0 &&
            !hasControlCharacters(row.food_id) &&
            (row.amount_g === null ||
              (typeof row.amount_g === "number" &&
                Number.isFinite(row.amount_g) &&
                row.amount_g > 0)) &&
            row.position === index
          );
        })
      );
    } catch {
      return false;
    }
  }
  if (op === "putSupplement") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "name",
        "dose_label",
        "unit",
        "schedule_json",
        "stock_unit",
        "stock_counted_at",
        "created_at",
        "updated_at",
        "deleted_at",
      ],
      numbers: ["version"],
      numberOrEmpty: ["amount", "stock_amount"],
      booleans: [],
    });
    if (!validParams) {
      return false;
    }
    const scheduleJson = String(params.schedule_json);
    if (scheduleJson === "") {
      return true;
    }
    try {
      const schedule: unknown = JSON.parse(scheduleJson);
      return (
        Array.isArray(schedule) &&
        schedule.length <= 12 &&
        schedule.every(
          (time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time),
        ) &&
        new Set(schedule).size === schedule.length
      );
    } catch {
      return false;
    }
  }
  if (op === "putSupplementLog") {
    const validParams = isEntityParams(params, {
      strings: [
        "id",
        "supplement_id",
        "status",
        "scheduled_at",
        "dose_unit",
        "taken_at",
        "created_at",
        "updated_at",
      ],
      numbers: ["version"],
      numberOrEmpty: ["dose_amount"],
      booleans: [],
    });
    return (
      validParams &&
      (params.status === "taken" || params.status === "skipped" || params.status === "pending")
    );
  }
  if (op === "deleteSupplementLog") {
    return isEntityParams(params, { strings: ["id"], numbers: [], booleans: [] });
  }
  if (op === "deleteEntity") {
    return isEntityParams(params, {
      strings: ["entity_type", "id"],
      numbers: [],
      booleans: [],
    });
  }
  return false;
}

export function isDbRequest(value: unknown): value is DbRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.requestId !== "string" || record.requestId.length === 0) {
    return false;
  }
  if (
    record.kind !== "ping" &&
    record.kind !== "open" &&
    record.kind !== "exec" &&
    record.kind !== "query" &&
    record.kind !== "close" &&
    record.kind !== "local-key" &&
    record.kind !== "migrate" &&
    record.kind !== "transaction" &&
    record.kind !== "restore"
  ) {
    return false;
  }
  if (record.kind === "local-key") {
    if (record.action === "lock") return true;
    return (
      record.action === "unlock" && record.key instanceof Uint8Array && record.key.byteLength === 32
    );
  }
  if (record.kind === "close") {
    return true;
  }
  // T076: atominen kirjoituserä — vain nimettyjä oppia, 1–64 kpl.
  if (record.kind === "transaction") {
    const ops: unknown = record.ops;
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > 64) {
      return false;
    }
    const terminalWrites: { readonly op: string; readonly index: number }[] = [];
    for (const [index, entry] of ops.entries()) {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }
      const candidate = entry as Record<string, unknown>;
      const params = candidate.params as
        Readonly<Record<string, string | number | boolean>> | undefined;
      if (
        candidate.op === "putSyncOperation" ||
        candidate.op === "putConflictRecord" ||
        candidate.op === "resolveConflictRecord"
      ) {
        terminalWrites.push({ op: candidate.op, index });
      }
      if (!isValidNamedOp(candidate.op, params)) {
        return false;
      }
    }
    if (
      terminalWrites.length === 1 &&
      terminalWrites[0]?.index === ops.length - 1 &&
      terminalWrites[0].op !== "resolveConflictRecord"
    ) {
      return true;
    }
    if (
      terminalWrites.length === 2 &&
      terminalWrites[0]?.op === "putSyncOperation" &&
      terminalWrites[0].index === ops.length - 2 &&
      terminalWrites[1]?.op === "resolveConflictRecord" &&
      terminalWrites[1].index === ops.length - 1
    ) {
      return true;
    }
    if (terminalWrites.length > 0) return false;
    return true;
  }
  if (record.kind === "restore") {
    const ops: unknown = record.ops;
    if (!Array.isArray(ops) || ops.length < 1 || ops.length > MAX_RESTORE_WRITE_OPS) {
      return false;
    }
    const allowedOps = new Set<DbRestoreWriteOp>([
      "putPreferences",
      "putHydrationEntry",
      "putSleepEntry",
      "putActivityEntry",
      "putMoodCheckin",
      "putJournalEntry",
      "putBreathingSession",
      "putReminder",
      "putNotificationState",
      "putQuest",
      "putQuestProgress",
      "putVaultReward",
      "putVaultRewardClaim",
      "putXpTransaction",
      "putLevelState",
      "putAchievement",
      "putCollectible",
      "putUserReward",
      "putProject",
      "putTag",
      "putTask",
      "putTaskChecklistItem",
      "putRoutine",
      "putRoutineStep",
      "putRoutineSchedule",
      "putRoutineRun",
      "putRoutineStepRun",
      "putCalendarBlock",
      "putFocusSession",
      "putDistraction",
      "putGoal",
      "putHabitRule",
      "putGoalDay",
      "putMeasurement",
      "putFood",
      "putNutritionEntry",
      "putRecipe",
      "putSupplement",
      "putSupplementLog",
    ]);
    for (const entry of ops) {
      if (typeof entry !== "object" || entry === null) return false;
      const candidate = entry as Record<string, unknown>;
      const params = candidate.params as
        Readonly<Record<string, string | number | boolean>> | undefined;
      if (
        typeof candidate.op !== "string" ||
        !allowedOps.has(candidate.op as DbRestoreWriteOp) ||
        !isValidNamedOp(candidate.op, params)
      ) {
        return false;
      }
    }
    return true;
  }
  if (record.kind === "migrate") {
    const target = record.targetVersion;
    return typeof target === "number" && Number.isInteger(target) && target >= 1;
  }
  if (record.kind === "exec") {
    const params = record.params as Readonly<Record<string, string | number | boolean>> | undefined;
    return (
      record.op !== "putSyncOperation" &&
      record.op !== "putConflictRecord" &&
      record.op !== "resolveConflictRecord" &&
      isValidNamedOp(record.op, params)
    );
  }
  if (record.kind === "query") {
    if (typeof record.op !== "string") {
      return false;
    }
    if (
      record.op !== "getMeta" &&
      record.op !== "listMetaKeys" &&
      record.op !== "integrityCheck" &&
      record.op !== "probeWrite" &&
      record.op !== "getSchemaVersion" &&
      record.op !== "getPreferences" &&
      record.op !== "getActiveInstallation" &&
      record.op !== "listInstallations" &&
      record.op !== "getSyncCursor" &&
      record.op !== "getHydrationEntry" &&
      record.op !== "listHydrationEntries" &&
      record.op !== "getSleepEntry" &&
      record.op !== "listSleepEntries" &&
      record.op !== "getActivityEntry" &&
      record.op !== "listActivityEntries" &&
      record.op !== "getMoodCheckin" &&
      record.op !== "listMoodCheckins" &&
      record.op !== "getJournalEntry" &&
      record.op !== "listJournalEntries" &&
      record.op !== "getBreathingSession" &&
      record.op !== "listBreathingSessions" &&
      record.op !== "getReminder" &&
      record.op !== "listReminders" &&
      record.op !== "getNotificationState" &&
      record.op !== "listNotificationStates" &&
      record.op !== "getQuest" &&
      record.op !== "listQuests" &&
      record.op !== "getQuestProgress" &&
      record.op !== "listQuestProgress" &&
      record.op !== "getVaultReward" &&
      record.op !== "listVaultRewards" &&
      record.op !== "getVaultRewardClaim" &&
      record.op !== "listVaultRewardClaims" &&
      record.op !== "getXpTransaction" &&
      record.op !== "listXpTransactions" &&
      record.op !== "getLevelState" &&
      record.op !== "listLevelStates" &&
      record.op !== "getAchievement" &&
      record.op !== "listAchievements" &&
      record.op !== "getAchievementRewardReference" &&
      record.op !== "getCollectible" &&
      record.op !== "listCollectibles" &&
      record.op !== "getCollectibleRewardReference" &&
      record.op !== "getUserReward" &&
      record.op !== "listUserRewards" &&
      record.op !== "getProject" &&
      record.op !== "listProjects" &&
      record.op !== "getTag" &&
      record.op !== "listTags" &&
      record.op !== "getTask" &&
      record.op !== "listTasks" &&
      record.op !== "listTaskTags" &&
      record.op !== "getTaskChecklistItem" &&
      record.op !== "listTaskChecklistItems" &&
      record.op !== "getRoutine" &&
      record.op !== "listRoutines" &&
      record.op !== "getRoutineStep" &&
      record.op !== "listRoutineSteps" &&
      record.op !== "getRoutineSchedule" &&
      record.op !== "listRoutineSchedules" &&
      record.op !== "getRoutineRun" &&
      record.op !== "listRoutineRuns" &&
      record.op !== "getRoutineStepRun" &&
      record.op !== "listRoutineStepRuns" &&
      record.op !== "getCalendarBlock" &&
      record.op !== "listCalendarBlocks" &&
      record.op !== "getFocusSession" &&
      record.op !== "listFocusSessions" &&
      record.op !== "getDistraction" &&
      record.op !== "listDistractions" &&
      record.op !== "getGoal" &&
      record.op !== "listGoals" &&
      record.op !== "getHabitRule" &&
      record.op !== "listHabitRules" &&
      record.op !== "getGoalDay" &&
      record.op !== "listGoalDays" &&
      record.op !== "getMeasurement" &&
      record.op !== "listMeasurements" &&
      record.op !== "getFood" &&
      record.op !== "listFoods" &&
      record.op !== "getNutritionEntry" &&
      record.op !== "listNutritionEntries" &&
      record.op !== "getRecipe" &&
      record.op !== "listRecipes" &&
      record.op !== "getSupplement" &&
      record.op !== "listSupplements" &&
      record.op !== "getSupplementLog" &&
      record.op !== "listSupplementLogs" &&
      record.op !== "getEntity" &&
      record.op !== "listEntities" &&
      record.op !== "listSyncOperations" &&
      record.op !== "listConflictRecords"
    ) {
      return false;
    }
    if (record.op === "getEntity") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const entityType: unknown = (params as { entity_type?: unknown }).entity_type;
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof entityType !== "string" || typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getSyncCursor") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null || Array.isArray(params)) return false;
      const entries = Object.entries(params as Record<string, unknown>);
      const installationId = (params as { installation_id?: unknown }).installation_id;
      const providerId = (params as { provider_id?: unknown }).provider_id;
      return (
        entries.length === 2 &&
        typeof installationId === "string" &&
        installationId.length > 0 &&
        installationId.length <= 128 &&
        typeof providerId === "string" &&
        providerId.length > 0 &&
        providerId.length <= 128
      );
    }
    if (record.op === "listTaskTags") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null || Array.isArray(params)) {
        return false;
      }
      const entries = Object.entries(params as Record<string, unknown>);
      return (
        entries.length <= 1 &&
        (entries.length === 0 ||
          (entries[0]?.[0] === "task_id" && typeof entries[0][1] === "string"))
      );
    }
    if (record.op === "listSyncOperations") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listConflictRecords") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listTaskChecklistItems") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listRoutines") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listRoutineSteps") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listRoutineSchedules") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listRoutineRuns") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listRoutineStepRuns") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listCalendarBlocks") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listFocusSessions" || record.op === "listDistractions") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (record.op === "listHabitRules") {
      const params: unknown = (record as { params?: unknown }).params;
      return (
        typeof params === "object" &&
        params !== null &&
        !Array.isArray(params) &&
        Object.keys(params).length === 0
      );
    }
    if (
      record.op === "getHydrationEntry" ||
      record.op === "getSleepEntry" ||
      record.op === "getActivityEntry" ||
      record.op === "getMoodCheckin" ||
      record.op === "getJournalEntry" ||
      record.op === "getBreathingSession" ||
      record.op === "getReminder" ||
      record.op === "getNotificationState" ||
      record.op === "getQuest" ||
      record.op === "getQuestProgress" ||
      record.op === "getVaultReward" ||
      record.op === "getVaultRewardClaim" ||
      record.op === "getXpTransaction" ||
      record.op === "getLevelState" ||
      record.op === "getAchievement" ||
      record.op === "getAchievementRewardReference" ||
      record.op === "getCollectible" ||
      record.op === "getCollectibleRewardReference" ||
      record.op === "getUserReward" ||
      record.op === "getProject" ||
      record.op === "getTag" ||
      record.op === "getTask" ||
      record.op === "getTaskChecklistItem" ||
      record.op === "getRoutine" ||
      record.op === "getRoutineStep" ||
      record.op === "getRoutineSchedule" ||
      record.op === "getRoutineRun" ||
      record.op === "getRoutineStepRun" ||
      record.op === "getCalendarBlock" ||
      record.op === "getFocusSession" ||
      record.op === "getDistraction"
    ) {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getGoal" || record.op === "getHabitRule" || record.op === "getGoalDay") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getMeasurement") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getFood") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getNutritionEntry") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getRecipe") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "getSupplement" || record.op === "getSupplementLog") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const id: unknown = (params as { id?: unknown }).id;
      if (typeof id !== "string") {
        return false;
      }
    }
    if (record.op === "listEntities") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const entityType: unknown = (params as { entity_type?: unknown }).entity_type;
      if (typeof entityType !== "string") {
        return false;
      }
    }
    if (record.op === "getMeta") {
      const params: unknown = (record as { params?: unknown }).params;
      if (typeof params !== "object" || params === null) {
        return false;
      }
      const key: unknown = (params as { key?: unknown }).key;
      if (typeof key !== "string") {
        return false;
      }
    }
    return true;
  }
  return true;
}

export function isDbResponse(value: unknown): value is DbResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.requestId === "string" && typeof record.ok === "boolean";
}
