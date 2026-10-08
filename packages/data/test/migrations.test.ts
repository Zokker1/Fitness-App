// T033: migraatioketjun + protokollan unit-testit (T031-sopimus lukittuna).
import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  isDbRequest,
  pendingMigrations,
  validateMigrationChain,
} from "../src/index.ts";

describe("migration chain", () => {
  it("M001-M054-ketju on validi ja versio 54 (T060-T079, T130, T151, T204-T205, T212-T250, T281-T282, T328, T339)", () => {
    expect(validateMigrationChain(MIGRATIONS).ok).toBe(true);
    expect(CURRENT_SCHEMA_VERSION).toBe(54);
    expect(pendingMigrations(MIGRATIONS, 18)).toHaveLength(36);
    expect(pendingMigrations(MIGRATIONS, 0)).toHaveLength(54);
    const m015 = MIGRATIONS.find((step) => step.version === 15);
    expect(m015).toMatchObject({ id: "M015" });
    expect(m015?.statements.join("\n")).toContain("sync_cursors");
    const m016 = MIGRATIONS.find((step) => step.version === 16);
    expect(m016).toMatchObject({ id: "M016" });
    expect(m016?.statements.join("\n")).toContain("backup_manifests");
    const m017 = MIGRATIONS.find((step) => step.version === 17);
    expect(m017).toMatchObject({ id: "M017" });
    expect(m017?.statements.join("\n")).toContain("entity_docs");
    const m018 = MIGRATIONS.find((step) => step.version === 18);
    expect(m018).toMatchObject({ id: "M018" });
    expect(m018?.statements.join("\n")).toContain("optional");
    expect(MIGRATIONS.at(-1)).toMatchObject({ id: "M054" });
    expect(MIGRATIONS.at(-1)?.statements.join("\n")).toContain("local_private_records");
    const m027 = MIGRATIONS.find((step) => step.version === 27);
    expect(m027).toMatchObject({ id: "M027" });
    expect(m027?.statements.join("\n")).toContain("active_from");
    expect(m027?.statements.join("\n")).toContain("active_until");
    const m028 = MIGRATIONS.find((step) => step.version === 28);
    expect(m028).toMatchObject({ id: "M028" });
    expect(m028?.statements.join("\n")).toContain("metric_name");
    expect(m028?.statements.join("\n")).toContain("pulse_bpm");
    expect(m028?.statements.join("\n")).toContain("context");
    const m029 = MIGRATIONS.find((step) => step.version === 29);
    expect(m029).toMatchObject({ id: "M029" });
    expect(m029?.statements.join("\n")).toContain("fiber_per_100g");
    expect(m029?.statements.join("\n")).toContain("serving_size_g");
    const m030 = MIGRATIONS.find((step) => step.version === 30);
    expect(m030).toMatchObject({ id: "M030" });
    expect(m030?.statements.join("\n")).toContain(
      "food_id TEXT REFERENCES foods(id) ON DELETE SET NULL",
    );
    expect(m030?.statements.join("\n")).toContain("amount_g");
    expect(m030?.statements.join("\n")).toContain("meal_slot_id");
    expect(m030?.statements.join("\n")).toContain("fiber_g");
    const m031 = MIGRATIONS.find((step) => step.version === 31);
    expect(m031).toMatchObject({ id: "M031" });
    expect(m031?.statements.join("\n")).toContain("ADD COLUMN servings REAL");
    expect(m031?.statements.join("\n")).toContain("amount_g REAL");
    expect(m031?.statements.join("\n")).toContain("ROW_NUMBER() OVER");
    const m032 = MIGRATIONS.find((step) => step.version === 32);
    expect(m032).toMatchObject({ id: "M032" });
    expect(m032?.statements.join("\n")).toContain("ADD COLUMN schedule_json");
    expect(m032?.statements.join("\n")).toContain("stock_counted_at");
    const m033 = MIGRATIONS.find((step) => step.version === 33);
    expect(m033).toMatchObject({ id: "M033" });
    expect(m033?.statements.join("\n")).toContain("status TEXT NOT NULL");
    expect(m033?.statements.join("\n")).toContain("scheduled_at");
    expect(m033?.statements.join("\n")).toContain("taken_at IS NULL");
    const m034 = MIGRATIONS.find((step) => step.version === 34);
    expect(m034).toMatchObject({ id: "M034" });
    expect(m034?.statements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS breathing_sessions");
    expect(m034?.statements.join("\n")).toContain("pattern_key");
    const m035 = MIGRATIONS.find((step) => step.version === 35);
    expect(m035).toMatchObject({ id: "M035" });
    expect(m035?.statements.join("\n")).toContain("condition_kind");
    expect(m035?.statements.join("\n")).toContain("minimum_amount");
    const m036 = MIGRATIONS.find((step) => step.version === 36);
    expect(m036).toMatchObject({ id: "M036" });
    expect(m036?.statements.join("\n")).toContain("vault_rewards");
    expect(m036?.statements.join("\n")).toContain("vault-claim");
    const m037 = MIGRATIONS.find((step) => step.version === 37);
    expect(m037).toMatchObject({ id: "M037" });
    expect(m037?.statements.join("\n")).toContain("vault_reward_claims");
    expect(m037?.statements.join("\n")).toContain("ON DELETE RESTRICT");
    expect(m037?.statements.join("\n")).toContain("append-only");
    const m038 = MIGRATIONS.find((step) => step.version === 38);
    expect(m038).toMatchObject({ id: "M038" });
    expect(m038?.statements.join("\n")).toContain("xp_transactions");
    expect(m038?.statements.join("\n")).toContain("append-only");
    const m039 = MIGRATIONS.find((step) => step.version === 39);
    expect(m039).toMatchObject({ id: "M039" });
    expect(m039?.statements.join("\n")).toContain("user_rewards");
    expect(m039?.statements.join("\n")).toContain("append-only");
    const m040 = MIGRATIONS.find((step) => step.version === 40);
    expect(m040).toMatchObject({ id: "M040" });
    expect(m040?.statements.join("\n")).toContain("recurrence_json");
    expect(m040?.statements.join("\n")).toContain("estimate_minutes");
    expect(m040?.statements.join("\n")).toContain("actual_seconds");
    expect(m040?.statements.join("\n")).toContain("sort_order");
    const m041 = MIGRATIONS.find((step) => step.version === 41);
    expect(m041).toMatchObject({ id: "M041" });
    expect(m041?.statements.join("\n")).toContain("calendar_block_id");
    expect(m041?.statements.join("\n")).toContain("active_elapsed_seconds");
    expect(m041?.statements.join("\n")).toContain("active_segment_started_at");
    expect(m041?.statements.join("\n")).toContain("accumulated_pause_seconds");
    expect(m041?.statements.join("\n")).toContain("interruption_count");
    const m042 = MIGRATIONS.find((step) => step.version === 42);
    expect(m042).toMatchObject({ id: "M042" });
    expect(m042?.statements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS routine_schedules");
    expect(m042?.statements.join("\n")).toContain(
      "routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE",
    );
    expect(m042?.statements.join("\n")).toContain("json_array_length(weekdays_json)");
    const m043 = MIGRATIONS.find((step) => step.version === 43);
    expect(m043).toMatchObject({ id: "M043" });
    expect(m043?.statements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS routine_runs");
    expect(m043?.statements.join("\n")).toContain("ON DELETE RESTRICT");
    expect(m043?.statements.join("\n")).toContain("idx_routine_runs_active_day");
    const m044 = MIGRATIONS.find((step) => step.version === 44);
    expect(m044).toMatchObject({ id: "M044" });
    expect(m044?.statements.join("\n")).toContain("CREATE TABLE IF NOT EXISTS routine_step_runs");
    expect(m044?.statements.join("\n")).toContain("routine-step-run-parent-mismatch");
    expect(m044?.statements.join("\n")).toContain("UNIQUE (routine_run_id, routine_step_id)");
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putFood",
        params: {
          id: "food-1",
          name: "Kaurapuuro",
          calories_per_100g: 70,
          protein_per_100g: 2.5,
          carbs_per_100g: 12,
          fat_per_100g: 1.5,
          fiber_per_100g: 1.8,
          serving_size_g: 250,
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          deleted_at: "",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getFood",
        params: { id: "food-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putNutritionEntry",
        params: {
          id: "nutrition-1",
          eaten_at: "2026-09-01T08:00:00.000Z",
          food_id: "food-1",
          amount_g: 150,
          meal_slot_id: "lunch",
          label: "Kaurapuuro",
          calories: 105,
          protein_g: 3.75,
          carbs_g: 18,
          fat_g: 2.25,
          fiber_g: 2.7,
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getNutritionEntry",
        params: { id: "nutrition-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putRecipe",
        params: {
          id: "recipe-1",
          name: "Puuro",
          servings: 2,
          ingredients_json: '[{"food_id":"food-1","amount_g":150,"position":0}]',
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getRecipe",
        params: { id: "recipe-1" },
      }),
    ).toBe(true);
    expect(isDbRequest({ requestId: "x", kind: "query", op: "listRecipes", params: {} })).toBe(
      true,
    );
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putSupplement",
        params: {
          id: "supplement-1",
          name: "D-vitamiini",
          dose_label: "",
          amount: 1,
          unit: "kapseli",
          schedule_json: '["08:00"]',
          stock_amount: 20,
          stock_unit: "kapselia",
          stock_counted_at: "2026-09-01T08:00:00.000Z",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putSupplementLog",
        params: {
          id: "supplement-log-1",
          supplement_id: "supplement-1",
          status: "pending",
          scheduled_at: "2026-09-01T08:00:00.000Z",
          dose_amount: 1,
          dose_unit: "kapseli",
          taken_at: "",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({ requestId: "x", kind: "query", op: "getSupplement", params: { id: "s1" } }),
    ).toBe(true);
    expect(
      isDbRequest({ requestId: "x", kind: "query", op: "listSupplementLogs", params: {} }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putSleepEntry",
        params: {
          id: "sleep-1",
          sleep_start: "2026-09-01T00:00:00.000Z",
          sleep_end: "2026-09-01T08:00:00.000Z",
          quality: 4,
          is_nap: 0,
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getSleepEntry",
        params: { id: "sleep-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putActivityEntry",
        params: {
          id: "activity-1",
          activity_at: "2026-09-01T08:00:00.000Z",
          kind: "kävely",
          duration_seconds: 2400,
          distance_meters: 3520.5,
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getActivityEntry",
        params: { id: "activity-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putJournalEntry",
        params: {
          id: "journal-1",
          written_at: "2026-09-01T08:00:00.000Z",
          title: "",
          title_is_null: true,
          body: "Päiväkirjamerkintä",
          reflection_success: "",
          reflection_difficult: "",
          reflection_tomorrow: "",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getJournalEntry",
        params: { id: "journal-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putBreathingSession",
        params: {
          id: "breath-1",
          started_at: "2026-09-01T08:00:00.000Z",
          ended_at: "",
          pattern_key: "box-breathing",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "deleteBreathingSession",
        params: { id: "breath-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getBreathingSession",
        params: { id: "breath-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putReminder",
        params: {
          id: "reminder-1",
          kind: "time",
          route: "/tasks",
          title: "Testimuistutus",
          fire_at: "2026-09-01T08:00:00.000Z",
          snoozed_until: "",
          rule_json: "",
          category_key: "tasks",
          enabled: 1,
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
          deleted_at: "",
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getReminder",
        params: { id: "reminder-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putNotificationState",
        params: {
          id: "notify-1",
          reminder_id: "reminder-1",
          category_key: "tasks",
          delivery: "pending",
          last_evaluated_at: "2026-09-01T08:00:00.000Z",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "deleteNotificationState",
        params: { id: "notify-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getNotificationState",
        params: { id: "notify-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putMoodCheckin",
        params: {
          id: "mood-1",
          checked_at: "2026-09-01T08:00:00.000Z",
          mood: 3,
          stress: "",
          energy: "",
          motivation: "",
          focus: "",
          note: "",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "deleteMoodCheckin",
        params: { id: "mood-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getMoodCheckin",
        params: { id: "mood-1" },
      }),
    ).toBe(true);
  });

  it("hylkää tyhjän/aukollisen/duplikaatin/väärän alun", () => {
    const step = { version: 1, id: "M001", description: "x", statements: ["SELECT 1;"] };
    expect(validateMigrationChain([]).ok).toBe(false);
    expect(
      validateMigrationChain([
        step,
        { version: 3, id: "M003", description: "x", statements: ["SELECT 1;"] },
      ]).ok,
    ).toBe(false);
    expect(
      validateMigrationChain([
        step,
        { version: 1, id: "M001b", description: "x", statements: ["SELECT 1;"] },
      ]).ok,
    ).toBe(false);
    expect(
      validateMigrationChain([
        { version: 2, id: "M002", description: "x", statements: ["SELECT 1;"] },
      ]).ok,
    ).toBe(false);
  });

  it("validates named Goal and GoalDay writes", () => {
    const baseRequest = { requestId: "x", kind: "exec" } as const;
    expect(
      isDbRequest({
        ...baseRequest,
        op: "putGoal",
        params: {
          id: "goal-1",
          title: "Tavoite",
          description: "",
          active_from: "2026-09-01",
          active_until: "",
          archived_at: "",
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          deleted_at: "",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        ...baseRequest,
        op: "putGoalDay",
        params: {
          id: "goal-day-1",
          goal_id: "goal-1",
          local_date: "2026-09-01",
          completed: 1,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        ...baseRequest,
        op: "putGoalDay",
        params: {
          id: "goal-day-1",
          goal_id: "goal-1",
          local_date: "2026-09-01",
          completed: 2,
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(false);
  });

  it("validates HabitRule writes and lookup parameters", () => {
    const validRule = {
      id: "habit-rule-1",
      goal_id: "goal-1",
      goal_id_is_null: false,
      title: "Kävely",
      cadence: "weekly",
      target_per_period: 3,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z",
      version: 1,
      deleted_at: "",
      deleted_at_is_null: true,
    };
    expect(
      isDbRequest({ requestId: "x", kind: "exec", op: "putHabitRule", params: validRule }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putHabitRule",
        params: { ...validRule, target_per_period: 0 },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getHabitRule",
        params: { id: "habit-rule-1" },
      }),
    ).toBe(true);
    expect(isDbRequest({ requestId: "x", kind: "query", op: "listHabitRules", params: {} })).toBe(
      true,
    );
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listHabitRules",
        params: { goal_id: "goal-1" },
      }),
    ).toBe(false);
  });

  it("validates named Measurement writes and lookup parameters", () => {
    const baseRequest = { requestId: "x", kind: "exec" } as const;
    expect(
      isDbRequest({
        ...baseRequest,
        op: "putMeasurement",
        params: {
          id: "measurement-1",
          type: "blood-pressure",
          value: 128,
          secondary_value: 82,
          unit: "mmHg",
          metric_name: "",
          pulse_bpm: 64,
          context: "morning",
          measured_at: "2026-09-01T08:00:00.000Z",
          note: "",
          created_at: "2026-09-01T08:00:00.000Z",
          updated_at: "2026-09-01T08:00:00.000Z",
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getMeasurement",
        params: { id: "measurement-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getMeasurement",
        params: {},
      }),
    ).toBe(false);
  });
});

describe("db protocol", () => {
  it("validates the worker-local content key request", () => {
    expect(
      isDbRequest({
        requestId: "key-unlock",
        kind: "local-key",
        action: "unlock",
        key: new Uint8Array(32),
      }),
    ).toBe(true);
    expect(isDbRequest({ requestId: "key-lock", kind: "local-key", action: "lock" })).toBe(true);
    expect(
      isDbRequest({
        requestId: "key-short",
        kind: "local-key",
        action: "unlock",
        key: new Uint8Array(31),
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "key-plain",
        kind: "local-key",
        action: "unlock",
        key: "a".repeat(32),
      }),
    ).toBe(false);
  });

  it("hyväksyy migrate/getSchemaVersion, hylkää ensureMeta", () => {
    expect(isDbRequest({ requestId: "x", kind: "migrate", targetVersion: 1 })).toBe(true);
    expect(isDbRequest({ requestId: "x", kind: "migrate", targetVersion: 0 })).toBe(false);
    expect(isDbRequest({ requestId: "x", kind: "query", op: "getSchemaVersion", params: {} })).toBe(
      true,
    );
    expect(isDbRequest({ requestId: "x", kind: "exec", op: "ensureMeta", params: {} })).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putMeta",
        params: { key: "a", value: "b" },
      }),
    ).toBe(true);
    // T060: getPreferences/putPreferences validointi (täsmälleen oikeat kentät).
    expect(isDbRequest({ requestId: "x", kind: "query", op: "getPreferences", params: {} })).toBe(
      true,
    );
    // T061: getActiveInstallation/putInstallation (NULL-olielot ""-merkkijonoina).
    expect(
      isDbRequest({ requestId: "x", kind: "query", op: "getActiveInstallation", params: {} }),
    ).toBe(true);
    const validPrefs = {
      id: "p1",
      theme: "system",
      day_start_hour: 8,
      gamification_visible: true,
      enabled_sections: "[]",
      notification_defaults_enabled: false,
      app_lock_enabled: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      version: 1,
      weight_target: "",
      height_cm: "",
      meal_slots: "[]",
      macro_targets: "{}",
      hydration_target_ml: "",
      hydration_reminder_time: "",
      notification_categories: "{}",
    };
    expect(
      isDbRequest({ requestId: "x", kind: "exec", op: "putPreferences", params: validPrefs }),
    ).toBe(true);
    const validInstallation = {
      id: "i1",
      installation_id: "inst-1",
      installation_name: "Tämä selain",
      last_seen_app_version: "0.0.0",
      last_sync_at: "",
      revoked_at: "",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      version: 1,
      is_local: true,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putInstallation",
        params: validInstallation,
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putInstallation",
        params: { ...validInstallation, last_sync_at: "2026-01-02T00:00:00.000Z" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putInstallation",
        params: { ...validInstallation, version: 0.5 },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putInstallation",
        params: { ...validInstallation, extra: "x" },
      }),
    ).toBe(false);
    // Protokolla validoi TYYPIT (kokonaisluku); arvorajoitukset (0–23) ovat
    // DB:n CHECK-rajoituksessa ja domain-säännössä (kaksoissuoja).
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putPreferences",
        params: { ...validPrefs, day_start_hour: 24 },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putPreferences",
        params: { ...validPrefs, day_start_hour: "8" },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putPreferences",
        params: { ...validPrefs, version: 0.5 },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putPreferences",
        params: { ...validPrefs, extra: "x" },
      }),
    ).toBe(false);
    expect(
      isDbRequest({ requestId: "x", kind: "exec", op: "putPreferences", params: { id: "p1" } }),
    ).toBe(false);
    // T130: entity-doc-opit (putEntity täsmälään oikeat kentät; doc JSONnä).
    const validEntityDoc = {
      entity_type: "task",
      id: "lifeos-1",
      doc_version: 0,
      doc: '{"id":"lifeos-1","createdAt":"2026-01-01T00:00:00.000Z"}',
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    expect(
      isDbRequest({ requestId: "x", kind: "exec", op: "putEntity", params: validEntityDoc }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putEntity",
        params: { ...validEntityDoc, doc: 5 },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putEntity",
        params: { ...validEntityDoc, extra: "x" },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "deleteEntity",
        params: { entity_type: "task", id: "lifeos-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "deleteEntity",
        params: { entity_type: "task" },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getEntity",
        params: { entity_type: "task", id: "lifeos-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listEntities",
        params: { entity_type: "task" },
      }),
    ).toBe(true);
    const validTag = {
      id: "tag-1",
      name: "Koti",
      color_key: "",
      color_key_is_null: false,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      version: 1,
      deleted_at: "",
      deleted_at_is_null: true,
    };
    expect(isDbRequest({ requestId: "x", kind: "exec", op: "putTag", params: validTag })).toBe(
      true,
    );
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putTag",
        params: { ...validTag, color_key: "blue", color_key_is_null: true },
      }),
    ).toBe(false);
    expect(
      isDbRequest({ requestId: "x", kind: "query", op: "getTag", params: { id: "tag-1" } }),
    ).toBe(true);
    expect(isDbRequest({ requestId: "x", kind: "query", op: "listTags", params: {} })).toBe(true);
    const validTaskWrite = {
      id: "task-1",
      title: "Analyysi",
      notes: "",
      status: "open",
      priority: "high",
      due_at: "2026-09-02T10:00:00.000Z",
      project_id: "project-1",
      completed_at: "",
      reopened_at: "",
      recurrence_json: '{"kind":"daily","everyDays":2}',
      tag_ids_json: '["tag-1"]',
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
      deleted_at: "",
      estimate_minutes: 25.5,
      actual_seconds: 1200,
      version: 1,
      notes_is_null: true,
      due_at_is_null: false,
      project_id_is_null: false,
      completed_at_is_null: true,
      reopened_at_is_null: true,
      recurrence_is_null: false,
      estimate_minutes_is_null: false,
      deleted_at_is_null: true,
    };
    expect(
      isDbRequest({ requestId: "x", kind: "exec", op: "putTask", params: validTaskWrite }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putTask",
        params: { ...validTaskWrite, estimate_minutes_is_null: true },
      }),
    ).toBe(false);
    expect(
      isDbRequest({ requestId: "x", kind: "query", op: "getTask", params: { id: "task-1" } }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listTaskTags",
        params: { task_id: "task-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listTaskTags",
        params: { task_id: 1 },
      }),
    ).toBe(false);
    const validChecklistItemWrite = {
      id: "checklist-1",
      task_id: "task-1",
      title: "Tee yhteenveto",
      done: 1,
      sort_order: 0,
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
      version: 1,
      deleted_at: "",
      deleted_at_is_null: true,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putTaskChecklistItem",
        params: validChecklistItemWrite,
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putTaskChecklistItem",
        params: { ...validChecklistItemWrite, done: 2 },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getTaskChecklistItem",
        params: { id: "checklist-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listTaskChecklistItems",
        params: {},
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listTaskChecklistItems",
        params: { task_id: "task-1" },
      }),
    ).toBe(false);
    const validRoutineWrite = {
      id: "routine-1",
      title: "Aamurutiini",
      archived_at: "",
      archived_at_is_null: false,
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
      version: 1,
      deleted_at: "",
      deleted_at_is_null: true,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putRoutine",
        params: validRoutineWrite,
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putRoutine",
        params: { ...validRoutineWrite, archived_at: "stale", archived_at_is_null: true },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getRoutine",
        params: { id: "routine-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listRoutines",
        params: {},
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listRoutines",
        params: { archived: true },
      }),
    ).toBe(false);
    const validRoutineStepWrite = {
      id: "routine-step-1",
      routine_id: "routine-1",
      title: "Avaa verhot",
      sort_order: 0,
      optional: 1,
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
      version: 1,
      deleted_at: "",
      deleted_at_is_null: true,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putRoutineStep",
        params: validRoutineStepWrite,
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putRoutineStep",
        params: { ...validRoutineStepWrite, optional: 2 },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getRoutineStep",
        params: { id: "routine-step-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listRoutineSteps",
        params: {},
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listRoutineSteps",
        params: { routine_id: "routine-1" },
      }),
    ).toBe(false);
    const validCalendarBlockWrite = {
      id: "block-1",
      kind: "task",
      title: "Analysoi",
      starts_at: "2026-09-02T08:00:00.000Z",
      ends_at: "2026-09-02T09:00:00.000Z",
      linked_task_id: "task-1",
      linked_task_id_is_null: false,
      linked_routine_id: "",
      linked_routine_id_is_null: true,
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
      version: 1,
      deleted_at: "",
      deleted_at_is_null: true,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putCalendarBlock",
        params: validCalendarBlockWrite,
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putCalendarBlock",
        params: {
          ...validCalendarBlockWrite,
          linked_routine_id: "routine-1",
          linked_routine_id_is_null: false,
        },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getCalendarBlock",
        params: { id: "block-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listCalendarBlocks",
        params: {},
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listCalendarBlocks",
        params: { kind: "task" },
      }),
    ).toBe(false);
    const validFocusSessionWrite = {
      id: "focus-1",
      task_id: "",
      task_id_is_null: true,
      routine_id: "",
      routine_id_is_null: true,
      calendar_block_id: "",
      calendar_block_id_is_null: true,
      phase: "planned",
      started_at: "",
      started_at_is_null: true,
      ended_at: "",
      ended_at_is_null: true,
      duration_seconds: 1500,
      duration_seconds_is_null: false,
      active_elapsed_seconds: 0,
      active_elapsed_seconds_is_null: true,
      active_segment_started_at: "",
      active_segment_started_at_is_null: true,
      accumulated_pause_seconds: 0,
      accumulated_pause_seconds_is_null: true,
      interruption_count: 0,
      interruption_count_is_null: true,
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
      version: 1,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putFocusSession",
        params: validFocusSessionWrite,
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putFocusSession",
        params: {
          ...validFocusSessionWrite,
          interruption_count: -1,
          interruption_count_is_null: false,
        },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "exec",
        op: "putFocusSession",
        params: {
          ...validFocusSessionWrite,
          task_id: "task-1",
          task_id_is_null: false,
          started_at: "2026-09-02T09:00:00.000Z",
          started_at_is_null: false,
          ended_at: "2026-09-02T08:00:00.000Z",
          ended_at_is_null: false,
        },
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getFocusSession",
        params: { id: "focus-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listFocusSessions",
        params: {},
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listFocusSessions",
        params: { phase: "planned" },
      }),
    ).toBe(false);
    const validDistractionWrite = {
      id: "distraction-1",
      focus_session_id: "focus-1",
      noted_at: "2026-09-01T08:04:00.000Z",
      note: "Puhelu",
      note_is_null: false,
      created_at: "2026-09-01T08:04:00.000Z",
      updated_at: "2026-09-01T08:04:00.000Z",
      version: 1,
    };
    expect(
      isDbRequest({
        requestId: "x",
        kind: "transaction",
        ops: [{ op: "putDistraction", params: validDistractionWrite }],
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "transaction",
        ops: [
          {
            op: "putDistraction",
            params: { ...validDistractionWrite, note_is_null: true },
          },
        ],
      }),
    ).toBe(false);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "getDistraction",
        params: { id: "distraction-1" },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listDistractions",
        params: {},
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "x",
        kind: "query",
        op: "listDistractions",
        params: { focus_session_id: "focus-1" },
      }),
    ).toBe(false);
    expect(isDbRequest({ requestId: "x", kind: "query", op: "listEntities", params: {} })).toBe(
      false,
    );
    expect(isDbRequest({ kind: "ping" })).toBe(false);
  });
});
