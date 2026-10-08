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
  for (const step of MIGRATIONS) {
    for (const statement of step.statements) {
      db.exec(statement);
    }
  }
  return db;
}

function insertFood(
  db: Db,
  id: string,
  fiberPer100G: number | null,
  servingSizeG: number | null,
): void {
  db.exec(
    `INSERT INTO foods (
       id, name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g,
       fiber_per_100g, serving_size_g, created_at, updated_at, version, deleted_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        id,
        "Kaurapuuro",
        70,
        2.5,
        12,
        1.5,
        fiberPer100G,
        servingSizeG,
        "2026-08-01T08:00:00.000Z",
        "2026-08-01T08:00:00.000Z",
        1,
        null,
      ],
    },
  );
}

describe("foods schema (T220)", () => {
  it("tallentaa kuidun, oletusannoksen ja soft-delete-tilan", async () => {
    const db = await openMigrated();
    try {
      insertFood(db, "food-1", 1.8, 250);
      const rows: Row[] = [];
      db.exec(
        `SELECT fiber_per_100g, serving_size_g, deleted_at
         FROM foods WHERE id = ?;`,
        { bind: ["food-1"], rowMode: "object", resultRows: rows },
      );
      expect(rows).toEqual([{ fiber_per_100g: 1.8, serving_size_g: 250, deleted_at: null }]);

      const columns: Row[] = [];
      db.exec("PRAGMA table_info(foods);", { rowMode: "object", resultRows: columns });
      expect(columns.map((row) => row.name)).toContain("fiber_per_100g");
      expect(columns.map((row) => row.name)).toContain("serving_size_g");
    } finally {
      db.close();
    }
  });

  it("hylkää negatiivisen kuidun ja nollakokoisen annoksen", async () => {
    const db = await openMigrated();
    try {
      expect(() => {
        insertFood(db, "food-bad-fiber", -1, 250);
      }).toThrow();
      expect(() => {
        insertFood(db, "food-bad-serving", 1, 0);
      }).toThrow();
    } finally {
      db.close();
    }
  });
});
