import type { CalendarBlock, CalendarBlockKind, EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteRoutineStore } from "./sqliteRoutineStore.ts";
import { createSqliteTaskStore } from "./sqliteTaskStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "calendar-block";
const LEGACY_BATCH_SIZE = 32;
const VALID_KINDS: readonly CalendarBlockKind[] = ["task", "routine", "focus", "event"];

interface CalendarBlockRow {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly title?: unknown;
  readonly starts_at?: unknown;
  readonly ends_at?: unknown;
  readonly linked_task_id?: unknown;
  readonly linked_routine_id?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedCalendarBlock(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua kalenterimerkintää ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.calendar-block.invalid",
    },
  };
}

export function validCalendarBlock(block: CalendarBlock): boolean {
  const taskLinkValid =
    block.linkedTaskId === null ||
    (typeof block.linkedTaskId === "string" && block.linkedTaskId.length > 0);
  const routineLinkValid =
    block.linkedRoutineId === null ||
    (typeof block.linkedRoutineId === "string" && block.linkedRoutineId.length > 0);
  return (
    typeof block.id === "string" &&
    block.id.length > 0 &&
    VALID_KINDS.includes(block.kind) &&
    typeof block.title === "string" &&
    block.title.trim().length > 0 &&
    block.title.length <= 200 &&
    typeof block.startsAt === "string" &&
    block.startsAt.length > 0 &&
    typeof block.endsAt === "string" &&
    block.endsAt.length > 0 &&
    block.endsAt >= block.startsAt &&
    taskLinkValid &&
    routineLinkValid &&
    !(block.linkedTaskId !== null && block.linkedRoutineId !== null) &&
    (block.linkedTaskId === null || block.kind === "task") &&
    (block.linkedRoutineId === null || block.kind === "routine") &&
    typeof block.createdAt === "string" &&
    block.createdAt.length > 0 &&
    typeof block.updatedAt === "string" &&
    block.updatedAt.length > 0 &&
    Number.isInteger(block.version) &&
    block.version >= 1 &&
    (block.deletedAt === null || typeof block.deletedAt === "string")
  );
}

function normalizeLegacyBlock(value: CalendarBlock): CalendarBlock {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    linkedTaskId:
      raw.linkedTaskId === undefined ? null : (raw.linkedTaskId as CalendarBlock["linkedTaskId"]),
    linkedRoutineId:
      raw.linkedRoutineId === undefined
        ? null
        : (raw.linkedRoutineId as CalendarBlock["linkedRoutineId"]),
    deletedAt: raw.deletedAt === undefined ? null : (raw.deletedAt as CalendarBlock["deletedAt"]),
  };
}

export function putCalendarBlockOp(block: CalendarBlock): DbTransactionOp {
  return {
    op: "putCalendarBlock",
    params: {
      id: block.id,
      kind: block.kind,
      title: block.title,
      starts_at: block.startsAt,
      ends_at: block.endsAt,
      linked_task_id: block.linkedTaskId ?? "",
      linked_task_id_is_null: block.linkedTaskId === null,
      linked_routine_id: block.linkedRoutineId ?? "",
      linked_routine_id_is_null: block.linkedRoutineId === null,
      created_at: block.createdAt,
      updated_at: block.updatedAt,
      version: block.version,
      deleted_at: block.deletedAt ?? "",
      deleted_at_is_null: block.deletedAt === null,
    },
  };
}

function parseCalendarBlocks(rows: readonly unknown[]): DataResult<readonly CalendarBlock[]> {
  const blocks: CalendarBlock[] = [];
  const ids = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedCalendarBlock();
    }
    const row = value as CalendarBlockRow;
    if (
      typeof row.id !== "string" ||
      ids.has(row.id) ||
      (row.linked_task_id !== null && typeof row.linked_task_id !== "string") ||
      (row.linked_routine_id !== null && typeof row.linked_routine_id !== "string")
    ) {
      return corruptedCalendarBlock();
    }
    const block: CalendarBlock = {
      id: row.id,
      kind: row.kind as CalendarBlockKind,
      title: row.title as string,
      startsAt: row.starts_at as string,
      endsAt: row.ends_at as string,
      linkedTaskId: row.linked_task_id,
      linkedRoutineId: row.linked_routine_id,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      version: row.version as number,
      deletedAt: row.deleted_at as CalendarBlock["deletedAt"],
    };
    if (!validCalendarBlock(block)) return corruptedCalendarBlock();
    ids.add(block.id);
    blocks.push(block);
  }
  return { ok: true, value: blocks };
}

async function readCalendarBlocks(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly CalendarBlock[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  return parseCalendarBlocks(response.rows);
}

async function migrateLegacyCalendarBlocks(): Promise<DataResult<true>> {
  const [tasksResult, routinesResult] = await Promise.all([
    createSqliteTaskStore().list(),
    createSqliteRoutineStore().list(),
  ]);
  if (!tasksResult.ok) return tasksResult;
  if (!routinesResult.ok) return routinesResult;
  const taskIds = new Set(tasksResult.value.map((task) => task.id));
  const routineIds = new Set(routinesResult.value.map((routine) => routine.id));

  const legacyResult = await createSqliteEntityDocStore<CalendarBlock>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const blocks = legacyResult.value.map(normalizeLegacyBlock);
  const legacyIds = new Set<string>();
  for (const block of blocks) {
    if (
      !validCalendarBlock(block) ||
      legacyIds.has(block.id) ||
      (block.linkedTaskId !== null && !taskIds.has(block.linkedTaskId)) ||
      (block.linkedRoutineId !== null && !routineIds.has(block.linkedRoutineId))
    ) {
      return corruptedCalendarBlock();
    }
    legacyIds.add(block.id);
  }

  const currentResult = await readCalendarBlocks({
    kind: "query",
    op: "listCalendarBlocks",
    params: {},
  });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((block) => block.id));
  if (blocks.some((block) => currentIds.has(block.id))) return corruptedCalendarBlock();

  for (let offset = 0; offset < blocks.length; offset += LEGACY_BATCH_SIZE) {
    const batch = blocks.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const block of batch) {
      ops.push(putCalendarBlockOp(block));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: block.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteCalendarBlockStore(): EntityStore<CalendarBlock> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyCalendarBlocks();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<CalendarBlock> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly CalendarBlock[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok
        ? readCalendarBlocks({ kind: "query", op: "listCalendarBlocks", params: {} })
        : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<CalendarBlock>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readCalendarBlocks({
        kind: "query",
        op: "getCalendarBlock",
        params: { id },
      });
      if (!result.ok) return result;
      const block = result.value[0];
      return block === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: block };
    },
    async save(value: CalendarBlock): Promise<DataResult<CalendarBlock>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const block = normalizeLegacyBlock(value);
      if (!validCalendarBlock(block)) {
        return {
          ok: false,
          error: invalidInput(
            "data.calendar-block.invalid",
            "Kalenterimerkinnän tiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putCalendarBlockOp(block)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: block } : result;
    },
    async saveWithSyncOperation(
      value: CalendarBlock,
      context: SyncWriteContext,
    ): Promise<DataResult<CalendarBlock>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const block = normalizeLegacyBlock(value);
      if (!validCalendarBlock(block)) {
        return {
          ok: false,
          error: invalidInput(
            "data.calendar-block.invalid",
            "Kalenterimerkinnän tiedot eivät kelpaa.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: block.id,
        operation: context.operation,
        entityVersion: block.version,
        occurredAt: context.occurredAt,
        createdAt: block.createdAt,
        entity: block as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putCalendarBlockOp(block)],
      });
      return committed.ok ? { ok: true, value: block } : committed;
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
