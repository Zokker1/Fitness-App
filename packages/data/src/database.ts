// T030: database-factory. Kokoaa open/health/probeWrite-polun yhteen
// paikkaan jota T031 (migraatiot) ja T032 (repositoryt) kuluttavat.
// T031: openDatabase ajaa open→migrate(CURRENT_SCHEMA_VERSION)→integrity.
// - openDatabase(): ping -> open (yhteys+pragma) -> migrate (idempotentti
//   ketju) -> integrity_check. Palauttaa healthin: backend
//   (opfs/opfs-sahpool|memory) + persisted-lipun rehellisesti + schemaVersion.
// - Capability failure (ei Workeria, OPFS lukossa, quota) -> DataResult-
//   virhe, ei poikkeusta. Kutsuja (T036 diagnostiikka) näyttää tilan.
// - T030:ssa ei vielä monen operaation transaktioita: T032 tuo UnitOfWorkin
//   workerin omistamalla SQL:llä (ei clientin vapaita BEGIN/COMMIT-viestejä).

import { type DataResult } from "./errors.ts";
import { CURRENT_SCHEMA_VERSION } from "./migrations.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import type { DatabaseHealth } from "./sqliteClient.ts";
export type { DatabaseHealth } from "./sqliteClient.ts";
export { configureDatabaseWorker, resetDatabaseWorkerForTests } from "./sqliteClient.ts";

function rowsToRecord(rows: readonly unknown[]): Record<string, unknown> {
  const first = rows[0];
  return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : {};
}

/** integrity_check palauttaa yhden rivin sarakkeessa; lue se ilman Object-toString. */
function readIntegrityText(rows: readonly unknown[]): string {
  const record = rowsToRecord(rows);
  const value = record.value;
  if (typeof value === "string") {
    return value;
  }
  const check = record.integrity_check;
  if (typeof check === "string") {
    return check;
  }
  return "ok";
}

export interface MigrationResult {
  readonly schemaVersion: number;
  /** true jos ajoi vähintään yhden migraation (false = jo ajan tasalla). */
  readonly migrated: boolean;
}

export async function migrateDatabase(
  targetVersion: number = CURRENT_SCHEMA_VERSION,
): Promise<DataResult<MigrationResult>> {
  if (!Number.isInteger(targetVersion) || targetVersion < 1) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        userMessage: "Migraation kohdeversio on virheellinen.",
        diagnosticCode: "data.migrate.bad-target",
      },
    };
  }
  const before = await sendDbRequest({ kind: "query", op: "getSchemaVersion", params: {} });
  if (!before.ok) {
    return toDataResult<MigrationResult>(before, () => ({ schemaVersion: 0, migrated: false }));
  }
  const beforeVersion = Number(rowsToRecord(before.rows).version ?? 0);
  const response = await sendDbRequest({ kind: "migrate", targetVersion });
  return toDataResult<MigrationResult>(response, (rows) => {
    const rowVersion = Number(rowsToRecord(rows).version ?? Number.NaN);
    const version =
      Number.isInteger(rowVersion) && rowVersion >= 0
        ? rowVersion
        : response.ok
          ? (response.schemaVersion ?? beforeVersion)
          : beforeVersion;
    return { schemaVersion: version, migrated: version !== beforeVersion };
  });
}

export async function getSchemaVersion(): Promise<DataResult<number>> {
  const response = await sendDbRequest({ kind: "query", op: "getSchemaVersion", params: {} });
  return toDataResult<number>(response, (rows) => Number(rowsToRecord(rows).version ?? 0));
}

export async function openDatabase(): Promise<DataResult<DatabaseHealth>> {
  const ping = await sendDbRequest({ kind: "ping" });
  if (!ping.ok) {
    return toDataResult<DatabaseHealth>(ping, () => ({
      backend: "memory",
      persisted: false,
      open: false,
      integrity: "unknown",
      schemaVersion: 0,
    }));
  }
  const open = await sendDbRequest({ kind: "open" });
  if (!open.ok) {
    return toDataResult<DatabaseHealth>(open, () => ({
      backend: "memory",
      persisted: false,
      open: false,
      integrity: "unknown",
      schemaVersion: 0,
    }));
  }
  const migrated = await migrateDatabase(CURRENT_SCHEMA_VERSION);
  if (!migrated.ok) {
    return {
      ok: false,
      error: {
        ...migrated.error,
        diagnosticCode: `data.open.migrate.${migrated.error.diagnosticCode}`,
      },
    };
  }
  const integrity = await sendDbRequest({ kind: "query", op: "integrityCheck", params: {} });
  const integrityText = integrity.ok ? readIntegrityText(integrity.rows) : "unknown";
  // T038: open on tässä kohtaa aina ok (virhe palasi yllä) — diagnostiikka
  // luetaan suoraan (lintti päättelee ok-tyypin, ei ehtoa).
  const poolCapacity = open.poolCapacity ?? null;
  const poolFileCount = open.poolFileCount ?? null;
  const poolHasDb = open.poolHasDb ?? false;
  return {
    ok: true,
    value: {
      backend: open.backend,
      persisted: open.persisted,
      open: true,
      integrity: integrityText,
      schemaVersion: migrated.value.schemaVersion,
      poolCapacity,
      poolFileCount,
      poolHasDb,
    },
  };
}

export async function probeDatabaseWrite(): Promise<DataResult<boolean>> {
  const response = await sendDbRequest({ kind: "query", op: "probeWrite", params: {} });
  return toDataResult<boolean>(response, () => true);
}

export async function writeMeta(key: string, value: string): Promise<DataResult<boolean>> {
  if (key.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        userMessage: "Avain ei saa olla tyhjä.",
        diagnosticCode: "data.meta.write.empty-key",
      },
    };
  }
  const response = await sendDbRequest({ kind: "exec", op: "putMeta", params: { key, value } });
  return toDataResult<boolean>(response, () => true);
}

export async function readMeta(key: string): Promise<DataResult<string | null>> {
  const response = await sendDbRequest({ kind: "query", op: "getMeta", params: { key } });
  return toDataResult<string | null>(response, (rows) => {
    const value = rowsToRecord(rows).value;
    return typeof value === "string" ? value : null;
  });
}

/** Reports whether local entity content has been encrypted by the worker. */
export async function isLocalContentEncrypted(): Promise<DataResult<boolean>> {
  const marker = await readMeta("local-content-encryption-v1");
  return marker.ok ? { ok: true, value: marker.value === "1" } : marker;
}

/**
 * T038: vapauta poolin SAH-lukot ennen sivun sulkemista. Kutsutaan
 * pagehide-kuuntelijasta (adapters/database.ts): sulkee workerin DB-yhteyden
 * (db.close vapauttaa SAHit) jotta seuraava sivu saa poolin lukon ilman
 * kilpaa. Best-effort: virhe ei kaada sulkemista; avauspuolen retry
 * hoitaa loput. Ei poikkeusta ulos.
 */
export async function closeDatabase(): Promise<void> {
  try {
    await sendDbRequest({ kind: "close" });
  } catch {
    // Sulkeminen ei saa kaataa sivun purkua — avausretry hoitaa loput.
  }
}

/** Send a temporary copy of the unlocked DEK to the isolated SQLite worker. */
export async function unlockLocalContent(key: Uint8Array): Promise<DataResult<boolean>> {
  if (!(key instanceof Uint8Array) || key.byteLength !== 32) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        userMessage: "Paikallisen sisällön avain ei kelpaa.",
        diagnosticCode: "data.local-content-key.bad-key",
      },
    };
  }
  const keyCopy = new Uint8Array(key);
  try {
    const response = await sendDbRequest({ kind: "local-key", action: "unlock", key: keyCopy });
    return toDataResult<boolean>(response, () => true);
  } finally {
    keyCopy.fill(0);
  }
}

/** Lock local protected data and clear the worker's in-memory key copy. */
export async function lockLocalContent(): Promise<void> {
  try {
    await sendDbRequest({ kind: "local-key", action: "lock" });
  } catch {
    // Lock is best-effort on page teardown; key sessions are also zeroized in the caller.
  }
}
