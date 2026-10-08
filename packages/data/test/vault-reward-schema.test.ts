// M036-M037: VaultReward- ja append-only VaultRewardClaim -relaatiot.
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
    for (const statement of step.statements) db.exec(statement);
  }
  return db;
}

const AT = "2026-09-01T08:00:00.000Z";

describe("VaultReward schema (M036-M037)", () => {
  it("validoi palkinnon ja claimin viitteet sekä säilyttää lunastushistorian", async () => {
    const db = await openMigrated();
    try {
      db.exec(
        `INSERT INTO vault_rewards (id, title, note, xp_threshold, created_at, updated_at, version)
         VALUES ('reward-1', 'Elokuvailta', NULL, 1000, ?, ?, 1);`,
        { bind: [AT, AT] },
      );
      db.exec(
        `INSERT INTO entity_docs (entity_type, id, doc, created_at, updated_at)
         VALUES ('vault-claim', 'claim-1', ?, ?, ?);`,
        { bind: [JSON.stringify({ id: "claim-1", rewardId: "reward-1" }), AT, AT] },
      );
      expect(() => {
        db.exec(
          `UPDATE entity_docs SET doc = ? WHERE entity_type = 'vault-claim' AND id = 'claim-1';`,
          { bind: [JSON.stringify({ id: "claim-1", rewardId: "reward-missing" })] },
        );
      }).toThrow();

      expect(() => {
        db.exec("DELETE FROM vault_rewards WHERE id = 'reward-1';");
      }).toThrow();
      db.exec(
        `INSERT INTO vault_reward_claims (
           id, reward_id, claimed_at, xp_deducted, created_at, updated_at, version
         ) VALUES ('claim-rel', 'reward-1', ?, 250, ?, ?, 1);`,
        { bind: [AT, AT, AT] },
      );
      db.exec("DELETE FROM entity_docs WHERE entity_type = 'vault-claim' AND id = 'claim-1';");
      expect(() => {
        db.exec("DELETE FROM vault_rewards WHERE id = 'reward-1';");
      }).toThrow();
      expect(() => {
        db.exec("UPDATE vault_reward_claims SET xp_deducted = 0 WHERE id = 'claim-rel';");
      }).toThrow();
      expect(() => {
        db.exec("DELETE FROM vault_reward_claims WHERE id = 'claim-rel';");
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO vault_rewards (id, title, note, xp_threshold, created_at, updated_at, version)
           VALUES ('reward-bad', 'Virheellinen', NULL, 0, ?, ?, 1);`,
          { bind: [AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO entity_docs (entity_type, id, doc, created_at, updated_at)
           VALUES ('vault-claim', 'claim-missing', ?, ?, ?);`,
          { bind: [JSON.stringify({ id: "claim-missing", rewardId: "reward-missing" }), AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO vault_reward_claims (
             id, reward_id, claimed_at, xp_deducted, created_at, updated_at, version
           ) VALUES ('claim-missing', 'reward-missing', ?, 0, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();
      expect(() => {
        db.exec(
          `INSERT INTO vault_reward_claims (
             id, reward_id, claimed_at, xp_deducted, created_at, updated_at, version
           ) VALUES ('claim-negative', 'reward-1', ?, -1, ?, ?, 1);`,
          { bind: [AT, AT, AT] },
        );
      }).toThrow();

      const rows: Row[] = [];
      db.exec("SELECT id, xp_threshold FROM vault_rewards;", {
        rowMode: "object",
        resultRows: rows,
      });
      expect(rows).toEqual([{ id: "reward-1", xp_threshold: 1000 }]);
    } finally {
      db.close();
    }
  });
});
