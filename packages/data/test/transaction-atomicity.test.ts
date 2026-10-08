// T076: SQLiten BEGIN/COMMIT/ROLLBACK-semantiikka oikealla wasmilla —
// sama rakenne jonka workerin transaction-oppa käyttää. Todistaa, että
// puolivalmis tila ei näy: virhe ROLLBACKissa peruuttaa kaikki erän
// kirjoitukset, COMMIT vahvistaa ne yhdellä kertaa.
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

function countTasks(db: Db): number {
  const rows: Row[] = [];
  db.exec("SELECT COUNT(*) AS n FROM tasks;", { rowMode: "object", resultRows: rows });
  return Number(rows[0]?.n ?? 0);
}

describe("transaction atomicity (T076)", () => {
  it("COMMIT vahvistaa erän kirjoitukset yhdellä kertaa", async () => {
    const db = await openMigrated();
    try {
      db.exec("BEGIN;");
      db.exec(
        `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
           completed_at, reopened_at, created_at, updated_at, version, deleted_at)
         VALUES ('t-1', 'Ensimmäinen', NULL, 'open', 'normal', NULL, NULL, NULL, NULL, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
           completed_at, reopened_at, created_at, updated_at, version, deleted_at)
         VALUES ('t-2', 'Toinen', NULL, 'open', 'normal', NULL, NULL, NULL, NULL, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec("COMMIT;");
      expect(countTasks(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it("ROLLBACK peruuttaa kaikki erän kirjoitukset virheestä huolimatta", async () => {
    const db = await openMigrated();
    try {
      expect(countTasks(db)).toBe(0);
      db.exec("BEGIN;");
      db.exec(
        `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
           completed_at, reopened_at, created_at, updated_at, version, deleted_at)
         VALUES ('t-1', 'Ensimmäinen', NULL, 'open', 'normal', NULL, NULL, NULL, NULL, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      // Toinen kirjoitus rikkoo PK-rajoitteen (duplicaatti-id) → ROLLBACK.
      expect(() => {
        db.exec(
          `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
             completed_at, reopened_at, created_at, updated_at, version, deleted_at)
           VALUES ('t-1', 'Duplikaatti', NULL, 'open', 'normal', NULL, NULL, NULL, NULL, ?, ?, 1, NULL);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
      db.exec("ROLLBACK;");
      // Kumpaakaan ei kirjoitettu: puolivalmis tila ei näy.
      expect(countTasks(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});
