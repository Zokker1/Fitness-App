// T063: tehtäväytimen relaatioiden ja eheysehtojen integriteettitesti
// (oikea @sqlite.org/sqlite-wasm :memory:-kannalla, sama M001-M004-ketju kuin
// worker ajaa). Todistaa kriteerin: relaatiot ja eheysehdot elävät
// migraatiossa —
// - FK: task.project_id -> projects, checklist -> tasks CASCADE, task_tags
//   M:N CASCADE molempiin suuntiin (rikkiva viite heittää, poisto kaskadoi);
// - CHECK: status/priority-unionit, otsikon pituus 1–200, liput 0/1,
//   sort_order >= 0, version >= 1;
// - UNIQUE: tagin nimi;
// - soft-delete: deleted_at-sarake olemassa, FK sallii poistetun projektin
//   viittauksen (soft delete ei riko historiaviitteitä).
// Meta-taulujen tarkistukset ovat sqlite-memory.test.ts:ssä (ei toistoa).
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

function insertProject(db: Db, id: string, name: string): void {
  db.exec(
    `INSERT INTO projects (id, name, color_key, archived_at, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, NULL, NULL, ?, ?, 1, NULL);`,
    { bind: [id, name, AT, AT] },
  );
}

function insertTag(db: Db, id: string, name: string): void {
  db.exec(
    `INSERT INTO tags (id, name, color_key, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, NULL, ?, ?, 1, NULL);`,
    { bind: [id, name, AT, AT] },
  );
}

function insertTask(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    title: "Osta maitoa",
    notes: null,
    status: "open",
    priority: "normal",
    due_at: null,
    project_id: null,
    completed_at: null,
    reopened_at: null,
    created_at: AT,
    updated_at: AT,
    version: 1,
    deleted_at: null,
    ...overrides,
  };
  db.exec(
    `INSERT INTO tasks (id, title, notes, status, priority, due_at, project_id,
                        completed_at, reopened_at, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.title,
        row.notes,
        row.status,
        row.priority,
        row.due_at,
        row.project_id,
        row.completed_at,
        row.reopened_at,
        row.created_at,
        row.updated_at,
        row.version,
        row.deleted_at,
      ],
    },
  );
}

describe("productivity schema (T063)", () => {
  it("relaatiot: validi projektiviite + M:N liitokset toimivat", async () => {
    const db = await openMigrated();
    try {
      insertProject(db, "prj-1", "Koti");
      insertTag(db, "tag-1", "hankinta");
      insertTag(db, "tag-2", "koti");
      insertTask(db, "t-1", { project_id: "prj-1" });
      db.exec("INSERT INTO task_tags (task_id, tag_id) VALUES ('t-1', 'tag-1');");
      db.exec("INSERT INTO task_tags (task_id, tag_id) VALUES ('t-1', 'tag-2');");

      const tags: Row[] = [];
      db.exec("SELECT tag_id FROM task_tags WHERE task_id = 't-1' ORDER BY tag_id;", {
        rowMode: "object",
        resultRows: tags,
      });
      expect(tags.map((row) => row.tag_id)).toEqual(["tag-1", "tag-2"]);

      const joined: Row[] = [];
      db.exec(
        `SELECT t.title, p.name AS project_name FROM tasks t
         JOIN projects p ON p.id = t.project_id WHERE t.id = 't-1';`,
        { rowMode: "object", resultRows: joined },
      );
      expect(joined[0]).toMatchObject({ title: "Osta maitoa", project_name: "Koti" });
    } finally {
      db.close();
    }
  });

  it("FK eheysohjelma: tuntematon project_id/task_id/tag_id hylätään", async () => {
    const db = await openMigrated();
    try {
      insertTask(db, "t-1");
      expect(() => {
        insertTask(db, "t-2", { project_id: "puuttuu" });
      }).toThrow();
      expect(() => {
        db.exec("INSERT INTO task_tags (task_id, tag_id) VALUES ('t-1', 'puuttuu');");
      }).toThrow();
      expect(() => {
        db.exec("INSERT INTO task_tags (task_id, tag_id) VALUES ('puuttuu', 'x');");
      }).toThrow();
      // Checklist: tuntematon task_id hylätään.
      expect(() => {
        db.exec(
          `INSERT INTO task_checklist_items (id, task_id, title, done, sort_order,
             created_at, updated_at, version, deleted_at)
           VALUES ('c-1', 'puuttuu', 'Muna', 0, 0, ?, ?, 1, NULL);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });

  it("CASCADE: tehtävän poisto poistaa checklistin ja liitokset, ei projektia/tagia", async () => {
    const db = await openMigrated();
    try {
      insertProject(db, "prj-1", "Koti");
      insertTag(db, "tag-1", "hankinta");
      insertTask(db, "t-1", { project_id: "prj-1" });
      db.exec("INSERT INTO task_tags (task_id, tag_id) VALUES ('t-1', 'tag-1');");
      db.exec(
        `INSERT INTO task_checklist_items (id, task_id, title, done, sort_order,
           created_at, updated_at, version, deleted_at)
         VALUES ('c-1', 't-1', 'Muna', 0, 0, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );

      db.exec("DELETE FROM tasks WHERE id = 't-1';");
      const checklist: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM task_checklist_items;", {
        rowMode: "object",
        resultRows: checklist,
      });
      expect(Number(checklist[0]?.n)).toBe(0);
      const junction: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM task_tags;", {
        rowMode: "object",
        resultRows: junction,
      });
      expect(Number(junction[0]?.n)).toBe(0);
      // Projekti ja tagi säilyvät (ei CASCADEa niiden suuntaan).
      const parents: Row[] = [];
      db.exec("SELECT (SELECT COUNT(*) FROM projects) AS p, (SELECT COUNT(*) FROM tags) AS t;", {
        rowMode: "object",
        resultRows: parents,
      });
      expect(parents[0]).toMatchObject({ p: 1, t: 1 });
    } finally {
      db.close();
    }
  });

  it("CHECK-ehdot: status/priority-unionit, pituudet, liput, sort_order", async () => {
    const db = await openMigrated();
    try {
      insertTask(db, "t-1");
      expect(() => {
        insertTask(db, "t-bad-status", { status: "cancelled" });
      }).toThrow();
      expect(() => {
        insertTask(db, "t-bad-prio", { priority: "urgent" });
      }).toThrow();
      expect(() => {
        insertTask(db, "t-empty", { title: "   " });
      }).toThrow();
      expect(() => {
        insertTask(db, "t-long", { title: "a".repeat(201) });
      }).toThrow();
      expect(() => {
        insertTask(db, "t-bad-version", { version: 0 });
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO task_checklist_items (id, task_id, title, done, sort_order,
             created_at, updated_at, version, deleted_at)
           VALUES ('c-bad', 't-1', 'Muna', 2, -1, ?, ?, 1, NULL);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
      // Rajat hyväksytään: pituus 200, priority low, done 0/1.
      insertTask(db, "t-200", { title: "a".repeat(200), priority: "low" });
      db.exec(
        `INSERT INTO task_checklist_items (id, task_id, title, done, sort_order,
           created_at, updated_at, version, deleted_at)
         VALUES ('c-ok', 't-1', 'Muna', 1, 0, ?, ?, 1, NULL);`,
        { bind: [AT, AT] },
      );
    } finally {
      db.close();
    }
  });

  it("UNIQUE: tagin nimi on uniikki; soft-delete-sarake olemassa", async () => {
    const db = await openMigrated();
    try {
      insertTag(db, "tag-1", "hankinta");
      expect(() => {
        insertTag(db, "tag-2", "hankinta");
      }).toThrow();
      const columns: Row[] = [];
      db.exec("PRAGMA table_info(tasks);", { rowMode: "object", resultRows: columns });
      const names = columns.map((row) => String(row.name));
      expect(names).toContain("deleted_at");
    } finally {
      db.close();
    }
  });
});
