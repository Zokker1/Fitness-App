// T065: Goal/HabitRule/GoalDay-integriteettitesti (oikea wasm, sama
// M001-M006-ketju kuin worker ajaa). Todistaa kriteerin "säännöt ja
// päivätilat erotetaan historiasta":
// - goals/habit_rules soft-deletable entiteettejä; goal_days on tilarivi
//   ilman deleted_at:ta (metadata ilman soft-deleteä);
// - habit_rules.goal_id nullable (sääntö voi olla vapaakin), FK kun täytetty;
// - cadence-unioni + target_per_period >= 1;
// - UNIQUE (goal_id, local_date): yksi tila per tavoite per päivä;
// - goal_days CASCADE: tavoitteen kova poisto poistaa päivätilat; säännöt
//   eivät kaskado (omat entiteettinsä).
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

function insertGoal(db: Db, id: string, title = "Liiku enemmän"): void {
  db.exec(
    `INSERT INTO goals (id, title, description, archived_at, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, NULL, NULL, ?, ?, 1, NULL);`,
    { bind: [id, title, AT, AT] },
  );
}

function insertRule(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    goal_id: null,
    title: "Kävely 30 min",
    cadence: "daily",
    target_per_period: 5,
    created_at: AT,
    updated_at: AT,
    version: 1,
    deleted_at: null,
    ...overrides,
  };
  db.exec(
    `INSERT INTO habit_rules (id, goal_id, title, cadence, target_per_period,
       created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.goal_id,
        row.title,
        row.cadence,
        row.target_per_period,
        row.created_at,
        row.updated_at,
        row.version,
        row.deleted_at,
      ],
    },
  );
}

function insertGoalDay(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    goal_id: "g-1",
    local_date: "2026-01-02",
    completed: 1,
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO goal_days (id, goal_id, local_date, completed, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.goal_id,
        row.local_date,
        row.completed,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

describe("goal core schema (T065)", () => {
  it("sääntö ja päivätila tallentuvat; sääntö voi olla ilman tavoitetta", async () => {
    const db = await openMigrated();
    try {
      insertGoal(db, "g-1");
      insertRule(db, "r-1", { goal_id: "g-1" });
      insertRule(db, "r-free");
      insertGoalDay(db, "gd-1");

      const days: Row[] = [];
      db.exec("SELECT goal_id, local_date, completed FROM goal_days;", {
        rowMode: "object",
        resultRows: days,
      });
      expect(days[0]).toMatchObject({ goal_id: "g-1", local_date: "2026-01-02", completed: 1 });
      // goal_days EI sisällä deleted_at:ta (tilarivi, ei soft-deletable).
      const columns: Row[] = [];
      db.exec("PRAGMA table_info(goal_days);", { rowMode: "object", resultRows: columns });
      const names = columns.map((row) => String(row.name));
      expect(names).not.toContain("deleted_at");
    } finally {
      db.close();
    }
  });

  it("eheysehdot: cadence-unioni, target >= 1, päivämuoto, päivä-UNIQUE", async () => {
    const db = await openMigrated();
    try {
      insertGoal(db, "g-1");
      insertRule(db, "r-1");
      expect(() => {
        insertRule(db, "r-bad-cadence", { cadence: "hourly" });
      }).toThrow();
      expect(() => {
        insertRule(db, "r-bad-target", { target_per_period: 0 });
      }).toThrow();
      expect(() => {
        insertGoalDay(db, "gd-bad-date", { local_date: "2026-1-2" });
      }).toThrow();
      expect(() => {
        insertGoalDay(db, "gd-bad-completed", { completed: 2 });
      }).toThrow();
      // Ensin onnistunut rivi, sitten sama (goal_id, local_date) -> UNIQUE.
      insertGoalDay(db, "gd-1");
      expect(() => {
        insertGoalDay(db, "gd-dup", {});
      }).toThrow();
      // Eri päivä OK; toinen tavoite samalla päivällä OK.
      insertGoalDay(db, "gd-2", { local_date: "2026-01-03" });
      insertGoal(db, "g-2", "Nuku hyvin");
      insertGoalDay(db, "gd-3", { goal_id: "g-2" });
      // FK: päivätila tuntemattomalle tavoitteelle hylätään.
      expect(() => {
        insertGoalDay(db, "gd-bad-fk", { goal_id: "puuttuu" });
      }).toThrow();
      // Säännön FK: tuntematon goal_id hylätään kun täytetty.
      expect(() => {
        insertRule(db, "r-bad-fk", { goal_id: "puuttuu" });
      }).toThrow();
    } finally {
      db.close();
    }
  });

  it("tavoitteen kova poisto kaskadoi päivätilat, sääntö jää vapaaksi (SET NULL)", async () => {
    const db = await openMigrated();
    try {
      insertGoal(db, "g-1");
      insertRule(db, "r-1", { goal_id: "g-1" });
      insertGoalDay(db, "gd-1");

      db.exec("DELETE FROM goals WHERE id = 'g-1';");
      const days: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM goal_days;", { rowMode: "object", resultRows: days });
      expect(Number(days[0]?.n)).toBe(0);
      const rules: Row[] = [];
      db.exec("SELECT goal_id FROM habit_rules;", { rowMode: "object", resultRows: rules });
      expect(rules.length).toBe(1);
      expect(rules[0]?.goal_id).toBeNull();
    } finally {
      db.close();
    }
  });
});
