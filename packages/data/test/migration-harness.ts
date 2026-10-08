// T077: migration test harness — uudelleenkäytettävä apuri joka replikoi
// workerin runMigrations-semantiikan (per-vaihe-transaktio + historiataulu +
// PRAGMA user_version) oikeaa @sqlite.org/sqlite-wasm -node-buildia vasten.
//
// Käyttö (uudet migraatiot M017+):
//   const db = await openFresh();
//   applyMigrations(db, 0, 15);        // rakenna kanta edelliseen versioon
//   seedV15Fixture(db);                // data kuten se versiossa 15 oli
//   applyMigrations(db, 15, 16);       // migroi uusimpaan, data säilyy
//
// Sopimukset (samat kuin sqliteWorker.runMigrations):
// - valida ketjun ennen yhtäkään kirjoitusta;
// - jokainen vaihe omassa transaktiossaan; virhe → ROLLBACK + heitto,
//   user_version jää ennalleen;
// - historiatauluun kirjataan (version, id, description); jo ajetut ohitetaan;
// - user_version päivitetään vasta onnistuneen vaiheen jälkeen.
// Ei selainta: node-build + :memory: (selain-OPFS E2E:ssä, T060/T061).
import {
  CURRENT_SCHEMA_VERSION,
  MIGRATIONS,
  pendingMigrations,
  validateMigrationChain,
} from "../src/index.ts";

export type Db = {
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
};

export type Row = Record<string, unknown>;

async function initSqlite(): Promise<{
  oo1: { DB: new (filename: string, flags: string) => Db };
}> {
  const initModule = await import("@sqlite.org/sqlite-wasm");
  return (await initModule.default()) as unknown as {
    oo1: { DB: new (filename: string, flags: string) => Db };
  };
}

/** Avaa tuoreen :memory:-kannan (ei skeemaa). */
export async function openFresh(): Promise<Db> {
  const sqlite3 = await initSqlite();
  return new sqlite3.oo1.DB(":memory:", "ct");
}

/**
 * Ajaa migraatiot [fromVersion, targetVersion] välillä samoilla säännöillä
 * kuin workerin runMigrations. Heittää ensimmäisessä virheessä (kanta
 * jää vaiheen alkutilaan ROLLBACKin kautta).
 */
export function applyMigrations(
  db: Db,
  fromVersion: number,
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): void {
  const chainCheck = validateMigrationChain(MIGRATIONS);
  if (!chainCheck.ok) {
    throw new Error(`migration-chain-invalid:${chainCheck.issue.kind}`);
  }
  if (targetVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`migration-target-too-new:${String(targetVersion)}`);
  }
  const pending = pendingMigrations(MIGRATIONS, fromVersion).filter(
    (step) => step.version <= targetVersion,
  );
  for (const step of pending) {
    db.exec("BEGIN;");
    try {
      for (const statement of step.statements) {
        db.exec(statement);
      }
      db.exec("INSERT INTO _lifeos_migrations (version, id, description) VALUES (?, ?, ?);", {
        bind: [step.version, step.id, step.description],
      });
      db.exec(`PRAGMA user_version=${String(step.version)};`);
      db.exec("COMMIT;");
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        // Rollback best-effort; alkuperäinen virhe ratkaisee.
      }
      throw error;
    }
  }
}

/** Avaa tyhjän kannan ja migroituu kohdeversioon (oletus: uusin). */
export async function createMigratedDatabase(
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): Promise<Db> {
  const db = await openFresh();
  applyMigrations(db, 0, targetVersion);
  return db;
}

function readUserVersion(db: Db): number {
  const rows: Row[] = [];
  db.exec("PRAGMA user_version;", { rowMode: "object", resultRows: rows });
  const value = rows[0]?.user_version;
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

export function readAppliedVersions(db: Db): number[] {
  const rows: Row[] = [];
  db.exec("SELECT version FROM _lifeos_migrations ORDER BY version;", {
    rowMode: "object",
    resultRows: rows,
  });
  return rows.map((row) => Number(row.version));
}

export function readSchemaVersion(db: Db): number {
  return readUserVersion(db);
}
