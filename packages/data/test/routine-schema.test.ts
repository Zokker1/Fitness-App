// T066: Routine/RoutineStep + calendar_blocks-routine-FK integriteettitesti
// (oikea wasm, sama M001-M007-ketju kuin worker ajaa). Todistaa:
// - järjestetty rutiini tallentuu: steps routine+sort_order ilman UNIQUEia
//   (uudelleenjärjestely ei tarvitse väliaikaisia duplikaatteja);
// - CASCADE: rutiinin kova poisto poistaa askeleet;
// - T064:n luvattu FK: calendar_blocks.linked_routine_id -> routines(id)
//   ON DELETE SET NULL (rutiinin kova poisto irrottaa blokin, historia säilyy);
// - FK-kiellot: tuntematon routine_id askeleelle/blokille;
// - eheysehdot: title 1–200, sort_order >= 0.
// Data-säilyvyys uudelleenrakennuksessa: M005-rivit kantaantuvat M007:ssä.
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS, pendingMigrations } from "../src/index.ts";

type Row = Record<string, unknown>;

type Db = {
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
};

/** Migroi vaiheittain: M005 väliin jättäen ei mahdollista (ketju aukoton) —
 * tämä apuri ajaa ketjun tiettyyn versioon asti (T077-harnessin ennakkosolu). */
async function openMigratedTo(target: number): Promise<Db> {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as Db;
  db.exec("PRAGMA foreign_keys=ON;");
  const steps = pendingMigrations(MIGRATIONS, 0).filter((step) => step.version <= target);
  for (const step of steps) {
    for (const statement of step.statements) {
      db.exec(statement);
    }
  }
  return db;
}

const AT = "2026-01-01T00:00:00.000Z";

function insertRoutine(db: Db, id: string, title = "Aamurutiini"): void {
  db.exec(
    `INSERT INTO routines (id, title, archived_at, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, NULL, ?, ?, 1, NULL);`,
    { bind: [id, title, AT, AT] },
  );
}

function insertStep(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    routine_id: "r-1",
    title: "Venyttele",
    sort_order: 0,
    created_at: AT,
    updated_at: AT,
    version: 1,
    deleted_at: null,
    ...overrides,
  };
  db.exec(
    `INSERT INTO routine_steps (id, routine_id, title, sort_order, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.routine_id,
        row.title,
        row.sort_order,
        row.created_at,
        row.updated_at,
        row.version,
        row.deleted_at,
      ],
    },
  );
}

function insertTask(db: Db, id: string): void {
  db.exec(
    `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
                        completed_at, reopened_at, created_at, updated_at, version, deleted_at)
     VALUES (?, 'Tehtävä', NULL, 'open', 'normal', NULL, NULL, NULL, NULL, ?, ?, 1, NULL);`,
    { bind: [id, AT, AT] },
  );
}

describe("routine core schema (T066)", () => {
  it("rutiini + järjestetyt askeleet tallentuvat; sort_order ilman UNIQUEia", async () => {
    const db = await openMigratedTo(7);
    try {
      insertRoutine(db, "r-1");
      insertStep(db, "s-1", { sort_order: 0 });
      // Kahdella askeleella sama sort_order SALLITAAN (uudelleenjärjestely).
      insertStep(db, "s-2", { title: "Vesi", sort_order: 0 });
      insertStep(db, "s-3", { title: "Huole", sort_order: 1 });
      const steps: Row[] = [];
      db.exec("SELECT title FROM routine_steps WHERE routine_id = 'r-1' ORDER BY sort_order, id;", {
        rowMode: "object",
        resultRows: steps,
      });
      expect(steps).toHaveLength(3);
    } finally {
      db.close();
    }
  });

  it("CASCADE + FK: askeleet kaskadoituvat, tuntematon routine hylätään", async () => {
    const db = await openMigratedTo(7);
    try {
      insertRoutine(db, "r-1");
      insertStep(db, "s-1");
      expect(() => {
        insertStep(db, "s-bad-fk", { routine_id: "puuttuu" });
      }).toThrow();
      expect(() => {
        insertStep(db, "s-bad-order", { sort_order: -1 });
      }).toThrow();
      expect(() => {
        insertStep(db, "s-empty", { title: " " });
      }).toThrow();

      db.exec("DELETE FROM routines WHERE id = 'r-1';");
      const steps: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM routine_steps;", {
        rowMode: "object",
        resultRows: steps,
      });
      expect(Number(steps[0]?.n)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("calendar_blocks.routine-FK (T064-lupaus): SET NULL + data säilyy M005->M007", async () => {
    // Luo ensin M005-kannan tila: task + routine-block jonka routine_id on
    // "r-vanha" (ei rutiiniriviä — M005:ssä FK:tta ei vielä ollut).
    const db = await openMigratedTo(5);
    insertTask(db, "t-1");
    db.exec(
      `INSERT INTO calendar_blocks (id, kind, title, starts_at, ends_at,
         linked_task_id, linked_routine_id, created_at, updated_at, version, deleted_at)
       VALUES ('b-vanha', 'routine', 'Rutiiniaika', '2026-01-02T07:00:00.000Z',
               '2026-01-02T07:30:00.000Z', NULL, 'r-vanha', ?, ?, 1, NULL);`,
      { bind: [AT, AT] },
    );
    // Aja M006 + M007: data on kopioidava uudelleenrakennetussa taulussa.
    const steps = pendingMigrations(MIGRATIONS, 5);
    for (const step of steps) {
      for (const statement of step.statements) {
        db.exec(statement);
      }
    }
    try {
      // M005-kauden roskalinkit nollataan migroinnissa (rutiineja ei voinut
      // olla olemassa ennen M007:tä), muu data säilyy.
      const blocks: Row[] = [];
      db.exec("SELECT kind, linked_routine_id FROM calendar_blocks WHERE id = 'b-vanha';", {
        rowMode: "object",
        resultRows: blocks,
      });
      expect(blocks[0]).toMatchObject({ kind: "routine", linked_routine_id: null });

      // FK nyt voimassa: tuntematon rutiini hylätään.
      expect(() => {
        db.exec(
          `INSERT INTO calendar_blocks (id, kind, title, starts_at, ends_at,
             linked_task_id, linked_routine_id, created_at, updated_at, version, deleted_at)
           VALUES ('b-bad', 'routine', 'Rutiiniaika', '2026-01-02T08:00:00.000Z',
                   '2026-01-02T08:30:00.000Z', NULL, 'puuttuu', ?, ?, 1, NULL);`,
          { bind: [AT, AT] },
        );
      }).toThrow();

      // Kelvollinen linkitys + rutiinin kova poisto -> SET NULL (ei poistoa).
      insertRoutine(db, "r-1");
      db.exec(
        `INSERT INTO calendar_blocks (id, kind, title, starts_at, ends_at,
           linked_task_id, linked_routine_id, created_at, updated_at, version, deleted_at)
         VALUES ('b-ok', 'routine', 'Aamu', '2026-01-02T06:00:00.000Z',
                 '2026-01-02T06:30:00.000Z', NULL, 'r-1', ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec("DELETE FROM routines WHERE id = 'r-1';");
      const after: Row[] = [];
      db.exec("SELECT linked_routine_id FROM calendar_blocks WHERE id = 'b-ok';", {
        rowMode: "object",
        resultRows: after,
      });
      expect(after[0]?.linked_routine_id).toBeNull();
    } finally {
      db.close();
    }
  });

  it("M018: optional-lippu säilyy ja vanha oletus on pakollinen", async () => {
    const db = await openMigratedTo(18);
    try {
      insertRoutine(db, "r-1");
      insertStep(db, "s-required");
      db.exec(
        "INSERT INTO routine_steps (id, routine_id, title, sort_order, optional, created_at, updated_at, version, deleted_at) VALUES ('s-optional', 'r-1', 'Hengitä', 1, 1, ?, ?, 1, NULL);",
        { bind: [AT, AT] },
      );
      const rows: Row[] = [];
      db.exec(
        "SELECT id, optional FROM routine_steps WHERE routine_id = 'r-1' ORDER BY sort_order;",
        {
          rowMode: "object",
          resultRows: rows,
        },
      );
      expect(rows.map((row) => row.optional)).toEqual([0, 1]);
      expect(() => {
        db.exec(
          "INSERT INTO routine_steps (id, routine_id, title, sort_order, optional, created_at, updated_at, version, deleted_at) VALUES ('s-invalid', 'r-1', 'Virhe', 2, 2, ?, ?, 1, NULL);",
          { bind: [AT, AT] },
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });

  it("M042: aikataulun rytmi, viikonpäivät, kellonaika ja Routine-FK ovat rajattuja", async () => {
    const db = await openMigratedTo(42);
    try {
      insertRoutine(db, "r-1");
      db.exec(
        `INSERT INTO routine_schedules (
           id, routine_id, cadence, weekdays_json, local_time, enabled,
           created_at, updated_at, version, deleted_at
         ) VALUES ('schedule-daily', 'r-1', 'daily', '[]', '07:30', 1, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO routine_schedules (
           id, routine_id, cadence, weekdays_json, local_time, enabled,
           created_at, updated_at, version, deleted_at
         ) VALUES ('schedule-weekly', 'r-1', 'weekly', '[1,3,5]', NULL, 0, ?, ?, 2, NULL);`,
        { bind: [AT, AT] },
      );
      const rows: Row[] = [];
      db.exec(
        "SELECT cadence, weekdays_json, local_time, enabled FROM routine_schedules ORDER BY id;",
        { rowMode: "object", resultRows: rows },
      );
      expect(rows).toEqual([
        { cadence: "daily", weekdays_json: "[]", local_time: "07:30", enabled: 1 },
        { cadence: "weekly", weekdays_json: "[1,3,5]", local_time: null, enabled: 0 },
      ]);

      const invalidRows = [
        ["bad-fk", "puuttuu", "daily", "[]", null],
        ["bad-cadence-days", "r-1", "daily", "[1]", null],
        ["bad-weekdays", "r-1", "weekly", "[]", null],
        ["bad-time", "r-1", "daily", "[]", "24:00"],
      ] as const;
      for (const [id, routineId, cadence, weekdays, localTime] of invalidRows) {
        expect(() => {
          db.exec(
            `INSERT INTO routine_schedules (
               id, routine_id, cadence, weekdays_json, local_time, enabled,
               created_at, updated_at, version, deleted_at
             ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, NULL);`,
            { bind: [id, routineId, cadence, weekdays, localTime, AT, AT] },
          );
        }).toThrow();
      }

      db.exec("DELETE FROM routines WHERE id = 'r-1';");
      const afterDelete: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM routine_schedules;", {
        rowMode: "object",
        resultRows: afterDelete,
      });
      expect(Number(afterDelete[0]?.n)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("M043: RoutineRun säilyttää historian ja rajaa yhden aktiivisen päiväajon", async () => {
    const db = await openMigratedTo(43);
    try {
      insertRoutine(db, "r-1");
      db.exec(
        `INSERT INTO routine_runs (
           id, routine_id, local_date, status, day_mode, started_at, completed_at,
           skip_reason, created_at, updated_at, version
         ) VALUES ('run-cancelled', 'r-1', '2026-09-21', 'running', NULL, ?, NULL, NULL, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      db.exec("UPDATE routine_runs SET status = 'cancelled' WHERE id = 'run-cancelled';");
      db.exec(
        `INSERT INTO routine_runs (
           id, routine_id, local_date, status, day_mode, started_at, completed_at,
           skip_reason, created_at, updated_at, version
         ) VALUES ('run-active', 'r-1', '2026-09-21', 'running', 'minimum', ?, NULL, NULL, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );

      expect(() => {
        db.exec(
          `INSERT INTO routine_runs (
             id, routine_id, local_date, status, day_mode, started_at, completed_at,
             skip_reason, created_at, updated_at, version
           ) VALUES ('run-duplicate', 'r-1', '2026-09-21', 'skipped', 'full', ?, ?, 'Ei tänään', ?, ?, 1);`,
          { bind: [AT, AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO routine_runs (
             id, routine_id, local_date, status, day_mode, started_at, completed_at,
             skip_reason, created_at, updated_at, version
           ) VALUES ('run-bad-date', 'r-1', '2026/09/21', 'running', NULL, ?, NULL, NULL, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO routine_runs (
             id, routine_id, local_date, status, day_mode, started_at, completed_at,
             skip_reason, created_at, updated_at, version
           ) VALUES ('run-bad-fk', 'missing', '2026-09-22', 'running', NULL, ?, NULL, NULL, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM routines WHERE id = 'r-1';");
      }).toThrow();

      db.exec("DELETE FROM routine_runs;");
      db.exec("DELETE FROM routines WHERE id = 'r-1';");
      const rows: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM routine_runs;", {
        rowMode: "object",
        resultRows: rows,
      });
      expect(Number(rows[0]?.n)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("M044: askelkirjaus vaatii saman rutiinin suorituksen ja askeleen parentiksi", async () => {
    const db = await openMigratedTo(44);
    try {
      insertRoutine(db, "r-1");
      insertRoutine(db, "r-2", "Iltarutiini");
      insertStep(db, "s-1", { routine_id: "r-1" });
      insertStep(db, "s-2", { routine_id: "r-2" });
      db.exec(
        `INSERT INTO routine_runs (
           id, routine_id, local_date, status, day_mode, started_at, completed_at,
           skip_reason, created_at, updated_at, version
         ) VALUES ('run-1', 'r-1', '2026-09-21', 'running', NULL, ?, NULL, NULL, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      db.exec(
        `INSERT INTO routine_step_runs (
           id, routine_run_id, routine_step_id, status, completed_at, skip_reason,
           created_at, updated_at, version
         ) VALUES ('step-run-1', 'run-1', 's-1', 'pending', NULL, NULL, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `UPDATE routine_step_runs
         SET status = 'completed', completed_at = ?, version = 2
         WHERE id = 'step-run-1';`,
        { bind: [AT] },
      );

      const invalidInsertions = [
        ["wrong-routine", "run-1", "s-2", "pending", null, null],
        ["duplicate-step", "run-1", "s-1", "pending", null, null],
        ["bad-shape", "run-1", "s-1", "pending", AT, null],
      ] as const;
      for (const [id, runId, stepId, status, completedAt, skipReason] of invalidInsertions) {
        expect(() => {
          db.exec(
            `INSERT INTO routine_step_runs (
               id, routine_run_id, routine_step_id, status, completed_at, skip_reason,
               created_at, updated_at, version
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1);`,
            { bind: [id, runId, stepId, status, completedAt, skipReason, AT, AT] },
          );
        }).toThrow();
      }
      expect(() => {
        db.exec("UPDATE routine_step_runs SET routine_step_id = 's-2' WHERE id = 'step-run-1';");
      }).toThrow();
      expect(() => {
        db.exec("UPDATE routine_runs SET routine_id = 'r-2' WHERE id = 'run-1';");
      }).toThrow();
      expect(() => {
        db.exec("UPDATE routine_steps SET routine_id = 'r-2' WHERE id = 's-1';");
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM routine_runs WHERE id = 'run-1';");
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM routine_steps WHERE id = 's-1';");
      }).toThrow();

      db.exec("DELETE FROM routine_step_runs WHERE id = 'step-run-1';");
      db.exec("DELETE FROM routine_runs WHERE id = 'run-1';");
      db.exec("DELETE FROM routines WHERE id IN ('r-1', 'r-2');");
      const rows: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM routine_step_runs;", {
        rowMode: "object",
        resultRows: rows,
      });
      expect(Number(rows[0]?.n)).toBe(0);
    } finally {
      db.close();
    }
  });
});
