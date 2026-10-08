import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS } from "../src/index.ts";

type Row = Record<string, unknown>;

async function openDatabase() {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as {
    exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
    close: () => void;
  };
  return db;
}

describe("supplement schema M032-M033", () => {
  it("migrates legacy taken logs and enforces status, parent, and schedule constraints", async () => {
    const db = await openDatabase();
    try {
      db.exec("PRAGMA foreign_keys=ON;");
      for (const step of MIGRATIONS.filter((migration) => migration.version <= 31)) {
        db.exec("BEGIN;");
        for (const statement of step.statements) db.exec(statement);
        db.exec("INSERT INTO _lifeos_migrations (version, id, description) VALUES (?, ?, ?);", {
          bind: [step.version, step.id, step.description],
        });
        db.exec(`PRAGMA user_version=${String(step.version)};`);
        db.exec("COMMIT;");
      }

      const at = "2026-09-01T08:00:00.000Z";
      db.exec(
        `INSERT INTO supplements (id, name, dose_label, created_at, updated_at, version, deleted_at)
         VALUES ('s-1', 'D-vitamiini', '1 kapseli', ?, ?, 1, NULL);`,
        { bind: [at, at] },
      );
      db.exec(
        `INSERT INTO supplement_logs (id, supplement_id, taken_at, created_at, updated_at, version)
         VALUES ('log-old', 's-1', ?, ?, ?, 1);`,
        { bind: [at, at, at] },
      );

      for (const step of MIGRATIONS.filter((migration) => migration.version > 31)) {
        db.exec("BEGIN;");
        for (const statement of step.statements) db.exec(statement);
        db.exec("INSERT INTO _lifeos_migrations (version, id, description) VALUES (?, ?, ?);", {
          bind: [step.version, step.id, step.description],
        });
        db.exec(`PRAGMA user_version=${String(step.version)};`);
        db.exec("COMMIT;");
      }

      const oldLog: Row[] = [];
      db.exec("SELECT * FROM supplement_logs WHERE id = 'log-old';", {
        rowMode: "object",
        resultRows: oldLog,
      });
      expect(oldLog[0]).toMatchObject({
        status: "taken",
        scheduled_at: null,
        dose_amount: null,
        dose_unit: null,
        taken_at: at,
      });

      db.exec(
        `INSERT INTO supplements (
           id, name, dose_label, amount, unit, schedule_json, stock_amount, stock_unit,
           stock_counted_at, created_at, updated_at, version, deleted_at
         ) VALUES ('s-2', 'Magnesium', NULL, 2, 'tablettia', '["08:00"]', 0,
                   'tablettia', ?, ?, ?, 1, NULL);`,
        { bind: [at, at, at] },
      );
      db.exec(
        `INSERT INTO supplement_logs (
           id, supplement_id, status, scheduled_at, dose_amount, dose_unit, taken_at,
           created_at, updated_at, version
         ) VALUES ('log-pending', 's-2', 'pending', ?, 2, 'tablettia', NULL, ?, ?, 1);`,
        { bind: [at, at, at] },
      );
      expect(() => {
        db.exec(
          `INSERT INTO supplement_logs (
             id, supplement_id, status, scheduled_at, taken_at, created_at, updated_at, version
           ) VALUES ('log-bad', 's-2', 'taken', NULL, NULL, ?, ?, 1);`,
          { bind: [at, at] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO supplement_logs (
             id, supplement_id, status, scheduled_at, taken_at, created_at, updated_at, version
           ) VALUES ('log-orphan', 'missing', 'pending', NULL, NULL, ?, ?, 1);`,
          { bind: [at, at] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO supplement_logs (
             id, supplement_id, status, scheduled_at, taken_at, created_at, updated_at, version
           ) VALUES ('log-duplicate-time', 's-2', 'pending', ?, NULL, ?, ?, 1);`,
          { bind: [at, at, at] },
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });
});
