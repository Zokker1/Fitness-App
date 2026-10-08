import type { EntityId, TaskChecklistItem } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteTaskStore } from "./sqliteTaskStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";

const ENTITY_TYPE = "task-checklist-item";
const LEGACY_BATCH_SIZE = 32;

interface TaskChecklistItemRow {
  readonly id?: unknown;
  readonly task_id?: unknown;
  readonly title?: unknown;
  readonly done?: unknown;
  readonly sort_order?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedChecklistItem(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tehtävän muistilistan kohtaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.task-checklist-item.invalid",
    },
  };
}

export function validChecklistItem(item: TaskChecklistItem): boolean {
  return (
    typeof item.id === "string" &&
    item.id.length > 0 &&
    typeof item.taskId === "string" &&
    item.taskId.length > 0 &&
    typeof item.title === "string" &&
    item.title.trim().length > 0 &&
    item.title.length <= 200 &&
    typeof item.done === "boolean" &&
    Number.isInteger(item.sortOrder) &&
    item.sortOrder >= 0 &&
    typeof item.createdAt === "string" &&
    item.createdAt.length > 0 &&
    typeof item.updatedAt === "string" &&
    item.updatedAt.length > 0 &&
    Number.isInteger(item.version) &&
    item.version >= 1 &&
    (item.deletedAt === null || (typeof item.deletedAt === "string" && item.deletedAt.length > 0))
  );
}

function normalizeLegacyItem(value: TaskChecklistItem): TaskChecklistItem {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    deletedAt:
      raw.deletedAt === undefined ? null : (raw.deletedAt as TaskChecklistItem["deletedAt"]),
  };
}

export function putChecklistItemOp(item: TaskChecklistItem): DbTransactionOp {
  return {
    op: "putTaskChecklistItem",
    params: {
      id: item.id,
      task_id: item.taskId,
      title: item.title,
      done: item.done ? 1 : 0,
      sort_order: item.sortOrder,
      created_at: item.createdAt,
      updated_at: item.updatedAt,
      version: item.version,
      deleted_at: item.deletedAt ?? "",
      deleted_at_is_null: item.deletedAt === null,
    },
  };
}

function parseChecklistItems(rows: readonly unknown[]): DataResult<readonly TaskChecklistItem[]> {
  const items: TaskChecklistItem[] = [];
  const ids = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedChecklistItem();
    }
    const row = value as TaskChecklistItemRow;
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      typeof row.task_id !== "string" ||
      (row.done !== 0 && row.done !== 1) ||
      typeof row.sort_order !== "number" ||
      typeof row.version !== "number"
    ) {
      return corruptedChecklistItem();
    }
    const item: TaskChecklistItem = {
      id: row.id,
      taskId: row.task_id,
      title: row.title as string,
      done: row.done === 1,
      sortOrder: row.sort_order,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      version: row.version,
      deletedAt: row.deleted_at as TaskChecklistItem["deletedAt"],
    };
    if (!validChecklistItem(item)) return corruptedChecklistItem();
    ids.add(item.id);
    items.push(item);
  }
  return { ok: true, value: items };
}

async function readChecklistItems(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly TaskChecklistItem[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseChecklistItems(response.rows);
}

async function migrateLegacyChecklistItems(): Promise<DataResult<true>> {
  const tasksResult = await createSqliteTaskStore().list();
  if (!tasksResult.ok) return tasksResult;
  const taskIds = new Set(tasksResult.value.map((task) => task.id));

  const legacyResult = await createSqliteEntityDocStore<TaskChecklistItem>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const items = legacyResult.value.map(normalizeLegacyItem);
  const legacyIds = new Set<string>();
  for (const item of items) {
    if (!validChecklistItem(item) || legacyIds.has(item.id) || !taskIds.has(item.taskId)) {
      return corruptedChecklistItem();
    }
    legacyIds.add(item.id);
  }

  const currentResult = await readChecklistItems({
    kind: "query",
    op: "listTaskChecklistItems",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((item) => item.id));
  if (items.some((item) => currentIds.has(item.id))) return corruptedChecklistItem();

  for (let offset = 0; offset < items.length; offset += LEGACY_BATCH_SIZE) {
    const batch = items.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const item of batch) {
      ops.push(putChecklistItemOp(item));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: item.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteTaskChecklistItemStore(): EntityStore<TaskChecklistItem> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyChecklistItems();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<TaskChecklistItem> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly TaskChecklistItem[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readChecklistItems({ kind: "query", op: "listTaskChecklistItems", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<TaskChecklistItem>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readChecklistItems({
        kind: "query",
        op: "getTaskChecklistItem",
        params: { id },
      });
      if (!result.ok) return result;
      const item = result.value[0];
      return item === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: item };
    },
    async save(value: TaskChecklistItem): Promise<DataResult<TaskChecklistItem>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const item = normalizeLegacyItem(value);
      if (!validChecklistItem(item)) {
        return {
          ok: false,
          error: invalidInput(
            "data.task-checklist-item.invalid",
            "Tehtävän muistilistan kohdan tiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putChecklistItemOp(item)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: item } : result;
    },
    async saveWithSyncOperation(
      value: TaskChecklistItem,
      context: SyncWriteContext,
    ): Promise<DataResult<TaskChecklistItem>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const item = normalizeLegacyItem(value);
      if (!validChecklistItem(item)) {
        return {
          ok: false,
          error: invalidInput(
            "data.task-checklist-item.invalid",
            "Tehtävän muistilistan kohdan tiedot eivät kelpaa.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: item.id,
        operation: context.operation,
        entityVersion: item.version,
        occurredAt: context.occurredAt,
        createdAt: item.createdAt,
        entity: item as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putChecklistItemOp(item)],
      });
      return committed.ok ? { ok: true, value: item } : committed;
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
