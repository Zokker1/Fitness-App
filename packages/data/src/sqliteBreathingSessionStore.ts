import type { BreathingSession, EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "breathing-session";
const LEGACY_BATCH_SIZE = 32;

interface BreathingSessionRow {
  readonly id?: unknown;
  readonly started_at?: unknown;
  readonly ended_at?: unknown;
  readonly pattern_key?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedBreathingSession(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua hengitysharjoitusta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.breathing-session.invalid",
    },
  };
}

function normalizeBreathingSession(session: BreathingSession): BreathingSession {
  return { ...session, endedAt: session.endedAt ?? null };
}

export function validBreathingSession(session: BreathingSession): boolean {
  return (
    typeof session.id === "string" &&
    session.id.length > 0 &&
    typeof session.startedAt === "string" &&
    (session.endedAt === null ||
      (typeof session.endedAt === "string" && session.endedAt >= session.startedAt)) &&
    typeof session.patternKey === "string" &&
    session.patternKey.trim().length > 0 &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    Number.isInteger(session.version) &&
    session.version >= 1
  );
}

export function putBreathingSessionOp(session: BreathingSession): DbTransactionOp {
  return {
    op: "putBreathingSession",
    params: {
      id: session.id,
      started_at: session.startedAt,
      ended_at: session.endedAt ?? "",
      pattern_key: session.patternKey,
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      version: session.version,
    },
  };
}

async function migrateLegacyBreathingSessions(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<BreathingSession>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const sessions = legacyResult.value.map(normalizeBreathingSession);
  if (sessions.some((session) => !validBreathingSession(session))) {
    return corruptedBreathingSession();
  }

  for (let offset = 0; offset < sessions.length; offset += LEGACY_BATCH_SIZE) {
    const batch = sessions.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const session of batch) {
      ops.push(putBreathingSessionOp(session));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: session.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseBreathingSessions(rows: readonly unknown[]): DataResult<readonly BreathingSession[]> {
  const sessions: BreathingSession[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedBreathingSession();
    }
    const row = value as BreathingSessionRow;
    if (
      typeof row.id !== "string" ||
      typeof row.started_at !== "string" ||
      (row.ended_at !== null && typeof row.ended_at !== "string") ||
      typeof row.pattern_key !== "string" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedBreathingSession();
    }
    const session: BreathingSession = {
      id: row.id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      patternKey: row.pattern_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validBreathingSession(session)) {
      return corruptedBreathingSession();
    }
    sessions.push(session);
  }
  return { ok: true, value: sessions };
}

export function createSqliteBreathingSessionStore(): EntityStore<BreathingSession> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyBreathingSessions();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<BreathingSession> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly BreathingSession[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "listBreathingSessions",
        params: {},
      });
      if (!response.ok) return toDataResult(response, () => []);
      return parseBreathingSessions(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<BreathingSession>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getBreathingSession",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as BreathingSession);
      const parsed = parseBreathingSessions(response.rows);
      if (!parsed.ok) return parsed;
      const session = parsed.value[0];
      return session === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: session };
    },
    async save(session: BreathingSession): Promise<DataResult<BreathingSession>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeBreathingSession(session);
      if (!validBreathingSession(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.breathing-session.invalid",
            "Hengitysharjoituksen ajat, mallin avain ja metatiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putBreathingSessionOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      session: BreathingSession,
      context: SyncWriteContext,
    ): Promise<DataResult<BreathingSession>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeBreathingSession(session);
      if (!validBreathingSession(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.breathing-session.invalid",
            "Hengitysharjoituksen ajat, mallin avain ja metatiedot eivät kelpaa.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: normalized.id,
        operation: context.operation,
        entityVersion: normalized.version,
        occurredAt: context.occurredAt,
        createdAt: normalized.createdAt,
        entity: normalized as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putBreathingSessionOp(normalized)],
      });
      return committed.ok ? { ok: true, value: normalized } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteBreathingSession",
        params: { id },
      });
      return toDataResult(response, () => true);
    },
  };
  return store;
}
