// T077: migration test harnessin testit. Todistaa kriteerin:
// - tyhjä kanta migroituu uusimpaan (kaikki 20 vaihetta, historia täydellinen,
//   integrity ok, domain-taulut olemassa);
// - edellisen version (v15) FIXTURE migroituu uusimpaan ja DATA SÄILYYY
//   (v15-aikakauden user_preferences-rivi + task-rivi luettavissa M016:n
//   jälkeen — ei tietojen menetystä rakennemuutoksissa);
// - ajan tasalla oleva kanta: uusinta on no-op (historia ei kasva);
// - virheellinen kohdeversio hylätään (downgrade/too-new).
// Harness replikoi workerin runMigrations-säännöt (per-vaihe-transaktio +
// historia + user_version) — sama semantiikka, testattava ilman selainta.
import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "../src/index.ts";
import {
  applyMigrations,
  createMigratedDatabase,
  openFresh,
  readAppliedVersions,
  readSchemaVersion,
  type Db,
} from "./migration-harness.ts";

type WasmRow = Record<string, unknown>;

function queryAll(db: Db, sql: string): WasmRow[] {
  const rows: WasmRow[] = [];
  db.exec(sql, { rowMode: "object", resultRows: rows });
  return rows;
}

const AT = "2026-01-01T00:00:00.000Z";

/** V15-aikakauden datafixtuuri: rivit jotka olivat olemassa ennen M016:ta. */
function seedV15Fixture(db: Db): void {
  db.exec(
    `INSERT INTO user_preferences (id, theme, day_start_hour, gamification_visible, enabled_sections,
       notification_defaults_enabled, app_lock_enabled, created_at, updated_at, version)
     VALUES ('pref-1', 'dark', 9, 1, '["today","tasks"]', 0, 0, ?, ?, 3);`,
    { bind: [AT, AT] },
  );
  db.exec(
    `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
       completed_at, reopened_at, created_at, updated_at, version, deleted_at)
     VALUES ('t-fix', 'Fixture-tehtävä', NULL, 'open', 'high', NULL, NULL, NULL, NULL, ?, ?, 2, NULL);`,
    { bind: [AT, AT] },
  );
}

describe("migration harness (T077)", () => {
  it("tyhjä kanta migroituu uusimpaan: versio + historia + integrity", async () => {
    const db = await createMigratedDatabase();
    try {
      expect(readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      expect(readAppliedVersions(db)).toHaveLength(CURRENT_SCHEMA_VERSION);
      expect(readAppliedVersions(db)).toEqual(MIGRATIONS.map((step) => step.version));

      const integrity = queryAll(db, "PRAGMA integrity_check;");
      const firstCell: unknown = Object.values(integrity[0] ?? {})[0];
      expect(typeof firstCell === "string" ? firstCell.toLowerCase() : "").toBe("ok");

      const tables = queryAll(
        db,
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;",
      );
      const names = tables.map((row) => String(row.name));
      for (const expected of [
        "user_preferences",
        "browser_installations",
        "tasks",
        "calendar_blocks",
        "goals",
        "focus_sessions",
        "measurements",
        "sync_operations",
        "backup_manifests",
      ]) {
        expect(names).toContain(expected);
      }
    } finally {
      db.close();
    }
  });

  it("v15-fixture migroituu uusimpaan ja data säilyy", async () => {
    const db = await openFresh();
    try {
      applyMigrations(db, 0, CURRENT_SCHEMA_VERSION - 1);
      expect(readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION - 1);
      seedV15Fixture(db);

      applyMigrations(db, CURRENT_SCHEMA_VERSION - 1, CURRENT_SCHEMA_VERSION);
      expect(readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
      expect(readAppliedVersions(db)).toHaveLength(CURRENT_SCHEMA_VERSION);

      // Data säilyi rakennemuutoksen yli.
      const prefs = queryAll(
        db,
        "SELECT theme, day_start_hour, version FROM user_preferences WHERE id = 'pref-1';",
      );
      expect(prefs[0]).toMatchObject({ theme: "dark", day_start_hour: 9, version: 3 });
      const tasks = queryAll(db, "SELECT title, priority, version FROM tasks WHERE id = 't-fix';");
      expect(tasks[0]).toMatchObject({ title: "Fixture-tehtävä", priority: "high", version: 2 });

      const integrity = queryAll(db, "PRAGMA integrity_check;");
      const firstCell: unknown = Object.values(integrity[0] ?? {})[0];
      expect(typeof firstCell === "string" ? firstCell.toLowerCase() : "").toBe("ok");
    } finally {
      db.close();
    }
  });

  it("M034 → M035 säilyttää questin ja progressin mutta jättää vanhan säännön tuntemattomaksi", async () => {
    const db = await openFresh();
    try {
      db.exec("PRAGMA foreign_keys=ON;");
      applyMigrations(db, 0, 34);
      db.exec(
        `INSERT INTO quests (
           id, title, description, active_from, active_until, created_at, updated_at, version
         ) VALUES ('q-old', 'Vanha haaste', NULL, ?, ?, ?, ?, 2);`,
        { bind: [AT, AT, AT, AT] },
      );
      db.exec(
        `INSERT INTO quest_progress (
           id, quest_id, progress, goal, completed_at, created_at, updated_at, version
         ) VALUES ('qp-old', 'q-old', 2, 5, NULL, ?, ?, 3);`,
        { bind: [AT, AT] },
      );

      applyMigrations(db, 34, 35);
      const quests = queryAll(
        db,
        "SELECT title, condition_kind, condition_goal, minimum_amount, version FROM quests WHERE id='q-old';",
      );
      expect(quests[0]).toEqual({
        title: "Vanha haaste",
        condition_kind: null,
        condition_goal: null,
        minimum_amount: null,
        version: 2,
      });
      const progress = queryAll(
        db,
        "SELECT quest_id, progress, goal, version FROM quest_progress;",
      );
      expect(progress[0]).toEqual({ quest_id: "q-old", progress: 2, goal: 5, version: 3 });
      expect(readSchemaVersion(db)).toBe(35);
    } finally {
      db.close();
    }
  });

  it("ajan tasalla oleva kanta: uusinta on no-op (historia ei kasva)", async () => {
    const db = await createMigratedDatabase();
    try {
      applyMigrations(db, CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
      expect(readAppliedVersions(db)).toHaveLength(CURRENT_SCHEMA_VERSION);
      expect(readSchemaVersion(db)).toBe(CURRENT_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it("virheellinen kohdeversio hylätään (too-new)", async () => {
    const db = await openFresh();
    try {
      expect(() => {
        applyMigrations(db, 0, CURRENT_SCHEMA_VERSION + 1);
      }).toThrow(/migration-target-too-new/);
      expect(readSchemaVersion(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});
