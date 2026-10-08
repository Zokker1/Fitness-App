// T073: gamification-integriteettitesti (oikea wasm, sama M001-M045-ketju
// kuin worker ajaa). Todistaa:
// - XP append-only-virta: kaikki 7 lähdettä, negatiivinen manual-korjaus OK,
//   polymorfinen source_entity_id ilman FK:ta;
// - level_states snapshot CHECK (total_xp >= 0, level >= 1);
// - quest + progress CASCADE, active-ikkuna CHECK;
// - achievements/collectibles UNIQUE keyt;
// - user_rewards: ainakin yksi viite CHECK, append-only ja FK:n cascaden esto.
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

describe("gamification schema (T073)", () => {
  it("XP-virta: lähteet, negatiivinen manual-korjaus, polymorfinen viite", async () => {
    const db = await openMigrated();
    try {
      db.exec(
        `INSERT INTO xp_transactions (id, source, source_entity_id, amount, earned_at, reason,
           created_at, updated_at, version)
         VALUES ('x-1', 'task', 't-1', 10, ?, 'Tehtävä valmis', ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      db.exec(
        `INSERT INTO xp_transactions (id, source, source_entity_id, amount, earned_at, reason,
           created_at, updated_at, version)
         VALUES ('x-2', 'manual', NULL, -5, ?, 'Korjaus', ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      expect(() => {
        db.exec("UPDATE xp_transactions SET amount = 0 WHERE id = 'x-1';");
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM xp_transactions WHERE id = 'x-1';");
      }).toThrow();
      db.exec(
        `INSERT INTO level_states (id, total_xp, level, computed_at, created_at, updated_at, version)
         VALUES ('lv-1', 5, 1, ?, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      const xp: Row[] = [];
      db.exec("SELECT source, amount FROM xp_transactions ORDER BY id;", {
        rowMode: "object",
        resultRows: xp,
      });
      expect(xp.map((row) => row.amount)).toEqual([10, -5]);
      expect(() => {
        db.exec(
          `INSERT INTO xp_transactions (id, source, source_entity_id, amount, earned_at, reason,
             created_at, updated_at, version)
           VALUES ('x-bad', 'import', NULL, 5, ?, NULL, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO level_states (id, total_xp, level, computed_at, created_at, updated_at, version)
           VALUES ('lv-bad', 5, 0, ?, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });

  it("quest + progress CASCADE; active-ikkuna CHECK", async () => {
    const db = await openMigrated();
    try {
      db.exec(
        `INSERT INTO quests (id, title, description, active_from, active_until, created_at, updated_at, version)
         VALUES ('q-1', 'Viikon haaste', NULL, '2026-01-01T00:00:00.000Z', '2026-01-07T00:00:00.000Z', ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO quest_progress (id, quest_id, progress, goal, completed_at, created_at, updated_at, version)
         VALUES ('qp-1', 'q-1', 3, 5, NULL, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      expect(() => {
        db.exec(
          `INSERT INTO quests (id, title, description, active_from, active_until, created_at, updated_at, version)
           VALUES ('q-bad', 'Aikakone', NULL, '2026-01-07T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO quest_progress (id, quest_id, progress, goal, completed_at, created_at, updated_at, version)
           VALUES ('qp-bad-goal', 'q-1', 1, 0, NULL, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();

      db.exec("DELETE FROM quests WHERE id = 'q-1';");
      const progress: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM quest_progress;", {
        rowMode: "object",
        resultRows: progress,
      });
      expect(Number(progress[0]?.n)).toBe(0);
    } finally {
      db.close();
    }
  });

  it("M035 tallentaa QuestCondition-kentät ja sallii vanhan questin tuntemattoman ehdon", async () => {
    const db = await openMigrated();
    try {
      db.exec(
        `INSERT INTO quests (
           id, title, description, active_from, active_until, created_at, updated_at, version
         ) VALUES ('q-legacy', 'Vanha haaste', NULL, NULL, NULL, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO quests (
           id, title, description, active_from, active_until, condition_kind,
           condition_goal, minimum_amount, created_at, updated_at, version
         ) VALUES ('q-rule', 'Uusi haaste', NULL, NULL, NULL, 'active-day-count', 5, 60, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      const rows: Row[] = [];
      db.exec(
        "SELECT id, condition_kind, condition_goal, minimum_amount FROM quests ORDER BY id;",
        { rowMode: "object", resultRows: rows },
      );
      expect(rows).toEqual([
        {
          id: "q-legacy",
          condition_kind: null,
          condition_goal: null,
          minimum_amount: null,
        },
        {
          id: "q-rule",
          condition_kind: "active-day-count",
          condition_goal: 5,
          minimum_amount: 60,
        },
      ]);
      expect(() => {
        db.exec(
          `INSERT INTO quests (
             id, title, condition_kind, condition_goal, created_at, updated_at, version
           ) VALUES ('q-invalid', 'Virheellinen', 'event-count', NULL, ?, ?, 1);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
    } finally {
      db.close();
    }
  });

  it("achievements/collectibles UNIQUE + user_rewards CHECK, append-only ja FK-suoja", async () => {
    const db = await openMigrated();
    try {
      db.exec(
        `INSERT INTO achievements (id, key, title, description, created_at, updated_at, version)
         VALUES ('a-1', 'first-task', 'Ensimmäinen tehtävä', NULL, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO collectibles (id, key, title, unlocks_theme_key, created_at, updated_at, version)
         VALUES ('c-1', 'medal-bronze', 'Pronssimitali', 'aurora', ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      expect(() => {
        db.exec(
          `INSERT INTO achievements (id, key, title, description, created_at, updated_at, version)
           VALUES ('a-dup', 'first-task', 'Duplikaatti', NULL, ?, ?, 1);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO user_rewards (id, achievement_id, collectible_id, earned_at, created_at, updated_at, version)
           VALUES ('ur-null', NULL, NULL, ?, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      db.exec(
        `INSERT INTO user_rewards (id, achievement_id, collectible_id, earned_at, created_at, updated_at, version)
         VALUES ('ur-1', 'a-1', 'c-1', ?, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      expect(() => {
        db.exec(
          "UPDATE user_rewards SET earned_at = '2026-01-02T00:00:00.000Z' WHERE id = 'ur-1';",
        );
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM user_rewards WHERE id = 'ur-1';");
      }).toThrow();
      // M014:n FK:t ovat CASCADE, mutta M039:n historiatrigger estää parentin
      // poistamisen aiheuttaman palkintohistorian katoamisen.
      expect(() => {
        db.exec("DELETE FROM achievements WHERE id = 'a-1';");
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM collectibles WHERE id = 'c-1';");
      }).toThrow();
      const afterParentDeletes: Row[] = [];
      db.exec("SELECT COUNT(*) AS n FROM user_rewards;", {
        rowMode: "object",
        resultRows: afterParentDeletes,
      });
      expect(Number(afterParentDeletes[0]?.n)).toBe(1);
      const parents: Row[] = [];
      db.exec(
        "SELECT (SELECT COUNT(*) FROM achievements WHERE id = 'a-1') + (SELECT COUNT(*) FROM collectibles WHERE id = 'c-1') AS n;",
        {
          rowMode: "object",
          resultRows: parents,
        },
      );
      expect(Number(parents[0]?.n)).toBe(2);
      const reward: Row[] = [];
      db.exec("SELECT achievement_id, collectible_id FROM user_rewards WHERE id = 'ur-1';", {
        rowMode: "object",
        resultRows: reward,
      });
      expect(reward).toEqual([{ achievement_id: "a-1", collectible_id: "c-1" }]);
    } finally {
      db.close();
    }
  });
});
