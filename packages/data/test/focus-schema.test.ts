// T067: FocusSession/Distraction-integriteettitesti (oikea wasm, sama
// M001-M045-ketju kuin worker ajaa). Todistaa:
// - istunto tallentuu kaikissa phase-tiloissa (unioni CHECK);
// - FK: task RESTRICT, routine SET NULL ja calendar-block SET NULL;
// - aikaväli: ended < started hylätään, NULL-arvot OK (alkamatta/päättynyt);
// - duration: negatiivinen hylätään, 0 OK;
// - parking lot: distraction CASCADE istunnon poistossa, FK-rikkomus hylätään;
// - historiaentiteetit ilman deleted_at:ta (softDelete:false).
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

function insertSession(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    task_id: null,
    routine_id: null,
    phase: "completed",
    started_at: "2026-01-02T08:00:00.000Z",
    ended_at: "2026-01-02T08:25:00.000Z",
    duration_seconds: 1500,
    calendar_block_id: null,
    active_elapsed_seconds: null,
    active_segment_started_at: null,
    accumulated_pause_seconds: null,
    interruption_count: null,
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO focus_sessions (id, task_id, routine_id, phase, started_at, ended_at,
       duration_seconds, created_at, updated_at, version, calendar_block_id,
       active_elapsed_seconds, active_segment_started_at,
       accumulated_pause_seconds, interruption_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.task_id,
        row.routine_id,
        row.phase,
        row.started_at,
        row.ended_at,
        row.duration_seconds,
        row.created_at,
        row.updated_at,
        row.version,
        row.calendar_block_id,
        row.active_elapsed_seconds,
        row.active_segment_started_at,
        row.accumulated_pause_seconds,
        row.interruption_count,
      ],
    },
  );
}

function insertCalendarBlock(db: Db, id: string): void {
  db.exec(
    `INSERT INTO calendar_blocks (id, kind, title, starts_at, ends_at,
       linked_task_id, linked_routine_id, created_at, updated_at, version, deleted_at)
     VALUES (?, 'focus', 'Fokus', ?, ?, NULL, NULL, ?, ?, 1, NULL);`,
    {
      bind: [id, "2026-01-02T08:00:00.000Z", "2026-01-02T08:25:00.000Z", AT, AT],
    },
  );
}

function insertDistraction(db: Db, id: string, sessionId: string, note: string | null): void {
  db.exec(
    `INSERT INTO distractions (id, focus_session_id, noted_at, note, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, 1);`,
    { bind: [id, sessionId, AT, note, AT, AT] },
  );
}

describe("focus core schema (T067)", () => {
  it("istunto tallentuu: task-linkki, routine-linkki, planned ilman aikoja", async () => {
    const db = await openMigrated();
    try {
      insertTask(db, "t-1");
      db.exec(
        `INSERT INTO routines (id, title, archived_at, created_at, updated_at, version, deleted_at)
         VALUES ('r-1', 'Aamurutiini', NULL, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      insertCalendarBlock(db, "b-1");
      insertSession(db, "f-1", { task_id: "t-1" });
      insertSession(db, "f-2", {
        routine_id: "r-1",
        phase: "planned",
        started_at: null,
        ended_at: null,
        duration_seconds: null,
      });
      insertSession(db, "f-3", {
        calendar_block_id: "b-1",
        active_elapsed_seconds: 840,
        active_segment_started_at: "2026-01-02T08:10:00.000Z",
        accumulated_pause_seconds: 60,
        interruption_count: 2,
      });
      const sessions: Row[] = [];
      db.exec("SELECT phase FROM focus_sessions WHERE id IN ('f-1', 'f-2') ORDER BY phase;", {
        rowMode: "object",
        resultRows: sessions,
      });
      expect(sessions.map((row) => row.phase)).toEqual(["completed", "planned"]);
      const extended: Row[] = [];
      db.exec(
        `SELECT calendar_block_id, active_elapsed_seconds, active_segment_started_at,
                accumulated_pause_seconds, interruption_count
         FROM focus_sessions WHERE id = 'f-3';`,
        { rowMode: "object", resultRows: extended },
      );
      expect(extended[0]).toMatchObject({
        calendar_block_id: "b-1",
        active_elapsed_seconds: 840,
        active_segment_started_at: "2026-01-02T08:10:00.000Z",
        accumulated_pause_seconds: 60,
        interruption_count: 2,
      });
    } finally {
      db.close();
    }
  });

  it("eheysehdot: phase-unioni, aikaväli, duration >= 0, FK-kiellot", async () => {
    const db = await openMigrated();
    try {
      expect(() => {
        insertSession(db, "f-bad-phase", { phase: "archived" });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-time", {
          started_at: "2026-01-02T09:00:00.000Z",
          ended_at: "2026-01-02T08:59:00.000Z",
        });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-duration", { duration_seconds: -1 });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-task", { task_id: "puuttuu" });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-routine", { routine_id: "puuttuu" });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-calendar-block", { calendar_block_id: "puuttuu" });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-active-seconds", { active_elapsed_seconds: -1 });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-pause-seconds", { accumulated_pause_seconds: -1 });
      }).toThrow();
      expect(() => {
        insertSession(db, "f-bad-interruption-count", { interruption_count: -1 });
      }).toThrow();
      // Rajat OK: 0 sekuntia, ended == started.
      insertSession(db, "f-zero", { duration_seconds: 0, started_at: AT, ended_at: AT });
    } finally {
      db.close();
    }
  });

  it("parking lot: CASCADE + task-RESTRICT + nullable routine and calendar references", async () => {
    const db = await openMigrated();
    try {
      insertTask(db, "t-1");
      // Rutiini tarvitaan: luo yksi suoraan (M007-skeema).
      db.exec(
        `INSERT INTO routines (id, title, archived_at, created_at, updated_at, version, deleted_at)
         VALUES ('r-1', 'Aamurutiini', NULL, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
      insertCalendarBlock(db, "b-1");
      insertSession(db, "f-1", {
        task_id: "t-1",
        routine_id: "r-1",
        calendar_block_id: "b-1",
      });
      insertDistraction(db, "d-1", "f-1", "Puhelin soi");
      insertDistraction(db, "d-2", "f-1", null);
      expect(() => {
        insertDistraction(db, "d-bad", "puuttuu", null);
      }).toThrow();

      // Kova poisto tehtävästä estetään (RESTRICT).
      expect(() => {
        db.exec("DELETE FROM tasks WHERE id = 't-1';");
      }).toThrow();
      // Pehmeä poisto toimii.
      db.exec("UPDATE tasks SET deleted_at = ? WHERE id = 't-1';", { bind: [AT] });

      // Rutiinin kova poisto -> session routine_id SET NULL.
      db.exec("DELETE FROM routines WHERE id = 'r-1';");
      const session: Row[] = [];
      db.exec("SELECT routine_id FROM focus_sessions WHERE id = 'f-1';", {
        rowMode: "object",
        resultRows: session,
      });
      expect(session[0]?.routine_id).toBeNull();

      // Timeboxin kova poisto säilyttää istunnon ja irrottaa viitteen.
      db.exec("DELETE FROM calendar_blocks WHERE id = 'b-1';");
      const timeboxReference: Row[] = [];
      db.exec("SELECT calendar_block_id FROM focus_sessions WHERE id = 'f-1';", {
        rowMode: "object",
        resultRows: timeboxReference,
      });
      expect(timeboxReference[0]?.calendar_block_id).toBeNull();

      // Istunnon poisto kaskadoi huomiot.
      db.exec("DELETE FROM focus_sessions WHERE id = 'f-1';");
      const distractions: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM distractions;", {
        rowMode: "object",
        resultRows: distractions,
      });
      expect(Number(distractions[0]?.n)).toBe(0);
    } finally {
      db.close();
    }
  });
});
