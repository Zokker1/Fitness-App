import type { Distraction, EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteFocusSessionStore } from "./sqliteFocusSessionStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "distraction";
const LEGACY_BATCH_SIZE = 32;

interface DistractionRow {
  readonly id?: unknown;
  readonly focus_session_id?: unknown;
  readonly noted_at?: unknown;
  readonly note?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedDistraction(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua fokusistunnon huomiota ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.distraction.invalid",
    },
  };
}

export function validDistraction(distraction: Distraction): boolean {
  return (
    typeof distraction.id === "string" &&
    distraction.id.length > 0 &&
    typeof distraction.focusSessionId === "string" &&
    distraction.focusSessionId.length > 0 &&
    typeof distraction.notedAt === "string" &&
    distraction.notedAt.length > 0 &&
    (distraction.note === null || typeof distraction.note === "string") &&
    typeof distraction.createdAt === "string" &&
    distraction.createdAt.length > 0 &&
    typeof distraction.updatedAt === "string" &&
    distraction.updatedAt.length > 0 &&
    Number.isInteger(distraction.version) &&
    distraction.version >= 1
  );
}

export function putDistractionOp(distraction: Distraction): DbTransactionOp {
  return {
    op: "putDistraction",
    params: {
      id: distraction.id,
      focus_session_id: distraction.focusSessionId,
      noted_at: distraction.notedAt,
      note: distraction.note ?? "",
      note_is_null: distraction.note === null,
      created_at: distraction.createdAt,
      updated_at: distraction.updatedAt,
      version: distraction.version,
    },
  };
}

function parseDistractions(rows: readonly unknown[]): DataResult<readonly Distraction[]> {
  const distractions: Distraction[] = [];
  const ids = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedDistraction();
    }
    const row = value as DistractionRow;
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      typeof row.focus_session_id !== "string" ||
      row.focus_session_id.length === 0 ||
      typeof row.noted_at !== "string" ||
      row.noted_at.length === 0 ||
      (row.note !== null && typeof row.note !== "string") ||
      typeof row.created_at !== "string" ||
      row.created_at.length === 0 ||
      typeof row.updated_at !== "string" ||
      row.updated_at.length === 0 ||
      typeof row.version !== "number" ||
      !Number.isInteger(row.version) ||
      row.version < 1
    ) {
      return corruptedDistraction();
    }
    ids.add(row.id);
    distractions.push({
      id: row.id,
      focusSessionId: row.focus_session_id,
      notedAt: row.noted_at,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    });
  }
  return { ok: true, value: distractions };
}

async function readDistractions(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly Distraction[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseDistractions(response.rows);
}

async function migrateLegacyDistractions(): Promise<DataResult<true>> {
  const sessionsResult = await createSqliteFocusSessionStore().list();
  if (!sessionsResult.ok) return sessionsResult;
  const sessionIds = new Set(sessionsResult.value.map((session) => session.id));

  const legacyResult = await createSqliteEntityDocStore<Distraction>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const distractions = legacyResult.value;
  const legacyIds = new Set<string>();
  for (const distraction of distractions) {
    if (
      !validDistraction(distraction) ||
      legacyIds.has(distraction.id) ||
      !sessionIds.has(distraction.focusSessionId)
    ) {
      return corruptedDistraction();
    }
    legacyIds.add(distraction.id);
  }

  const currentResult = await readDistractions({
    kind: "query",
    op: "listDistractions",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((distraction) => distraction.id));
  if (distractions.some((distraction) => currentIds.has(distraction.id))) {
    return corruptedDistraction();
  }

  for (let offset = 0; offset < distractions.length; offset += LEGACY_BATCH_SIZE) {
    const batch = distractions.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const distraction of batch) {
      ops.push(putDistractionOp(distraction));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: distraction.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteDistractionStore(): EntityStore<Distraction> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyDistractions();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Distraction> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Distraction[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readDistractions({ kind: "query", op: "listDistractions", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<Distraction>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readDistractions({
        kind: "query",
        op: "getDistraction",
        params: { id },
      });
      if (!result.ok) return result;
      const distraction = result.value[0];
      return distraction === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: distraction };
    },
    async save(value: Distraction): Promise<DataResult<Distraction>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validDistraction(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.distraction.invalid",
            "Fokusistunnon huomion tiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putDistractionOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async saveWithSyncOperation(
      value: Distraction,
      context: SyncWriteContext,
    ): Promise<DataResult<Distraction>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validDistraction(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.distraction.invalid",
            "Fokusistunnon huomion tiedot eivät kelpaa.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: value.id,
        operation: context.operation,
        entityVersion: value.version,
        occurredAt: context.occurredAt,
        createdAt: value.createdAt,
        entity: value as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putDistractionOp(value)],
      });
      return committed.ok ? { ok: true, value } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteDistraction", params: { id } }],
      });
      return toDataResult(response, () => true as const);
    },
  };
  return store;
}
