import { afterEach, describe, expect, it } from "vitest";
import { decryptLocalContent, isLocalContentCiphertext } from "../src/local-content-crypto.ts";
import {
  activateLocalContentKey,
  isPrivateQuery,
  isPrivateWrite,
  lockLocalContentKey,
  persistPrivateWrite,
  privateRowsResponse,
  protectNamedWrite,
  revealEntityRows,
  revealPrivateRows,
  validateOrWriteLocalContentKeyCheck,
} from "../src/sqliteWorker.ts";
import { applyMigrations, openFresh } from "./migration-harness.ts";
import type { Db, Row } from "./migration-harness.ts";

const AT = "2026-10-05T10:00:00.000Z";
const key = new Uint8Array(32).fill(17);
let database: Db | null = null;

afterEach(() => {
  lockLocalContentKey();
  key.fill(17);
  database?.close();
  database = null;
});

describe("SQLite local content encryption", () => {
  it("migrates entity docs and health values to authenticated ciphertext", async () => {
    database = await openFresh();
    applyMigrations(database, 0);
    database.exec(
      "INSERT INTO entity_docs (entity_type, id, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?);",
      {
        bind: ["journal-entry", "j-1", JSON.stringify({ body: "private journal note" }), AT, AT],
      },
    );
    database.exec(
      `INSERT INTO hydration_entries (id, drunk_at, milliliters, created_at, updated_at, version)
       VALUES ('h-1', '2026-10-05T09:00:00.000Z', 250, ?, ?, 1);`,
      { bind: [AT, AT] },
    );
    database.exec(
      `INSERT INTO user_preferences (
         id, theme, day_start_hour, gamification_visible, enabled_sections,
         notification_defaults_enabled, app_lock_enabled, created_at, updated_at, version,
         weight_target, height_cm, meal_slots, macro_targets, hydration_target_ml,
         hydration_reminder_time
       ) VALUES (?, 'system', 8, 0, '[]', 0, 0, ?, ?, 1, ?, ?, '[]', ?, ?, ?);`,
      {
        bind: [
          "prefs-1",
          AT,
          AT,
          JSON.stringify({ targetKg: 62, unit: "kg" }),
          "172",
          JSON.stringify({ caloriesKcal: 1800 }),
          2300,
          "08:30",
        ],
      },
    );

    expect(activateLocalContentKey(database, key)).toBe(true);

    const entityDocs: Row[] = [];
    database.exec("SELECT doc FROM entity_docs WHERE id = 'j-1';", {
      rowMode: "object",
      resultRows: entityDocs,
    });
    const envelope = JSON.parse(String(entityDocs[0]?.doc)) as { ciphertext: string };
    expect(isLocalContentCiphertext(envelope.ciphertext)).toBe(true);
    expect(String(entityDocs[0]?.doc)).not.toContain("private journal note");

    const rawHydration: Row[] = [];
    database.exec("SELECT id, milliliters FROM hydration_entries WHERE id = 'h-1';", {
      rowMode: "object",
      resultRows: rawHydration,
    });
    expect(rawHydration[0]?.milliliters).toBe(0);
    const privateRows: Row[] = [];
    database.exec(
      "SELECT payload FROM local_private_records WHERE record_type = 'hydration_entries' AND record_id = 'h-1';",
      { rowMode: "object", resultRows: privateRows },
    );
    const encryptedPayload = privateRows[0]?.payload;
    expect(isLocalContentCiphertext(encryptedPayload)).toBe(true);
    expect(encryptedPayload).not.toBe(JSON.stringify({ milliliters: 250 }));

    const revealedEntity: Row = { id: "j-1", value: String(entityDocs[0]?.doc) };
    revealEntityRows([revealedEntity], "journal-entry", key);
    expect(JSON.parse(String(revealedEntity.value))).toEqual({ body: "private journal note" });

    revealPrivateRows(database, "hydration_entries", rawHydration, key);
    expect(rawHydration[0]?.milliliters).toBe(250);

    const rawPreferences: Row[] = [];
    database.exec(
      `SELECT id, weight_target, height_cm, meal_slots, macro_targets,
              hydration_target_ml, hydration_reminder_time, notification_categories
       FROM user_preferences WHERE id = 'prefs-1';`,
      { rowMode: "object", resultRows: rawPreferences },
    );
    expect(rawPreferences[0]?.height_cm).toBe(null);
    expect(rawPreferences[0]?.hydration_target_ml).toBe(null);
    revealPrivateRows(database, "user_preferences", rawPreferences, key);
    expect(rawPreferences[0]?.weight_target).toBe(JSON.stringify({ targetKg: 62, unit: "kg" }));
    expect(rawPreferences[0]?.height_cm).toBe("172");
    expect(rawPreferences[0]?.hydration_target_ml).toBe(2300);
    expect(rawPreferences[0]?.hydration_reminder_time).toBe("08:30");
    expect(validateOrWriteLocalContentKeyCheck(database, key)).toBe(true);
    expect(validateOrWriteLocalContentKeyCheck(database, new Uint8Array(32).fill(18))).toBe(false);
  });

  it("encrypts future private writes and classifies reads/deletes as locked operations", async () => {
    database = await openFresh();
    applyMigrations(database, 0);
    expect(activateLocalContentKey(database, key)).toBe(true);

    const protectedWrite = protectNamedWrite(database, "putHydrationEntry", {
      id: "h-2",
      drunk_at: "2026-10-05T11:00:00.000Z",
      milliliters: 375,
      created_at: AT,
      updated_at: AT,
      version: 1,
    });
    expect(protectedWrite.milliliters).toBe(0);
    expect(protectedWrite._local_private_payload).toEqual(expect.any(String));
    expect(protectedWrite._local_private_payload).not.toBe(JSON.stringify({ milliliters: 375 }));

    const protectedPreferences = protectNamedWrite(database, "putPreferences", {
      id: "prefs-2",
      theme: "system",
      day_start_hour: 8,
      gamification_visible: false,
      enabled_sections: "[]",
      notification_defaults_enabled: false,
      app_lock_enabled: false,
      created_at: AT,
      updated_at: AT,
      version: 1,
      weight_target: "",
      height_cm: "",
      meal_slots: "[]",
      macro_targets: "{}",
      hydration_target_ml: "",
      hydration_reminder_time: "",
      notification_categories: "{}",
    });
    const preferencesPayload = JSON.parse(
      decryptLocalContent(String(protectedPreferences._local_private_payload), key, {
        recordType: "user_preferences",
        recordId: "prefs-2",
        field: "payload",
      }),
    ) as Row;
    expect(preferencesPayload.height_cm).toBe(null);
    expect(preferencesPayload.weight_target).toBe(null);
    expect(protectedPreferences.height_cm).toBe("");

    persistPrivateWrite(database, "putHydrationEntry", protectedWrite);
    const payloadRows: Row[] = [];
    database.exec(
      "SELECT payload FROM local_private_records WHERE record_type = 'hydration_entries' AND record_id = 'h-2';",
      { rowMode: "object", resultRows: payloadRows },
    );
    expect(
      decryptLocalContent(String(payloadRows[0]?.payload), key, {
        recordType: "hydration_entries",
        recordId: "h-2",
        field: "payload",
      }),
    ).toContain('"milliliters":375');

    expect(isPrivateQuery("getPreferences")).toBe(true);
    expect(isPrivateQuery("listJournalEntries")).toBe(true);
    expect(isPrivateWrite("putPreferences")).toBe(true);
    expect(isPrivateWrite("deleteHydrationEntry")).toBe(true);
    expect(isPrivateWrite("deleteEntity")).toBe(true);
  });

  it("encrypts direct task fields and recipe ingredients while preserving query results", async () => {
    database = await openFresh();
    applyMigrations(database, 0);
    database.exec(
      `INSERT INTO tasks (id, title, notes, status, priority, created_at, updated_at, version)
       VALUES ('task-private-1', 'Call my doctor', 'Discuss test results', 'open', 'normal', ?, ?, 1);`,
      { bind: [AT, AT] },
    );
    database.exec(
      `INSERT INTO foods (id, name, created_at, updated_at, version)
       VALUES ('food-private-1', 'Private oat mix', ?, ?, 1);`,
      { bind: [AT, AT] },
    );
    database.exec(
      `INSERT INTO recipes (id, name, servings, created_at, updated_at, version)
       VALUES ('recipe-private-1', 'Recovery breakfast', 2, ?, ?, 1);`,
      { bind: [AT, AT] },
    );
    database.exec(
      `INSERT INTO recipe_foods (recipe_id, food_id, amount_g, position)
       VALUES ('recipe-private-1', 'food-private-1', 42.5, 0);`,
    );

    expect(activateLocalContentKey(database, key)).toBe(true);

    const rawTask: Row[] = [];
    database.exec("SELECT id, title, notes FROM tasks WHERE id = 'task-private-1';", {
      rowMode: "object",
      resultRows: rawTask,
    });
    expect(rawTask[0]?.title).toBe("Private task");
    expect(rawTask[0]?.notes).toBe(null);
    revealPrivateRows(database, "tasks", rawTask, key);
    expect(rawTask[0]?.title).toBe("Call my doctor");
    expect(rawTask[0]?.notes).toBe("Discuss test results");

    const remainingIngredients: Row[] = [];
    database.exec("SELECT recipe_id FROM recipe_foods WHERE recipe_id = 'recipe-private-1';", {
      rowMode: "object",
      resultRows: remainingIngredients,
    });
    expect(remainingIngredients).toHaveLength(0);

    const rawRecipe: Row[] = [];
    database.exec(
      `SELECT r.id, r.name, r.servings, r.created_at, r.updated_at, r.version, r.deleted_at,
              rf.food_id, rf.amount_g, rf.position
       FROM recipes r LEFT JOIN recipe_foods rf ON rf.recipe_id = r.id
       WHERE r.id = 'recipe-private-1' ORDER BY rf.position;`,
      { rowMode: "object", resultRows: rawRecipe },
    );
    expect(rawRecipe[0]?.name).toBe("Private recipe");
    const recipeResponse = privateRowsResponse("recipe-query", "getRecipe", database, rawRecipe);
    expect(recipeResponse.ok).toBe(true);
    if (!recipeResponse.ok) return;
    expect(recipeResponse.rows).toMatchObject([
      {
        id: "recipe-private-1",
        name: "Recovery breakfast",
        servings: 2,
        food_id: "food-private-1",
        amount_g: 42.5,
        position: 0,
      },
    ]);
  });

  it("encrypts freeform skip reasons in routine history", async () => {
    database = await openFresh();
    applyMigrations(database, 0);
    database.exec(
      `INSERT INTO routines (id, title, created_at, updated_at, version)
       VALUES ('routine-1', 'Daily routine', ?, ?, 1);`,
      { bind: [AT, AT] },
    );
    database.exec(
      `INSERT INTO routine_steps (id, routine_id, title, sort_order, created_at, updated_at, version)
       VALUES ('routine-step-1', 'routine-1', 'Walk', 0, ?, ?, 1);`,
      { bind: [AT, AT] },
    );
    database.exec(
      `INSERT INTO routine_runs (
         id, routine_id, local_date, status, day_mode, started_at, completed_at,
         skip_reason, created_at, updated_at, version
       ) VALUES ('routine-run-1', 'routine-1', '2026-10-05', 'skipped', NULL, ?, NULL,
                'I felt unwell', ?, ?, 1);`,
      { bind: [AT, AT, AT] },
    );
    database.exec(
      `INSERT INTO routine_step_runs (
         id, routine_run_id, routine_step_id, status, completed_at, skip_reason,
         created_at, updated_at, version
       ) VALUES ('routine-step-run-1', 'routine-run-1', 'routine-step-1', 'skipped', ?,
                'My ankle hurt', ?, ?, 1);`,
      { bind: [AT, AT, AT] },
    );

    expect(activateLocalContentKey(database, key)).toBe(true);

    const rawRoutineRun: Row[] = [];
    database.exec("SELECT id, skip_reason FROM routine_runs WHERE id = 'routine-run-1';", {
      rowMode: "object",
      resultRows: rawRoutineRun,
    });
    const rawStepRun: Row[] = [];
    database.exec(
      "SELECT id, skip_reason FROM routine_step_runs WHERE id = 'routine-step-run-1';",
      { rowMode: "object", resultRows: rawStepRun },
    );
    expect(rawRoutineRun[0]?.skip_reason).toBe("Private reason");
    expect(rawStepRun[0]?.skip_reason).toBe("Private reason");
    revealPrivateRows(database, "routine_runs", rawRoutineRun, key);
    revealPrivateRows(database, "routine_step_runs", rawStepRun, key);
    expect(rawRoutineRun[0]?.skip_reason).toBe("I felt unwell");
    expect(rawStepRun[0]?.skip_reason).toBe("My ankle hurt");
    expect(isPrivateQuery("getRoutineRun")).toBe(true);
    expect(isPrivateQuery("listRoutineStepRuns")).toBe(true);
  });
});
