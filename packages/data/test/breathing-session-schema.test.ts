import { describe, expect, it } from "vitest";
import { createMigratedDatabase, type Db, type Row } from "./migration-harness.ts";

describe("BreathingSession schema (M034)", () => {
  it("stores in-progress and completed sessions and enforces their basic invariants", async () => {
    const db: Db = await createMigratedDatabase();
    const at = "2026-09-01T08:00:00.000Z";
    try {
      db.exec(
        `INSERT INTO breathing_sessions (id, started_at, ended_at, pattern_key, created_at, updated_at, version)
         VALUES ('breath-open', ?, NULL, 'box-breathing', ?, ?, 1);`,
        { bind: [at, at, at] },
      );
      db.exec(
        `INSERT INTO breathing_sessions (id, started_at, ended_at, pattern_key, created_at, updated_at, version)
         VALUES ('breath-done', ?, '2026-09-01T08:05:00.000Z', 'equal-breathing', ?, ?, 1);`,
        { bind: [at, at, at] },
      );

      expect(() => {
        db.exec(
          `INSERT INTO breathing_sessions (id, started_at, ended_at, pattern_key, created_at, updated_at, version)
           VALUES ('breath-reversed', '2026-09-01T08:05:00.000Z', ?, 'box-breathing', ?, ?, 1);`,
          { bind: [at, at, at] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO breathing_sessions (id, started_at, ended_at, pattern_key, created_at, updated_at, version)
           VALUES ('breath-no-pattern', ?, NULL, '   ', ?, ?, 1);`,
          { bind: [at, at, at] },
        );
      }).toThrow();

      const rows: Row[] = [];
      db.exec("SELECT id, ended_at, pattern_key FROM breathing_sessions ORDER BY id;", {
        rowMode: "object",
        resultRows: rows,
      });
      expect(rows).toEqual([
        { id: "breath-done", ended_at: "2026-09-01T08:05:00.000Z", pattern_key: "equal-breathing" },
        { id: "breath-open", ended_at: null, pattern_key: "box-breathing" },
      ]);
    } finally {
      db.close();
    }
  });
});
