// T074: sync-entiteettien integriteettitesti (oikea wasm, sama M001-M015-ketju
// kuin worker ajaa). Todistaa kriteerin "ilman Drive-riippuvuutta" — pelkät
// paikalliset taulut:
// - legacy-outbox (M001, ilman kirjoittajia) migroituu sync_operations-tauluun
//   data säilyen (id = operation_id);
// - operation-unioni + entity_version >= 1 + operation_id UNIQUE;
// - sync_cursors: yksi per asennus (UNIQUE), last_seen nullable;
// - conflict_records: status-unioni + resolved <-> resolved_at -kytkös,
//   versioreferenssit pakollisia (§36: molemmat versiot säilytetään).
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

function insertOperation(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    operation_id: id,
    installation_id: "inst-1",
    entity_type: "task",
    entity_id: "t-1",
    operation: "update",
    entity_version: 2,
    occurred_at: AT,
    encrypted_payload_ref: "ref:1",
    integrity_ref: "sha:1",
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO sync_operations (id, operation_id, installation_id, entity_type, entity_id,
       operation, entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
       created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.operation_id,
        row.installation_id,
        row.entity_type,
        row.entity_id,
        row.operation,
        row.entity_version,
        row.occurred_at,
        row.encrypted_payload_ref,
        row.integrity_ref,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

function insertCursor(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    installation_id: "inst-1",
    provider_id: "provider-1",
    last_seen_operation_id: null,
    updated_through: AT,
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO sync_cursors (id, installation_id, provider_id, last_seen_operation_id,
       updated_through, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.installation_id,
        row.provider_id,
        row.last_seen_operation_id,
        row.updated_through,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

function insertConflict(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    entity_type: "task",
    entity_id: "t-1",
    status: "open",
    local_version_ref: "local-ref-1",
    remote_version_ref: "remote-ref-1",
    resolved_at: null,
    resolution_operation_id: null,
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO conflict_records (id, entity_type, entity_id, status, local_version_ref,
       remote_version_ref, resolved_at, resolution_operation_id, created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.entity_type,
        row.entity_id,
        row.status,
        row.local_version_ref,
        row.remote_version_ref,
        row.resolved_at,
        row.resolution_operation_id,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

describe("sync schema (T074)", () => {
  it("legacy-outbox migroituu sync_operationsiin (data säilyy, id = operation_id)", async () => {
    const sqlite3 = await initModule();
    const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as Db;
    try {
      db.exec("PRAGMA foreign_keys=ON;");
      // Aja M001-M014 ja kirjoita legacy-outbox-rivi (M001-aikakauden muoto).
      const early = MIGRATIONS.filter((step) => step.version <= 14);
      for (const step of early) {
        for (const statement of step.statements) {
          db.exec(statement);
        }
      }
      db.exec(
        `INSERT INTO _lifeos_sync_outbox (
           operation_id, installation_id, entity_type, entity_id, operation,
           entity_version, occurred_at, encrypted_payload_ref, integrity_ref)
         VALUES ('legacy-op-1', 'inst-old', 'task', 't-9', 'create', 1, ?,
                 'ref:legacy', 'sha:legacy');`,
        { bind: [AT] },
      );
      // Aja M015: outbox-rivi kantaantuu metadatatauluun.
      const m015 = MIGRATIONS.find((step) => step.version === 15);
      expect(m015).toBeDefined();
      if (m015 === undefined) {
        return;
      }
      for (const statement of m015.statements) {
        db.exec(statement);
      }
      const ops: Row[] = [];
      db.exec(
        "SELECT id, operation_id, installation_id, operation, entity_version FROM sync_operations;",
        { rowMode: "object", resultRows: ops },
      );
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        id: "legacy-op-1",
        operation_id: "legacy-op-1",
        installation_id: "inst-old",
        operation: "create",
        entity_version: 1,
      });
      // Legacy-taulu poistettu.
      const legacy: Row[] = [];
      db.exec(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = '_lifeos_sync_outbox';",
        { rowMode: "object", resultRows: legacy },
      );
      expect(legacy).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it("operaatiot + kursorit + konfliktit tallentuvat ja täyttyvät sopimuksen", async () => {
    const db = await openMigrated();
    try {
      insertOperation(db, "op-1");
      insertOperation(db, "op-2", { operation: "delete", entity_version: 3 });
      // operation_id UNIQUE: sama operaatiotunniste kahdesti hylätään.
      expect(() => {
        insertOperation(db, "op-dup", { operation_id: "op-1" });
      }).toThrow();
      expect(() => {
        insertOperation(db, "op-bad-kind", { operation: "merge" });
      }).toThrow();
      expect(() => {
        insertOperation(db, "op-bad-version", { entity_version: 0 });
      }).toThrow();

      insertCursor(db, "cur-1");
      // Yksi kursori per asennus ja provider.
      expect(() => {
        insertCursor(db, "cur-dup");
      }).toThrow();
      insertCursor(db, "cur-2", { installation_id: "inst-2", last_seen_operation_id: "op-1" });

      insertConflict(db, "cf-1");
      expect(() => {
        insertConflict(db, "cf-bad-status", { status: "merged" });
      }).toThrow();
      // resolved-tila vaatii resolved_at:in (CHECK kytkös).
      expect(() => {
        insertConflict(db, "cf-unresolved", { status: "resolved" });
      }).toThrow();
      insertConflict(db, "cf-resolved", {
        status: "resolved",
        resolved_at: AT,
        resolution_operation_id: "op-1",
      });
      const conflicts: Row[] = [];
      db.exec("SELECT status FROM conflict_records ORDER BY id;", {
        rowMode: "object",
        resultRows: conflicts,
      });
      expect(conflicts.map((row) => row.status)).toEqual(["open", "resolved"]);
    } finally {
      db.close();
    }
  });
});
