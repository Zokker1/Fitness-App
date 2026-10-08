import type { EntityId, HabitRule } from "@lifeos/domain";
import { validateHabitRuleValues } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import {
  ensureSqliteGoalsMigrated,
  getSqliteGoalIds,
  isCorruptedGoalResult,
} from "./sqliteGoalStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "habit-rule";
const LEGACY_BATCH_SIZE = 32;

interface HabitRuleRow {
  readonly id?: unknown;
  readonly goal_id?: unknown;
  readonly title?: unknown;
  readonly cadence?: unknown;
  readonly target_per_period?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedHabitRule(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tavan sääntöä ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.habit-rule.invalid",
    },
  };
}

export function validHabitRule(rule: HabitRule): boolean {
  const deletedAt: unknown = (rule as unknown as { readonly deletedAt: unknown }).deletedAt;
  if (
    typeof rule.id !== "string" ||
    rule.id.length === 0 ||
    (rule.goalId !== null && (typeof rule.goalId !== "string" || rule.goalId.length === 0)) ||
    typeof rule.title !== "string" ||
    typeof rule.cadence !== "string" ||
    typeof rule.targetPerPeriod !== "number" ||
    typeof rule.createdAt !== "string" ||
    rule.createdAt.length === 0 ||
    typeof rule.updatedAt !== "string" ||
    rule.updatedAt.length === 0 ||
    !Number.isInteger(rule.version) ||
    rule.version < 1 ||
    (typeof deletedAt !== "string" && deletedAt !== null)
  ) {
    return false;
  }
  return validateHabitRuleValues(rule).ok;
}

function parseHabitRule(row: unknown): HabitRule | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) return null;
  const value = row as HabitRuleRow;
  if (
    typeof value.id !== "string" ||
    (value.goal_id !== null && typeof value.goal_id !== "string") ||
    typeof value.title !== "string" ||
    typeof value.cadence !== "string" ||
    typeof value.target_per_period !== "number" ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string" ||
    typeof value.version !== "number" ||
    (typeof value.deleted_at !== "string" && value.deleted_at !== null)
  ) {
    return null;
  }
  const rule: HabitRule = {
    id: value.id,
    goalId: value.goal_id,
    title: value.title,
    cadence: value.cadence as HabitRule["cadence"],
    targetPerPeriod: value.target_per_period,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    version: value.version,
    deletedAt: value.deleted_at,
  };
  return validHabitRule(rule) ? rule : null;
}

function parseHabitRules(rows: readonly unknown[]): DataResult<readonly HabitRule[]> {
  const rules: HabitRule[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    const rule = parseHabitRule(row);
    if (rule === null || ids.has(rule.id)) return corruptedHabitRule();
    ids.add(rule.id);
    rules.push(rule);
  }
  return { ok: true, value: rules };
}

export function putHabitRuleOp(rule: HabitRule): DbTransactionOp {
  return {
    op: "putHabitRule",
    params: {
      id: rule.id,
      goal_id: rule.goalId ?? "",
      goal_id_is_null: rule.goalId === null,
      title: rule.title,
      cadence: rule.cadence,
      target_per_period: rule.targetPerPeriod,
      created_at: rule.createdAt,
      updated_at: rule.updatedAt,
      version: rule.version,
      deleted_at: rule.deletedAt ?? "",
      deleted_at_is_null: rule.deletedAt === null,
    },
  };
}

async function readHabitRules(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly HabitRule[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseHabitRules(response.rows);
}

async function migrateLegacyHabitRules(): Promise<DataResult<true>> {
  const goalsMigrated = await ensureSqliteGoalsMigrated();
  if (!goalsMigrated.ok) return goalsMigrated;
  const goalsResponse = await sendDbRequest({ kind: "query", op: "listGoals", params: {} });
  if (!goalsResponse.ok) return toDataResult(goalsResponse, () => true as const);
  const goalIds = getSqliteGoalIds(goalsResponse.rows);
  if (!goalIds.ok) return isCorruptedGoalResult();

  const legacyResult = await createSqliteEntityDocStore<HabitRule>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const rules = legacyResult.value;
  const legacyIds = new Set<string>();
  for (const rule of rules) {
    if (
      !validHabitRule(rule) ||
      legacyIds.has(rule.id) ||
      (rule.goalId !== null && !goalIds.value.has(rule.goalId))
    ) {
      return corruptedHabitRule();
    }
    legacyIds.add(rule.id);
  }

  const currentResult = await readHabitRules({ kind: "query", op: "listHabitRules", params: {} });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((rule) => rule.id));
  if (rules.some((rule) => currentIds.has(rule.id))) return corruptedHabitRule();

  for (let offset = 0; offset < rules.length; offset += LEGACY_BATCH_SIZE) {
    const batch = rules.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const rule of batch) {
      ops.push(putHabitRuleOp(rule));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: rule.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteHabitRuleStore(): EntityStore<HabitRule> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyHabitRules();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<HabitRule> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly HabitRule[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readHabitRules({ kind: "query", op: "listHabitRules", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<HabitRule>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readHabitRules({ kind: "query", op: "getHabitRule", params: { id } });
      if (!result.ok) return result;
      const rule = result.value[0];
      return rule === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: rule };
    },
    async save(value: HabitRule): Promise<DataResult<HabitRule>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validHabitRule(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.habit-rule.invalid",
            "Tavan säännön tietoja ei voi tallentaa näillä arvoilla.",
          ),
        };
      }
      const response = await sendDbRequest({ kind: "exec", ...putHabitRuleOp(value) });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async saveWithSyncOperation(
      value: HabitRule,
      context: SyncWriteContext,
    ): Promise<DataResult<HabitRule>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validHabitRule(value)) {
        return {
          ok: false,
          error: invalidInput(
            "data.habit-rule.invalid",
            "Tavan säännön tietoja ei voi tallentaa näillä arvoilla.",
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
        writes: [putHabitRuleOp(value)],
      });
      return committed.ok ? { ok: true, value } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const now = new Date().toISOString();
      const saved = await store.save({ ...existing.value, deletedAt: now, updatedAt: now });
      return saved.ok ? { ok: true, value: true } : saved;
    },
  };
  return store;
}
