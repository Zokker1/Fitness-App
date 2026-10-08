// T064: CalendarBlock-timeboxin integriteettitesti (oikea wasm, sama
// M001-M007-ketju kuin worker ajaa). Todistaa:
// - kind-unioni + linkityseheys: linked_task_id vain task-blokille,
//   linked_routine_id vain routine-blokille, molempia ei koskaan yhdessä;
// - FK:t tehtäviin ja rutiineihin (soft-delete säilyttää viitteet);
// - aikaväli: ends_at >= starts_at (leksikaalinen = kronologinen UTC:ssä);
// - soft-delete: deleted_at-sarake olemassa.
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

function insertTask(db: Db, id: string): void {
  db.exec(
    `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
                        completed_at, reopened_at, created_at, updated_at, version, deleted_at)
     VALUES (?, 'Tehtävä', NULL, 'open', 'normal', NULL, NULL, NULL, NULL, ?, ?, 1, NULL);`,
    { bind: [id, AT, AT] },
  );
}

function insertRoutine(db: Db, id: string): void {
  db.exec(
    `INSERT INTO routines (id, title, archived_at, created_at, updated_at, version, deleted_at)
     VALUES (?, 'Rutiini', NULL, ?, ?, 1, NULL);`,
    { bind: [id, AT, AT] },
  );
}

function insertBlock(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    kind: "event",
    title: "Aikapalaute",
    starts_at: "2026-01-02T08:00:00.000Z",
    ends_at: "2026-01-02T09:00:00.000Z",
    linked_task_id: null,
    linked_routine_id: null,
    created_at: AT,
    updated_at: AT,
    version: 1,
    deleted_at: null,
    ...overrides,
  };
  db.exec(
    `INSERT INTO calendar_blocks (id, kind, title, starts_at, ends_at,
       linked_task_id, linked_routine_id, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.kind,
        row.title,
        row.starts_at,
        row.ends_at,
        row.linked_task_id,
        row.linked_routine_id,
        row.created_at,
        row.updated_at,
        row.version,
        row.deleted_at,
      ],
    },
  );
}

describe("calendar_blocks schema (T064)", () => {
  it("tehtävälinkitetty task-blokki + linkitön event-blokki tallentuvat", async () => {
    const db = await openMigrated();
    try {
      insertTask(db, "t-1");
      insertRoutine(db, "r-1");
      insertBlock(db, "b-1", {
        kind: "task",
        linked_task_id: "t-1",
        starts_at: "2026-01-02T08:00:00.000Z",
      });
      insertBlock(db, "b-2");
      insertBlock(db, "b-3", { kind: "routine", linked_routine_id: "r-1" });
      const linked: Row[] = [];
      db.exec("SELECT kind, linked_task_id FROM calendar_blocks WHERE id = 'b-1';", {
        rowMode: "object",
        resultRows: linked,
      });
      expect(linked[0]).toMatchObject({ kind: "task", linked_task_id: "t-1" });
      const routineLinked: Row[] = [];
      db.exec("SELECT kind, linked_routine_id FROM calendar_blocks WHERE id = 'b-3';", {
        rowMode: "object",
        resultRows: routineLinked,
      });
      expect(routineLinked[0]).toMatchObject({ kind: "routine", linked_routine_id: "r-1" });
    } finally {
      db.close();
    }
  });

  it("linkityseheys: ristiinlinkitys, molemmat linkit ja FK-rikkomus hylätään", async () => {
    const db = await openMigrated();
    try {
      insertTask(db, "t-1");
      // event-blokki ei saa linkata tehtävää.
      expect(() => {
        insertBlock(db, "b-bad-kind", { linked_task_id: "t-1" });
      }).toThrow();
      // task-blokki ei saa linkata rutiinia (eikä routine-blokki tehtävää).
      expect(() => {
        insertBlock(db, "b-bad-routine", { linked_routine_id: "r-1" });
      }).toThrow();
      expect(() => {
        insertBlock(db, "b-both", {
          kind: "task",
          linked_task_id: "t-1",
          linked_routine_id: "r-1",
        });
      }).toThrow();
      // FK: tuntematon tehtävä hylätään.
      expect(() => {
        insertBlock(db, "b-bad-fk", { kind: "task", linked_task_id: "puuttuu" });
      }).toThrow();
      // M007:n Routine-FK hylkää puuttuvan parent-rutiinin.
      expect(() => {
        insertBlock(db, "b-bad-routine-fk", {
          kind: "routine",
          linked_routine_id: "puuttuu",
        });
      }).toThrow();
      // Kelvollinen linkitetty blokki: kova poisto tehtävästä estetään FK:lla.
      insertBlock(db, "b-ok", { kind: "task", linked_task_id: "t-1" });
      expect(() => {
        db.exec("DELETE FROM tasks WHERE id = 't-1';");
      }).toThrow();
      // Pehmeä poisto toimii (historia säilyy).
      db.exec("UPDATE tasks SET deleted_at = ? WHERE id = 't-1';", { bind: [AT] });
      const blocks: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM calendar_blocks WHERE linked_task_id = 't-1';", {
        rowMode: "object",
        resultRows: blocks,
      });
      expect(Number(blocks[0]?.n)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("aikaväli ja kind-unioni: ends < starts ja tuntematon kind hylätään", async () => {
    const db = await openMigrated();
    try {
      expect(() => {
        insertBlock(db, "b-time", {
          starts_at: "2026-01-02T09:00:00.000Z",
          ends_at: "2026-01-02T08:59:00.000Z",
        });
      }).toThrow();
      expect(() => {
        insertBlock(db, "b-kind", { kind: "meeting" });
      }).toThrow();
      // Rajat: samat alku- ja loppuajat OK (0 min timebox), fokus-blokki OK.
      insertBlock(db, "b-zero", {
        kind: "focus",
        starts_at: "2026-01-02T10:00:00.000Z",
        ends_at: "2026-01-02T10:00:00.000Z",
      });
      const columns: Row[] = [];
      db.exec("PRAGMA table_info(calendar_blocks);", { rowMode: "object", resultRows: columns });
      expect(columns.map((row) => String(row.name))).toContain("deleted_at");
    } finally {
      db.close();
    }
  });
});
