// T062: yhteisen EntityMetadata-mallin lukitsevat testit.
// - Skeema: M002/M003:n entiteettitaulujen metadatasarakkeet täsmäävät
//   entityMetadataColumns-vakiomuotoon (PRAGMA table_info oikealla wasmilla)
//   — yhtenäisyys on nyt testattu sopimus, ei sopimusta paperilla.
// - ID:t: ulidLikeId tuottaa lajiteltavia, uniikkeja Crockford-base32-id:eitä;
//   isValidEntityId rajat (repository hylkää virheelliset ennen kantaan).
// - Domain: EntityMetadata = BaseEntity & SoftDeletable -tyyppi kattaa
//   molemmat kestomallit (UserPreferences ei soft-deletable, Task on).
// Oikea Worker+OPFS kulkee E2E:ssä (T060/T061 persistenssi-tabit).
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import {
  MIGRATIONS,
  entityMetadataColumnNames,
  entityMetadataColumns,
  isValidEntityId,
  ulidLikeId,
} from "../src/index.ts";

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
  for (const step of MIGRATIONS) {
    for (const statement of step.statements) {
      db.exec(statement);
    }
  }
  return db;
}

function tableColumns(db: Awaited<ReturnType<typeof openMigrated>>, table: string): string[] {
  const rows: Row[] = [];
  db.exec(`PRAGMA table_info(${table});`, { rowMode: "object", resultRows: rows });
  return rows.map((row) => String(row.name));
}

describe("entity metadata schema (T062)", () => {
  it("T060/T061-taulujen metadatasarakkeet täsmäävät vakiomuotoon", async () => {
    const db = await openMigrated();
    try {
      // Ei soft-deletable (UserPreferences): id + created/updated/version.
      expect(tableColumns(db, "user_preferences")).toEqual([
        "id",
        "theme",
        "day_start_hour",
        "gamification_visible",
        "enabled_sections",
        "notification_defaults_enabled",
        "app_lock_enabled",
        ...entityMetadataColumnNames({ softDelete: false }),
        "weight_target",
        "height_cm",
        "meal_slots",
        "macro_targets",
        "hydration_target_ml",
        "hydration_reminder_time",
        "notification_categories",
      ]);
      // Ei soft-deletable (BrowserInstallation).
      expect(tableColumns(db, "browser_installations")).toEqual([
        "id",
        "installation_id",
        "installation_name",
        "last_seen_app_version",
        "last_sync_at",
        "revoked_at",
        ...entityMetadataColumnNames({ softDelete: false }),
        "is_local",
      ]);
      expect(tableColumns(db, "goals")).toContain("active_from");
      expect(tableColumns(db, "goals")).toContain("active_until");
    } finally {
      db.close();
    }
  });

  it("soft-delete-variantti tuo deleted_at:n (T063+ tauluille)", () => {
    expect(entityMetadataColumns({ softDelete: true })).toEqual([
      "created_at TEXT NOT NULL",
      "updated_at TEXT NOT NULL",
      "version INTEGER NOT NULL CHECK (version >= 1)",
      "deleted_at TEXT",
    ]);
    expect(entityMetadataColumnNames({ softDelete: true })).toEqual([
      "created_at",
      "updated_at",
      "version",
      "deleted_at",
    ]);
  });
});

describe("global ids (T062)", () => {
  it("ulidLikeId on uniikki, 26 merkkiä Crockfordia ja lajiteltava ajassa", () => {
    const seen = new Set<string>();
    let previous = "";
    for (let index = 0; index < 1000; index += 1) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const id = ulidLikeId(1_700_000_000_000 + index, bytes);
      expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      seen.add(id);
      expect(id > previous).toBe(true);
      previous = id;
    }
    expect(seen.size).toBe(1000);
  });

  it("isValidEntityId hylkää tyhjät, yli pitkät ja väärät merkit", () => {
    expect(isValidEntityId("id-0001")).toBe(true);
    expect(isValidEntityId("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(true);
    expect(isValidEntityId("")).toBe(false);
    expect(isValidEntityId("-alkaa-viivalla")).toBe(false);
    expect(isValidEntityId("a".repeat(129))).toBe(false);
  });
});
