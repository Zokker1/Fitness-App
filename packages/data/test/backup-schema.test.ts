// T075: BackupManifest-integriteettitesti (oikea wasm, sama M001-M016-ketju
// kuin worker ajaa). Todistaa kriteerin:
// - backup_version ja schema_version ovat eksplisiittisiä sarakkeita (>= 1);
// - sisältömanifesti JSON-objektina (json_valid), ei itse dataa;
// - crypto_version merkkijonona (ei avaimia/tokeneita manifestiin §38);
// - manifestit ovat muuttumattomia tietueita (ei deleted_at:ta).
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

function insertManifest(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    backup_version: 1,
    schema_version: 16,
    crypto_version: "age-v1",
    contents: '{"task":5,"measurement":12}',
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO backup_manifests (id, backup_version, schema_version, crypto_version, contents,
       created_at, updated_at, version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.backup_version,
        row.schema_version,
        row.crypto_version,
        row.contents,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

describe("backup manifest schema (T075)", () => {
  it("manifesti tallentuu versioineen + sisältöluetteloina", async () => {
    const db = await openMigrated();
    try {
      insertManifest(db, "bm-1");
      const manifests: Row[] = [];
      db.exec(
        "SELECT backup_version, schema_version, crypto_version, contents FROM backup_manifests;",
        { rowMode: "object", resultRows: manifests },
      );
      expect(manifests[0]).toMatchObject({
        backup_version: 1,
        schema_version: 16,
        crypto_version: "age-v1",
      });
      const contents: unknown = JSON.parse(String(manifests[0]?.contents));
      expect(contents).toMatchObject({ task: 5, measurement: 12 });

      // Manifestit muuttumattomia: ei deleted_at-saraketta.
      const columns: Row[] = [];
      db.exec("PRAGMA table_info(backup_manifests);", { rowMode: "object", resultRows: columns });
      expect(columns.map((row) => String(row.name))).not.toContain("deleted_at");
    } finally {
      db.close();
    }
  });

  it("eheysehdot: versiot >= 1, crypto-version pakollinen, contents JSON-objekti", async () => {
    const db = await openMigrated();
    try {
      insertManifest(db, "bm-ok");
      expect(() => {
        insertManifest(db, "bm-bv", { backup_version: 0 });
      }).toThrow();
      expect(() => {
        insertManifest(db, "bm-sv", { schema_version: -1 });
      }).toThrow();
      expect(() => {
        insertManifest(db, "bm-cv", { crypto_version: "  " });
      }).toThrow();
      expect(() => {
        insertManifest(db, "bm-json", { contents: "ei-jsonia" });
      }).toThrow();
      // Tyhjä objekti on validi sisältöluettelo (tyhjä backup).
      insertManifest(db, "bm-empty", { contents: "{}" });
    } finally {
      db.close();
    }
  });
});
