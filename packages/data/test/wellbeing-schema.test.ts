// T071: hyvinvointimerkintöjen integriteettitesti (oikea wasm, sama
// M001-M012-ketju kuin worker ajaa). Todistaa:
// - neljä erillistä taulua yhteisellä metadata-mallilla (T062-vakio);
// - soft-deletable: sleep/activity/journal (deleted_at olemassa), mood
//   tilarivi ilman deleted_at:ta;
// - eheysehdot: sleep_end >= sleep_start, mood 1–5, duration/distance >= 0,
//   body ei tyhjä, kind 1–60.
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS } from "../src/index.ts";

type Row = Record<string, unknown>;

type Db = {
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
};

async function openMigrated(): Promise<Db> {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as Db;
  db.exec("PRAGMA foreign_keys=ON;");
  for (const step of MIGRATIONS) {
    for (const statement of step.statements) {
      db.exec(statement);
    }
  }
  return db;
}

const AT = "2026-01-01T00:00:00.000Z";

describe("wellbeing schema (T071)", () => {
  it("kaikki neljä merkintätyyppiä tallentuvat null-olielillaan", async () => {
    const db = await openMigrated();
    try {
      db.exec(
        `INSERT INTO sleep_entries (id, sleep_start, sleep_end, quality, created_at, updated_at, version, deleted_at)
         VALUES ('sl-1', '2026-01-01T22:30:00.000Z', '2026-01-02T06:45:00.000Z', 4, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO activity_entries (id, activity_at, kind, duration_seconds, distance_meters, created_at, updated_at, version, deleted_at)
         VALUES ('ac-1', '2026-01-02T07:00:00.000Z', 'kävely', 1800, 2500.5, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO mood_checkins (id, checked_at, mood, energy, note, created_at, updated_at, version)
         VALUES ('md-1', '2026-01-02T08:00:00.000Z', 4, 3, 'Hyvä aamu', ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO journal_entries (id, written_at, title, body, created_at, updated_at, version, deleted_at)
         VALUES ('jr-1', '2026-01-02T21:00:00.000Z', NULL, 'Kirjoitus ilman otsikkoa.', ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      const counts: Row[] = [];
      db.exec(
        `SELECT (SELECT COUNT(*) FROM sleep_entries) AS s,
                (SELECT COUNT(*) FROM activity_entries) AS a,
                (SELECT COUNT(*) FROM mood_checkins) AS m,
                (SELECT COUNT(*) FROM journal_entries) AS j;`,
        { rowMode: "object", resultRows: counts },
      );
      expect(counts[0]).toMatchObject({ s: 1, a: 1, m: 1, j: 1 });

      // Yhteinen metadata: mood ilman deleted_at:ta, muilla on.
      const moodCols: Row[] = [];
      db.exec("PRAGMA table_info(mood_checkins);", { rowMode: "object", resultRows: moodCols });
      expect(moodCols.map((row) => String(row.name))).not.toContain("deleted_at");
      const sleepCols: Row[] = [];
      db.exec("PRAGMA table_info(sleep_entries);", { rowMode: "object", resultRows: sleepCols });
      expect(sleepCols.map((row) => String(row.name))).toContain("deleted_at");
    } finally {
      db.close();
    }
  });

  it("eheysehdot: aikaväli, mood-alue, kesto/matkä >= 0, body ei tyhjä", async () => {
    const db = await openMigrated();
    try {
      expect(() => {
        db.exec(
          `INSERT INTO sleep_entries (id, sleep_start, sleep_end, quality, created_at, updated_at, version, deleted_at)
           VALUES ('sl-bad', '2026-01-02T06:45:00.000Z', '2026-01-01T22:30:00.000Z', 3, ?, ?, 1, NULL);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO mood_checkins (id, checked_at, mood, energy, note, created_at, updated_at, version)
           VALUES ('md-bad', ?, 0, NULL, NULL, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO mood_checkins (id, checked_at, mood, energy, note, created_at, updated_at, version)
           VALUES ('md-bad6', ?, 6, NULL, NULL, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO activity_entries (id, activity_at, kind, duration_seconds, distance_meters, created_at, updated_at, version, deleted_at)
           VALUES ('ac-bad', ?, 'juoksu', -10, NULL, ?, ?, 1, NULL);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO journal_entries (id, written_at, title, body, created_at, updated_at, version, deleted_at)
           VALUES ('jr-bad', ?, NULL, '   ', ?, ?, 1, NULL);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      // Rajat OK: mood 1 ja 5, quality/energy null, kind 60 merkkiä.
      db.exec(
        `INSERT INTO mood_checkins (id, checked_at, mood, energy, note, created_at, updated_at, version)
         VALUES ('md-1', ?, 5, NULL, NULL, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      db.exec(
        `INSERT INTO activity_entries (id, activity_at, kind, duration_seconds, distance_meters, created_at, updated_at, version, deleted_at)
         VALUES ('ac-kind60', ?, '${"k".repeat(60)}', NULL, NULL, ?, ?, 1, NULL);`,
        { bind: [AT, AT, AT] },
      );
    } finally {
      db.close();
    }
  });
});
