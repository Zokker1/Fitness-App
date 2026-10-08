// T061: BrowserInstallation-palvelu (§39: pysyvä installationId, vain
// turvallinen metadata — ei fingerprintingia, ei laitetietoja).
// - ensureInstallation(deps, appVersion): get-or-create; luo puuttuessa
//   rivin satunnaisella installationId:llä (uuid, data-kerros tuottaa) ja
//   oletusnimellä; olemassa olevalla päivittää lastSeenAppVersionin jos se
//   muuttui (version + 1, passiivinen metadatamerkintä).
// - markInstallationSynced(deps, at): lastSyncAt-päivitys (B15 kutsuu).
// - revokeInstallationService(deps): revokaatio eksplisiittisenä tilana;
//   domain-sääntö estää toisen revokaation.
// Rivimapping: NULL <-> tyhjä merkkijono protokollassa; rikki data ->
// hallittu invalid-input. Ei raakaa SQL:ää (worker omistaa lauseet).

import {
  type UtcTimestamp,
  assertInstallationActive,
  revokeInstallation,
  type BrowserInstallation,
} from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput, notFound } from "./errors.ts";
import { type IdGenerator } from "./ids.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import { listSyncOperations } from "./sync-operations.ts";
import type { DataKeySession } from "./key-material.ts";
import type { SyncCryptoAdapter } from "./sync-crypto.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";

export interface InstallationDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/** Oletusnimi on neutraali ja käyttäjä voi muuttaa sen myöhemmin (T090+). */
export const DEFAULT_INSTALLATION_NAME = "Tämä selain";
export const BROWSER_INSTALLATION_ENTITY_TYPE = "browser-installation";
const INSTALLATION_SYNC_FIELDS = [
  "installationName",
  "lastSeenAppVersion",
  "lastSyncAt",
  "revokedAt",
] as const;

type InstallationRow = {
  readonly id: string;
  readonly installation_id: string;
  readonly installation_name: string;
  readonly last_seen_app_version: string;
  readonly last_sync_at: string | null;
  readonly revoked_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
};

function firstRow(rows: readonly unknown[]): InstallationRow | null {
  const row = rows[0];
  if (typeof row !== "object" || row === null) {
    return null;
  }
  return row as InstallationRow;
}

function rowToInstallation(row: InstallationRow): DataResult<BrowserInstallation> {
  // Turvallisen metadatan tarkistus: kenttien tyyppien on täsmättävä
  // domain-mallia; rikki rivi on korjattavissa ensure-uudelleenluennalla.
  const lastSyncOk = row.last_sync_at === null || typeof row.last_sync_at === "string";
  const revokedOk = row.revoked_at === null || typeof row.revoked_at === "string";
  const idOk = typeof row.id === "string" && row.id.length > 0;
  const installationIdOk =
    typeof row.installation_id === "string" && row.installation_id.length > 0;
  if (
    !idOk ||
    !installationIdOk ||
    typeof row.installation_name !== "string" ||
    typeof row.last_seen_app_version !== "string" ||
    !lastSyncOk ||
    !revokedOk ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    !Number.isInteger(row.version) ||
    row.version < 1
  ) {
    return {
      ok: false,
      error: invalidInput("data.installation.corrupt", "Tallennettua asennustietoa ei voi lukea."),
    };
  }
  return {
    ok: true,
    value: {
      id: row.id,
      installationId: row.installation_id,
      installationName: row.installation_name,
      lastSeenAppVersion: row.last_seen_app_version,
      lastSyncAt: row.last_sync_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    },
  };
}

function installationToParams(
  entity: BrowserInstallation,
  isLocal: boolean,
): Record<string, string | number | boolean> {
  return {
    id: entity.id,
    installation_id: entity.installationId,
    installation_name: entity.installationName,
    last_seen_app_version: entity.lastSeenAppVersion,
    // NULL-olielot kulkevat tyhjänä merkkijonona; worker bindei NULL:ksi.
    last_sync_at: entity.lastSyncAt ?? "",
    revoked_at: entity.revokedAt ?? "",
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    version: entity.version,
    is_local: isLocal,
  };
}

async function readInstallationRow(): Promise<DataResult<InstallationRow | null>> {
  const response = await sendDbRequest({ kind: "query", op: "getActiveInstallation", params: {} });
  return toDataResult<InstallationRow | null>(response, (rows) => firstRow(rows));
}

async function saveInstallation(
  entity: BrowserInstallation,
  isLocal = true,
): Promise<DataResult<BrowserInstallation>> {
  const response = await sendDbRequest({
    kind: "exec",
    op: "putInstallation",
    params: installationToParams(entity, isLocal),
  });
  return toDataResult<BrowserInstallation>(response, () => entity);
}

function putInstallationOp(entity: BrowserInstallation, isLocal: boolean): DbTransactionOp {
  return { op: "putInstallation", params: installationToParams(entity, isLocal) };
}

function toInstallationSyncEntity(installation: BrowserInstallation): SyncPayloadEntity {
  return { ...installation, id: installation.installationId };
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function parseInstallationSyncEntity(
  installationId: string,
  value: SyncPayloadEntity,
): BrowserInstallation | null {
  if (
    value.id !== installationId ||
    value.installationId !== installationId ||
    typeof value.installationName !== "string" ||
    value.installationName.trim().length === 0 ||
    value.installationName.length > 60 ||
    typeof value.lastSeenAppVersion !== "string" ||
    value.lastSeenAppVersion.length > 80 ||
    (value.lastSyncAt !== null && !isTimestamp(value.lastSyncAt)) ||
    (value.revokedAt !== null && !isTimestamp(value.revokedAt)) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    typeof value.version !== "number" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    return null;
  }
  return {
    id: installationId,
    installationId,
    installationName: value.installationName,
    lastSeenAppVersion: value.lastSeenAppVersion,
    lastSyncAt: value.lastSyncAt,
    revokedAt: value.revokedAt,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    version: value.version,
  };
}

/** Reads an installation using its immutable cross-profile identifier. */
export async function readInstallationSyncSnapshot(
  installationId: string,
): Promise<DataResult<SyncPayloadEntity | null>> {
  const listed = await listInstallations();
  if (!listed.ok) return listed;
  const installation = listed.value.find((item) => item.installationId === installationId);
  return {
    ok: true,
    value: installation === undefined ? null : toInstallationSyncEntity(installation),
  };
}

/** Validates and stores a merged encrypted snapshot without creating an outbox echo. */
export async function writeInstallationSyncSnapshot(
  installationId: string,
  entity: SyncPayloadEntity,
): Promise<DataResult<true>> {
  const parsed = parseInstallationSyncEntity(installationId, entity);
  if (parsed === null) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.sync-snapshot-invalid",
        "Selaininstanssin synkronointitiedot eivät kelpaa.",
      ),
    };
  }
  const [localResult, listed] = await Promise.all([readInstallationRow(), listInstallations()]);
  if (!localResult.ok) return localResult;
  if (!listed.ok) return listed;
  const currentLocal = localResult.value === null ? null : rowToInstallation(localResult.value);
  if (currentLocal !== null && !currentLocal.ok) return currentLocal;
  const isLocal = currentLocal !== null && currentLocal.value.installationId === installationId;
  const existing = listed.value.find((item) => item.installationId === installationId);
  if (existing !== undefined && existing.createdAt !== parsed.createdAt) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.sync-created-at-conflict",
        "Selaininstanssin pysyvä tunniste ei täsmää sen alkuperäiseen tietueeseen.",
      ),
    };
  }
  const existingRevokedAt = existing?.revokedAt ?? null;
  if (
    existingRevokedAt !== null &&
    (parsed.revokedAt === null || Date.parse(parsed.revokedAt) > Date.parse(existingRevokedAt))
  ) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.revocation-immutable",
        "Perutun selaininstanssin synkkausoikeutta ei voi palauttaa tällä asennustunnisteella.",
      ),
    };
  }
  let id = existing?.id;
  if (id === undefined) {
    id = isLocal ? currentLocal.value.id : `remote-installation:${installationId}`;
  }
  const next: BrowserInstallation = { ...parsed, id };
  const saved = await saveInstallation(next, isLocal);
  return saved.ok ? { ok: true, value: true } : saved;
}

export interface RenameInstallationInput {
  readonly deps: InstallationDeps;
  readonly installationId: string;
  readonly name: string;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
}

/** Atomically updates the local name and appends its encrypted sync event. */
export async function renameInstallation(
  input: RenameInstallationInput,
): Promise<DataResult<BrowserInstallation>> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 60 || !input.keySession.isUnlocked) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.rename-invalid",
        "Anna selaimelle nimi, jossa on 1–60 merkkiä, ja avaa salausavain.",
      ),
    };
  }
  const currentResult = await readInstallationRow();
  if (!currentResult.ok) return currentResult;
  if (currentResult.value === null) {
    return { ok: false, error: notFound("installation") };
  }
  const current = rowToInstallation(currentResult.value);
  if (!current.ok) return current;
  if (current.value.installationId !== input.installationId) {
    return { ok: false, error: notFound("installation") };
  }
  if (current.value.revokedAt !== null) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.revoked",
        "Käytöstä poistetun selaimen nimeä ei voi muuttaa.",
      ),
    };
  }
  if (current.value.installationName === name) return current;

  const operations = await listSyncOperations();
  if (!operations.ok) return operations;
  const hasCreate = operations.value.some(
    (operation) =>
      operation.installationId === input.installationId &&
      operation.entityType === BROWSER_INSTALLATION_ENTITY_TYPE &&
      operation.entityId === input.installationId &&
      operation.operation === "create",
  );
  const now = input.deps.clock.nowIso();
  const next: BrowserInstallation = {
    ...current.value,
    installationName: name,
    updatedAt: now,
    version: current.value.version + 1,
  };
  const operation = await commitSyncableChange({
    operationId: input.deps.ids.next(),
    installationId: input.installationId,
    entityType: BROWSER_INSTALLATION_ENTITY_TYPE,
    entityId: input.installationId,
    operation: hasCreate ? "update" : "create",
    entityVersion: next.version,
    occurredAt: now,
    createdAt: next.createdAt,
    entity: toInstallationSyncEntity(next),
    changedFields: hasCreate
      ? ["installationName"]
      : ["installationId", ...INSTALLATION_SYNC_FIELDS],
    keySession: input.keySession,
    crypto: input.crypto,
    writes: [putInstallationOp(next, true)],
  });
  if (!operation.ok) return operation;
  return { ok: true, value: next };
}

export interface RevokeOtherInstallationInput {
  readonly deps: InstallationDeps;
  readonly actingInstallationId: string;
  readonly targetInstallationId: string;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
}

/** Revokes another known browser through an encrypted, atomic sync event. */
export async function revokeOtherInstallation(
  input: RevokeOtherInstallationInput,
): Promise<DataResult<BrowserInstallation>> {
  if (input.actingInstallationId === input.targetInstallationId || !input.keySession.isUnlocked) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.revoke-invalid",
        "Toisen selaininstanssin peruminen vaatii avoimen salausavaimen.",
      ),
    };
  }
  const [localResult, targetResult] = await Promise.all([
    readInstallationRow(),
    readInstallationSyncSnapshot(input.targetInstallationId),
  ]);
  if (!localResult.ok) return localResult;
  if (!targetResult.ok) return targetResult;
  if (localResult.value === null || targetResult.value === null) {
    return { ok: false, error: notFound("installation") };
  }
  const local = rowToInstallation(localResult.value);
  if (!local.ok) return local;
  const currentTarget = parseInstallationSyncEntity(input.targetInstallationId, targetResult.value);
  if (currentTarget === null) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.revoke-target-invalid",
        "Peruttavan selaininstanssin tietoja ei voitu vahvistaa.",
      ),
    };
  }
  if (local.value.installationId !== input.actingInstallationId || local.value.revokedAt !== null) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.revoke-actor-unavailable",
        "Tämä selain ei ole valtuutettu muuttamaan muiden asennusten oikeuksia.",
      ),
    };
  }
  if (currentTarget.revokedAt !== null) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.already-revoked",
        "Selaininstanssin synkkausoikeus on jo peruttu.",
      ),
    };
  }

  const now = input.deps.clock.nowIso();
  const next: BrowserInstallation = {
    ...currentTarget,
    revokedAt: now,
    updatedAt: now,
    version: currentTarget.version + 1,
  };
  const committed = await commitSyncableChange({
    operationId: input.deps.ids.next(),
    installationId: input.actingInstallationId,
    entityType: BROWSER_INSTALLATION_ENTITY_TYPE,
    entityId: input.targetInstallationId,
    operation: "update",
    entityVersion: next.version,
    occurredAt: now,
    createdAt: next.createdAt,
    entity: toInstallationSyncEntity(next),
    changedFields: ["revokedAt"],
    keySession: input.keySession,
    crypto: input.crypto,
    writes: [putInstallationOp(next, false)],
  });
  if (!committed.ok) return committed;
  return { ok: true, value: next };
}

/**
 * Varmistaa asennusrivin: luo puuttuessa (pysyvä satunnainen installationId)
 * ja merkitsee sovellusversion jos se muuttui edellisestä kirjauksesta.
 */
export async function ensureInstallation(
  deps: InstallationDeps,
  appVersion: string,
): Promise<DataResult<BrowserInstallation>> {
  const existing = await readInstallationRow();
  if (!existing.ok) {
    return existing;
  }
  if (existing.value !== null) {
    const current = rowToInstallation(existing.value);
    if (!current.ok) {
      return current;
    }
    if (current.value.lastSeenAppVersion === appVersion) {
      return current;
    }
    // Passiivinen lastSeen-päivitys (revokoitu instanssi saa päivittää
    // lastSeen-tiedon, ei aktiivisia operaatioita — vrt. §39).
    const now = deps.clock.nowIso();
    return saveInstallation({
      ...current.value,
      lastSeenAppVersion: appVersion,
      updatedAt: now,
      version: current.value.version + 1,
    });
  }
  const now = deps.clock.nowIso();
  const entity: BrowserInstallation = {
    id: deps.ids.next(),
    installationId: deps.ids.next(),
    installationName: DEFAULT_INSTALLATION_NAME,
    lastSeenAppVersion: appVersion,
    lastSyncAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  return saveInstallation(entity);
}

/** Lists the browser installation metadata currently stored in this profile. */
export async function listInstallations(): Promise<DataResult<readonly BrowserInstallation[]>> {
  const response = await sendDbRequest({ kind: "query", op: "listInstallations", params: {} });
  if (!response.ok) return toDataResult<readonly BrowserInstallation[]>(response, () => []);
  if (!Array.isArray(response.rows)) {
    return {
      ok: false,
      error: invalidInput(
        "data.installation.list-corrupt",
        "Tallennettuja asennuksia ei voi lukea.",
      ),
    };
  }
  const installations: BrowserInstallation[] = [];
  for (const row of response.rows) {
    if (typeof row !== "object" || row === null) {
      return {
        ok: false,
        error: invalidInput(
          "data.installation.list-corrupt",
          "Tallennettuja asennuksia ei voi lukea.",
        ),
      };
    }
    const parsed = rowToInstallation(row as InstallationRow);
    if (!parsed.ok) {
      return {
        ok: false,
        error: invalidInput(
          "data.installation.list-corrupt",
          "Tallennettuja asennuksia ei voi lukea.",
        ),
      };
    }
    installations.push(parsed.value);
  }
  return { ok: true, value: installations };
}

/** Merkitsee sync-ajankohdan (B15 kutsuu; update-tyylinen versiokasvu). */
export async function markInstallationSynced(
  deps: InstallationDeps,
  at: UtcTimestamp,
): Promise<DataResult<BrowserInstallation>> {
  const existing = await readInstallationRow();
  if (!existing.ok) {
    return existing;
  }
  if (existing.value === null) {
    return {
      ok: false,
      error: invalidInput("data.installation.not-created", "Asennusta ei ole vielä luotu."),
    };
  }
  const current = rowToInstallation(existing.value);
  if (!current.ok) {
    return current;
  }
  const active = assertInstallationActive(current.value);
  if (!active.ok) {
    return {
      ok: false,
      error: invalidInput("data.installation.revoked", active.error.message),
    };
  }
  const next: BrowserInstallation = {
    ...current.value,
    lastSyncAt: at,
    updatedAt: deps.clock.nowIso(),
    version: current.value.version + 1,
  };
  return saveInstallation(next);
}

/** Revokoi asennuksen (eksplisiittinen tila; toinen revokaatio hylätään). */
export async function revokeInstallationService(
  deps: InstallationDeps,
): Promise<DataResult<BrowserInstallation>> {
  const existing = await readInstallationRow();
  if (!existing.ok) {
    return existing;
  }
  if (existing.value === null) {
    return {
      ok: false,
      error: invalidInput("data.installation.not-created", "Asennusta ei ole vielä luotu."),
    };
  }
  const current = rowToInstallation(existing.value);
  if (!current.ok) {
    return current;
  }
  const revoked = revokeInstallation(current.value, deps.clock.nowIso());
  if (!revoked.ok) {
    return {
      ok: false,
      error: invalidInput("data.installation.revoked", revoked.error.message),
    };
  }
  const next: BrowserInstallation = {
    ...revoked.value,
    version: current.value.version + 1,
  };
  return saveInstallation(next);
}
