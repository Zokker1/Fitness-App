import { hasControlCharacters } from "./text-validation.ts";
// T030: db-worker. Ainoa moduuli joka importoi @sqlite.org/sqlite-wasm ja
// koskee OPFS:ään. Ajo Web Workerissa (Vite ?worker), ei pääsäikeessä.
// WebWorker-lib ja self/MessageEvent-viittaukset on eristetty tähän
// tiedostoon: muu data-koodi on alustariippumatonta.
// T031: worker omistaa migraatiorunnerin — skeema syntyy VAIN versionoidusta
// ketjusta (migrations.ts), ei ad-hoc-DDL:ää. open() ei luo tauluja; se vain
// avaa yhteyden ja asettaa foreign_keys=ON. database.ts ajaa open→migrate→
// integrity-järjestyksen (§49: failure ei jätä puolikasta tilaa).
//
// Käynnistysjärjestys:
// 1. initWasm (locateFile -> same-origin sqlite3.wasm, Vite ?url).
// 2. installOpfsSAHPoolVfs (ei COOP/COEP-vaatimusta, ADR-001; T039-mittaus:
//    sahpool EI käytä SAB:a — sync on suora file.sah.flush(). SAB puuttuu
//    tarkoituksella ilman COOP/COEP:a eikä estä persistenssiä. Uusi sivu
//    voi silti törmätä toisen kontekstin SAH-lukkoon.
//    Onnistuu -> backend opfs-sahpool, persisted=true.
//    Epäonnistuu (toinen tabi/sivu lukitsee poolin / ei OPFS-tukea) ->
//    tunnistettu lukkokilpa palautuu storage-unavailable-virheenä, jotta
//    käyttäjän kirjoitukset eivät näytä onnistuvan vain tilapäisessä muistissa.
//    Muut OPFS-kyvyttömyydet voivat käyttää diagnostiikassa näkyvää fallbackia.
//
// T039-ARKKITEHTUURIHUOMIO (mitattu selaimessa): poolin SAH-lukot ovat
// sivukohtaisia. Kun sivu suljetaan ja uusi avataan samaan kontekstiin
// nopeasti perään, uuden sivun acquireAccessHandles voi kilpailla vanhan
// roikkuvan lukon kanssa — createSyncAccessHandle heittää, poolin init
// epäonnistuu. Monivälilehtitilanteessa tunnistettu lukkokilpa palautetaan
// virheenä eikä sitä peitetä muistikirjoituksiksi. E2E sulkee kannan
// eksplisiittisesti ennen sivun sulkemista (close-pyyntö vapauttaa SAHit;
// ks. database.ts closeDatabase). Avaus yrittää 3× kasvavalla odotuksella.
// Täysi monitab-jako (lukituskoordinaatio) on edelleen avoin.
// 3. open luo app-taulut (T031 tuo täyden migraatiorunnerin; tässä minimi
//    meta-taulu jotta T030 todistaa kirjoitus+lukupolun). Transaktiot eivät
//    kuulu T030-protokollaan: T032:n UnitOfWork tuo BEGIN/COMMIT/ROLLBACKin
//    erillisenä, testattuna operaationa workerin omistamalla SQL:llä.
//
// Turvallisuus: worker ei koske verkkoon/Domainiin/UI:hin; viestit
// validoidaan isDbRequestillä; tuntematon op -> invalid-input.

import type {
  DbBackend,
  DbFailureResponse,
  DbRequest,
  DbRestoreWrite,
  DbRestoreWriteOp,
  DbResponse,
  DbSuccessResponse,
} from "./sqliteProtocol.ts";
import { isDbRequest, isValidLocalDateKeyValue } from "./sqliteProtocol.ts";
import { decryptLocalContent, encryptLocalContent } from "./local-content-crypto.ts";
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  pendingMigrations,
  validateMigrationChain,
} from "./migrations.ts";

type SqliteDb = {
  exec(
    sql: string,
    options?: { bind?: unknown; rowMode?: string; resultRows?: unknown[] },
  ): unknown;
  close(): void;
  filename?: string;
  /**
   * T038: sahpoolin checkpoint. Poolin xOpen sitoo polun SAH-headeriin;
   * WAL-tilassa sivuja voi jäädä -wal-virtuaalitiedostoon joka ei kantaudu
   * uudelle workerille. passive-checkpoint pakottaa sivut pääkantaan
   * (best-effort: ei kaada sulkua jos VFS ei tue sitä).
   */
  checkpoint?: (mode?: string) => void;
};

/** True when an installation has been revoked in this profile's metadata table. */
export function isSyncInstallationRevoked(
  database: Pick<SqliteDb, "exec">,
  installationId: string,
  occurredAt?: string,
): boolean {
  const rows: Record<string, unknown>[] = [];
  database.exec(
    "SELECT revoked_at, is_local FROM browser_installations WHERE installation_id = ? LIMIT 1;",
    { bind: [installationId], rowMode: "object", resultRows: rows },
  );
  const row = rows[0];
  if (typeof row?.revoked_at !== "string" || row.revoked_at.length === 0) return false;
  if (row.is_local === 1 || occurredAt === undefined) return true;
  const occurredAtMs = Date.parse(occurredAt);
  const revokedAtMs = Date.parse(row.revoked_at);
  return (
    !Number.isFinite(occurredAtMs) || !Number.isFinite(revokedAtMs) || occurredAtMs >= revokedAtMs
  );
}

type SqliteStatic = {
  oo1: {
    DB: new (filename?: string, flags?: string) => SqliteDb;
    OpfsDb?: new (filename: string, flags?: string) => SqliteDb;
  };
  opfs?: {
    installOpfsVfs?: (options?: unknown) => Promise<unknown>;
  };
  installOpfsSAHPoolVfs?: (options?: {
    name?: string;
    directory?: string;
    initialCapacity?: number;
    forceReinitIfPreviouslyFailed?: boolean;
  }) => Promise<{
    OpfsSAHPoolDb: new (filename: string) => SqliteDb;
    getCapacity?: () => number;
    getFileCount?: () => number;
    getFileNames?: () => string[];
    pauseVfs?: () => void;
    unpauseVfs?: () => Promise<unknown>;
  }>;
};

type PoolDiagnostics = {
  readonly capacity: number | null;
  readonly fileCount: number | null;
  readonly fileNames: readonly string[];
};

let poolDiagnostics: PoolDiagnostics = { capacity: null, fileCount: null, fileNames: [] };

let sqlite3: SqliteStatic | null = null;
let db: SqliteDb | null = null;
let backend: DbBackend = "memory";
let persisted = false;
let sqliteWasmUrl: string | null = null;
let initError: string | null = null;
let localContentKey: Uint8Array | null = null;
const LOCAL_CONTENT_META_KEY = "local-content-encryption-v1";
const LOCAL_CONTENT_KEY_CHECK_META_KEY = "local-content-key-check-v1";
const LOCAL_CONTENT_KEY_CHECK_TEXT = "lifeos-local-content-key-check:v1";
const PRIVATE_PAYLOAD_PARAM = "_local_private_payload";

interface PrivateRecordSpec {
  readonly op: string;
  readonly recordType: string;
  readonly fields: readonly string[];
  readonly nullableFields?: readonly string[];
  readonly virtualFields?: readonly string[];
  readonly uniquePlaceholderFields?: readonly string[];
  readonly placeholders: Readonly<Record<string, string | number | boolean>>;
}

const PRIVATE_RECORD_SPECS: readonly PrivateRecordSpec[] = [
  {
    op: "putPreferences",
    recordType: "user_preferences",
    fields: [
      "weight_target",
      "height_cm",
      "meal_slots",
      "macro_targets",
      "hydration_target_ml",
      "hydration_reminder_time",
      "notification_categories",
    ],
    nullableFields: [
      "weight_target",
      "height_cm",
      "hydration_target_ml",
      "hydration_reminder_time",
    ],
    placeholders: {
      weight_target: "",
      height_cm: "",
      meal_slots: "[]",
      macro_targets:
        '{"caloriesKcal":null,"proteinG":null,"carbsG":null,"fatG":null,"fiberG":null}',
      hydration_target_ml: "",
      hydration_reminder_time: "",
      notification_categories: "{}",
    },
  },
  {
    op: "putProject",
    recordType: "projects",
    fields: ["name"],
    placeholders: { name: "Private project" },
  },
  {
    op: "putTag",
    recordType: "tags",
    fields: ["name"],
    uniquePlaceholderFields: ["name"],
    placeholders: { name: "Private tag" },
  },
  {
    op: "putTask",
    recordType: "tasks",
    fields: ["title", "notes", "due_at", "completed_at", "reopened_at"],
    nullableFields: ["notes", "due_at", "completed_at", "reopened_at"],
    placeholders: {
      title: "Private task",
      notes: "",
      due_at: "",
      completed_at: "",
      reopened_at: "",
    },
  },
  {
    op: "putTaskChecklistItem",
    recordType: "task_checklist_items",
    fields: ["title"],
    placeholders: { title: "Private checklist item" },
  },
  {
    op: "putCalendarBlock",
    recordType: "calendar_blocks",
    fields: ["title"],
    placeholders: { title: "Private calendar block" },
  },
  {
    op: "putRoutine",
    recordType: "routines",
    fields: ["title"],
    placeholders: { title: "Private routine" },
  },
  {
    op: "putRoutineStep",
    recordType: "routine_steps",
    fields: ["title"],
    placeholders: { title: "Private routine step" },
  },
  {
    op: "putRoutineRun",
    recordType: "routine_runs",
    fields: ["skip_reason", "skip_reason_is_null"],
    nullableFields: ["skip_reason"],
    virtualFields: ["skip_reason_is_null"],
    placeholders: { skip_reason: "Private reason", skip_reason_is_null: false },
  },
  {
    op: "putRoutineStepRun",
    recordType: "routine_step_runs",
    fields: ["skip_reason", "skip_reason_is_null"],
    nullableFields: ["skip_reason"],
    virtualFields: ["skip_reason_is_null"],
    placeholders: { skip_reason: "Private reason", skip_reason_is_null: false },
  },
  {
    op: "putGoal",
    recordType: "goals",
    fields: ["title", "description"],
    nullableFields: ["description"],
    placeholders: { title: "Private goal", description: "" },
  },
  {
    op: "putHabitRule",
    recordType: "habit_rules",
    fields: ["title"],
    placeholders: { title: "Private habit rule" },
  },
  {
    op: "putDistraction",
    recordType: "distractions",
    fields: ["note"],
    nullableFields: ["note"],
    placeholders: { note: "" },
  },
  {
    op: "putReminder",
    recordType: "reminders",
    fields: ["title"],
    placeholders: { title: "Private reminder" },
  },
  {
    op: "putVaultReward",
    recordType: "vault_rewards",
    fields: ["title", "note"],
    nullableFields: ["note"],
    placeholders: { title: "Private reward", note: "" },
  },
  {
    op: "putBreathingSession",
    recordType: "breathing_sessions",
    fields: ["pattern_key"],
    placeholders: { pattern_key: "private-pattern" },
  },
  {
    op: "putRecipe",
    recordType: "recipes",
    fields: ["name", "servings", "ingredients_json"],
    nullableFields: ["servings"],
    virtualFields: ["ingredients_json"],
    placeholders: { name: "Private recipe", servings: "", ingredients_json: "[]" },
  },
  {
    op: "putHydrationEntry",
    recordType: "hydration_entries",
    fields: ["milliliters"],
    placeholders: { milliliters: 0 },
  },
  {
    op: "putSleepEntry",
    recordType: "sleep_entries",
    fields: ["quality", "is_nap"],
    nullableFields: ["quality"],
    placeholders: { quality: "", is_nap: 0 },
  },
  {
    op: "putActivityEntry",
    recordType: "activity_entries",
    fields: ["kind", "duration_seconds", "distance_meters", "note"],
    nullableFields: ["duration_seconds", "distance_meters", "note"],
    placeholders: { kind: "Activity", duration_seconds: "", distance_meters: "", note: "" },
  },
  {
    op: "putMoodCheckin",
    recordType: "mood_checkins",
    fields: ["mood", "stress", "energy", "motivation", "focus", "note"],
    nullableFields: ["stress", "energy", "motivation", "focus", "note"],
    placeholders: { mood: 3, stress: "", energy: "", motivation: "", focus: "", note: "" },
  },
  {
    op: "putJournalEntry",
    recordType: "journal_entries",
    fields: [
      "title",
      "title_is_null",
      "body",
      "reflection_success",
      "reflection_difficult",
      "reflection_tomorrow",
    ],
    nullableFields: ["title", "reflection_success", "reflection_difficult", "reflection_tomorrow"],
    placeholders: {
      title: "",
      title_is_null: true,
      body: "Private entry",
      reflection_success: "",
      reflection_difficult: "",
      reflection_tomorrow: "",
    },
  },
  {
    op: "putMeasurement",
    recordType: "measurements",
    fields: [
      "type",
      "value",
      "secondary_value",
      "unit",
      "metric_name",
      "pulse_bpm",
      "context",
      "note",
    ],
    nullableFields: ["secondary_value", "metric_name", "pulse_bpm", "context", "note"],
    placeholders: {
      type: "custom",
      value: 0,
      secondary_value: "",
      unit: "private",
      metric_name: "",
      pulse_bpm: "",
      context: "",
      note: "",
    },
  },
  {
    op: "putFood",
    recordType: "foods",
    fields: [
      "name",
      "calories_per_100g",
      "protein_per_100g",
      "carbs_per_100g",
      "fat_per_100g",
      "fiber_per_100g",
      "serving_size_g",
    ],
    nullableFields: [
      "calories_per_100g",
      "protein_per_100g",
      "carbs_per_100g",
      "fat_per_100g",
      "fiber_per_100g",
      "serving_size_g",
    ],
    placeholders: {
      name: "Private food",
      calories_per_100g: "",
      protein_per_100g: "",
      carbs_per_100g: "",
      fat_per_100g: "",
      fiber_per_100g: "",
      serving_size_g: "",
    },
  },
  {
    op: "putNutritionEntry",
    recordType: "nutrition_entries",
    fields: [
      "food_id",
      "amount_g",
      "meal_slot_id",
      "label",
      "calories",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
    ],
    nullableFields: [
      "food_id",
      "amount_g",
      "meal_slot_id",
      "calories",
      "protein_g",
      "carbs_g",
      "fat_g",
      "fiber_g",
    ],
    placeholders: {
      food_id: "",
      amount_g: "",
      meal_slot_id: "",
      label: "Private meal",
      calories: "",
      protein_g: "",
      carbs_g: "",
      fat_g: "",
      fiber_g: "",
    },
  },
  {
    op: "putSupplement",
    recordType: "supplements",
    fields: [
      "name",
      "dose_label",
      "amount",
      "unit",
      "schedule_json",
      "stock_amount",
      "stock_unit",
      "stock_counted_at",
    ],
    nullableFields: [
      "dose_label",
      "amount",
      "unit",
      "schedule_json",
      "stock_amount",
      "stock_unit",
      "stock_counted_at",
    ],
    placeholders: {
      name: "Private supplement",
      dose_label: "",
      amount: "",
      unit: "",
      schedule_json: "",
      stock_amount: "",
      stock_unit: "",
      stock_counted_at: "",
    },
  },
  {
    op: "putSupplementLog",
    recordType: "supplement_logs",
    fields: ["status", "scheduled_at", "dose_amount", "dose_unit", "taken_at"],
    nullableFields: ["scheduled_at", "dose_amount", "dose_unit", "taken_at"],
    placeholders: {
      status: "pending",
      scheduled_at: "",
      dose_amount: "",
      dose_unit: "",
      taken_at: "",
    },
  },
];

function privatePlaceholder(
  spec: PrivateRecordSpec,
  field: string,
  recordId: string,
): string | number | boolean {
  const value = spec.placeholders[field];
  if (value === undefined) throw new Error("local-content.private-placeholder.missing");
  if (spec.uniquePlaceholderFields?.includes(field) && typeof value === "string") {
    const suffix = recordId.replace(/[^A-Za-z0-9_-]/gu, "").slice(-8) || "record";
    return `${value} ${suffix}`;
  }
  return value;
}

interface LocalContentEnvelope {
  readonly format: "lifeos-private-record";
  readonly version: 1;
  readonly ciphertext: string;
}

function parseLocalContentEnvelope(value: unknown): LocalContentEnvelope | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      (parsed as Record<string, unknown>).format === "lifeos-private-record" &&
      (parsed as Record<string, unknown>).version === 1 &&
      typeof (parsed as Record<string, unknown>).ciphertext === "string"
    ) {
      return parsed as LocalContentEnvelope;
    }
  } catch {
    // The row is still a legacy plaintext JSON document.
  }
  return null;
}

function localContentEncryptionEnabled(active: SqliteDb): boolean {
  const metadataTable: Record<string, unknown>[] = [];
  active.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_lifeos_meta' LIMIT 1;",
    { rowMode: "object", resultRows: metadataTable },
  );
  if (metadataTable.length === 0) return false;

  const rows: Record<string, unknown>[] = [];
  active.exec("SELECT value FROM _lifeos_meta WHERE key = ? LIMIT 1;", {
    bind: [LOCAL_CONTENT_META_KEY],
    rowMode: "object",
    resultRows: rows,
  });
  return rows[0]?.value === "1";
}

function protectEntityDocument(
  entityType: string,
  id: string,
  document: string,
  key: Uint8Array,
): string {
  const existingEnvelope = parseLocalContentEnvelope(document);
  if (existingEnvelope !== null) {
    try {
      decryptLocalContent(existingEnvelope.ciphertext, key, {
        recordType: "entity-doc",
        recordId: `${entityType}:${id}`,
        field: "document",
      });
      return document;
    } catch {
      // Treat an invalid wrapper-shaped user document as ordinary cleartext.
    }
  }
  const ciphertext = encryptLocalContent(document, key, {
    recordType: "entity-doc",
    recordId: `${entityType}:${id}`,
    field: "document",
  });
  return JSON.stringify({ format: "lifeos-private-record", version: 1, ciphertext });
}

function revealEntityDocument(
  entityType: string,
  id: string,
  document: string,
  key: Uint8Array,
): string {
  const envelope = parseLocalContentEnvelope(document);
  if (envelope === null) return document;
  return decryptLocalContent(envelope.ciphertext, key, {
    recordType: "entity-doc",
    recordId: `${entityType}:${id}`,
    field: "document",
  });
}

export function migrateEntityDocumentsToEncryption(active: SqliteDb, key: Uint8Array): void {
  const rows: Record<string, unknown>[] = [];
  active.exec("SELECT entity_type, id, doc FROM entity_docs ORDER BY entity_type, id;", {
    rowMode: "object",
    resultRows: rows,
  });
  const protectedDocs: { entityType: string; id: string; document: string }[] = [];
  for (const row of rows) {
    if (
      typeof row.entity_type !== "string" ||
      typeof row.id !== "string" ||
      typeof row.doc !== "string"
    ) {
      throw new Error("local-content.entity-doc.invalid-row");
    }
    const existingEnvelope = parseLocalContentEnvelope(row.doc);
    if (existingEnvelope !== null) {
      try {
        decryptLocalContent(existingEnvelope.ciphertext, key, {
          recordType: "entity-doc",
          recordId: `${row.entity_type}:${row.id}`,
          field: "document",
        });
        continue;
      } catch {
        // A legacy document can coincidentally resemble an envelope wrapper.
      }
    }
    protectedDocs.push({
      entityType: row.entity_type,
      id: row.id,
      document: protectEntityDocument(row.entity_type, row.id, row.doc, key),
    });
  }
  const privateRecords: {
    readonly spec: PrivateRecordSpec;
    readonly id: string;
    readonly encryptedPayload: string;
    readonly placeholders: Readonly<Record<string, string | number | boolean>>;
  }[] = [];
  for (const spec of PRIVATE_RECORD_SPECS) {
    const privateRows: Record<string, unknown>[] = [];
    active.exec(`SELECT * FROM ${spec.recordType} ORDER BY id;`, {
      rowMode: "object",
      resultRows: privateRows,
    });
    for (const row of privateRows) {
      if (typeof row.id !== "string") throw new Error("local-content.private-row.invalid-id");
      const existing: Record<string, unknown>[] = [];
      active.exec(
        "SELECT record_id FROM local_private_records WHERE record_type = ? AND record_id = ? LIMIT 1;",
        { bind: [spec.recordType, row.id], rowMode: "object", resultRows: existing },
      );
      if (existing.length > 0) continue;
      const payload: Record<string, unknown> = {};
      for (const field of spec.fields) {
        if (field.endsWith("_is_null")) {
          payload[field] = row[field.slice(0, -8)] === null;
        } else if (spec.recordType === "recipes" && field === "ingredients_json") {
          const ingredients: Record<string, unknown>[] = [];
          active.exec(
            "SELECT food_id, amount_g, position FROM recipe_foods WHERE recipe_id = ? ORDER BY position;",
            { bind: [row.id], rowMode: "object", resultRows: ingredients },
          );
          payload[field] = JSON.stringify(ingredients);
        } else {
          payload[field] = row[field];
        }
      }
      const plaintext = JSON.stringify(payload);
      const encryptedPayload = encryptLocalContent(plaintext, key, {
        recordType: spec.recordType,
        recordId: row.id,
        field: "payload",
      });
      privateRecords.push({
        spec,
        id: row.id,
        encryptedPayload,
        placeholders: Object.fromEntries(
          Object.keys(spec.placeholders).map((field) => [
            field,
            privatePlaceholder(spec, field, row.id as string),
          ]),
        ),
      });
    }
  }
  active.exec("BEGIN;");
  try {
    for (const item of protectedDocs) {
      active.exec("UPDATE entity_docs SET doc = ? WHERE entity_type = ? AND id = ?;", {
        bind: [item.document, item.entityType, item.id],
      });
    }
    for (const record of privateRecords) {
      const columns = Object.keys(record.placeholders).filter(
        (field) => field !== "title_is_null" && !record.spec.virtualFields?.includes(field),
      );
      if (columns.length > 0) {
        const nullColumns = new Set(
          columns.filter(
            (field) =>
              record.spec.nullableFields?.includes(field) && record.placeholders[field] === "",
          ),
        );
        const assignments = columns.map((field) =>
          nullColumns.has(field) ? `${field} = NULL` : `${field} = ?`,
        );
        active.exec(
          `UPDATE ${record.spec.recordType} SET ${assignments.join(", ")} WHERE id = ?;`,
          {
            bind: [
              ...columns
                .filter((field) => !nullColumns.has(field))
                .map((field) => record.placeholders[field]),
              record.id,
            ],
          },
        );
      }
      active.exec(
        `INSERT INTO local_private_records (record_type, record_id, payload) VALUES (?, ?, ?)
         ON CONFLICT(record_type, record_id) DO UPDATE SET payload = excluded.payload;`,
        { bind: [record.spec.recordType, record.id, record.encryptedPayload] },
      );
      if (record.spec.recordType === "recipes") {
        active.exec("DELETE FROM recipe_foods WHERE recipe_id = ?;", { bind: [record.id] });
      }
    }
    active.exec(
      "INSERT INTO _lifeos_meta (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = '1';",
      { bind: [LOCAL_CONTENT_META_KEY] },
    );
    active.exec(
      "INSERT INTO _lifeos_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
      {
        bind: [
          LOCAL_CONTENT_KEY_CHECK_META_KEY,
          encryptLocalContent(LOCAL_CONTENT_KEY_CHECK_TEXT, key, {
            recordType: "key-check",
            recordId: "local-content",
            field: "value",
          }),
        ],
      },
    );
    active.exec("COMMIT;");
  } catch (error) {
    try {
      active.exec("ROLLBACK;");
    } catch {
      // Keep the original migration error.
    }
    throw error;
  }
}

export function validateOrWriteLocalContentKeyCheck(active: SqliteDb, key: Uint8Array): boolean {
  const checks: Record<string, unknown>[] = [];
  active.exec("SELECT value FROM _lifeos_meta WHERE key = ? LIMIT 1;", {
    bind: [LOCAL_CONTENT_KEY_CHECK_META_KEY],
    rowMode: "object",
    resultRows: checks,
  });
  const storedCheck = checks[0]?.value;
  if (typeof storedCheck === "string") {
    try {
      if (
        decryptLocalContent(storedCheck, key, {
          recordType: "key-check",
          recordId: "local-content",
          field: "value",
        }) !== LOCAL_CONTENT_KEY_CHECK_TEXT
      ) {
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }

  // Older in-development encrypted stores may predate the key-check marker.
  // Validate against one existing ciphertext before installing the marker.
  const docs: Record<string, unknown>[] = [];
  active.exec("SELECT entity_type, id, doc FROM entity_docs ORDER BY entity_type, id LIMIT 1;", {
    rowMode: "object",
    resultRows: docs,
  });
  const firstDoc = docs[0];
  const docEnvelope = parseLocalContentEnvelope(firstDoc?.doc);
  if (
    docEnvelope !== null &&
    typeof firstDoc?.entity_type === "string" &&
    typeof firstDoc.id === "string"
  ) {
    try {
      decryptLocalContent(docEnvelope.ciphertext, key, {
        recordType: "entity-doc",
        recordId: `${firstDoc.entity_type}:${firstDoc.id}`,
        field: "document",
      });
    } catch {
      return false;
    }
  } else {
    const records: Record<string, unknown>[] = [];
    active.exec(
      "SELECT record_type, record_id, payload FROM local_private_records ORDER BY record_type, record_id LIMIT 1;",
      {
        rowMode: "object",
        resultRows: records,
      },
    );
    const firstRecord = records[0];
    if (
      typeof firstRecord?.record_type === "string" &&
      typeof firstRecord.record_id === "string" &&
      typeof firstRecord.payload === "string"
    ) {
      try {
        decryptLocalContent(firstRecord.payload, key, {
          recordType: firstRecord.record_type,
          recordId: firstRecord.record_id,
          field: "payload",
        });
      } catch {
        return false;
      }
    }
  }

  try {
    active.exec("BEGIN;");
    active.exec(
      "INSERT INTO _lifeos_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;",
      {
        bind: [
          LOCAL_CONTENT_KEY_CHECK_META_KEY,
          encryptLocalContent(LOCAL_CONTENT_KEY_CHECK_TEXT, key, {
            recordType: "key-check",
            recordId: "local-content",
            field: "value",
          }),
        ],
      },
    );
    active.exec("COMMIT;");
    return true;
  } catch {
    try {
      active.exec("ROLLBACK;");
    } catch {
      // Preserve the failed marker update as a false validation result.
    }
    return false;
  }
}

export function activateLocalContentKey(active: SqliteDb, key: Uint8Array): boolean {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) return false;
  if (!localContentEncryptionEnabled(active)) {
    migrateEntityDocumentsToEncryption(active, key);
  } else if (!validateOrWriteLocalContentKeyCheck(active, key)) {
    return false;
  }
  localContentKey?.fill(0);
  localContentKey = new Uint8Array(key);
  return true;
}

export function lockLocalContentKey(): void {
  localContentKey?.fill(0);
  localContentKey = null;
}

export function isPrivateWrite(op: string): boolean {
  return (
    op === "putEntity" ||
    op === "deleteEntity" ||
    PRIVATE_RECORD_SPECS.some((spec) => spec.op === op) ||
    op === "deleteHydrationEntry" ||
    op === "deleteMoodCheckin" ||
    op === "deleteSupplementLog" ||
    op === "deleteRoutineRun"
  );
}

export function isPrivateQuery(op: string): boolean {
  return (
    op === "getPreferences" ||
    op === "getProject" ||
    op === "listProjects" ||
    op === "getTag" ||
    op === "listTags" ||
    op === "getTask" ||
    op === "listTasks" ||
    op === "getTaskChecklistItem" ||
    op === "listTaskChecklistItems" ||
    op === "getCalendarBlock" ||
    op === "listCalendarBlocks" ||
    op === "getRoutine" ||
    op === "listRoutines" ||
    op === "getRoutineStep" ||
    op === "listRoutineSteps" ||
    op === "getRoutineRun" ||
    op === "listRoutineRuns" ||
    op === "getRoutineStepRun" ||
    op === "listRoutineStepRuns" ||
    op === "getGoal" ||
    op === "listGoals" ||
    op === "getHabitRule" ||
    op === "listHabitRules" ||
    op === "getDistraction" ||
    op === "listDistractions" ||
    op === "getReminder" ||
    op === "listReminders" ||
    op === "getVaultReward" ||
    op === "listVaultRewards" ||
    op === "getBreathingSession" ||
    op === "listBreathingSessions" ||
    op === "getRecipe" ||
    op === "listRecipes" ||
    op === "getEntity" ||
    op === "listEntities" ||
    op === "getHydrationEntry" ||
    op === "listHydrationEntries" ||
    op === "getSleepEntry" ||
    op === "listSleepEntries" ||
    op === "getActivityEntry" ||
    op === "listActivityEntries" ||
    op === "getJournalEntry" ||
    op === "listJournalEntries" ||
    op === "getMoodCheckin" ||
    op === "listMoodCheckins" ||
    op === "getMeasurement" ||
    op === "listMeasurements" ||
    op === "getFood" ||
    op === "listFoods" ||
    op === "getNutritionEntry" ||
    op === "listNutritionEntries" ||
    op === "getSupplement" ||
    op === "listSupplements" ||
    op === "getSupplementLog" ||
    op === "listSupplementLogs"
  );
}

export function protectNamedWrite(
  active: SqliteDb,
  op: string,
  params: Readonly<Record<string, string | number | boolean>>,
): Readonly<Record<string, string | number | boolean>> {
  if (!isPrivateWrite(op) || !localContentEncryptionEnabled(active)) return params;
  const key = localContentKey;
  if (key === null) throw new Error("local-content-locked");
  if (op === "putEntity") {
    if (
      typeof params.entity_type !== "string" ||
      typeof params.id !== "string" ||
      typeof params.doc !== "string"
    ) {
      throw new Error("local-content.entity-doc.invalid-write");
    }
    return {
      ...params,
      doc: protectEntityDocument(params.entity_type, params.id, params.doc, key),
    };
  }
  const spec = PRIVATE_RECORD_SPECS.find((candidate) => candidate.op === op);
  if (spec === undefined || typeof params.id !== "string") return params;
  const payload: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const value = params[field];
    payload[field] = spec.nullableFields?.includes(field) && value === "" ? null : value;
  }
  const encryptedPayload = encryptLocalContent(JSON.stringify(payload), key, {
    recordType: spec.recordType,
    recordId: params.id,
    field: "payload",
  });
  const nullFlags = Object.fromEntries(
    (spec.nullableFields ?? [])
      .map((field) => [`${field}_is_null`, params[`${field}_is_null`]] as const)
      .filter(
        ([flag, value]) =>
          spec.placeholders[flag.slice(0, -8)] === "" && typeof value === "boolean",
      )
      .map(([flag]) => [flag, true]),
  );
  return {
    ...params,
    ...nullFlags,
    ...Object.fromEntries(
      Object.keys(spec.placeholders).map((field) => [
        field,
        privatePlaceholder(spec, field, params.id as string),
      ]),
    ),
    [PRIVATE_PAYLOAD_PARAM]: encryptedPayload,
  };
}

export function persistPrivateWrite(
  active: SqliteDb,
  op: string,
  params: Readonly<Record<string, string | number | boolean>>,
): void {
  const spec = PRIVATE_RECORD_SPECS.find((candidate) => candidate.op === op);
  const payload = params[PRIVATE_PAYLOAD_PARAM];
  if (spec === undefined || typeof params.id !== "string" || typeof payload !== "string") return;
  active.exec(
    `INSERT INTO local_private_records (record_type, record_id, payload) VALUES (?, ?, ?)
     ON CONFLICT(record_type, record_id) DO UPDATE SET payload = excluded.payload;`,
    { bind: [spec.recordType, params.id, payload] },
  );
}

function cleanupDeletedPrivateRecord(
  active: SqliteDb,
  op: string,
  params: Readonly<Record<string, string | number | boolean>>,
): void {
  const recordType =
    op === "deleteRoutineRun"
      ? "routine_runs"
      : op === "deleteHydrationEntry"
        ? "hydration_entries"
        : op === "deleteMoodCheckin"
          ? "mood_checkins"
          : op === "deleteSupplementLog"
            ? "supplement_logs"
            : null;
  const id = params.id;
  if (recordType === null || typeof id !== "string") return;
  active.exec("DELETE FROM local_private_records WHERE record_type = ? AND record_id = ?;", {
    bind: [recordType, id],
  });
}

const PRIVATE_QUERY_RECORD_TYPES: Readonly<Record<string, string>> = {
  getPreferences: "user_preferences",
  getProject: "projects",
  listProjects: "projects",
  getTag: "tags",
  listTags: "tags",
  getTask: "tasks",
  listTasks: "tasks",
  getTaskChecklistItem: "task_checklist_items",
  listTaskChecklistItems: "task_checklist_items",
  getCalendarBlock: "calendar_blocks",
  listCalendarBlocks: "calendar_blocks",
  getRoutine: "routines",
  listRoutines: "routines",
  getRoutineStep: "routine_steps",
  listRoutineSteps: "routine_steps",
  getRoutineRun: "routine_runs",
  listRoutineRuns: "routine_runs",
  getRoutineStepRun: "routine_step_runs",
  listRoutineStepRuns: "routine_step_runs",
  getGoal: "goals",
  listGoals: "goals",
  getHabitRule: "habit_rules",
  listHabitRules: "habit_rules",
  getDistraction: "distractions",
  listDistractions: "distractions",
  getReminder: "reminders",
  listReminders: "reminders",
  getVaultReward: "vault_rewards",
  listVaultRewards: "vault_rewards",
  getBreathingSession: "breathing_sessions",
  listBreathingSessions: "breathing_sessions",
  getRecipe: "recipes",
  listRecipes: "recipes",
  getHydrationEntry: "hydration_entries",
  listHydrationEntries: "hydration_entries",
  getSleepEntry: "sleep_entries",
  listSleepEntries: "sleep_entries",
  getActivityEntry: "activity_entries",
  listActivityEntries: "activity_entries",
  getMoodCheckin: "mood_checkins",
  listMoodCheckins: "mood_checkins",
  getJournalEntry: "journal_entries",
  listJournalEntries: "journal_entries",
  getMeasurement: "measurements",
  listMeasurements: "measurements",
  getFood: "foods",
  listFoods: "foods",
  getNutritionEntry: "nutrition_entries",
  listNutritionEntries: "nutrition_entries",
  getSupplement: "supplements",
  listSupplements: "supplements",
  getSupplementLog: "supplement_logs",
  listSupplementLogs: "supplement_logs",
};

export function revealPrivateRows(
  active: SqliteDb,
  recordType: string,
  rows: Record<string, unknown>[],
  key: Uint8Array,
): void {
  for (const row of rows) {
    if (typeof row.id !== "string") throw new Error("local-content.private-row.invalid-id");
    const stored: Record<string, unknown>[] = [];
    active.exec(
      "SELECT payload FROM local_private_records WHERE record_type = ? AND record_id = ? LIMIT 1;",
      { bind: [recordType, row.id], rowMode: "object", resultRows: stored },
    );
    const payload = stored[0]?.payload;
    if (typeof payload !== "string") throw new Error("local-content.private-row.missing");
    const plaintext = decryptLocalContent(payload, key, {
      recordType,
      recordId: row.id,
      field: "payload",
    });
    const values: unknown = JSON.parse(plaintext);
    if (typeof values !== "object" || values === null || Array.isArray(values)) {
      throw new Error("local-content.private-row.invalid-payload");
    }
    for (const [field, value] of Object.entries(values)) {
      if (field.endsWith("_is_null")) {
        if (value === true) row[field.slice(0, -8)] = null;
      } else {
        row[field] = value;
      }
    }
  }
}

export function revealEntityRows(
  rows: Record<string, unknown>[],
  entityType: string,
  key: Uint8Array,
): void {
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.value !== "string") {
      throw new Error("local-content.entity-doc.invalid-read");
    }
    row.value = revealEntityDocument(entityType, row.id, row.value, key);
  }
}

export function privateRowsResponse(
  requestId: string,
  queryOp: string,
  active: SqliteDb,
  rows: Record<string, unknown>[],
): DbResponse {
  if (!localContentEncryptionEnabled(active)) return success(requestId, rows);
  const key = localContentKey;
  const recordType = PRIVATE_QUERY_RECORD_TYPES[queryOp];
  if (recordType === undefined) return success(requestId, rows);
  if (key === null) {
    return failure(requestId, "storage-unavailable", "db.local-content.locked");
  }
  try {
    if (recordType === "recipes") {
      const uniqueRows = [...new Map(rows.map((row) => [row.id, { ...row }])).values()];
      revealPrivateRows(active, recordType, uniqueRows, key);
      const expanded: Record<string, unknown>[] = [];
      for (const row of uniqueRows) {
        if (typeof row.ingredients_json !== "string") {
          throw new Error("local-content.recipe.invalid-ingredients");
        }
        const ingredients: unknown = JSON.parse(row.ingredients_json);
        if (!Array.isArray(ingredients))
          throw new Error("local-content.recipe.invalid-ingredients");
        const base = { ...row };
        delete base.ingredients_json;
        if (ingredients.length === 0) {
          expanded.push({ ...base, food_id: null, amount_g: null, position: null });
          continue;
        }
        for (const ingredient of ingredients) {
          if (typeof ingredient !== "object" || ingredient === null || Array.isArray(ingredient)) {
            throw new Error("local-content.recipe.invalid-ingredient");
          }
          expanded.push({ ...base, ...(ingredient as Record<string, unknown>) });
        }
      }
      return success(requestId, expanded);
    }
    revealPrivateRows(active, recordType, rows, key);
    return success(requestId, rows);
  } catch {
    return failure(requestId, "storage-unavailable", "db.local-content.decrypt-failed");
  }
}

const DB_PATH = "/lifeos.sqlite3";

// T038: sahpool-poolin pysyvä nimi. Koko B01 käyttää yhtä poolia.
// ÄLÄ vaihda ilman migraatiota: nimen vaihto orvottaa vanhan poolin
// datan OPFS:ään. DB_PATH kertoo tiedostonimen poolin sisällä.
// (Kauttaviiva-hypoteesi testattu p1/p2-mittauksella: ei vaikutusta;
// poolin getPath normalisoi molemmat muutenkin samaksi URL-poluksi.)
//
// T039 (orpo-suoja POISTETTU): T038:n orpo-suoja (user_version==0 +
// poolHadDb → orphaned-pool-open) oli väärä positiivi. Mittaus T039:ssä:
// aidossa ensiasennuksessa poolissa on 6 tyhjää SAH:ta (fileNames tyhjä)
// ja DB_PATH assosioituu vasta OpfsSAHPoolDb-avauksessa — user_version==0
// on silloin normaali tuore kanta johon M001 AJETAAN. Vanhan suojan ehto
// (fileCount>0) täyttyi myös terveessä kannassa reloadin jälkeen ilman
// että data katosi, joten suoja olisi estänyt laillisen migraation.
// Siksi migraatiorunner ajaa M001:n aina kun historia puuttuu (M001 on
// idempotentti: CREATE TABLE IF NOT EXISTS). Todellinen orpo (lukkokilpa)
// näkyy acquire-vaiheessa createSyncAccessHandle-virheenä → retry →
// memory-fallback, ei hiljaisena tyhjänä kantana.
//
// T038-KORJAUS#2 (VFS-rekisteröinti, voimassa): createOpfsVfs heittää jos
// VFS-nimi on jo rekisteröity ("VFS name is already registered"). Sama
// workeri elää koko sivun elinkaaren (open→write→read samassa prosessissa),
// joten toinen install SAMALLA nimellä samassa workerissa KAATUU — ja koska
// initPromises cachaa hylkäyksen, kaikki myöhemmät haut putoavat muistiin.
// Siksi: (a) SAH_POOL_NAME on vakio, (b) avaus EI kutsu installia uudelleen
// kun db on jo auki (ensureOpen palauttaa heti), (c) close EI nollaa
// sqlite3-moduulia (VFS-rekisteröinti + initPromises säilyvät) — vain db
// suljetaan ja backend nollataan. Uusi sivu = uusi workeri = puhdas install.
const SAH_POOL_NAME = "lifeos-sahpool";

function failure(
  requestId: string,
  code: DbFailureResponse["code"],
  diagnosticCode: string,
): DbFailureResponse {
  return { requestId, ok: false, code, diagnosticCode };
}

function success(
  requestId: string,
  rows: readonly unknown[] = [],
  schemaVersion?: number,
): DbSuccessResponse {
  const diagnostics =
    poolDiagnostics.capacity === null && poolDiagnostics.fileCount === null
      ? {}
      : {
          poolCapacity: poolDiagnostics.capacity,
          poolFileCount: poolDiagnostics.fileCount,
          poolHasDb: poolDiagnostics.fileNames.includes(DB_PATH),
        };
  return schemaVersion === undefined
    ? { requestId, ok: true, rows, backend, persisted, ...diagnostics }
    : { requestId, ok: true, rows, backend, persisted, schemaVersion, ...diagnostics };
}

function toFailureCode(error: unknown): DbFailureResponse["code"] {
  const message = error instanceof Error ? error.message : String(error);
  if (/bad-params|SQLITE_CONSTRAINT|constraint failed/i.test(message)) {
    return "invalid-input";
  }
  if (/quota|Quota|disk full|SQLITE_FULL/i.test(message)) {
    return "quota-exceeded";
  }
  if (/locked|busy|IOERR|CORRUPT|NOTADB/i.test(message)) {
    return "storage-unavailable";
  }
  return "transient-failure";
}

function isSahPoolLockConflict(error: unknown): boolean {
  const name =
    typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
      ? error.name
      : "";
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : String(error);
  return (
    /NoModificationAllowedError/i.test(name) ||
    /NoModificationAllowedError|already active.*another|another.*(?:browsing context|tab)|sync\s*access\s*handle.{0,120}(?:locked|in use|already open)|(?:locked|in use).{0,120}sync\s*access\s*handle/i.test(
      message,
    )
  );
}

/** Vite injektoi wasm-URL:n (?url + locateFile) — worker ei arvaa polkua. */
export function configureWorkerAssets(options: { readonly sqliteWasmUrl: string }): void {
  sqliteWasmUrl = options.sqliteWasmUrl;
}

async function ensureInit(): Promise<void> {
  if (sqlite3 !== null || initError !== null) {
    return;
  }
  try {
    // Dynaaminen import jotta worker latautuu nopeasti ja wasm vasta tässä.
    // Vite paketoi ?worker-erillisen chunkin; wasm kulkee assettina (?url).
    const initModule = (await import("@sqlite.org/sqlite-wasm")) as unknown as {
      default: (options?: { locateFile?: (path: string) => string }) => Promise<SqliteStatic>;
    };
    sqlite3 = await initModule.default(
      sqliteWasmUrl === null
        ? undefined
        : {
            locateFile: (path: string) => {
              if (path.endsWith(".wasm") && sqliteWasmUrl !== null) {
                return sqliteWasmUrl;
              }
              return path;
            },
          },
    );
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

// T060-KORJAUS: ensureOpen on nyt single-flight. Aiemmin kaksi samaan aikaan
// tulevaa pyyntöä (esim. kaksi probea samalla sivulla) kutsui
// installOpfsSAHPoolVfs:ää rinnakkain: toinen heitti "VFS name already
// registered" -> retry forceReinitillä -> repi poolin alta ensimmäisen
// avaamisen -> jäi roikkumaan. Nyt avauslupaus jaetaan kaikille odottajille.
// Jaettu lupaus palauttaa null (ok) TAI failure-RESPONSEMALLIN ilman
// requestId:tä; kutsuja liittää oman requestId:nsä (client täsmäyttää
// vastaukset id:llä — jaettu id rikkoisi odottajien mapin).
let openInFlight: Promise<DbResponse | null> | null = null;

async function ensureOpen(requestId: string): Promise<DbResponse | null> {
  if (db !== null) {
    return null;
  }
  if (openInFlight === null) {
    const attempt = doEnsureOpen();
    openInFlight = attempt;
    void attempt.finally(() => {
      if (openInFlight === attempt) {
        openInFlight = null;
      }
    });
  }
  const shared = await openInFlight;
  if (shared === null) {
    return null;
  }
  return { ...shared, requestId };
}

async function doEnsureOpen(): Promise<DbResponse | null> {
  // Placeholder-id: ensureOpen ylikirjoittaa sen kutsujan omalla id:llä.
  const requestId = "ensure-open-shared";
  try {
    await ensureInit();
  } catch {
    return failure(requestId, "transient-failure", "db.init.failed");
  }
  if (sqlite3 === null) {
    return failure(requestId, "transient-failure", "db.init.missing");
  }
  // T039-PÄÄTÖS (mitattu): suora OpfsDb-koe ohitetaan — oo1.OpfsDb on
  // function VAIN jos "opfs"-VFS on asennettu, eikä sitä asenneta tässä
  // workerissa (sahpool on ADR-001-valinta; "opfs" vaatisi COOP/COEP-
  // monisäiekontekstin + async-proxyn jota ei ole kytketty). Pooli on
  // ainoa OPFS-polku; lukkokilpa näkyy acquire-vaiheessa → retry →
  // tunnistettu lukkovirhe tai yleinen muistifallback.
  // Ensisijainen: sahpool-pool ("opfs-sahpool", ADR-001; ei COOP/COEP,
  // Safari 16.4+).
  //
  // T039-KORJAUS (OpfsDb-haara poistettu): aiempi koodi kutsui
  // installOpfsVfs:ää ilman proxyUri-kytkentää. Ilman proxya initOptions
  // palauttaa undefined → install on no-op → oo1.OpfsDb jää määrittämättä
  // → haara ohitettiin joka tapauksessa. Kuollut koodi poistettu.
  // Toissijainen: sahpool-pool (vaatii COOP/COEP/SAB; nopeampi kun toimii).
  let poolFailedOnce = false;
  let poolLockConflict = false;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (typeof sqlite3.installOpfsSAHPoolVfs === "function") {
        const pool = await sqlite3.installOpfsSAHPoolVfs({
          name: SAH_POOL_NAME,
          // T038: EI initialCapacitya. Mittaus: capacity kasvoi 12→24 p1→p2,
          // eli initialCapacity on KUMULATIIVINEN (joka install lisää).
          // Oletus 6 riittää B01:lle; capacity on pysyvä OPFS:ssä.
          ...(poolFailedOnce ? { forceReinitIfPreviouslyFailed: true } : {}),
        });
        // T038-diagnostiikka E2E:lle: poolin tila vastaukseen (capacity/
        // count/nimet) jotta testi erottaa "pooli terve" vs "pooli rikki".
        // Ei PII:tä — vain lukumäärät + DB-polut.
        // T039-MITTAUS (selitys capacity-kasvulle 6→12): uusi sivu = uusi
        // workeri = uusi OpfsSAHPool-olio. Vanhan sivun workeri pitää SAHeja
        // auki reload-hetkellä, joten uuden sivun acquireAccessHandles ei saa
        // samoja SAH-oloita vaan addCapacity luo uudet (vanhat lukossa).
        // Kummatkin osoittavat samoihin OPFS-tiedostoihin headereiden kautta,
        // joten data kantaantuu (mitattu: READBACK täsmää). Capacity on siis
        // prosessikohtainen laskuri, ei jaettu tila — kasvu on odotettu eikä
        // merkki orvosta poolista. Sulku ennen sivun sulkemista (close-pyyntö)
        // vapauttaa lukot ja pitää capacityn kurissa.
        try {
          poolDiagnostics = {
            capacity: pool.getCapacity?.() ?? null,
            fileCount: pool.getFileCount?.() ?? null,
            fileNames: pool.getFileNames?.() ?? [],
          };
        } catch {
          // Diagnostiikka best-effort; avaus onnistui silti.
        }
        // T038-ORPO-RETRY: jos fileNames on tyhjä (acquire ei yhdistänyt
        // headereita — lukkokilpa), älä avaa tyhjää kantaa vaan yritä
        // uudelleen forceReinitillä. Vain kun OPFS:ssä oikeasti on pool-
        // hakemisto (muuten kyse on aidosta ensiasennuksesta).
        if (poolDiagnostics.fileNames.length === 0) {
          try {
            const dir = await navigator.storage.getDirectory();
            let hasPoolDir = false;
            try {
              await dir.getDirectoryHandle(".lifeos-sahpool", { create: false });
              hasPoolDir = true;
            } catch {
              hasPoolDir = false;
            }
            if (hasPoolDir && attempt < 2) {
              poolFailedOnce = true;
              await new Promise((resolve) => {
                setTimeout(resolve, 500 * (attempt + 1));
              });
              continue;
            }
          } catch {
            // OPFS-kysely best-effort; jatketaan avaukseen.
          }
        }
        db = new pool.OpfsSAHPoolDb(DB_PATH);
        backend = "opfs-sahpool";
        persisted = true;
        return null;
      }
      break;
    } catch (error) {
      poolLockConflict = poolLockConflict || isSahPoolLockConflict(error);
      // Yritys N: odota lukon vapautumista ja yritä uudelleen; viimeisellä
      // kierroksella pudotaan fallbackiin (ei heittoa).
      poolFailedOnce = true;
      if (attempt < 2) {
        await new Promise((resolve) => {
          setTimeout(resolve, 250 * (attempt + 1));
        });
        continue;
      }
    }
  }
  if (poolLockConflict) {
    return failure(requestId, "storage-unavailable", "db.open.opfs-locked");
  }
  // Viimeinen: muut OPFS-kyvyttömyydet saavat diagnostisen muistifallbackin.
  try {
    db = new sqlite3.oo1.DB(":memory:", "ct");
    backend = "memory";
    persisted = false;
    return null;
  } catch (error) {
    return failure(requestId, toFailureCode(error), "db.open.failed");
  }
}

function readUserVersion(active: SqliteDb): number {
  const rows: Record<string, unknown>[] = [];
  active.exec("PRAGMA user_version;", { rowMode: "object", resultRows: rows });
  const value = rows[0]?.user_version;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

function readAppliedVersions(active: SqliteDb): Set<number> {
  const applied = new Set<number>();
  try {
    const rows: Record<string, unknown>[] = [];
    active.exec("SELECT version FROM _lifeos_migrations;", { rowMode: "object", resultRows: rows });
    for (const row of rows) {
      if (typeof row.version === "number" && Number.isInteger(row.version)) {
        applied.add(row.version);
      }
    }
  } catch {
    // Historiataulua ei vielä ole (tuore kanta ennen M001:tä) — tyhjä joukko.
  }
  return applied;
}

/**
 * T031-runner: ajaa puuttuvat migraatiot transaktiossa (kaikki tai ei mitään).
 * - Validoi ketjun (validateMigrationChain) ennen yhtäkään kirjoitusta.
 * - Lukee PRAGMA user_version + _lifeos_migrations-historian; ohittaa jo
 *   ajetut (idempotentti: uusinta-ajo on no-op).
 * - Jokainen migraatio omassa transaktiossaan; virhe -> ROLLBACK + failure,
 *   user_version jää ennalleen (§49: ei puolirikasta tilaa).
 * - Päivittää user_versionin vasta onnistuneen migraation jälkeen.
 */
function runMigrations(active: SqliteDb, targetVersion: number): number {
  const chainCheck = validateMigrationChain(MIGRATIONS);
  if (!chainCheck.ok) {
    throw new Error(`migration-chain-invalid:${chainCheck.issue.kind}`);
  }
  if (targetVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`migration-target-too-new:${String(targetVersion)}`);
  }
  const current = readUserVersion(active);
  if (current > CURRENT_SCHEMA_VERSION) {
    throw new Error(`migration-downgrade-refused:${String(current)}`);
  }
  const applied = readAppliedVersions(active);
  // T039: orpo-suoja poistettu (väärä positiivi, ks. SAH_POOL_NAME-kommentti).
  // M001 on idempotentti — uusinta-ajo tyhjään kantaan on turvallinen, ja
  // lukkokilpa hoidetaan acquire-retryllä, ei tässä.
  const pending = pendingMigrations(MIGRATIONS, Math.max(current, 0)).filter(
    (step) => step.version <= targetVersion && !applied.has(step.version),
  );
  // (SQL TRACE -vahvistus: ilman suojaa p2 ajoi M001:n uudelleen vaikka p1
  // migroi jo — historia-kysely näkee vain uuden kannan historian.)
  let version = current;
  for (const step of pending) {
    try {
      active.exec("BEGIN;");
      for (const statement of step.statements) {
        active.exec(statement);
      }
      active.exec("INSERT INTO _lifeos_migrations (version, id, description) VALUES (?, ?, ?);", {
        bind: [step.version, step.id, step.description],
      });
      active.exec(`PRAGMA user_version=${String(step.version)};`);
      active.exec("COMMIT;");
      version = step.version;
    } catch (error) {
      try {
        active.exec("ROLLBACK;");
      } catch {
        // Rollback best-effort; alkuperäinen virhe ratkaisee.
      }
      throw error;
    }
  }
  return Math.max(version, current);
}

// T038: kirjoituspolun eheys. SYNC-järjestys poolille (mitattu xSync:
// file.sah.flush() — SAH-flush on se joka kantaantuu OPFS:ään):
// 1. PRAGMA journal_mode=DELETE (ei WAL-tilaa → ei -wal-tiedostoa).
// 2. JOKAISEN kirjoituksen jälkeen wal_checkpoint(PASSIVE) best-effort.
// 3. Sulussa wal_checkpoint(TRUNCATE) + journal_mode=DELETE + db.close().
// Jos reload silti näyttää tyhjää, syy on poolin header-mäppäyksessä
// (uusi workeri ei yhdistä) — silloin E2E-raportti näyttää backendin
// ja T039-portti päättää jatkosta. Tätä ei peitetä hiljaisella feikillä.
let deferPassiveCheckpointForRestore = false;

function checkpointPassive(active: SqliteDb): void {
  if (deferPassiveCheckpointForRestore) return;
  try {
    active.exec("PRAGMA wal_checkpoint(PASSIVE);");
  } catch {
    // Ei WAL-tilaa / ei tukea — ohitetaan (DELETE-journal ei tarvitse).
  }
}

// T076: yhden nimetyn kirjoitusopin suoritus (exec + transaction jakavat).
// Heittää SQL-virheen; kutsuja päättää transaktiorajan.
function executeNamedOp(
  active: SqliteDb,
  op: string,
  params: Readonly<Record<string, string | number | boolean>>,
): void {
  if (op === "putPreferences") {
    active.exec(
      `INSERT INTO user_preferences (
         id, theme, day_start_hour, gamification_visible, enabled_sections,
         notification_defaults_enabled, app_lock_enabled, created_at, updated_at, version,
         weight_target, height_cm, meal_slots, macro_targets, hydration_target_ml,
         hydration_reminder_time, notification_categories
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         theme = excluded.theme,
         day_start_hour = excluded.day_start_hour,
         gamification_visible = excluded.gamification_visible,
         enabled_sections = excluded.enabled_sections,
         notification_defaults_enabled = excluded.notification_defaults_enabled,
         app_lock_enabled = excluded.app_lock_enabled,
         updated_at = excluded.updated_at,
         version = excluded.version,
         weight_target = excluded.weight_target,
         height_cm = excluded.height_cm,
         meal_slots = excluded.meal_slots,
         macro_targets = excluded.macro_targets,
         hydration_target_ml = excluded.hydration_target_ml,
         hydration_reminder_time = excluded.hydration_reminder_time,
         notification_categories = excluded.notification_categories;`,
      {
        bind: [
          params.id,
          params.theme,
          params.day_start_hour,
          params.gamification_visible ? 1 : 0,
          params.enabled_sections,
          params.notification_defaults_enabled ? 1 : 0,
          params.app_lock_enabled ? 1 : 0,
          params.created_at,
          params.updated_at,
          params.version,
          params.weight_target === "" ? null : params.weight_target,
          params.height_cm === "" ? null : params.height_cm,
          params.meal_slots,
          params.macro_targets,
          params.hydration_target_ml === "" ? null : Number(params.hydration_target_ml),
          params.hydration_reminder_time === "" ? null : params.hydration_reminder_time,
          params.notification_categories,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putInstallation") {
    const toNullable = (value: unknown): string | null =>
      typeof value === "string" && value.length > 0 ? value : null;
    active.exec(
      `INSERT INTO browser_installations (
         id, installation_id, installation_name, last_seen_app_version,
         last_sync_at, revoked_at, created_at, updated_at, version, is_local
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         installation_id = excluded.installation_id,
         installation_name = excluded.installation_name,
         last_seen_app_version = excluded.last_seen_app_version,
         last_sync_at = excluded.last_sync_at,
         revoked_at = excluded.revoked_at,
         updated_at = excluded.updated_at,
         version = excluded.version,
         is_local = excluded.is_local;`,
      {
        bind: [
          params.id,
          params.installation_id,
          params.installation_name,
          params.last_seen_app_version,
          toNullable(params.last_sync_at),
          toNullable(params.revoked_at),
          params.created_at,
          params.updated_at,
          params.version,
          params.is_local ? 1 : 0,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putSyncOperation") {
    active.exec(
      `INSERT INTO sync_operations (
         id, operation_id, installation_id, entity_type, entity_id, operation,
         entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
         created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          params.id,
          params.operation_id,
          params.installation_id,
          params.entity_type,
          params.entity_id,
          params.operation,
          params.entity_version,
          params.occurred_at,
          params.encrypted_payload_ref,
          params.integrity_ref,
          params.created_at,
          params.updated_at,
          params.version,
        ],
      },
    );
    return;
  }
  if (op === "putSyncCursor") {
    active.exec(
      `INSERT INTO sync_cursors (
         id, installation_id, provider_id, provider_cursor, last_seen_operation_id,
         updated_through, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(installation_id, provider_id) DO UPDATE SET
         provider_cursor = excluded.provider_cursor,
         last_seen_operation_id = excluded.last_seen_operation_id,
         updated_through = excluded.updated_through,
         updated_at = excluded.updated_at,
         version = sync_cursors.version + 1;`,
      {
        bind: [
          params.id,
          params.installation_id,
          params.provider_id,
          params.provider_cursor,
          params.last_seen_operation_id === "" ? null : params.last_seen_operation_id,
          params.updated_through,
          params.created_at,
          params.updated_at,
          params.version,
        ],
      },
    );
    return;
  }
  if (op === "putConflictRecord") {
    active.exec(
      `INSERT INTO conflict_records (
         id, entity_type, entity_id, status, local_version_ref, remote_version_ref,
         resolved_at, resolution_operation_id, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      {
        bind: [
          params.id,
          params.entity_type,
          params.entity_id,
          params.status,
          params.local_version_ref,
          params.remote_version_ref,
          params.resolved_at === "" ? null : params.resolved_at,
          params.resolution_operation_id === "" ? null : params.resolution_operation_id,
          params.created_at,
          params.updated_at,
          params.version,
        ],
      },
    );
    return;
  }
  if (op === "resolveConflictRecord") {
    active.exec(
      `UPDATE conflict_records
       SET status = 'resolved', resolved_at = ?, resolution_operation_id = ?,
           updated_at = ?, version = version + 1
       WHERE id = ? AND status = 'open';`,
      {
        bind: [params.updated_at, params.resolution_operation_id, params.updated_at, params.id],
      },
    );
    return;
  }
  if (op === "putHydrationEntry") {
    const id = params.id;
    const drunkAt = params.drunk_at;
    const milliliters = params.milliliters;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof drunkAt !== "string" ||
      typeof milliliters !== "number" ||
      !Number.isInteger(milliliters) ||
      milliliters < 0 ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("hydration-entry-bad-params");
    }
    active.exec(
      `INSERT INTO hydration_entries (
         id, drunk_at, milliliters, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         drunk_at = excluded.drunk_at,
         milliliters = excluded.milliliters,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      { bind: [id, drunkAt, milliliters, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putSleepEntry") {
    const id = params.id;
    const sleepStart = params.sleep_start;
    const sleepEnd = params.sleep_end;
    const quality = params.quality;
    const isNap = params.is_nap;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof sleepStart !== "string" ||
      typeof sleepEnd !== "string" ||
      sleepEnd < sleepStart ||
      (isNap !== 0 && isNap !== 1) ||
      (quality !== "" && (typeof quality !== "number" || !Number.isInteger(quality))) ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string"
    ) {
      throw new Error("sleep-entry-bad-params");
    }
    active.exec(
      `INSERT INTO sleep_entries (
         id, sleep_start, sleep_end, quality, is_nap, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, NULLIF(?, ''), ?, ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         sleep_start = excluded.sleep_start,
         sleep_end = excluded.sleep_end,
         quality = excluded.quality,
         is_nap = excluded.is_nap,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [id, sleepStart, sleepEnd, quality, isNap, createdAt, updatedAt, version, deletedAt],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putActivityEntry") {
    const id = params.id;
    const activityAt = params.activity_at;
    const kind = params.kind;
    const durationSeconds = params.duration_seconds;
    const distanceMeters = params.distance_meters;
    const note = params.note ?? "";
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof activityAt !== "string" ||
      typeof kind !== "string" ||
      kind.trim().length === 0 ||
      kind.length > 60 ||
      (durationSeconds !== "" &&
        (typeof durationSeconds !== "number" ||
          !Number.isInteger(durationSeconds) ||
          durationSeconds < 0)) ||
      (distanceMeters !== "" &&
        (typeof distanceMeters !== "number" ||
          !Number.isFinite(distanceMeters) ||
          distanceMeters < 0)) ||
      typeof note !== "string" ||
      note.length > 500 ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string"
    ) {
      throw new Error("activity-entry-bad-params");
    }
    active.exec(
      `INSERT INTO activity_entries (
         id, activity_at, kind, duration_seconds, distance_meters, note,
         created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         activity_at = excluded.activity_at,
         kind = excluded.kind,
         duration_seconds = excluded.duration_seconds,
         distance_meters = excluded.distance_meters,
         note = excluded.note,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          activityAt,
          kind,
          durationSeconds,
          distanceMeters,
          note,
          createdAt,
          updatedAt,
          version,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putMoodCheckin") {
    const id = params.id;
    const checkedAt = params.checked_at;
    const mood = params.mood;
    const stress = params.stress;
    const energy = params.energy;
    const motivation = params.motivation;
    const focus = params.focus;
    const note = params.note;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof checkedAt !== "string" ||
      typeof mood !== "number" ||
      !Number.isInteger(mood) ||
      mood < 1 ||
      mood > 5 ||
      (stress !== "" &&
        (typeof stress !== "number" || !Number.isInteger(stress) || stress < 1 || stress > 5)) ||
      (energy !== "" &&
        (typeof energy !== "number" || !Number.isInteger(energy) || energy < 1 || energy > 5)) ||
      (motivation !== "" &&
        (typeof motivation !== "number" ||
          !Number.isInteger(motivation) ||
          motivation < 1 ||
          motivation > 5)) ||
      (focus !== "" &&
        (typeof focus !== "number" || !Number.isInteger(focus) || focus < 1 || focus > 5)) ||
      typeof note !== "string" ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("mood-checkin-bad-params");
    }
    active.exec(
      `INSERT INTO mood_checkins (
         id, checked_at, mood, stress, energy, motivation, focus, note, created_at, updated_at, version
       ) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         checked_at = excluded.checked_at,
         mood = excluded.mood,
         stress = excluded.stress,
         energy = excluded.energy,
         motivation = excluded.motivation,
         focus = excluded.focus,
         note = excluded.note,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          checkedAt,
          mood,
          stress,
          energy,
          motivation,
          focus,
          note,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putJournalEntry") {
    const id = params.id;
    const writtenAt = params.written_at;
    const title = params.title;
    const titleIsNull = params.title_is_null;
    const body = params.body;
    const reflectionSuccess = params.reflection_success;
    const reflectionDifficult = params.reflection_difficult;
    const reflectionTomorrow = params.reflection_tomorrow;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof writtenAt !== "string" ||
      typeof title !== "string" ||
      typeof titleIsNull !== "boolean" ||
      typeof body !== "string" ||
      typeof reflectionSuccess !== "string" ||
      reflectionSuccess.length > 2000 ||
      typeof reflectionDifficult !== "string" ||
      reflectionDifficult.length > 2000 ||
      typeof reflectionTomorrow !== "string" ||
      reflectionTomorrow.length > 2000 ||
      (body.trim().length === 0 &&
        [reflectionSuccess, reflectionDifficult, reflectionTomorrow].every(
          (value) => value.trim().length === 0,
        )) ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string"
    ) {
      throw new Error("journal-entry-bad-params");
    }
    active.exec(
      `INSERT INTO journal_entries (
         id, written_at, title, body, reflection_success, reflection_difficult,
         reflection_tomorrow, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, CASE WHEN ? THEN NULL ELSE ? END, ?, NULLIF(?, ''),
         NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         written_at = excluded.written_at,
         title = excluded.title,
         body = excluded.body,
         reflection_success = excluded.reflection_success,
         reflection_difficult = excluded.reflection_difficult,
         reflection_tomorrow = excluded.reflection_tomorrow,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          writtenAt,
          titleIsNull ? 1 : 0,
          title,
          body,
          reflectionSuccess,
          reflectionDifficult,
          reflectionTomorrow,
          createdAt,
          updatedAt,
          version,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putBreathingSession") {
    const id = params.id;
    const startedAt = params.started_at;
    const endedAt = params.ended_at;
    const patternKey = params.pattern_key;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof startedAt !== "string" ||
      typeof endedAt !== "string" ||
      (endedAt !== "" && endedAt < startedAt) ||
      typeof patternKey !== "string" ||
      patternKey.trim().length === 0 ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("breathing-session-bad-params");
    }
    active.exec(
      `INSERT INTO breathing_sessions (
         id, started_at, ended_at, pattern_key, created_at, updated_at, version
       ) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         pattern_key = excluded.pattern_key,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      { bind: [id, startedAt, endedAt, patternKey, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteBreathingSession") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("breathing-session-delete-bad-params");
    }
    active.exec("DELETE FROM breathing_sessions WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putReminder") {
    const id = params.id;
    const kind = params.kind;
    const route = params.route;
    const title = params.title;
    const fireAt = params.fire_at;
    const snoozedUntil = params.snoozed_until;
    const ruleJson = params.rule_json;
    const categoryKey = params.category_key;
    const enabled = params.enabled;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      (kind !== "time" && kind !== "recurring" && kind !== "deadline" && kind !== "conditional") ||
      typeof route !== "string" ||
      route.trim().length === 0 ||
      route.length > 200 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof fireAt !== "string" ||
      typeof snoozedUntil !== "string" ||
      typeof ruleJson !== "string" ||
      ruleJson.length > 2048 ||
      typeof categoryKey !== "string" ||
      categoryKey.trim().length === 0 ||
      categoryKey.length > 60 ||
      typeof enabled !== "number" ||
      (enabled !== 0 && enabled !== 1) ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string"
    ) {
      throw new Error("reminder-bad-params");
    }
    active.exec(
      `INSERT INTO reminders (
         id, kind, route, title, fire_at, snoozed_until, rule_json, category_key, enabled,
         created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         route = excluded.route,
         title = excluded.title,
         fire_at = excluded.fire_at,
         snoozed_until = excluded.snoozed_until,
         rule_json = excluded.rule_json,
         category_key = excluded.category_key,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          kind,
          route,
          title,
          fireAt,
          snoozedUntil,
          ruleJson,
          categoryKey,
          enabled,
          createdAt,
          updatedAt,
          version,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putNotificationState") {
    const id = params.id;
    const reminderId = params.reminder_id;
    const categoryKey = params.category_key;
    const delivery = params.delivery;
    const lastEvaluatedAt = params.last_evaluated_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof reminderId !== "string" ||
      typeof categoryKey !== "string" ||
      categoryKey.trim().length === 0 ||
      categoryKey.length > 60 ||
      (delivery !== "pending" &&
        delivery !== "shown" &&
        delivery !== "dismissed" &&
        delivery !== "missed" &&
        delivery !== "snoozed") ||
      typeof lastEvaluatedAt !== "string" ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("notification-state-bad-params");
    }
    active.exec(
      `INSERT INTO notification_states (
         id, reminder_id, category_key, delivery, last_evaluated_at,
         created_at, updated_at, version
       ) VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         reminder_id = excluded.reminder_id,
         category_key = excluded.category_key,
         delivery = excluded.delivery,
         last_evaluated_at = excluded.last_evaluated_at,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          reminderId,
          categoryKey,
          delivery,
          lastEvaluatedAt,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteNotificationState") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("notification-state-delete-bad-params");
    }
    active.exec("DELETE FROM notification_states WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putQuest") {
    const id = params.id;
    const title = params.title;
    const description = params.description;
    const activeFrom = params.active_from;
    const activeUntil = params.active_until;
    const conditionKind = params.condition_kind;
    const conditionGoal = params.condition_goal;
    const minimumAmount = params.minimum_amount;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof description !== "string" ||
      typeof activeFrom !== "string" ||
      typeof activeUntil !== "string" ||
      (activeFrom !== "" && activeUntil !== "" && activeUntil < activeFrom) ||
      typeof conditionKind !== "string" ||
      (conditionKind !== "" &&
        conditionKind !== "event-count" &&
        conditionKind !== "active-day-count") ||
      (conditionGoal !== "" &&
        (typeof conditionGoal !== "number" ||
          !Number.isInteger(conditionGoal) ||
          conditionGoal < 1)) ||
      (minimumAmount !== "" &&
        (typeof minimumAmount !== "number" ||
          !Number.isFinite(minimumAmount) ||
          minimumAmount <= 0)) ||
      (conditionKind === "" && (conditionGoal !== "" || minimumAmount !== "")) ||
      (conditionKind !== "" && conditionGoal === "") ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("quest-bad-params");
    }
    active.exec(
      `INSERT INTO quests (
         id, title, description, active_from, active_until,
         condition_kind, condition_goal, minimum_amount,
         created_at, updated_at, version
       ) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
                 NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         active_from = excluded.active_from,
         active_until = excluded.active_until,
         condition_kind = excluded.condition_kind,
         condition_goal = excluded.condition_goal,
         minimum_amount = excluded.minimum_amount,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          title,
          description,
          activeFrom,
          activeUntil,
          conditionKind,
          conditionGoal,
          minimumAmount,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteQuest") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("quest-delete-bad-params");
    }
    active.exec("DELETE FROM quests WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putQuestProgress") {
    const id = params.id;
    const questId = params.quest_id;
    const progress = params.progress;
    const goal = params.goal;
    const completedAt = params.completed_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof questId !== "string" ||
      questId.length === 0 ||
      typeof progress !== "number" ||
      !Number.isInteger(progress) ||
      progress < 0 ||
      typeof goal !== "number" ||
      !Number.isInteger(goal) ||
      goal < 1 ||
      typeof completedAt !== "string" ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("quest-progress-bad-params");
    }
    active.exec(
      `INSERT INTO quest_progress (
         id, quest_id, progress, goal, completed_at, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, NULLIF(?, ''), ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         quest_id = excluded.quest_id,
         progress = excluded.progress,
         goal = excluded.goal,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      { bind: [id, questId, progress, goal, completedAt, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteQuestProgress") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("quest-progress-delete-bad-params");
    }
    active.exec("DELETE FROM quest_progress WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putVaultReward") {
    const id = params.id;
    const title = params.title;
    const note = params.note;
    const xpThreshold = params.xp_threshold;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof note !== "string" ||
      note.length > 500 ||
      typeof xpThreshold !== "number" ||
      !Number.isSafeInteger(xpThreshold) ||
      xpThreshold < 1 ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("vault-reward-bad-params");
    }
    active.exec(
      `INSERT INTO vault_rewards (
         id, title, note, xp_threshold, created_at, updated_at, version
       ) VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         note = excluded.note,
         xp_threshold = excluded.xp_threshold,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      { bind: [id, title, note, xpThreshold, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteVaultReward") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("vault-reward-delete-bad-params");
    }
    active.exec("DELETE FROM vault_rewards WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putVaultRewardClaim") {
    const id = params.id;
    const rewardId = params.reward_id;
    const claimedAt = params.claimed_at;
    const xpDeducted = params.xp_deducted;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof rewardId !== "string" ||
      rewardId.length === 0 ||
      typeof claimedAt !== "string" ||
      claimedAt.length === 0 ||
      typeof xpDeducted !== "number" ||
      !Number.isSafeInteger(xpDeducted) ||
      xpDeducted < 0 ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("vault-reward-claim-bad-params");
    }
    active.exec(
      `INSERT INTO vault_reward_claims (
         id, reward_id, claimed_at, xp_deducted, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?);`,
      { bind: [id, rewardId, claimedAt, xpDeducted, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putXpTransaction") {
    const id = params.id;
    const source = params.source;
    const sourceEntityId = params.source_entity_id;
    const amount = params.amount;
    const earnedAt = params.earned_at;
    const reason = params.reason;
    const reasonIsNull = params.reason_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof source !== "string" ||
      !["task", "routine", "focus", "habit", "health", "quest", "manual"].includes(source) ||
      typeof sourceEntityId !== "string" ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      typeof earnedAt !== "string" ||
      earnedAt.length === 0 ||
      typeof reason !== "string" ||
      typeof reasonIsNull !== "boolean" ||
      (reasonIsNull && reason.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("xp-transaction-bad-params");
    }
    active.exec(
      `INSERT INTO xp_transactions (
         id, source, source_entity_id, amount, earned_at, reason,
         created_at, updated_at, version
       ) VALUES (?, ?, NULLIF(?, ''), ?, ?, CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?);`,
      {
        bind: [
          id,
          source,
          sourceEntityId,
          amount,
          earnedAt,
          reasonIsNull ? 1 : 0,
          reason,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putLevelState") {
    const id = params.id;
    const totalXp = params.total_xp;
    const level = params.level;
    const computedAt = params.computed_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof totalXp !== "number" ||
      !Number.isSafeInteger(totalXp) ||
      totalXp < 0 ||
      typeof level !== "number" ||
      !Number.isSafeInteger(level) ||
      level < 1 ||
      typeof computedAt !== "string" ||
      computedAt.length === 0 ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("level-state-bad-params");
    }
    active.exec(
      `INSERT INTO level_states (
         id, total_xp, level, computed_at, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         total_xp = excluded.total_xp,
         level = excluded.level,
         computed_at = excluded.computed_at,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      { bind: [id, totalXp, level, computedAt, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteLevelState") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("level-state-delete-bad-params");
    }
    active.exec("DELETE FROM level_states WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putAchievement") {
    const id = params.id;
    const key = params.key;
    const title = params.title;
    const description = params.description;
    const descriptionIsNull = params.description_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof key !== "string" ||
      key.trim().length === 0 ||
      key.length > 100 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof description !== "string" ||
      typeof descriptionIsNull !== "boolean" ||
      (descriptionIsNull && description.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("achievement-bad-params");
    }
    active.exec(
      `INSERT INTO achievements (
         id, key, title, description, created_at, updated_at, version
       ) VALUES (?, ?, ?, CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         key = excluded.key,
         title = excluded.title,
         description = excluded.description,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          key,
          title,
          descriptionIsNull ? 1 : 0,
          description,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteAchievement") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("achievement-delete-bad-params");
    }
    const rewards: Record<string, unknown>[] = [];
    active.exec("SELECT id FROM user_rewards WHERE achievement_id = ? LIMIT 1;", {
      bind: [id],
      rowMode: "object",
      resultRows: rewards,
    });
    if (rewards.length > 0) {
      throw new Error("achievement-earned SQLITE_CONSTRAINT");
    }
    active.exec("DELETE FROM achievements WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putCollectible") {
    const id = params.id;
    const key = params.key;
    const title = params.title;
    const unlocksThemeKey = params.unlocks_theme_key;
    const unlocksThemeKeyIsNull = params.unlocks_theme_key_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof key !== "string" ||
      key.trim().length === 0 ||
      key.length > 100 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof unlocksThemeKey !== "string" ||
      typeof unlocksThemeKeyIsNull !== "boolean" ||
      (unlocksThemeKeyIsNull && unlocksThemeKey.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("collectible-bad-params");
    }
    active.exec(
      `INSERT INTO collectibles (
         id, key, title, unlocks_theme_key, created_at, updated_at, version
       ) VALUES (?, ?, ?, CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         key = excluded.key,
         title = excluded.title,
         unlocks_theme_key = excluded.unlocks_theme_key,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          key,
          title,
          unlocksThemeKeyIsNull ? 1 : 0,
          unlocksThemeKey,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteCollectible") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("collectible-delete-bad-params");
    }
    const rewards: Record<string, unknown>[] = [];
    active.exec("SELECT id FROM user_rewards WHERE collectible_id = ? LIMIT 1;", {
      bind: [id],
      rowMode: "object",
      resultRows: rewards,
    });
    if (rewards.length > 0) {
      throw new Error("collectible-earned SQLITE_CONSTRAINT");
    }
    active.exec("DELETE FROM collectibles WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putUserReward") {
    const id = params.id;
    const achievementId = params.achievement_id;
    const achievementIdIsNull = params.achievement_id_is_null;
    const collectibleId = params.collectible_id;
    const collectibleIdIsNull = params.collectible_id_is_null;
    const earnedAt = params.earned_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof achievementId !== "string" ||
      typeof achievementIdIsNull !== "boolean" ||
      (achievementIdIsNull && achievementId.length > 0) ||
      (!achievementIdIsNull && achievementId.length === 0) ||
      typeof collectibleId !== "string" ||
      typeof collectibleIdIsNull !== "boolean" ||
      (collectibleIdIsNull && collectibleId.length > 0) ||
      (!collectibleIdIsNull && collectibleId.length === 0) ||
      (achievementIdIsNull && collectibleIdIsNull) ||
      typeof earnedAt !== "string" ||
      earnedAt.length === 0 ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("user-reward-bad-params");
    }
    active.exec(
      `INSERT INTO user_rewards (
         id, achievement_id, collectible_id, earned_at, created_at, updated_at, version
       ) VALUES (
         ?, CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?, ?
       );`,
      {
        bind: [
          id,
          achievementIdIsNull ? 1 : 0,
          achievementId,
          collectibleIdIsNull ? 1 : 0,
          collectibleId,
          earnedAt,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putTask") {
    const id = params.id;
    const title = params.title;
    const notes = params.notes;
    const notesIsNull = params.notes_is_null;
    const status = params.status;
    const priority = params.priority;
    const dueAt = params.due_at;
    const dueAtIsNull = params.due_at_is_null;
    const projectId = params.project_id;
    const projectIdIsNull = params.project_id_is_null;
    const completedAt = params.completed_at;
    const completedAtIsNull = params.completed_at_is_null;
    const reopenedAt = params.reopened_at;
    const reopenedAtIsNull = params.reopened_at_is_null;
    const recurrenceJson = params.recurrence_json;
    const recurrenceIsNull = params.recurrence_is_null;
    const estimateMinutes = params.estimate_minutes;
    const estimateMinutesIsNull = params.estimate_minutes_is_null;
    const actualSeconds = params.actual_seconds;
    const tagIdsJson = params.tag_ids_json;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    const validRecurrenceJson = (value: string): boolean => {
      try {
        const rule: unknown = JSON.parse(value);
        if (typeof rule !== "object" || rule === null || Array.isArray(rule)) return false;
        const item = rule as Record<string, unknown>;
        if (item.kind === "daily") {
          return Number.isInteger(item.everyDays) && Number(item.everyDays) >= 1;
        }
        if (item.kind === "weekly") {
          return (
            Number.isInteger(item.everyWeeks) &&
            Number(item.everyWeeks) >= 1 &&
            Array.isArray(item.weekdays) &&
            item.weekdays.length > 0 &&
            item.weekdays.every(
              (day) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7,
            )
          );
        }
        if (item.kind === "monthly") {
          return (
            Number.isInteger(item.everyMonths) &&
            Number(item.everyMonths) >= 1 &&
            Number.isInteger(item.dayOfMonth) &&
            Number(item.dayOfMonth) >= 1 &&
            Number(item.dayOfMonth) <= 31
          );
        }
        if (item.kind === "custom") {
          return (
            Number.isInteger(item.every) &&
            Number(item.every) >= 1 &&
            (item.unit === "day" || item.unit === "week" || item.unit === "month")
          );
        }
        return false;
      } catch {
        return false;
      }
    };
    let tagIds: unknown;
    try {
      tagIds = typeof tagIdsJson === "string" ? JSON.parse(tagIdsJson) : null;
    } catch {
      tagIds = null;
    }
    const validTagIds =
      Array.isArray(tagIds) &&
      tagIds.every((tagId) => typeof tagId === "string" && tagId.length > 0) &&
      new Set(tagIds).size === tagIds.length;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof notes !== "string" ||
      typeof notesIsNull !== "boolean" ||
      (notesIsNull && notes.length > 0) ||
      (status !== "open" && status !== "done") ||
      (priority !== "low" && priority !== "normal" && priority !== "high") ||
      typeof dueAt !== "string" ||
      typeof dueAtIsNull !== "boolean" ||
      (dueAtIsNull && dueAt.length > 0) ||
      (!dueAtIsNull && dueAt.length === 0) ||
      typeof projectId !== "string" ||
      typeof projectIdIsNull !== "boolean" ||
      (projectIdIsNull && projectId.length > 0) ||
      (!projectIdIsNull && projectId.length === 0) ||
      typeof completedAt !== "string" ||
      typeof completedAtIsNull !== "boolean" ||
      (completedAtIsNull && completedAt.length > 0) ||
      (!completedAtIsNull && completedAt.length === 0) ||
      typeof reopenedAt !== "string" ||
      typeof reopenedAtIsNull !== "boolean" ||
      (reopenedAtIsNull && reopenedAt.length > 0) ||
      (!reopenedAtIsNull && reopenedAt.length === 0) ||
      typeof recurrenceJson !== "string" ||
      typeof recurrenceIsNull !== "boolean" ||
      (recurrenceIsNull && recurrenceJson.length > 0) ||
      (!recurrenceIsNull && !validRecurrenceJson(recurrenceJson)) ||
      typeof estimateMinutes !== "number" ||
      !Number.isFinite(estimateMinutes) ||
      typeof estimateMinutesIsNull !== "boolean" ||
      (estimateMinutesIsNull && estimateMinutes !== 0) ||
      (!estimateMinutesIsNull && estimateMinutes <= 0) ||
      typeof actualSeconds !== "number" ||
      !Number.isFinite(actualSeconds) ||
      actualSeconds < 0 ||
      !validTagIds ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0)
    ) {
      throw new Error("task-bad-params");
    }
    active.exec("SAVEPOINT task_write;");
    try {
      active.exec(
        `INSERT INTO tasks (
           id, title, notes, status, priority, due_at, project_id, completed_at, reopened_at,
           recurrence_json, estimate_minutes, actual_seconds,
           created_at, updated_at, version, deleted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           notes = excluded.notes,
           status = excluded.status,
           priority = excluded.priority,
           due_at = excluded.due_at,
           project_id = excluded.project_id,
           completed_at = excluded.completed_at,
           reopened_at = excluded.reopened_at,
           recurrence_json = excluded.recurrence_json,
           estimate_minutes = excluded.estimate_minutes,
           actual_seconds = excluded.actual_seconds,
           updated_at = excluded.updated_at,
           version = excluded.version,
           deleted_at = excluded.deleted_at;`,
        {
          bind: [
            id,
            title,
            notesIsNull ? null : notes,
            status,
            priority,
            dueAtIsNull ? null : dueAt,
            projectIdIsNull ? null : projectId,
            completedAtIsNull ? null : completedAt,
            reopenedAtIsNull ? null : reopenedAt,
            recurrenceIsNull ? null : recurrenceJson,
            estimateMinutesIsNull ? null : estimateMinutes,
            actualSeconds,
            createdAt,
            updatedAt,
            version,
            deletedAtIsNull ? null : deletedAt,
          ],
        },
      );
      active.exec("DELETE FROM task_tags WHERE task_id = ?;", { bind: [id] });
      for (const [sortOrder, tagId] of (tagIds as string[]).entries()) {
        active.exec("INSERT INTO task_tags (task_id, tag_id, sort_order) VALUES (?, ?, ?);", {
          bind: [id, tagId, sortOrder],
        });
      }
      active.exec("RELEASE task_write;");
    } catch (error) {
      active.exec("ROLLBACK TO task_write;");
      active.exec("RELEASE task_write;");
      throw error;
    }
    checkpointPassive(active);
    return;
  }
  if (op === "putTaskChecklistItem") {
    const id = params.id;
    const taskId = params.task_id;
    const title = params.title;
    const done = params.done;
    const sortOrder = params.sort_order;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof taskId !== "string" ||
      taskId.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      (done !== 0 && done !== 1) ||
      typeof sortOrder !== "number" ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0) ||
      (!deletedAtIsNull && deletedAt.length === 0)
    ) {
      throw new Error("task-checklist-item-bad-params");
    }
    active.exec(
      `INSERT INTO task_checklist_items (
         id, task_id, title, done, sort_order, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         task_id = excluded.task_id,
         title = excluded.title,
         done = excluded.done,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          taskId,
          title,
          done,
          sortOrder,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? null : deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putRoutine") {
    const id = params.id;
    const title = params.title;
    const archivedAt = params.archived_at;
    const archivedAtIsNull = params.archived_at_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof archivedAt !== "string" ||
      typeof archivedAtIsNull !== "boolean" ||
      (archivedAtIsNull && archivedAt.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0) ||
      (!deletedAtIsNull && deletedAt.length === 0)
    ) {
      throw new Error("routine-bad-params");
    }
    active.exec(
      `INSERT INTO routines (
         id, title, archived_at, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         archived_at = excluded.archived_at,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          title,
          archivedAtIsNull ? null : archivedAt,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? null : deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putRoutineStep") {
    const id = params.id;
    const routineId = params.routine_id;
    const title = params.title;
    const sortOrder = params.sort_order;
    const optional = params.optional;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof routineId !== "string" ||
      routineId.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof sortOrder !== "number" ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      (optional !== 0 && optional !== 1) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0)
    ) {
      throw new Error("routine-step-bad-params");
    }
    active.exec(
      `INSERT INTO routine_steps (
         id, routine_id, title, sort_order, optional,
         created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         routine_id = excluded.routine_id,
         title = excluded.title,
         sort_order = excluded.sort_order,
         optional = excluded.optional,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          routineId,
          title,
          sortOrder,
          optional,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? null : deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putRoutineSchedule") {
    const id = params.id;
    const routineId = params.routine_id;
    const cadence = params.cadence;
    const weekdaysJson = params.weekdays_json;
    const enabled = params.enabled;
    const localTime = params.local_time;
    const localTimeIsNull = params.local_time_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    let weekdays: unknown;
    try {
      weekdays = typeof weekdaysJson === "string" ? JSON.parse(weekdaysJson) : undefined;
    } catch {
      throw new Error("routine-schedule-bad-params");
    }
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof routineId !== "string" ||
      routineId.length === 0 ||
      (cadence !== "daily" && cadence !== "weekly") ||
      !Array.isArray(weekdays) ||
      (cadence === "daily" ? weekdays.length !== 0 : weekdays.length < 1 || weekdays.length > 7) ||
      !weekdays.every((day) => Number.isInteger(day) && day >= 1 && day <= 7) ||
      new Set(weekdays).size !== weekdays.length ||
      (enabled !== 0 && enabled !== 1) ||
      typeof localTime !== "string" ||
      typeof localTimeIsNull !== "boolean" ||
      (localTimeIsNull && localTime.length > 0) ||
      (!localTimeIsNull && !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(localTime)) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0) ||
      (!deletedAtIsNull && deletedAt.length === 0)
    ) {
      throw new Error("routine-schedule-bad-params");
    }
    active.exec(
      `INSERT INTO routine_schedules (
         id, routine_id, cadence, weekdays_json, local_time, enabled,
         created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         routine_id = excluded.routine_id,
         cadence = excluded.cadence,
         weekdays_json = excluded.weekdays_json,
         local_time = excluded.local_time,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          routineId,
          cadence,
          JSON.stringify(weekdays),
          localTimeIsNull ? null : localTime,
          enabled,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? null : deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putRoutineRun") {
    const id = params.id;
    const routineId = params.routine_id;
    const localDate = params.local_date;
    const status = params.status;
    const dayMode = params.day_mode;
    const dayModeIsNull = params.day_mode_is_null;
    const startedAt = params.started_at;
    const completedAt = params.completed_at;
    const completedAtIsNull = params.completed_at_is_null;
    const skipReason = params.skip_reason;
    const skipReasonIsNull = params.skip_reason_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof routineId !== "string" ||
      routineId.length === 0 ||
      !isValidLocalDateKeyValue(localDate) ||
      (status !== "running" &&
        status !== "completed" &&
        status !== "skipped" &&
        status !== "cancelled") ||
      typeof dayMode !== "string" ||
      typeof dayModeIsNull !== "boolean" ||
      (dayModeIsNull ? dayMode.length > 0 : dayMode !== "full" && dayMode !== "minimum") ||
      typeof startedAt !== "string" ||
      startedAt.length === 0 ||
      typeof completedAt !== "string" ||
      typeof completedAtIsNull !== "boolean" ||
      (completedAtIsNull ? completedAt.length > 0 : completedAt.length === 0) ||
      typeof skipReason !== "string" ||
      typeof skipReasonIsNull !== "boolean" ||
      (skipReasonIsNull && skipReason.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("routine-run-bad-params");
    }
    active.exec(
      `INSERT INTO routine_runs (
         id, routine_id, local_date, status, day_mode, started_at, completed_at,
         skip_reason, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         routine_id = excluded.routine_id,
         local_date = excluded.local_date,
         status = excluded.status,
         day_mode = excluded.day_mode,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at,
         skip_reason = excluded.skip_reason,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          routineId,
          localDate,
          status,
          dayModeIsNull ? null : dayMode,
          startedAt,
          completedAtIsNull ? null : completedAt,
          skipReasonIsNull ? null : skipReason,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteRoutineRun") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("routine-run-delete-bad-params");
    }
    active.exec("DELETE FROM routine_runs WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putRoutineStepRun") {
    const id = params.id;
    const routineRunId = params.routine_run_id;
    const routineStepId = params.routine_step_id;
    const status = params.status;
    const completedAt = params.completed_at;
    const completedAtIsNull = params.completed_at_is_null;
    const skipReason = params.skip_reason;
    const skipReasonIsNull = params.skip_reason_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const validShape =
      status === "pending"
        ? completedAtIsNull === true && skipReasonIsNull === true
        : status === "completed"
          ? completedAtIsNull === false && skipReasonIsNull === true
          : status === "skipped" && completedAtIsNull === false && skipReasonIsNull === false;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof routineRunId !== "string" ||
      routineRunId.length === 0 ||
      typeof routineStepId !== "string" ||
      routineStepId.length === 0 ||
      !validShape ||
      (status !== "pending" && status !== "completed" && status !== "skipped") ||
      typeof completedAt !== "string" ||
      (completedAtIsNull === true ? completedAt.length > 0 : completedAt.length === 0) ||
      typeof completedAtIsNull !== "boolean" ||
      typeof skipReason !== "string" ||
      (skipReasonIsNull === true ? skipReason.length > 0 : skipReason.trim().length === 0) ||
      typeof skipReasonIsNull !== "boolean" ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("routine-step-run-bad-params");
    }
    active.exec(
      `INSERT INTO routine_step_runs (
         id, routine_run_id, routine_step_id, status, completed_at, skip_reason,
         created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         routine_run_id = excluded.routine_run_id,
         routine_step_id = excluded.routine_step_id,
         status = excluded.status,
         completed_at = excluded.completed_at,
         skip_reason = excluded.skip_reason,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          routineRunId,
          routineStepId,
          status,
          completedAtIsNull ? null : completedAt,
          skipReasonIsNull ? null : skipReason,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteRoutineStepRun") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("routine-step-run-delete-bad-params");
    }
    active.exec("DELETE FROM routine_step_runs WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putCalendarBlock") {
    const id = params.id;
    const kind = params.kind;
    const title = params.title;
    const startsAt = params.starts_at;
    const endsAt = params.ends_at;
    const linkedTaskId = params.linked_task_id;
    const linkedTaskIdIsNull = params.linked_task_id_is_null;
    const linkedRoutineId = params.linked_routine_id;
    const linkedRoutineIdIsNull = params.linked_routine_id_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      (kind !== "task" && kind !== "routine" && kind !== "focus" && kind !== "event") ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof startsAt !== "string" ||
      startsAt.length === 0 ||
      typeof endsAt !== "string" ||
      endsAt.length === 0 ||
      endsAt < startsAt ||
      typeof linkedTaskId !== "string" ||
      typeof linkedTaskIdIsNull !== "boolean" ||
      (linkedTaskIdIsNull && linkedTaskId.length > 0) ||
      (!linkedTaskIdIsNull && linkedTaskId.length === 0) ||
      typeof linkedRoutineId !== "string" ||
      typeof linkedRoutineIdIsNull !== "boolean" ||
      (linkedRoutineIdIsNull && linkedRoutineId.length > 0) ||
      (!linkedRoutineIdIsNull && linkedRoutineId.length === 0) ||
      (!linkedTaskIdIsNull && !linkedRoutineIdIsNull) ||
      (!linkedTaskIdIsNull && kind !== "task") ||
      (!linkedRoutineIdIsNull && kind !== "routine") ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0)
    ) {
      throw new Error("calendar-block-bad-params");
    }
    active.exec(
      `INSERT INTO calendar_blocks (
         id, kind, title, starts_at, ends_at, linked_task_id, linked_routine_id,
         created_at, updated_at, version, deleted_at
       ) VALUES (
         ?, ?, ?, ?, ?, CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?, CASE WHEN ? THEN NULL ELSE ? END
       )
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = excluded.title,
         starts_at = excluded.starts_at,
         ends_at = excluded.ends_at,
         linked_task_id = excluded.linked_task_id,
         linked_routine_id = excluded.linked_routine_id,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          kind,
          title,
          startsAt,
          endsAt,
          linkedTaskIdIsNull ? 1 : 0,
          linkedTaskId,
          linkedRoutineIdIsNull ? 1 : 0,
          linkedRoutineId,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? 1 : 0,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putFocusSession") {
    const id = params.id;
    const taskId = params.task_id;
    const taskIdIsNull = params.task_id_is_null;
    const routineId = params.routine_id;
    const routineIdIsNull = params.routine_id_is_null;
    const calendarBlockId = params.calendar_block_id;
    const calendarBlockIdIsNull = params.calendar_block_id_is_null;
    const phase = params.phase;
    const startedAt = params.started_at;
    const startedAtIsNull = params.started_at_is_null;
    const endedAt = params.ended_at;
    const endedAtIsNull = params.ended_at_is_null;
    const durationSeconds = params.duration_seconds;
    const durationSecondsIsNull = params.duration_seconds_is_null;
    const activeElapsedSeconds = params.active_elapsed_seconds;
    const activeElapsedSecondsIsNull = params.active_elapsed_seconds_is_null;
    const activeSegmentStartedAt = params.active_segment_started_at;
    const activeSegmentStartedAtIsNull = params.active_segment_started_at_is_null;
    const accumulatedPauseSeconds = params.accumulated_pause_seconds;
    const accumulatedPauseSecondsIsNull = params.accumulated_pause_seconds_is_null;
    const interruptionCount = params.interruption_count;
    const interruptionCountIsNull = params.interruption_count_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const validNullableString = (value: unknown, isNull: unknown): value is string =>
      typeof value === "string" &&
      typeof isNull === "boolean" &&
      (isNull ? value.length === 0 : value.length > 0);
    const validNullableCount = (value: unknown, isNull: unknown): value is number =>
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      typeof isNull === "boolean" &&
      (isNull ? value === 0 : value >= 0);
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      !validNullableString(taskId, taskIdIsNull) ||
      !validNullableString(routineId, routineIdIsNull) ||
      !validNullableString(calendarBlockId, calendarBlockIdIsNull) ||
      (phase !== "planned" &&
        phase !== "running" &&
        phase !== "paused" &&
        phase !== "completed" &&
        phase !== "cancelled") ||
      !validNullableString(startedAt, startedAtIsNull) ||
      !validNullableString(endedAt, endedAtIsNull) ||
      (startedAtIsNull === false && endedAtIsNull === false && endedAt < startedAt) ||
      !validNullableCount(durationSeconds, durationSecondsIsNull) ||
      !validNullableCount(activeElapsedSeconds, activeElapsedSecondsIsNull) ||
      !validNullableString(activeSegmentStartedAt, activeSegmentStartedAtIsNull) ||
      !validNullableCount(accumulatedPauseSeconds, accumulatedPauseSecondsIsNull) ||
      !validNullableCount(interruptionCount, interruptionCountIsNull) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("focus-session-bad-params");
    }
    active.exec(
      `INSERT INTO focus_sessions (
         id, task_id, routine_id, phase, started_at, ended_at, duration_seconds,
         created_at, updated_at, version, calendar_block_id, active_elapsed_seconds,
         active_segment_started_at, accumulated_pause_seconds, interruption_count
       ) VALUES (
         ?, CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END, ?,
         CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END,
         ?, ?, ?,
         CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END
       )
       ON CONFLICT(id) DO UPDATE SET
         task_id = excluded.task_id,
         routine_id = excluded.routine_id,
         phase = excluded.phase,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_seconds = excluded.duration_seconds,
         updated_at = excluded.updated_at,
         version = excluded.version,
         calendar_block_id = excluded.calendar_block_id,
         active_elapsed_seconds = excluded.active_elapsed_seconds,
         active_segment_started_at = excluded.active_segment_started_at,
         accumulated_pause_seconds = excluded.accumulated_pause_seconds,
         interruption_count = excluded.interruption_count;`,
      {
        bind: [
          id,
          taskIdIsNull ? 1 : 0,
          taskId,
          routineIdIsNull ? 1 : 0,
          routineId,
          phase,
          startedAtIsNull ? 1 : 0,
          startedAt,
          endedAtIsNull ? 1 : 0,
          endedAt,
          durationSecondsIsNull ? 1 : 0,
          durationSeconds,
          createdAt,
          updatedAt,
          version,
          calendarBlockIdIsNull ? 1 : 0,
          calendarBlockId,
          activeElapsedSecondsIsNull ? 1 : 0,
          activeElapsedSeconds,
          activeSegmentStartedAtIsNull ? 1 : 0,
          activeSegmentStartedAt,
          accumulatedPauseSecondsIsNull ? 1 : 0,
          accumulatedPauseSeconds,
          interruptionCountIsNull ? 1 : 0,
          interruptionCount,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteFocusSession") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("focus-session-delete-bad-params");
    }
    active.exec("DELETE FROM focus_sessions WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putDistraction") {
    const id = params.id;
    const focusSessionId = params.focus_session_id;
    const notedAt = params.noted_at;
    const note = params.note;
    const noteIsNull = params.note_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof focusSessionId !== "string" ||
      focusSessionId.length === 0 ||
      typeof notedAt !== "string" ||
      notedAt.length === 0 ||
      typeof note !== "string" ||
      typeof noteIsNull !== "boolean" ||
      (noteIsNull && note.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("distraction-bad-params");
    }
    active.exec(
      `INSERT INTO distractions (
         id, focus_session_id, noted_at, note, created_at, updated_at, version
       ) VALUES (?, ?, ?, CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         focus_session_id = excluded.focus_session_id,
         noted_at = excluded.noted_at,
         note = excluded.note,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          focusSessionId,
          notedAt,
          noteIsNull ? 1 : 0,
          note,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteDistraction") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("distraction-delete-bad-params");
    }
    active.exec("DELETE FROM distractions WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putProject") {
    const id = params.id;
    const name = params.name;
    const colorKey = params.color_key;
    const colorKeyIsNull = params.color_key_is_null;
    const archivedAt = params.archived_at;
    const archivedAtIsNull = params.archived_at_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 200 ||
      typeof colorKey !== "string" ||
      typeof colorKeyIsNull !== "boolean" ||
      (colorKeyIsNull && colorKey.length > 0) ||
      typeof archivedAt !== "string" ||
      typeof archivedAtIsNull !== "boolean" ||
      (archivedAtIsNull && archivedAt.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0)
    ) {
      throw new Error("project-bad-params");
    }
    active.exec(
      `INSERT INTO projects (
         id, name, color_key, archived_at, created_at, updated_at, version, deleted_at
       ) VALUES (
         ?, ?, CASE WHEN ? THEN NULL ELSE ? END,
         CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?,
         CASE WHEN ? THEN NULL ELSE ? END
       )
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         color_key = excluded.color_key,
         archived_at = excluded.archived_at,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          name,
          colorKeyIsNull ? 1 : 0,
          colorKey,
          archivedAtIsNull ? 1 : 0,
          archivedAt,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? 1 : 0,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putTag") {
    const id = params.id;
    const name = params.name;
    const colorKey = params.color_key;
    const colorKeyIsNull = params.color_key_is_null;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 60 ||
      typeof colorKey !== "string" ||
      typeof colorKeyIsNull !== "boolean" ||
      (colorKeyIsNull && colorKey.length > 0) ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0)
    ) {
      throw new Error("tag-bad-params");
    }
    active.exec(
      `INSERT INTO tags (id, name, color_key, created_at, updated_at, version, deleted_at)
       VALUES (?, ?, CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?,
               CASE WHEN ? THEN NULL ELSE ? END)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         color_key = excluded.color_key,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          name,
          colorKeyIsNull ? 1 : 0,
          colorKey,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? 1 : 0,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteMoodCheckin") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("mood-checkin-delete-bad-params");
    }
    active.exec("DELETE FROM mood_checkins WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "deleteHydrationEntry") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("hydration-entry-bad-params");
    }
    active.exec("DELETE FROM hydration_entries WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putGoal") {
    const id = params.id;
    const title = params.title;
    const description = params.description;
    const activeFrom = params.active_from;
    const activeUntil = params.active_until;
    const archivedAt = params.archived_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const deletedAt = params.deleted_at;
    const version = params.version;
    const validDate = (value: unknown): boolean =>
      typeof value === "string" && (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value));
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      typeof description !== "string" ||
      description.length > 2000 ||
      !validDate(activeFrom) ||
      !validDate(activeUntil) ||
      typeof archivedAt !== "string" ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof deletedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("goal-bad-params");
    }
    active.exec(
      `INSERT INTO goals (
         id, title, description, active_from, active_until, archived_at,
         created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         active_from = excluded.active_from,
         active_until = excluded.active_until,
         archived_at = excluded.archived_at,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          title,
          description,
          activeFrom,
          activeUntil,
          archivedAt,
          createdAt,
          updatedAt,
          version,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putGoalDay") {
    const id = params.id;
    const goalId = params.goal_id;
    const localDate = params.local_date;
    const completed = params.completed;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof goalId !== "string" ||
      goalId.length === 0 ||
      typeof localDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
      typeof completed !== "number" ||
      (completed !== 0 && completed !== 1) ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("goal-day-bad-params");
    }
    active.exec(
      `INSERT INTO goal_days (
         id, goal_id, local_date, completed, created_at, updated_at, version
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         goal_id = excluded.goal_id,
         local_date = excluded.local_date,
         completed = excluded.completed,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      { bind: [id, goalId, localDate, completed, createdAt, updatedAt, version] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putHabitRule") {
    const id = params.id;
    const goalId = params.goal_id;
    const goalIdIsNull = params.goal_id_is_null;
    const title = params.title;
    const cadence = params.cadence;
    const targetPerPeriod = params.target_per_period;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const deletedAt = params.deleted_at;
    const deletedAtIsNull = params.deleted_at_is_null;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof goalId !== "string" ||
      typeof goalIdIsNull !== "boolean" ||
      (goalIdIsNull ? goalId.length > 0 : goalId.length === 0) ||
      typeof title !== "string" ||
      title.trim().length === 0 ||
      title.length > 200 ||
      (cadence !== "daily" && cadence !== "weekly" && cadence !== "custom") ||
      typeof targetPerPeriod !== "number" ||
      !Number.isInteger(targetPerPeriod) ||
      targetPerPeriod < 1 ||
      typeof createdAt !== "string" ||
      createdAt.length === 0 ||
      typeof updatedAt !== "string" ||
      updatedAt.length === 0 ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1 ||
      typeof deletedAt !== "string" ||
      typeof deletedAtIsNull !== "boolean" ||
      (deletedAtIsNull && deletedAt.length > 0)
    ) {
      throw new Error("habit-rule-bad-params");
    }
    active.exec(
      `INSERT INTO habit_rules (
         id, goal_id, title, cadence, target_per_period,
         created_at, updated_at, version, deleted_at
       ) VALUES (?, CASE WHEN ? THEN NULL ELSE ? END, ?, ?, ?, ?, ?, ?,
         CASE WHEN ? THEN NULL ELSE ? END)
       ON CONFLICT(id) DO UPDATE SET
         goal_id = excluded.goal_id,
         title = excluded.title,
         cadence = excluded.cadence,
         target_per_period = excluded.target_per_period,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          goalIdIsNull ? 1 : 0,
          goalId,
          title,
          cadence,
          targetPerPeriod,
          createdAt,
          updatedAt,
          version,
          deletedAtIsNull ? 1 : 0,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteGoalDay") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("goal-day-bad-params");
    }
    active.exec("DELETE FROM goal_days WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  if (op === "putMeasurement") {
    const id = params.id;
    const type = params.type;
    const value = params.value;
    const secondaryValue = params.secondary_value;
    const unit = params.unit;
    const metricName = params.metric_name;
    const pulseBpm = params.pulse_bpm;
    const context = params.context;
    const measuredAt = params.measured_at;
    const note = params.note;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    const measurementTypes = [
      "weight",
      "blood-pressure",
      "blood-sugar",
      "temperature",
      "spo2",
      "body-measure",
      "custom",
    ];
    const contexts = ["morning", "evening", "resting", "after-activity", "other"];
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof type !== "string" ||
      !measurementTypes.includes(type) ||
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (secondaryValue !== "" &&
        (typeof secondaryValue !== "number" || !Number.isFinite(secondaryValue))) ||
      typeof unit !== "string" ||
      unit.trim().length === 0 ||
      unit.length > 20 ||
      typeof metricName !== "string" ||
      metricName.length > 60 ||
      (pulseBpm !== "" &&
        (typeof pulseBpm !== "number" ||
          !Number.isInteger(pulseBpm) ||
          pulseBpm < 1 ||
          pulseBpm > 300)) ||
      typeof context !== "string" ||
      (context !== "" && !contexts.includes(context)) ||
      typeof measuredAt !== "string" ||
      typeof note !== "string" ||
      note.length > 500 ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("measurement-bad-params");
    }
    active.exec(
      `INSERT INTO measurements (
         id, type, value, secondary_value, unit, metric_name, pulse_bpm, context,
         measured_at, note, created_at, updated_at, version
       ) VALUES (?, ?, ?, NULLIF(?, ''), ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''), ?, ?, ?);`,
      {
        bind: [
          id,
          type,
          value,
          secondaryValue,
          unit,
          metricName,
          pulseBpm,
          context,
          measuredAt,
          note,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putFood") {
    const id = params.id;
    const name = params.name;
    const values = [
      params.calories_per_100g,
      params.protein_per_100g,
      params.carbs_per_100g,
      params.fat_per_100g,
      params.fiber_per_100g,
    ];
    const servingSize = params.serving_size_g;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const deletedAt = params.deleted_at;
    const version = params.version;
    const validNullableNumber = (value: unknown): boolean =>
      value === "" || (typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 200 ||
      hasControlCharacters(name) ||
      !values.every(validNullableNumber) ||
      (servingSize !== "" &&
        (typeof servingSize !== "number" || !Number.isFinite(servingSize) || servingSize <= 0)) ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof deletedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("food-bad-params");
    }
    active.exec(
      `INSERT INTO foods (
         id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
         fiber_per_100g, serving_size_g, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
                 NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         calories_per_100g = excluded.calories_per_100g,
         protein_per_100g = excluded.protein_per_100g,
         carbs_per_100g = excluded.carbs_per_100g,
         fat_per_100g = excluded.fat_per_100g,
         fiber_per_100g = excluded.fiber_per_100g,
         serving_size_g = excluded.serving_size_g,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [id, name, ...values, servingSize, createdAt, updatedAt, version, deletedAt],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putNutritionEntry") {
    const id = params.id;
    const eatenAt = params.eaten_at;
    const foodId = params.food_id;
    const amountG = params.amount_g;
    const mealSlotId = params.meal_slot_id;
    const label = params.label;
    const calories = params.calories;
    const proteinG = params.protein_g;
    const carbsG = params.carbs_g;
    const fatG = params.fat_g;
    const fiberG = params.fiber_g;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const deletedAt = params.deleted_at;
    const version = params.version;
    const nullableNutrients = [calories, proteinG, carbsG, fatG, fiberG];
    const validNullableNutrient = (value: unknown): boolean =>
      value === "" || (typeof value === "number" && Number.isFinite(value) && value >= 0);
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof eatenAt !== "string" ||
      typeof foodId !== "string" ||
      (foodId !== "" &&
        (foodId.trim().length === 0 || foodId.length > 128 || hasControlCharacters(foodId))) ||
      (amountG !== "" &&
        (typeof amountG !== "number" || !Number.isFinite(amountG) || amountG <= 0)) ||
      typeof mealSlotId !== "string" ||
      mealSlotId.length > 60 ||
      (mealSlotId !== "" && mealSlotId.trim().length === 0) ||
      hasControlCharacters(mealSlotId) ||
      typeof label !== "string" ||
      label.trim().length === 0 ||
      label.length > 200 ||
      hasControlCharacters(label) ||
      !nullableNutrients.every(validNullableNutrient) ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof deletedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("nutrition-entry-bad-params");
    }
    active.exec(
      `INSERT INTO nutrition_entries (
         id, eaten_at, food_id, amount_g, meal_slot_id, label, calories, protein_g,
         carbs_g, fat_g, fiber_g, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, NULLIF(?, ''),
                 NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         eaten_at = excluded.eaten_at,
         food_id = excluded.food_id,
         amount_g = excluded.amount_g,
         meal_slot_id = excluded.meal_slot_id,
         label = excluded.label,
         calories = excluded.calories,
         protein_g = excluded.protein_g,
         carbs_g = excluded.carbs_g,
         fat_g = excluded.fat_g,
         fiber_g = excluded.fiber_g,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          eatenAt,
          foodId,
          amountG,
          mealSlotId,
          label,
          calories,
          proteinG,
          carbsG,
          fatG,
          fiberG,
          createdAt,
          updatedAt,
          version,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putRecipe") {
    const id = params.id;
    const name = params.name;
    const servings = params.servings;
    const ingredientsJson = params.ingredients_json;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const deletedAt = params.deleted_at;
    const version = params.version;
    let ingredients: unknown;
    try {
      ingredients = typeof ingredientsJson === "string" ? JSON.parse(ingredientsJson) : null;
    } catch {
      throw new Error("recipe-bad-params");
    }
    const validIngredients =
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
          row.food_id.length <= 128 &&
          !hasControlCharacters(row.food_id) &&
          (row.amount_g === null ||
            (typeof row.amount_g === "number" &&
              Number.isFinite(row.amount_g) &&
              row.amount_g > 0)) &&
          row.position === index
        );
      });
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 200 ||
      hasControlCharacters(name) ||
      (servings !== "" &&
        (typeof servings !== "number" || !Number.isFinite(servings) || servings <= 0)) ||
      !validIngredients ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof deletedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("recipe-bad-params");
    }

    active.exec("SAVEPOINT put_recipe;");
    try {
      active.exec(
        `INSERT INTO recipes (id, name, servings, created_at, updated_at, version, deleted_at)
         VALUES (?, ?, NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           servings = excluded.servings,
           updated_at = excluded.updated_at,
           version = excluded.version,
           deleted_at = excluded.deleted_at;`,
        { bind: [id, name, servings, createdAt, updatedAt, version, deletedAt] },
      );
      active.exec("DELETE FROM recipe_foods WHERE recipe_id = ?;", { bind: [id] });
      for (const ingredient of ingredients as readonly {
        readonly food_id: string;
        readonly amount_g: number | null;
        readonly position: number;
      }[]) {
        active.exec(
          `INSERT INTO recipe_foods (recipe_id, food_id, amount_g, position)
           VALUES (?, ?, ?, ?);`,
          { bind: [id, ingredient.food_id, ingredient.amount_g, ingredient.position] },
        );
      }
      active.exec("RELEASE put_recipe;");
    } catch (error) {
      try {
        active.exec("ROLLBACK TO put_recipe;");
        active.exec("RELEASE put_recipe;");
      } catch {
        // Säilytä alkuperäinen tallennusvirhe.
      }
      throw error;
    }
    checkpointPassive(active);
    return;
  }
  if (op === "putSupplement") {
    const id = params.id;
    const name = params.name;
    const doseLabel = params.dose_label;
    const amount = params.amount;
    const unit = params.unit;
    const scheduleJson = params.schedule_json;
    const stockAmount = params.stock_amount;
    const stockUnit = params.stock_unit;
    const stockCountedAt = params.stock_counted_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const deletedAt = params.deleted_at;
    const version = params.version;
    const validOptionalAmount = (value: unknown, allowZero: boolean): boolean =>
      value === "" ||
      (typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0));
    let schedule: unknown;
    try {
      schedule = scheduleJson === "" ? null : JSON.parse(String(scheduleJson));
    } catch {
      throw new Error("supplement-bad-schedule");
    }
    const validSchedule =
      schedule === null ||
      (Array.isArray(schedule) &&
        schedule.length <= 12 &&
        schedule.every(
          (time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(time),
        ) &&
        new Set(schedule).size === schedule.length);
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof name !== "string" ||
      name.trim().length === 0 ||
      name.length > 200 ||
      hasControlCharacters(name) ||
      (doseLabel !== "" &&
        (typeof doseLabel !== "string" ||
          doseLabel.length > 200 ||
          hasControlCharacters(doseLabel))) ||
      !validOptionalAmount(amount, false) ||
      typeof unit !== "string" ||
      (unit !== "" &&
        (unit.trim().length === 0 || unit.length > 40 || hasControlCharacters(unit))) ||
      !validSchedule ||
      !validOptionalAmount(stockAmount, true) ||
      typeof stockUnit !== "string" ||
      (stockUnit !== "" &&
        (stockUnit.trim().length === 0 ||
          stockUnit.length > 40 ||
          hasControlCharacters(stockUnit))) ||
      typeof stockCountedAt !== "string" ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof deletedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("supplement-bad-params");
    }
    active.exec(
      `INSERT INTO supplements (
         id, name, dose_label, amount, unit, schedule_json, stock_amount, stock_unit,
         stock_counted_at, created_at, updated_at, version, deleted_at
       ) VALUES (?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''),
                 NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?, NULLIF(?, ''))
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         dose_label = excluded.dose_label,
         amount = excluded.amount,
         unit = excluded.unit,
         schedule_json = excluded.schedule_json,
         stock_amount = excluded.stock_amount,
         stock_unit = excluded.stock_unit,
         stock_counted_at = excluded.stock_counted_at,
         updated_at = excluded.updated_at,
         version = excluded.version,
         deleted_at = excluded.deleted_at;`,
      {
        bind: [
          id,
          name,
          doseLabel,
          amount,
          unit,
          scheduleJson,
          stockAmount,
          stockUnit,
          stockCountedAt,
          createdAt,
          updatedAt,
          version,
          deletedAt,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "putSupplementLog") {
    const id = params.id;
    const supplementId = params.supplement_id;
    const status = params.status;
    const scheduledAt = params.scheduled_at;
    const doseAmount = params.dose_amount;
    const doseUnit = params.dose_unit;
    const takenAt = params.taken_at;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    const version = params.version;
    if (
      typeof id !== "string" ||
      id.length === 0 ||
      typeof supplementId !== "string" ||
      supplementId.length === 0 ||
      (status !== "taken" && status !== "skipped" && status !== "pending") ||
      typeof scheduledAt !== "string" ||
      (doseAmount !== "" &&
        (typeof doseAmount !== "number" || !Number.isFinite(doseAmount) || doseAmount <= 0)) ||
      typeof doseUnit !== "string" ||
      (doseUnit !== "" &&
        (doseUnit.trim().length === 0 || doseUnit.length > 40 || hasControlCharacters(doseUnit))) ||
      typeof takenAt !== "string" ||
      (status === "taken" && takenAt === "") ||
      (status !== "taken" && takenAt !== "") ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string" ||
      typeof version !== "number" ||
      !Number.isInteger(version) ||
      version < 1
    ) {
      throw new Error("supplement-log-bad-params");
    }
    active.exec(
      `INSERT INTO supplement_logs (
         id, supplement_id, status, scheduled_at, dose_amount, dose_unit, taken_at,
         created_at, updated_at, version
       ) VALUES (?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         supplement_id = excluded.supplement_id,
         status = excluded.status,
         scheduled_at = excluded.scheduled_at,
         dose_amount = excluded.dose_amount,
         dose_unit = excluded.dose_unit,
         taken_at = excluded.taken_at,
         updated_at = excluded.updated_at,
         version = excluded.version;`,
      {
        bind: [
          id,
          supplementId,
          status,
          scheduledAt,
          doseAmount,
          doseUnit,
          takenAt,
          createdAt,
          updatedAt,
          version,
        ],
      },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteSupplementLog") {
    const id = params.id;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("supplement-log-delete-bad-params");
    }
    active.exec("DELETE FROM supplement_logs WHERE id = ?;", { bind: [id] });
    checkpointPassive(active);
    return;
  }
  // T130: geneerinen entity-doc tallenne (appin EntityStoreille; §32 nimetty
  // op — ei raakaa SQL:ää clientiltä). doc on kokonaisentiteetti JSONinä;
  // repos hallitsevat version/updatedAt-invariantit.
  if (op === "putEntity") {
    const entityType = params.entity_type;
    const id = params.id;
    const docVersion = params.doc_version;
    const doc = params.doc;
    const createdAt = params.created_at;
    const updatedAt = params.updated_at;
    if (
      typeof entityType !== "string" ||
      entityType.length === 0 ||
      typeof id !== "string" ||
      id.length === 0 ||
      typeof docVersion !== "number" ||
      !Number.isInteger(docVersion) ||
      docVersion < 0 ||
      typeof doc !== "string" ||
      typeof createdAt !== "string" ||
      typeof updatedAt !== "string"
    ) {
      throw new Error("entity-doc-bad-params");
    }
    active.exec(
      `INSERT INTO entity_docs (entity_type, id, doc_version, doc, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, id) DO UPDATE SET
         doc_version = excluded.doc_version,
         doc = excluded.doc,
         updated_at = excluded.updated_at;`,
      { bind: [entityType, id, docVersion, doc, createdAt, updatedAt] },
    );
    checkpointPassive(active);
    return;
  }
  if (op === "deleteEntity") {
    const deleteType = params.entity_type;
    const deleteId = params.id;
    if (
      typeof deleteType !== "string" ||
      deleteType.length === 0 ||
      typeof deleteId !== "string" ||
      deleteId.length === 0
    ) {
      throw new Error("entity-doc-bad-params");
    }
    active.exec("DELETE FROM entity_docs WHERE entity_type = ? AND id = ?;", {
      bind: [deleteType, deleteId],
    });
    checkpointPassive(active);
    return;
  }
  // Jäljellä putMeta (protokolla takaa op-joukon + paramtyypit).
  const key = params.key;
  const value = params.value;
  active.exec(
    "INSERT INTO _lifeos_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
    { bind: [key, value] },
  );
  checkpointPassive(active);
}

function collection(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * T039: paikallinen sulku (ei vastausta). Flushaa + vapauttaa SAHit jotta
 * seuraava sivu saa lukot. Jaettu close-pyynnön ja pagehide-kuuntelijan
 * kesken. sqlite3-moduulia EI nollata (VFS-rekisteröinti säilyy samassa
 * workerissa). Kaikki best-effort — sivu voi olla jo menossa.
 */
function closeLocalDatabase(): void {
  try {
    // 1. PRAGMA wal_checkpoint(TRUNCATE) ajaa -wal-sivut pääkantaan.
    // 2. journal_mode=DELETE checkpointaa mahdollisen vanhan WALin.
    // 3. db.close() flushaa + vapauttaa SAHit.
    try {
      db?.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      // Ei WAL-tilaa / ei tukea — jatketaan.
    }
    try {
      db?.exec("PRAGMA journal_mode=DELETE;");
    } catch {
      // Best-effort.
    }
    db?.close();
  } catch {
    // Sulku on best-effort; tila nollataan silti.
  }
  db = null;
  backend = "memory";
  persisted = false;
}

/**
 * T039: pagehide-kuuntelija (db.worker.ts) kutsuu tätä kun sivu piilotetaan
 * (bfcache + sulku). Sama sulku kuin close-pyynnössä, mutta ilman vastausta
 * (ei postMessagea — sivu on jo menossa eikä kuuntele).
 */
export function notifyPageHidden(): void {
  closeLocalDatabase();
}

const RESTORE_TOMBSTONE_TARGETS: Partial<Record<DbRestoreWriteOp, string>> = {
  putTask: "tasks",
  putTaskChecklistItem: "task_checklist_items",
  putCalendarBlock: "calendar_blocks",
  putRoutine: "routines",
  putRoutineStep: "routine_steps",
  putRoutineSchedule: "routine_schedules",
  putGoal: "goals",
  putHabitRule: "habit_rules",
  putSleepEntry: "sleep_entries",
  putActivityEntry: "activity_entries",
  putReminder: "reminders",
  putSupplement: "supplements",
  putProject: "projects",
  putTag: "tags",
  putJournalEntry: "journal_entries",
  putFood: "foods",
  putRecipe: "recipes",
  putNutritionEntry: "nutrition_entries",
};

function restoreWritePreservingTombstone(active: SqliteDb, write: DbRestoreWrite): DbRestoreWrite {
  const target = RESTORE_TOMBSTONE_TARGETS[write.op];
  const backupDeletedAt = write.params.deleted_at;
  const id = write.params.id;
  if (
    target === undefined ||
    typeof id !== "string" ||
    typeof backupDeletedAt !== "string" ||
    backupDeletedAt.length > 0
  ) {
    return write;
  }
  const rows: Record<string, unknown>[] = [];
  active.exec(`SELECT deleted_at FROM ${target} WHERE id = ? LIMIT 1;`, {
    bind: [id],
    rowMode: "object",
    resultRows: rows,
  });
  const existingDeletedAt = rows[0]?.deleted_at;
  if (typeof existingDeletedAt !== "string" || existingDeletedAt.length === 0) return write;
  return {
    ...write,
    params: {
      ...write.params,
      deleted_at: existingDeletedAt,
      ...(typeof write.params.deleted_at_is_null === "boolean"
        ? { deleted_at_is_null: false }
        : {}),
    },
  };
}

function existingImmutableRestoreRecord(active: SqliteDb, write: DbRestoreWrite): boolean {
  const id = write.params.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("restore-immutable-record-invalid-id");
  }
  let rows: Record<string, unknown>[] = [];
  let sameRecord: boolean;
  if (write.op === "putXpTransaction") {
    rows = [];
    active.exec(
      `SELECT id, source, source_entity_id, amount, earned_at, reason,
              created_at, updated_at, version
       FROM xp_transactions WHERE id = ? LIMIT 1;`,
      { bind: [id], rowMode: "object", resultRows: rows },
    );
    const existing = rows[0];
    if (existing === undefined) return false;
    sameRecord =
      existing.id === id &&
      existing.source === write.params.source &&
      existing.source_entity_id ===
        (write.params.source_entity_id === "" ? null : write.params.source_entity_id) &&
      existing.amount === write.params.amount &&
      existing.earned_at === write.params.earned_at &&
      existing.reason === (write.params.reason_is_null === true ? null : write.params.reason) &&
      existing.created_at === write.params.created_at &&
      existing.updated_at === write.params.updated_at &&
      existing.version === write.params.version;
  } else if (write.op === "putUserReward") {
    active.exec(
      `SELECT id, achievement_id, collectible_id, earned_at, created_at, updated_at, version
       FROM user_rewards WHERE id = ? LIMIT 1;`,
      { bind: [id], rowMode: "object", resultRows: rows },
    );
    const existing = rows[0];
    if (existing === undefined) return false;
    sameRecord =
      existing.id === id &&
      existing.achievement_id ===
        (write.params.achievement_id_is_null === true ? null : write.params.achievement_id) &&
      existing.collectible_id ===
        (write.params.collectible_id_is_null === true ? null : write.params.collectible_id) &&
      existing.earned_at === write.params.earned_at &&
      existing.created_at === write.params.created_at &&
      existing.updated_at === write.params.updated_at &&
      existing.version === write.params.version;
  } else if (write.op === "putVaultRewardClaim") {
    active.exec(
      `SELECT id, reward_id, claimed_at, xp_deducted, created_at, updated_at, version
       FROM vault_reward_claims WHERE id = ? LIMIT 1;`,
      { bind: [id], rowMode: "object", resultRows: rows },
    );
    const existing = rows[0];
    if (existing === undefined) return false;
    sameRecord =
      existing.id === id &&
      existing.reward_id === write.params.reward_id &&
      existing.claimed_at === write.params.claimed_at &&
      existing.xp_deducted === write.params.xp_deducted &&
      existing.created_at === write.params.created_at &&
      existing.updated_at === write.params.updated_at &&
      existing.version === write.params.version;
  } else {
    return false;
  }
  if (!sameRecord) throw new Error(`restore-${write.op}-id-conflict`);
  return true;
}

export type RestoreTransactionResult =
  { readonly ok: true } | { readonly ok: false; readonly index: number; readonly error: unknown };

export type RestoreSqliteDb = SqliteDb;

/** Runs the restore write set with the same executor and transaction boundaries as the worker. */
export function executeRestoreTransaction(
  active: RestoreSqliteDb,
  writes: readonly DbRestoreWrite[],
): RestoreTransactionResult {
  let activeIndex = -1;
  try {
    active.exec("BEGIN;");
    deferPassiveCheckpointForRestore = true;
    for (const [index, write] of writes.entries()) {
      activeIndex = index;
      if (existingImmutableRestoreRecord(active, write)) continue;
      const safeWrite = restoreWritePreservingTombstone(active, write);
      executeNamedOp(active, safeWrite.op, safeWrite.params);
      persistPrivateWrite(active, safeWrite.op, safeWrite.params);
      cleanupDeletedPrivateRecord(active, safeWrite.op, safeWrite.params);
    }
    deferPassiveCheckpointForRestore = false;
    active.exec("COMMIT;");
    checkpointPassive(active);
    return { ok: true };
  } catch (error) {
    deferPassiveCheckpointForRestore = false;
    try {
      active.exec("ROLLBACK;");
    } catch {
      // Rollback best-effort; return the failure from the transaction body.
    }
    return { ok: false, index: activeIndex, error };
  }
}

async function handleRequest(request: DbRequest): Promise<DbResponse> {
  // ping/close käsitellään heti; open/migrate/exec/query vaativat avoimen
  // yhteyden. If-else-ketju (ei switch+if-sekoitusta) jotta type-aware-lintti
  // seuraa kavennusta läpi funktion ilman mahdottomia vertailuja.
  if (request.kind === "local-key") {
    if (request.action === "lock") {
      lockLocalContentKey();
      return success(request.requestId, []);
    }
    const candidateKey = new Uint8Array(request.key);
    request.key.fill(0);
    const openFailure = await ensureOpen(request.requestId);
    if (openFailure !== null || db === null) {
      candidateKey.fill(0);
      return openFailure ?? failure(request.requestId, "transient-failure", "db.open.missing");
    }
    try {
      runMigrations(db, CURRENT_SCHEMA_VERSION);
      if (!activateLocalContentKey(db, candidateKey)) {
        candidateKey.fill(0);
        return failure(request.requestId, "invalid-input", "db.local-content.key-invalid");
      }
      candidateKey.fill(0);
      return success(request.requestId, []);
    } catch {
      candidateKey.fill(0);
      return failure(request.requestId, "storage-unavailable", "db.local-content.unlock-failed");
    }
  }
  if (request.kind === "ping") {
    return success(request.requestId, []);
  }
  if (request.kind === "close") {
    closeLocalDatabase();
    return success(request.requestId, []);
  }
  const openFailure = await ensureOpen(request.requestId);
  if (openFailure !== null || db === null) {
    return openFailure ?? failure(request.requestId, "transient-failure", "db.open.missing");
  }
  const active: SqliteDb = db;
  const encryptionEnabled = localContentEncryptionEnabled(active);
  if (
    encryptionEnabled &&
    localContentKey === null &&
    ((request.kind === "query" && isPrivateQuery(request.op)) ||
      (request.kind === "exec" && isPrivateWrite(request.op)) ||
      (request.kind === "transaction" && request.ops.some((write) => isPrivateWrite(write.op))) ||
      (request.kind === "restore" && request.ops.some((write) => isPrivateWrite(write.op))))
  ) {
    return failure(request.requestId, "storage-unavailable", "db.local-content.locked");
  }
  // open/migrate if-haaroina (switch-case yllä + nämä: lintti seuraa
  // if-kavennusta läpi funktion loppuun ilman mahdottomia vertailuja).
  if (request.kind === "open") {
    // T031: open ei luo skeemaa — vain yhteys + pragma. Taulut syntyvät
    // migrate-pyynnöstä (versionoitu ketju).
    // T038 (sync-eheys): journal_mode=DELETE (ei -wal-tiedostoa) +
    // synchronous=FULL (jokainen commit flushaa SAH:n OPFS:ään välittömästi;
    // ilman tätä reload voi nähdä vanhan kannan). Kustannus: hitaammat
    // kirjoitukset (B01-volyymeillä merkityksetön); hyöty: deterministinen
    // persistenssi. Muistibackend saa pitää oletuksensa.
    try {
      if (backend === "opfs-sahpool" || backend === "opfs") {
        active.exec("PRAGMA journal_mode=DELETE;");
        active.exec("PRAGMA synchronous=FULL;");
      }
      active.exec("PRAGMA foreign_keys=ON;");
      return success(request.requestId, [], readUserVersion(active));
    } catch (error) {
      return failure(request.requestId, toFailureCode(error), "db.open.failed");
    }
  } else if (request.kind === "migrate") {
    try {
      const version = runMigrations(active, request.targetVersion);
      return success(request.requestId, [], version);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        message.startsWith("migration-chain-invalid") ||
        message.startsWith("migration-target-too-new")
      ) {
        return failure(
          request.requestId,
          "invalid-input",
          `db.migrate.${message.split(":")[0] ?? "invalid"}`,
        );
      }
      if (message.startsWith("migration-downgrade-refused")) {
        return failure(request.requestId, "invalid-input", "db.migrate.downgrade-refused");
      }
      return failure(request.requestId, toFailureCode(error), "db.migrate.failed");
    }
  } else if (request.kind === "restore") {
    const restoreRequestId = request.requestId;
    let writes: DbRestoreWrite[];
    try {
      writes = request.ops.map((write) => ({
        ...write,
        params: protectNamedWrite(active, write.op, write.params),
      }));
    } catch {
      return failure(restoreRequestId, "storage-unavailable", "db.local-content.locked");
    }
    const restored = executeRestoreTransaction(active, writes);
    if (!restored.ok) {
      const diagnostic =
        restored.index >= 0 ? `db.restore.failed.op${String(restored.index)}` : "db.restore.failed";
      return failure(restoreRequestId, toFailureCode(restored.error), diagnostic);
    }
    return success(restoreRequestId, []);
  } else if (request.kind === "transaction") {
    // T076/T302: atominen kirjoituserä — kaikki tai ei mitään (§32). Outbox-
    // operationId tarkistetaan ennen domain-oppeja, jotta retry ohittaa koko
    // liiketoimintatapahtuman eikä kirjoita vanhaa versiota uudestaan.
    const txRequestId = request.requestId;
    let preparedOps: typeof request.ops;
    try {
      preparedOps = request.ops.map((write) => ({
        ...write,
        params: protectNamedWrite(active, write.op, write.params),
      }));
    } catch {
      return failure(txRequestId, "storage-unavailable", "db.local-content.locked");
    }
    try {
      active.exec("BEGIN;");
      const resolveWrite = request.ops.find((write) => write.op === "resolveConflictRecord");
      let identicalExistingSyncOperation = false;
      const syncWrite = request.ops.find((write) => write.op === "putSyncOperation");
      if (syncWrite !== undefined) {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, operation_id, installation_id, entity_type, entity_id, operation,
                  entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
                  created_at, updated_at, version
           FROM sync_operations WHERE operation_id = ? LIMIT 1;`,
          {
            bind: [syncWrite.params.operation_id],
            rowMode: "object",
            resultRows: rows,
          },
        );
        const existing = rows[0];
        if (existing !== undefined) {
          const fields = [
            "id",
            "operation_id",
            "installation_id",
            "entity_type",
            "entity_id",
            "operation",
            "entity_version",
            "occurred_at",
            "encrypted_payload_ref",
            "integrity_ref",
            "created_at",
            "updated_at",
            "version",
          ] as const;
          const sameOperation = fields.every(
            (field) => existing[field] === syncWrite.params[field],
          );
          if (!sameOperation) {
            active.exec("ROLLBACK;");
            return failure(txRequestId, "invalid-input", "db.sync.operation-id-conflict");
          }
          if (resolveWrite === undefined) {
            active.exec("ROLLBACK;");
            return success(txRequestId, []);
          }
          identicalExistingSyncOperation = true;
        }
        if (
          !identicalExistingSyncOperation &&
          isSyncInstallationRevoked(
            active,
            String(syncWrite.params.installation_id),
            String(syncWrite.params.occurred_at),
          )
        ) {
          active.exec("ROLLBACK;");
          return failure(txRequestId, "invalid-input", "db.sync.installation-revoked");
        }
      }
      const conflictWrite = request.ops.find((write) => write.op === "putConflictRecord");
      if (conflictWrite !== undefined) {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, entity_type, entity_id, local_version_ref, remote_version_ref, created_at
           FROM conflict_records WHERE id = ? LIMIT 1;`,
          {
            bind: [conflictWrite.params.id],
            rowMode: "object",
            resultRows: rows,
          },
        );
        const existing = rows[0];
        if (existing !== undefined) {
          const fields = [
            "id",
            "entity_type",
            "entity_id",
            "local_version_ref",
            "remote_version_ref",
            "created_at",
          ] as const;
          const sameConflict = fields.every(
            (field) => existing[field] === conflictWrite.params[field],
          );
          active.exec("ROLLBACK;");
          return sameConflict
            ? success(txRequestId, [])
            : failure(txRequestId, "invalid-input", "db.sync.conflict-id-conflict");
        }
      }
      if (resolveWrite !== undefined) {
        const resolutionOperation = request.ops.find((write) => write.op === "putSyncOperation");
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT entity_type, entity_id, status, resolution_operation_id
           FROM conflict_records WHERE id = ? LIMIT 1;`,
          {
            bind: [resolveWrite.params.id],
            rowMode: "object",
            resultRows: rows,
          },
        );
        const existing = rows[0];
        const sameResolvedConflict =
          existing?.status === "resolved" &&
          existing.resolution_operation_id === resolveWrite.params.resolution_operation_id;
        if (sameResolvedConflict) {
          active.exec("ROLLBACK;");
          return success(txRequestId, []);
        }
        if (
          existing === undefined ||
          existing.status !== "open" ||
          resolutionOperation === undefined ||
          resolveWrite.params.resolution_operation_id !== resolutionOperation.params.operation_id ||
          resolveWrite.params.updated_at !== resolutionOperation.params.occurred_at ||
          existing.entity_type !== resolutionOperation.params.entity_type ||
          existing.entity_id !== resolutionOperation.params.entity_id ||
          resolutionOperation.params.operation !== "resolve"
        ) {
          active.exec("ROLLBACK;");
          return failure(txRequestId, "invalid-input", "db.sync.conflict-not-open");
        }
      }
      for (const [index, write] of request.ops.entries()) {
        if (identicalExistingSyncOperation && write.op === "putSyncOperation") continue;
        try {
          const prepared = preparedOps[index];
          if (prepared === undefined) throw new Error("transaction-prepared-write-missing");
          executeNamedOp(active, prepared.op, prepared.params);
          persistPrivateWrite(active, prepared.op, prepared.params);
          cleanupDeletedPrivateRecord(active, prepared.op, prepared.params);
        } catch (error) {
          try {
            active.exec("ROLLBACK;");
          } catch {
            // Rollback best-effort; alkuperäinen virhe ratkaisee.
          }
          return failure(
            txRequestId,
            toFailureCode(error),
            `db.transaction.failed.op${String(index)}`,
          );
        }
      }
      active.exec("COMMIT;");
      checkpointPassive(active);
      return success(txRequestId, []);
    } catch (error) {
      try {
        active.exec("ROLLBACK;");
      } catch {
        // Rollback best-effort.
      }
      return failure(txRequestId, toFailureCode(error), "db.transaction.failed");
    }
  }
  // Tässä kohtaa ping/close/open/migrate on käsitelty yllä; alla exec/query.
  // If-else-kavennus yllä jättää tyypiksi exec|query. Erotetaan query ensin
  // (kind-toisto sallittu tässä: kumpaakaan ei ole vielä päätelty todeksi),
  // sitten exec, sitten puolustuksellinen unreachable.
  const requestId = request.requestId;
  try {
    if (request.kind === "query") {
      const queryOp = request.op;
      if (queryOp === "getMeta") {
        const key = request.params.key;
        if (key === undefined) {
          return failure(requestId, "invalid-input", "db.query.getMeta.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec("SELECT value FROM _lifeos_meta WHERE key = ?;", {
          bind: [key],
          rowMode: "object",
          resultRows: rows,
        });
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listMetaKeys") {
        const rows: Record<string, unknown>[] = [];
        active.exec("SELECT key FROM _lifeos_meta ORDER BY key;", {
          rowMode: "object",
          resultRows: rows,
        });
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getSchemaVersion") {
        return success(requestId, [{ version: readUserVersion(active) }]);
      }
      // T060: asetusrivi (get-or-create singleton; client luo rivin service-
      // kerroksessa — worker palauttaa tyhjän jos riviä ei vielä ole).
      if (queryOp === "getPreferences") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, theme, day_start_hour, gamification_visible, enabled_sections,
                  notification_defaults_enabled, app_lock_enabled, created_at, updated_at, version,
                  weight_target, height_cm, meal_slots, macro_targets, hydration_target_ml,
                  hydration_reminder_time, notification_categories
           FROM user_preferences ORDER BY created_at, id LIMIT 1;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      // T061: aktiivinen asennusrivi (yksi per profiili; vanhin = aktiivinen).
      if (queryOp === "getActiveInstallation") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, installation_id, installation_name, last_seen_app_version,
                  last_sync_at, revoked_at, created_at, updated_at, version
           FROM browser_installations WHERE is_local = 1 ORDER BY created_at, id LIMIT 1;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listInstallations") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, installation_id, installation_name, last_seen_app_version,
                  last_sync_at, revoked_at, created_at, updated_at, version
           FROM browser_installations ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listSyncOperations") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, operation_id, installation_id, entity_type, entity_id, operation,
                  entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
                  created_at, updated_at, version
           FROM sync_operations ORDER BY created_at, operation_id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getSyncCursor") {
        const installationId = request.params.installation_id;
        const providerId = request.params.provider_id;
        if (
          typeof installationId !== "string" ||
          installationId.length === 0 ||
          typeof providerId !== "string" ||
          providerId.length === 0
        ) {
          return failure(requestId, "invalid-input", "db.query.getSyncCursor.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, installation_id, provider_id, provider_cursor,
                  last_seen_operation_id, updated_through, created_at, updated_at, version
           FROM sync_cursors WHERE installation_id = ? AND provider_id = ? LIMIT 1;`,
          { bind: [installationId, providerId], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listConflictRecords") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, entity_type, entity_id, status, local_version_ref, remote_version_ref,
                  resolved_at, resolution_operation_id, created_at, updated_at, version
           FROM conflict_records ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "integrityCheck") {
        const rows: Record<string, unknown>[] = [];
        active.exec("PRAGMA integrity_check;", { rowMode: "object", resultRows: rows });
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getHydrationEntry") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getHydrationEntry.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, drunk_at, milliliters, created_at, updated_at, version
           FROM hydration_entries WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listHydrationEntries") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, drunk_at, milliliters, created_at, updated_at, version
           FROM hydration_entries ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getSleepEntry" || queryOp === "listSleepEntries") {
        const id = queryOp === "getSleepEntry" ? request.params.id : undefined;
        if (queryOp === "getSleepEntry" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getSleepEntry.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, sleep_start, sleep_end, quality, is_nap, created_at, updated_at, version, deleted_at
           FROM sleep_entries
           ${queryOp === "getSleepEntry" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getSleepEntry" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getActivityEntry" || queryOp === "listActivityEntries") {
        const id = queryOp === "getActivityEntry" ? request.params.id : undefined;
        if (queryOp === "getActivityEntry" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getActivityEntry.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, activity_at, kind, duration_seconds, distance_meters, note,
                  created_at, updated_at, version, deleted_at
           FROM activity_entries
           ${queryOp === "getActivityEntry" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getActivityEntry" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getMoodCheckin" || queryOp === "listMoodCheckins") {
        const id = queryOp === "getMoodCheckin" ? request.params.id : undefined;
        if (queryOp === "getMoodCheckin" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getMoodCheckin.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, checked_at, mood, stress, energy, motivation, focus, note, created_at, updated_at, version
           FROM mood_checkins
           ${queryOp === "getMoodCheckin" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getMoodCheckin" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getJournalEntry" || queryOp === "listJournalEntries") {
        const id = queryOp === "getJournalEntry" ? request.params.id : undefined;
        if (queryOp === "getJournalEntry" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getJournalEntry.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, written_at, title, body, reflection_success, reflection_difficult,
                  reflection_tomorrow, created_at, updated_at, version, deleted_at
           FROM journal_entries
           ${queryOp === "getJournalEntry" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getJournalEntry" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getBreathingSession" || queryOp === "listBreathingSessions") {
        const id = queryOp === "getBreathingSession" ? request.params.id : undefined;
        if (queryOp === "getBreathingSession" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getBreathingSession.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, started_at, ended_at, pattern_key, created_at, updated_at, version
           FROM breathing_sessions
           ${queryOp === "getBreathingSession" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getBreathingSession" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getReminder" || queryOp === "listReminders") {
        const id = queryOp === "getReminder" ? request.params.id : undefined;
        if (queryOp === "getReminder" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getReminder.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, kind, route, title, fire_at, snoozed_until, rule_json, category_key, enabled,
                  created_at, updated_at, version, deleted_at
           FROM reminders
           ${queryOp === "getReminder" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getReminder" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getNotificationState" || queryOp === "listNotificationStates") {
        const id = queryOp === "getNotificationState" ? request.params.id : undefined;
        if (queryOp === "getNotificationState" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getNotificationState.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, reminder_id, category_key, delivery, last_evaluated_at,
                  created_at, updated_at, version
           FROM notification_states
           ${queryOp === "getNotificationState" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getNotificationState" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getQuest" || queryOp === "listQuests") {
        const id = queryOp === "getQuest" ? request.params.id : undefined;
        if (queryOp === "getQuest" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getQuest.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, title, description, active_from, active_until,
                  condition_kind, condition_goal, minimum_amount,
                  created_at, updated_at, version
           FROM quests
           ${queryOp === "getQuest" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getQuest" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getQuestProgress" || queryOp === "listQuestProgress") {
        const id = queryOp === "getQuestProgress" ? request.params.id : undefined;
        if (queryOp === "getQuestProgress" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getQuestProgress.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, quest_id, progress, goal, completed_at, created_at, updated_at, version
           FROM quest_progress
           ${queryOp === "getQuestProgress" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getQuestProgress" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getVaultReward" || queryOp === "listVaultRewards") {
        const id = queryOp === "getVaultReward" ? request.params.id : undefined;
        if (queryOp === "getVaultReward" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getVaultReward.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, title, note, xp_threshold, created_at, updated_at, version
           FROM vault_rewards
           ${queryOp === "getVaultReward" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getVaultReward" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getVaultRewardClaim" || queryOp === "listVaultRewardClaims") {
        const id = queryOp === "getVaultRewardClaim" ? request.params.id : undefined;
        if (queryOp === "getVaultRewardClaim" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getVaultRewardClaim.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, reward_id, claimed_at, xp_deducted, created_at, updated_at, version
           FROM vault_reward_claims
           ${queryOp === "getVaultRewardClaim" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getVaultRewardClaim" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getXpTransaction" || queryOp === "listXpTransactions") {
        const id = queryOp === "getXpTransaction" ? request.params.id : undefined;
        if (queryOp === "getXpTransaction" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getXpTransaction.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, source, source_entity_id, amount, earned_at, reason,
                  created_at, updated_at, version
           FROM xp_transactions
           ${queryOp === "getXpTransaction" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getXpTransaction" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getLevelState" || queryOp === "listLevelStates") {
        const id = queryOp === "getLevelState" ? request.params.id : undefined;
        if (queryOp === "getLevelState" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getLevelState.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, total_xp, level, computed_at, created_at, updated_at, version
           FROM level_states
           ${queryOp === "getLevelState" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getLevelState" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getAchievement" || queryOp === "listAchievements") {
        const id = queryOp === "getAchievement" ? request.params.id : undefined;
        if (queryOp === "getAchievement" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getAchievement.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, key, title, description, created_at, updated_at, version
           FROM achievements
           ${queryOp === "getAchievement" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getAchievement" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getAchievementRewardReference") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(
            requestId,
            "invalid-input",
            "db.query.getAchievementRewardReference.bad-params",
          );
        }
        const rows: Record<string, unknown>[] = [];
        active.exec("SELECT id FROM user_rewards WHERE achievement_id = ? LIMIT 1;", {
          bind: [id],
          rowMode: "object",
          resultRows: rows,
        });
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getCollectible" || queryOp === "listCollectibles") {
        const id = queryOp === "getCollectible" ? request.params.id : undefined;
        if (queryOp === "getCollectible" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getCollectible.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, key, title, unlocks_theme_key, created_at, updated_at, version
           FROM collectibles
           ${queryOp === "getCollectible" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getCollectible" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getCollectibleRewardReference") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(
            requestId,
            "invalid-input",
            "db.query.getCollectibleRewardReference.bad-params",
          );
        }
        const rows: Record<string, unknown>[] = [];
        active.exec("SELECT id FROM user_rewards WHERE collectible_id = ? LIMIT 1;", {
          bind: [id],
          rowMode: "object",
          resultRows: rows,
        });
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getUserReward" || queryOp === "listUserRewards") {
        const id = queryOp === "getUserReward" ? request.params.id : undefined;
        if (queryOp === "getUserReward" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getUserReward.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, achievement_id, collectible_id, earned_at, created_at, updated_at, version
           FROM user_rewards
           ${queryOp === "getUserReward" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getUserReward" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getProject" || queryOp === "listProjects") {
        const id = queryOp === "getProject" ? request.params.id : undefined;
        if (queryOp === "getProject" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getProject.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, name, color_key, archived_at, created_at, updated_at, version, deleted_at
           FROM projects
           ${queryOp === "getProject" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getProject" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getTag" || queryOp === "listTags") {
        const id = queryOp === "getTag" ? request.params.id : undefined;
        if (queryOp === "getTag" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getTag.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, name, color_key, created_at, updated_at, version, deleted_at
           FROM tags
           ${queryOp === "getTag" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getTag" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getTask" || queryOp === "listTasks") {
        const id = queryOp === "getTask" ? request.params.id : undefined;
        if (queryOp === "getTask" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getTask.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, title, notes, status, priority, due_at, project_id,
                  completed_at, reopened_at, recurrence_json, estimate_minutes,
                  actual_seconds, created_at, updated_at, version, deleted_at
           FROM tasks
           ${queryOp === "getTask" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getTask" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listTaskTags") {
        const taskId = request.params.task_id;
        if (taskId !== undefined && typeof taskId !== "string") {
          return failure(requestId, "invalid-input", "db.query.listTaskTags.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT task_id, tag_id, sort_order FROM task_tags
           ${typeof taskId === "string" ? "WHERE task_id = ?" : "ORDER BY task_id, sort_order, tag_id"};`,
          {
            ...(typeof taskId === "string" ? { bind: [taskId] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getTaskChecklistItem" || queryOp === "listTaskChecklistItems") {
        const id = queryOp === "getTaskChecklistItem" ? request.params.id : undefined;
        if (queryOp === "getTaskChecklistItem" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getTaskChecklistItem.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, task_id, title, done, sort_order, created_at, updated_at, version, deleted_at
           FROM task_checklist_items
           ${queryOp === "getTaskChecklistItem" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getTaskChecklistItem" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getRoutine" || queryOp === "listRoutines") {
        const id = queryOp === "getRoutine" ? request.params.id : undefined;
        if (queryOp === "getRoutine" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getRoutine.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, title, archived_at, created_at, updated_at, version, deleted_at
           FROM routines
           ${queryOp === "getRoutine" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getRoutine" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getRoutineStep" || queryOp === "listRoutineSteps") {
        const id = queryOp === "getRoutineStep" ? request.params.id : undefined;
        if (queryOp === "getRoutineStep" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getRoutineStep.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, routine_id, title, sort_order, optional,
                  created_at, updated_at, version, deleted_at
           FROM routine_steps
           ${queryOp === "getRoutineStep" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getRoutineStep" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getRoutineSchedule" || queryOp === "listRoutineSchedules") {
        const id = queryOp === "getRoutineSchedule" ? request.params.id : undefined;
        if (queryOp === "getRoutineSchedule" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getRoutineSchedule.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, routine_id, cadence, weekdays_json, local_time, enabled,
                  created_at, updated_at, version, deleted_at
           FROM routine_schedules
           ${queryOp === "getRoutineSchedule" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getRoutineSchedule" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getRoutineRun" || queryOp === "listRoutineRuns") {
        const id = queryOp === "getRoutineRun" ? request.params.id : undefined;
        if (queryOp === "getRoutineRun" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getRoutineRun.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, routine_id, local_date, status, day_mode, started_at, completed_at,
                  skip_reason, created_at, updated_at, version
           FROM routine_runs
           ${queryOp === "getRoutineRun" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getRoutineRun" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getRoutineStepRun" || queryOp === "listRoutineStepRuns") {
        const id = queryOp === "getRoutineStepRun" ? request.params.id : undefined;
        if (queryOp === "getRoutineStepRun" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getRoutineStepRun.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, routine_run_id, routine_step_id, status, completed_at, skip_reason,
                  created_at, updated_at, version
           FROM routine_step_runs
           ${queryOp === "getRoutineStepRun" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getRoutineStepRun" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getCalendarBlock" || queryOp === "listCalendarBlocks") {
        const id = queryOp === "getCalendarBlock" ? request.params.id : undefined;
        if (queryOp === "getCalendarBlock" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getCalendarBlock.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, kind, title, starts_at, ends_at, linked_task_id, linked_routine_id,
                  created_at, updated_at, version, deleted_at
           FROM calendar_blocks
           ${queryOp === "getCalendarBlock" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getCalendarBlock" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getFocusSession" || queryOp === "listFocusSessions") {
        const id = queryOp === "getFocusSession" ? request.params.id : undefined;
        if (queryOp === "getFocusSession" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getFocusSession.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, task_id, routine_id, calendar_block_id, phase,
                  started_at, ended_at, duration_seconds, active_elapsed_seconds,
                  active_segment_started_at, accumulated_pause_seconds,
                  interruption_count, created_at, updated_at, version
           FROM focus_sessions
           ${queryOp === "getFocusSession" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getFocusSession" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getDistraction" || queryOp === "listDistractions") {
        const id = queryOp === "getDistraction" ? request.params.id : undefined;
        if (queryOp === "getDistraction" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getDistraction.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, focus_session_id, noted_at, note, created_at, updated_at, version
           FROM distractions
           ${queryOp === "getDistraction" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getDistraction" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getGoal") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getGoal.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, title, description, active_from, active_until, archived_at,
                  created_at, updated_at, version, deleted_at
           FROM goals WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listGoals") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, title, description, active_from, active_until, archived_at,
                  created_at, updated_at, version, deleted_at
           FROM goals ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getHabitRule" || queryOp === "listHabitRules") {
        const id = queryOp === "getHabitRule" ? request.params.id : undefined;
        if (queryOp === "getHabitRule" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getHabitRule.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, goal_id, title, cadence, target_per_period,
                  created_at, updated_at, version, deleted_at
           FROM habit_rules
           ${queryOp === "getHabitRule" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getHabitRule" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getGoalDay") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getGoalDay.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, goal_id, local_date, completed, created_at, updated_at, version
           FROM goal_days WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listGoalDays") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, goal_id, local_date, completed, created_at, updated_at, version
           FROM goal_days ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getMeasurement") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getMeasurement.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, type, value, secondary_value, unit, metric_name, pulse_bpm, context,
                  measured_at, note, created_at, updated_at, version
           FROM measurements WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listMeasurements") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, type, value, secondary_value, unit, metric_name, pulse_bpm, context,
                  measured_at, note, created_at, updated_at, version
           FROM measurements ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getFood") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getFood.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                  fiber_per_100g, serving_size_g, created_at, updated_at, version, deleted_at
           FROM foods WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listFoods") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
                  fiber_per_100g, serving_size_g, created_at, updated_at, version, deleted_at
           FROM foods ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getNutritionEntry") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getNutritionEntry.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, eaten_at, food_id, amount_g, meal_slot_id, label, calories, protein_g,
                  carbs_g, fat_g, fiber_g, created_at, updated_at, version, deleted_at
           FROM nutrition_entries WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listNutritionEntries") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, eaten_at, food_id, amount_g, meal_slot_id, label, calories, protein_g,
                  carbs_g, fat_g, fiber_g, created_at, updated_at, version, deleted_at
           FROM nutrition_entries ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getRecipe" || queryOp === "listRecipes") {
        const id = queryOp === "getRecipe" ? request.params.id : undefined;
        if (queryOp === "getRecipe" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getRecipe.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT r.id, r.name, r.servings, r.created_at, r.updated_at, r.version, r.deleted_at,
                  rf.food_id, rf.amount_g, rf.position
           FROM recipes r LEFT JOIN recipe_foods rf ON rf.recipe_id = r.id
           ${queryOp === "getRecipe" ? "WHERE r.id = ? ORDER BY rf.position" : "ORDER BY r.created_at, r.id, rf.position"};`,
          {
            ...(queryOp === "getRecipe" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getSupplement") {
        const id = request.params.id;
        if (typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getSupplement.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, name, dose_label, amount, unit, schedule_json, stock_amount, stock_unit,
                  stock_counted_at, created_at, updated_at, version, deleted_at
           FROM supplements WHERE id = ?;`,
          { bind: [id], rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listSupplements") {
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, name, dose_label, amount, unit, schedule_json, stock_amount, stock_unit,
                  stock_counted_at, created_at, updated_at, version, deleted_at
           FROM supplements ORDER BY created_at, id;`,
          { rowMode: "object", resultRows: rows },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "getSupplementLog" || queryOp === "listSupplementLogs") {
        const id = queryOp === "getSupplementLog" ? request.params.id : undefined;
        if (queryOp === "getSupplementLog" && typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getSupplementLog.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, supplement_id, status, scheduled_at, dose_amount, dose_unit, taken_at,
                  created_at, updated_at, version
           FROM supplement_logs
           ${queryOp === "getSupplementLog" ? "WHERE id = ?" : "ORDER BY created_at, id"};`,
          {
            ...(queryOp === "getSupplementLog" ? { bind: [id] } : {}),
            rowMode: "object",
            resultRows: rows,
          },
        );
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      // T130: entity-doc -lukut (appin EntityStoreille).
      if (queryOp === "getEntity") {
        const entityType = request.params.entity_type;
        const id = request.params.id;
        if (typeof entityType !== "string" || typeof id !== "string") {
          return failure(requestId, "invalid-input", "db.query.getEntity.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          "SELECT id, created_at, updated_at, doc_version, doc AS value FROM entity_docs WHERE entity_type = ? AND id = ?;",
          {
            bind: [entityType, id],
            rowMode: "object",
            resultRows: rows,
          },
        );
        if (localContentEncryptionEnabled(active) && localContentKey !== null) {
          revealEntityRows(rows, entityType, localContentKey);
        }
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      if (queryOp === "listEntities") {
        const entityType = request.params.entity_type;
        if (typeof entityType !== "string") {
          return failure(requestId, "invalid-input", "db.query.listEntities.bad-params");
        }
        const rows: Record<string, unknown>[] = [];
        active.exec(
          `SELECT id, created_at, updated_at, doc_version, doc AS value FROM entity_docs WHERE entity_type = ?
           ORDER BY created_at, id;`,
          { bind: [entityType], rowMode: "object", resultRows: rows },
        );
        if (localContentEncryptionEnabled(active) && localContentKey !== null) {
          revealEntityRows(rows, entityType, localContentKey);
        }
        return privateRowsResponse(requestId, queryOp, active, rows);
      }
      // Jäljellä vain probeWrite (isDbRequest takaa op-joukon).
      const key = `probe:${requestId}`;
      if (!/^[A-Za-z0-9:_-]{1,64}$/.test(key)) {
        return failure(requestId, "invalid-input", "db.query.probeWrite.bad-key");
      }
      active.exec(
        "INSERT INTO _lifeos_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value;",
        {
          bind: [key, "1"],
        },
      );
      checkpointPassive(active);
      active.exec("DELETE FROM _lifeos_meta WHERE key = ?;", { bind: [key] });
      checkpointPassive(active);
      return success(requestId, collection([]));
    } else {
      // Jäljellä exec (putMeta|putPreferences|putInstallation — isDbRequest
      // takaa kind/op-joukon; query palasi yllä). T076: suoritus shared
      // executeNamedOp:ssa (sama kuin transaction-polku).
      const params = protectNamedWrite(active, request.op, request.params);
      executeNamedOp(active, request.op, params);
      persistPrivateWrite(active, request.op, params);
      cleanupDeletedPrivateRecord(active, request.op, params);
      return success(requestId, []);
    }
    return failure(requestId, "invalid-input", "db.request.unreachable");
  } catch (error) {
    return failure(requestId, toFailureCode(error), "db.request.failed");
  }
}

// Worker-entry: viestiraja. Kelvoton viesti -> invalid-input (ei kaatumista).
if (
  typeof self !== "undefined" &&
  typeof (self as unknown as { postMessage?: unknown }).postMessage === "function"
) {
  let requestQueue: Promise<void> = Promise.resolve();
  (self as unknown as { onmessage: ((event: MessageEvent) => void) | null }).onmessage = (
    event: MessageEvent,
  ) => {
    const processMessage = async (): Promise<void> => {
      const target = self as unknown as { postMessage: (message: DbResponse) => void };
      if (!isDbRequest(event.data)) {
        const fallbackId =
          typeof event.data === "object" &&
          event.data !== null &&
          typeof (event.data as Record<string, unknown>).requestId === "string"
            ? ((event.data as Record<string, unknown>).requestId as string)
            : "unknown";
        target.postMessage(failure(fallbackId, "invalid-input", "db.protocol.invalid-message"));
        return;
      }
      try {
        target.postMessage(await handleRequest(event.data));
      } catch {
        target.postMessage(
          failure(event.data.requestId, "transient-failure", "db.request.unhandled-failure"),
        );
      }
    };
    requestQueue = requestQueue.then(processMessage, processMessage).catch(() => undefined);
  };
}

export type { DbRequest };
