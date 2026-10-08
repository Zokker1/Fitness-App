// T072: Reminder/NotificationState-integriteettitesti (oikea wasm, sama
// M001-M013-ketju kuin worker ajaa). Todistaa "ajastus ja toimitustila
// erotetaan domainissa":
// - reminders = ajastus (kind-unioni, route, kategoria, enabled-lippu,
//   soft-deletable);
// - notification_states = laitteen toimitustila (delivery-unioni, tilarivit
//   ilman deleted_at:ta, reminder_id nullable);
// - SET NULL: muistutuksen kova poisto irrottaa toimitustilan (historia säilyy);
// - eheysehdot: kind/delivery-unionit, kategoria 1–60, enabled 0/1.
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

function insertReminder(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    kind: "time",
    route: "/tasks",
    title: "Kirjaa mittaus",
    fire_at: "2026-01-02T18:00:00.000Z",
    snoozed_until: null,
    category_key: "health",
    enabled: 1,
    created_at: AT,
    updated_at: AT,
    version: 1,
    deleted_at: null,
    ...overrides,
  };
  db.exec(
    `INSERT INTO reminders (id, kind, route, title, fire_at, snoozed_until, category_key,
       enabled, created_at, updated_at, version, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.kind,
        row.route,
        row.title,
        row.fire_at,
        row.snoozed_until,
        row.category_key,
        row.enabled,
        row.created_at,
        row.updated_at,
        row.version,
        row.deleted_at,
      ],
    },
  );
}

function insertState(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    reminder_id: null,
    category_key: "health",
    delivery: "shown",
    last_evaluated_at: AT,
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO notification_states (id, reminder_id, category_key, delivery, last_evaluated_at,
       created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.reminder_id,
        row.category_key,
        row.delivery,
        row.last_evaluated_at,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

describe("reminder schema (T072)", () => {
  it("ajastus + toimitustila tallentuvat erillisinä (reminder_id nullable)", async () => {
    const db = await openMigrated();
    try {
      insertReminder(db, "r-1");
      insertState(db, "n-1", { reminder_id: "r-1" });
      insertState(db, "n-2", { reminder_id: null, category_key: "tasks", delivery: "pending" });
      const states: Row[] = [];
      db.exec("SELECT reminder_id, delivery FROM notification_states ORDER BY id;", {
        rowMode: "object",
        resultRows: states,
      });
      expect(states[0]).toMatchObject({ reminder_id: "r-1", delivery: "shown" });
      expect(states[1]).toMatchObject({ reminder_id: null, delivery: "pending" });

      // reminders sisältää deleted_at:in, notification_states ei.
      const reminderCols: Row[] = [];
      db.exec("PRAGMA table_info(reminders);", { rowMode: "object", resultRows: reminderCols });
      expect(reminderCols.map((row) => String(row.name))).toContain("deleted_at");
      const stateCols: Row[] = [];
      db.exec("PRAGMA table_info(notification_states);", {
        rowMode: "object",
        resultRows: stateCols,
      });
      expect(stateCols.map((row) => String(row.name))).not.toContain("deleted_at");
    } finally {
      db.close();
    }
  });

  it("eheysehdot + SET NULL: muistutuksen poisto irrottaa toimitustilan", async () => {
    const db = await openMigrated();
    try {
      insertReminder(db, "r-1");
      insertState(db, "n-1", { reminder_id: "r-1" });
      expect(() => {
        insertReminder(db, "r-bad-kind", { kind: "alarm" });
      }).toThrow();
      expect(() => {
        insertReminder(db, "r-bad-enabled", { enabled: 2 });
      }).toThrow();
      expect(() => {
        insertReminder(db, "r-empty-route", { route: " " });
      }).toThrow();
      expect(() => {
        insertState(db, "n-bad-delivery", { delivery: "sent" });
      }).toThrow();
      expect(() => {
        insertState(db, "n-bad-fk", { reminder_id: "puuttuu" });
      }).toThrow();

      // Pehmeä poisto ei irrota; kova poisto SET NULL:aa (historia säilyy).
      db.exec("UPDATE reminders SET deleted_at = ? WHERE id = 'r-1';", { bind: [AT] });
      const before: Row[] = [];
      db.exec("SELECT reminder_id FROM notification_states WHERE id = 'n-1';", {
        rowMode: "object",
        resultRows: before,
      });
      expect(before[0]?.reminder_id).toBe("r-1");
      db.exec("DELETE FROM reminders WHERE id = 'r-1';");
      const after: Row[] = [];
      db.exec("SELECT reminder_id FROM notification_states WHERE id = 'n-1';", {
        rowMode: "object",
        resultRows: after,
      });
      expect(after[0]?.reminder_id).toBeNull();
    } finally {
      db.close();
    }
  });
});
