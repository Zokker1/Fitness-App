import { describe, expect, it } from "vitest";
import { isSyncInstallationRevoked } from "../src/sqliteWorker.ts";
import { createMigratedDatabase } from "./migration-harness.ts";

describe("installation revoke write guard", () => {
  it("detects a revoked installation from the durable metadata table", async () => {
    const db = await createMigratedDatabase();
    try {
      db.exec(
        `INSERT INTO browser_installations (
           id, installation_id, installation_name, last_seen_app_version,
           last_sync_at, revoked_at, created_at, updated_at, version, is_local
         ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?);`,
        {
          bind: [
            "browser-a-row",
            "browser-a",
            "Työkone",
            "0.1.0",
            "2026-10-03T10:00:00.000Z",
            "2026-10-03T10:00:00.000Z",
            1,
            1,
          ],
        },
      );
      expect(isSyncInstallationRevoked(db, "browser-a")).toBe(false);

      db.exec("UPDATE browser_installations SET revoked_at = ? WHERE installation_id = ?;", {
        bind: ["2026-10-03T11:00:00.000Z", "browser-a"],
      });
      expect(isSyncInstallationRevoked(db, "browser-a")).toBe(true);
      expect(isSyncInstallationRevoked(db, "unknown-browser")).toBe(false);

      db.exec(
        `INSERT INTO browser_installations (
           id, installation_id, installation_name, last_seen_app_version,
           last_sync_at, revoked_at, created_at, updated_at, version, is_local
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?);`,
        {
          bind: [
            "browser-b-row",
            "browser-b",
            "Kotiselain",
            "0.1.0",
            "2026-10-03T11:00:00.000Z",
            "2026-10-03T10:00:00.000Z",
            "2026-10-03T11:00:00.000Z",
            2,
            0,
          ],
        },
      );
      expect(isSyncInstallationRevoked(db, "browser-b", "2026-10-03T10:59:00.000Z")).toBe(false);
      expect(isSyncInstallationRevoked(db, "browser-b", "2026-10-03T11:00:00.000Z")).toBe(true);
    } finally {
      db.close();
    }
  });
});
