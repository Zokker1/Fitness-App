// T033/T060-T079: node-db-integration. Oikea @sqlite.org/sqlite-wasm
// node-build :memory:-kannalla ajaa saman migraatioketjun kuin worker:
// user_version=CURRENT_SCHEMA_VERSION, historiataulu, sisätaulut, indeksit, FK=ON, write/read,
// integrity. Selain-OPFS + varsinainen Worker kulkevat Playwright-E2E:ssä
// (T038 + T060/T061 persistenssi-tabit).
//
// T074-HUOMIO: M007 ja M015 ovat KERTALUONTOISIA rakennemuutoksia
// (taulun uudelleenrakennus + DROP), eivät IF NOT EXISTS -uusintoja.
// Todellinen runner (runMigrations) ohittaa jo ajetut historiasta —
// idempotenssitesti alla toistaa vain IF NOT EXISTS -tyyppiset vaiheet.
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { CURRENT_SCHEMA_VERSION, MIGRATIONS } from "../src/index.ts";

type Row = Record<string, unknown>;

async function openMigrated(): Promise<{
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
}> {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as {
    exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
    close: () => void;
  };
  return db;
}

describe("M001-M054 real sqlite", () => {
  it("migroi idempotentisti ja todistaa write/read-polun", async () => {
    const db = await openMigrated();
    try {
      db.exec("PRAGMA foreign_keys=ON;");
      // Historiaton kanta: koko migraatioketju ajetaan (kuten worker tekee).
      for (const step of MIGRATIONS) {
        db.exec("BEGIN;");
        try {
          for (const stmt of step.statements) {
            db.exec(stmt);
          }
          db.exec("INSERT INTO _lifeos_migrations (version, id, description) VALUES (?, ?, ?);", {
            bind: [step.version, step.id, step.description],
          });
          db.exec(`PRAGMA user_version=${String(step.version)};`);
          db.exec("COMMIT;");
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }
      }

      const versionRows: Row[] = [];
      db.exec("PRAGMA user_version;", { rowMode: "object", resultRows: versionRows });
      expect(versionRows[0]?.user_version).toBe(CURRENT_SCHEMA_VERSION);

      const history: Row[] = [];
      db.exec("SELECT version, id FROM _lifeos_migrations ORDER BY version;", {
        rowMode: "object",
        resultRows: history,
      });
      expect(history).toHaveLength(CURRENT_SCHEMA_VERSION);
      expect(history[0]).toMatchObject({ version: 1, id: "M001" });
      expect(history[1]).toMatchObject({ version: 2, id: "M002" });
      expect(history[2]).toMatchObject({ version: 3, id: "M003" });
      expect(history[3]).toMatchObject({ version: 4, id: "M004" });
      expect(history[4]).toMatchObject({ version: 5, id: "M005" });
      expect(history[5]).toMatchObject({ version: 6, id: "M006" });
      expect(history[6]).toMatchObject({ version: 7, id: "M007" });
      expect(history[7]).toMatchObject({ version: 8, id: "M008" });
      expect(history[8]).toMatchObject({ version: 9, id: "M009" });
      expect(history[9]).toMatchObject({ version: 10, id: "M010" });
      expect(history[10]).toMatchObject({ version: 11, id: "M011" });
      expect(history[11]).toMatchObject({ version: 12, id: "M012" });
      expect(history[12]).toMatchObject({ version: 13, id: "M013" });
      expect(history[13]).toMatchObject({ version: 14, id: "M014" });
      expect(history[14]).toMatchObject({ version: 15, id: "M015" });
      expect(history[15]).toMatchObject({ version: 16, id: "M016" });
      expect(history[16]).toMatchObject({ version: 17, id: "M017" });
      expect(history[17]).toMatchObject({ version: 18, id: "M018" });
      expect(history.at(-1)).toMatchObject({
        version: CURRENT_SCHEMA_VERSION,
        id: `M${String(CURRENT_SCHEMA_VERSION).padStart(3, "0")}`,
      });

      const tables: Row[] = [];
      db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_lifeos\\_%' ESCAPE '\\' ORDER BY name;",
        { rowMode: "object", resultRows: tables },
      );
      const names = tables.map((row) => row.name);
      expect(names).toContain("_lifeos_meta");
      expect(names).toContain("_lifeos_migrations");
      // T074: legacy-outbox korvattu sync_operations-taululla.
      expect(names).not.toContain("_lifeos_sync_outbox");

      const domainTables: Row[] = [];
      db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name;",
        { rowMode: "object", resultRows: domainTables },
      );
      const domainNames = domainTables.map((row) => row.name);
      expect(domainNames).toContain("sync_operations");
      expect(domainNames).toContain("sync_cursors");
      expect(domainNames).toContain("conflict_records");
      expect(domainNames).toContain("user_preferences");
      expect(domainNames).toContain("tasks");
      expect(domainNames).toContain("routine_schedules");
      expect(domainNames).toContain("routine_runs");
      expect(domainNames).toContain("routine_step_runs");

      db.exec(
        "INSERT INTO projects (id, name, created_at, updated_at, version, deleted_at) VALUES ('task-project', 'Työ', '2026-09-01', '2026-09-01', 1, NULL);",
      );
      db.exec(
        "INSERT INTO tags (id, name, created_at, updated_at, version, deleted_at) VALUES ('task-tag-a', 'Tärkeä', '2026-09-01', '2026-09-01', 1, NULL);",
      );
      db.exec(
        "INSERT INTO tags (id, name, created_at, updated_at, version, deleted_at) VALUES ('task-tag-b', 'Koti', '2026-09-01', '2026-09-01', 1, NULL);",
      );
      db.exec(
        `INSERT INTO tasks (
           id, title, status, priority, project_id, recurrence_json, estimate_minutes,
           actual_seconds, created_at, updated_at, version, deleted_at
         ) VALUES (
           'task-row', 'Analyysi', 'open', 'high', 'task-project',
           '{"kind":"weekly","everyWeeks":2,"weekdays":[1,3]}', 25.5, 1200,
           '2026-09-01', '2026-09-01', 1, NULL
         );`,
      );
      db.exec(
        "INSERT INTO task_tags (task_id, tag_id, sort_order) VALUES ('task-row', 'task-tag-b', 0), ('task-row', 'task-tag-a', 1);",
      );
      const taskRows: Row[] = [];
      db.exec(
        `SELECT recurrence_json, estimate_minutes, actual_seconds FROM tasks WHERE id = 'task-row';`,
        { rowMode: "object", resultRows: taskRows },
      );
      expect(taskRows[0]).toMatchObject({
        recurrence_json: '{"kind":"weekly","everyWeeks":2,"weekdays":[1,3]}',
        estimate_minutes: 25.5,
        actual_seconds: 1200,
      });
      const taskTagRows: Row[] = [];
      db.exec("SELECT tag_id FROM task_tags WHERE task_id = 'task-row' ORDER BY sort_order;", {
        rowMode: "object",
        resultRows: taskTagRows,
      });
      expect(taskTagRows.map((row) => row.tag_id)).toEqual(["task-tag-b", "task-tag-a"]);
      db.exec(
        `INSERT INTO task_checklist_items (
           id, task_id, title, done, sort_order, created_at, updated_at, version, deleted_at
         ) VALUES (
           'checklist-row', 'task-row', 'Tee yhteenveto', 1, 2,
           '2026-09-01', '2026-09-01', 1, NULL
         );`,
      );
      const checklistRows: Row[] = [];
      db.exec(
        "SELECT task_id, title, done, sort_order, deleted_at FROM task_checklist_items WHERE id = 'checklist-row';",
        { rowMode: "object", resultRows: checklistRows },
      );
      expect(checklistRows[0]).toMatchObject({
        task_id: "task-row",
        title: "Tee yhteenveto",
        done: 1,
        sort_order: 2,
        deleted_at: null,
      });
      db.exec(
        `INSERT INTO routines (
           id, title, archived_at, created_at, updated_at, version, deleted_at
         ) VALUES (
           'routine-row', 'Aamurutiini', '', '2026-09-01', '2026-09-01', 1, NULL
         );`,
      );
      db.exec(
        `INSERT INTO routine_steps (
           id, routine_id, title, sort_order, optional,
           created_at, updated_at, version, deleted_at
         ) VALUES (
           'routine-step-row', 'routine-row', 'Aloita päivä', 0, 1,
           '2026-09-01', '2026-09-01', 1, NULL
         );`,
      );
      const routineRows: Row[] = [];
      db.exec(
        "SELECT routines.title, routines.archived_at, routine_steps.optional FROM routines JOIN routine_steps ON routine_steps.routine_id = routines.id WHERE routines.id = 'routine-row';",
        {
          rowMode: "object",
          resultRows: routineRows,
        },
      );
      expect(routineRows[0]).toEqual({ title: "Aamurutiini", archived_at: "", optional: 1 });
      expect(() => {
        db.exec(
          `INSERT INTO task_checklist_items (
             id, task_id, title, done, sort_order, created_at, updated_at, version, deleted_at
           ) VALUES ('orphan-checklist', 'missing-task', 'Orpo', 0, 0, '2026-09-01', '2026-09-01', 1, NULL);`,
        );
      }).toThrow();

      const indexes: Row[] = [];
      db.exec(
        "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx\\_sync\\_%' ESCAPE '\\' ORDER BY name;",
        { rowMode: "object", resultRows: indexes },
      );
      // T074: operaatio-/cursor-indeksit korvasivat outbox-indeksit.
      const indexNames = indexes.map((row) => String(row.name));
      expect(indexNames).toContain("idx_sync_operations_entity");
      expect(indexNames).toContain("idx_sync_operations_installation");
      expect(indexNames).toContain("idx_sync_cursors_installation");

      // Idempotentti DDL-uusinta turvallisille M001-M017-vaiheille.
      // M007/M015 ja M018+ ovat kertaluontoisia muutoksia, joita todellinen
      // runner ei toista historian perusteella.
      const rerunnable = MIGRATIONS.filter(
        (step) => step.version < 18 && step.version !== 7 && step.version !== 15,
      );
      for (const step of rerunnable) {
        for (const stmt of step.statements) {
          db.exec(stmt);
        }
      }

      db.exec("INSERT INTO _lifeos_meta (key, value) VALUES ('t033', 'ok');");
      const got: Row[] = [];
      db.exec("SELECT value FROM _lifeos_meta WHERE key='t033';", {
        rowMode: "object",
        resultRows: got,
      });
      expect(got[0]?.value).toBe("ok");

      const integrity: Row[] = [];
      db.exec("PRAGMA integrity_check;", { rowMode: "object", resultRows: integrity });
      const firstCell: unknown = Object.values(integrity[0] ?? {})[0];
      expect(typeof firstCell === "string" ? firstCell.toLowerCase() : "").toBe("ok");
    } finally {
      db.close();
    }
  });
});
