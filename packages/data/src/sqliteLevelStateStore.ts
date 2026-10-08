import type { EntityId, LevelState } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "level-state";
const LEGACY_BATCH_SIZE = 32;

interface LevelStateRow {
  readonly id?: unknown;
  readonly total_xp?: unknown;
  readonly level?: unknown;
  readonly computed_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedLevelState(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tasotilaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.level-state.invalid",
    },
  };
}

export function validLevelState(state: LevelState): boolean {
  return (
    typeof state.id === "string" &&
    state.id.length > 0 &&
    Number.isSafeInteger(state.totalXp) &&
    state.totalXp >= 0 &&
    Number.isSafeInteger(state.level) &&
    state.level >= 1 &&
    typeof state.computedAt === "string" &&
    state.computedAt.length > 0 &&
    typeof state.createdAt === "string" &&
    state.createdAt.length > 0 &&
    typeof state.updatedAt === "string" &&
    state.updatedAt.length > 0 &&
    Number.isInteger(state.version) &&
    state.version >= 1
  );
}

export function putLevelStateOp(state: LevelState): DbTransactionOp {
  return {
    op: "putLevelState",
    params: {
      id: state.id,
      total_xp: state.totalXp,
      level: state.level,
      computed_at: state.computedAt,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
      version: state.version,
    },
  };
}

async function migrateLegacyLevelStates(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<LevelState>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const states = legacy.value;
  if (states.some((state) => !validLevelState(state))) return corruptedLevelState();

  for (let offset = 0; offset < states.length; offset += LEGACY_BATCH_SIZE) {
    const batch = states.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const state of batch) {
      ops.push(putLevelStateOp(state));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: state.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function parseLevelStates(rows: readonly unknown[]): DataResult<readonly LevelState[]> {
  const states: LevelState[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedLevelState();
    }
    const row = value as LevelStateRow;
    if (
      typeof row.id !== "string" ||
      typeof row.total_xp !== "number" ||
      typeof row.level !== "number" ||
      typeof row.computed_at !== "string" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedLevelState();
    }
    const state: LevelState = {
      id: row.id,
      totalXp: row.total_xp,
      level: row.level,
      computedAt: row.computed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validLevelState(state)) return corruptedLevelState();
    states.push(state);
  }
  return { ok: true, value: states };
}

export function createSqliteLevelStateStore(): EntityStore<LevelState> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyLevelStates();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<LevelState> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly LevelState[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listLevelStates", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseLevelStates(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<LevelState>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getLevelState", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as LevelState);
      const parsed = parseLevelStates(response.rows);
      if (!parsed.ok) return parsed;
      const state = parsed.value[0];
      return state === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: state };
    },
    async save(value: LevelState): Promise<DataResult<LevelState>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validLevelState(value)) {
        return {
          ok: false,
          error: invalidInput("data.level-state.invalid", "Tasotilan tiedot eivät kelpaa."),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putLevelStateOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteLevelState", params: { id } }],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
