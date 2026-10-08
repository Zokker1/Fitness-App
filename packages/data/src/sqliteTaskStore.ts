import type { EntityId, Task, TaskRecurrence } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbRequestNoId, DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteProjectStore } from "./sqliteProjectStore.ts";
import { createSqliteTagStore } from "./sqliteTagStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "task";
const LEGACY_BATCH_SIZE = 32;

interface TaskRow {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly notes?: unknown;
  readonly status?: unknown;
  readonly priority?: unknown;
  readonly due_at?: unknown;
  readonly project_id?: unknown;
  readonly completed_at?: unknown;
  readonly reopened_at?: unknown;
  readonly recurrence_json?: unknown;
  readonly estimate_minutes?: unknown;
  readonly actual_seconds?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

interface TaskTagRow {
  readonly task_id?: unknown;
  readonly tag_id?: unknown;
  readonly sort_order?: unknown;
}

function corruptedTask(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tehtävää ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.task.invalid",
    },
  };
}

function validRecurrence(value: unknown): value is TaskRecurrence {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  if (rule.kind === "daily") {
    return Number.isInteger(rule.everyDays) && Number(rule.everyDays) >= 1;
  }
  if (rule.kind === "weekly") {
    return (
      Number.isInteger(rule.everyWeeks) &&
      Number(rule.everyWeeks) >= 1 &&
      Array.isArray(rule.weekdays) &&
      rule.weekdays.length > 0 &&
      rule.weekdays.every((day) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7)
    );
  }
  if (rule.kind === "monthly") {
    return (
      Number.isInteger(rule.everyMonths) &&
      Number(rule.everyMonths) >= 1 &&
      Number.isInteger(rule.dayOfMonth) &&
      Number(rule.dayOfMonth) >= 1 &&
      Number(rule.dayOfMonth) <= 31
    );
  }
  return (
    rule.kind === "custom" &&
    Number.isInteger(rule.every) &&
    Number(rule.every) >= 1 &&
    (rule.unit === "day" || rule.unit === "week" || rule.unit === "month")
  );
}

export function validTask(task: Task): boolean {
  const status: unknown = (task as unknown as Record<string, unknown>).status;
  const priority: unknown = (task as unknown as Record<string, unknown>).priority;
  const recurrence = task.recurrence;
  const estimate = task.estimateMinutes;
  const actualSeconds = task.actualSeconds;
  return (
    typeof task.id === "string" &&
    task.id.length > 0 &&
    typeof task.title === "string" &&
    task.title.trim().length > 0 &&
    task.title.length <= 200 &&
    (task.notes === null || typeof task.notes === "string") &&
    (status === "open" || status === "done") &&
    (priority === "low" || priority === "normal" || priority === "high") &&
    (task.dueAt === null || (typeof task.dueAt === "string" && task.dueAt.length > 0)) &&
    (task.projectId === null ||
      (typeof task.projectId === "string" && task.projectId.length > 0)) &&
    Array.isArray(task.tagIds) &&
    task.tagIds.every((tagId) => typeof tagId === "string" && tagId.length > 0) &&
    new Set(task.tagIds).size === task.tagIds.length &&
    (task.completedAt === null ||
      (typeof task.completedAt === "string" && task.completedAt.length > 0)) &&
    (task.reopenedAt === null ||
      (typeof task.reopenedAt === "string" && task.reopenedAt.length > 0)) &&
    (recurrence === null || recurrence === undefined || validRecurrence(recurrence)) &&
    (estimate === null || estimate === undefined || (Number.isFinite(estimate) && estimate > 0)) &&
    (actualSeconds === undefined || (Number.isFinite(actualSeconds) && actualSeconds >= 0)) &&
    typeof task.createdAt === "string" &&
    task.createdAt.length > 0 &&
    typeof task.updatedAt === "string" &&
    task.updatedAt.length > 0 &&
    Number.isInteger(task.version) &&
    task.version >= 1 &&
    (task.deletedAt === null || (typeof task.deletedAt === "string" && task.deletedAt.length > 0))
  );
}

function normalizeLegacyTask(value: Task): Task {
  const raw = value as unknown as Record<string, unknown>;
  return {
    ...value,
    notes: raw.notes === undefined ? null : (raw.notes as Task["notes"]),
    dueAt: raw.dueAt === undefined ? null : (raw.dueAt as Task["dueAt"]),
    projectId: raw.projectId === undefined ? null : (raw.projectId as Task["projectId"]),
    tagIds: raw.tagIds === undefined ? [] : (raw.tagIds as Task["tagIds"]),
    completedAt: raw.completedAt === undefined ? null : (raw.completedAt as Task["completedAt"]),
    reopenedAt: raw.reopenedAt === undefined ? null : (raw.reopenedAt as Task["reopenedAt"]),
    recurrence:
      raw.recurrence === undefined || raw.recurrence === null
        ? null
        : (raw.recurrence as TaskRecurrence),
    estimateMinutes:
      raw.estimateMinutes === undefined || raw.estimateMinutes === null
        ? null
        : (raw.estimateMinutes as number),
    actualSeconds: raw.actualSeconds === undefined ? 0 : (raw.actualSeconds as number),
    deletedAt: raw.deletedAt === undefined ? null : (raw.deletedAt as Task["deletedAt"]),
  };
}

export function putTaskOp(task: Task): DbTransactionOp {
  const recurrence = task.recurrence ?? null;
  const estimate = task.estimateMinutes ?? null;
  return {
    op: "putTask",
    params: {
      id: task.id,
      title: task.title,
      notes: task.notes ?? "",
      notes_is_null: task.notes === null,
      status: task.status,
      priority: task.priority,
      due_at: task.dueAt ?? "",
      due_at_is_null: task.dueAt === null,
      project_id: task.projectId ?? "",
      project_id_is_null: task.projectId === null,
      completed_at: task.completedAt ?? "",
      completed_at_is_null: task.completedAt === null,
      reopened_at: task.reopenedAt ?? "",
      reopened_at_is_null: task.reopenedAt === null,
      recurrence_json: recurrence === null ? "" : JSON.stringify(recurrence),
      recurrence_is_null: recurrence === null,
      estimate_minutes: estimate ?? 0,
      estimate_minutes_is_null: estimate === null,
      actual_seconds: task.actualSeconds ?? 0,
      tag_ids_json: JSON.stringify(task.tagIds),
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      version: task.version,
      deleted_at: task.deletedAt ?? "",
      deleted_at_is_null: task.deletedAt === null,
    },
  };
}

function parseTaskRows(
  rows: readonly unknown[],
  tagRows: readonly unknown[],
): DataResult<readonly Task[]> {
  const rawTasks: TaskRow[] = [];
  const knownTaskIds = new Set<string>();
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedTask();
    }
    const row = value as TaskRow;
    if (typeof row.id !== "string" || knownTaskIds.has(row.id)) return corruptedTask();
    knownTaskIds.add(row.id);
    rawTasks.push(row);
  }

  const taskTags = new Map<string, { readonly tagId: string; readonly sortOrder: number }[]>();
  const seenLinks = new Set<string>();
  for (const value of tagRows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedTask();
    }
    const row = value as TaskTagRow;
    if (
      typeof row.task_id !== "string" ||
      !knownTaskIds.has(row.task_id) ||
      typeof row.tag_id !== "string" ||
      row.tag_id.length === 0 ||
      typeof row.sort_order !== "number" ||
      !Number.isInteger(row.sort_order) ||
      row.sort_order < 0
    ) {
      return corruptedTask();
    }
    const key = `${row.task_id}\u0000${row.tag_id}`;
    if (seenLinks.has(key)) return corruptedTask();
    seenLinks.add(key);
    const links = taskTags.get(row.task_id) ?? [];
    links.push({ tagId: row.tag_id, sortOrder: row.sort_order });
    taskTags.set(row.task_id, links);
  }

  const tasks: Task[] = [];
  for (const row of rawTasks) {
    if (
      typeof row.title !== "string" ||
      (row.notes !== null && typeof row.notes !== "string") ||
      (row.status !== "open" && row.status !== "done") ||
      (row.priority !== "low" && row.priority !== "normal" && row.priority !== "high") ||
      (row.due_at !== null && typeof row.due_at !== "string") ||
      (row.project_id !== null && typeof row.project_id !== "string") ||
      (row.completed_at !== null && typeof row.completed_at !== "string") ||
      (row.reopened_at !== null && typeof row.reopened_at !== "string") ||
      (row.recurrence_json !== null && typeof row.recurrence_json !== "string") ||
      (row.estimate_minutes !== null && typeof row.estimate_minutes !== "number") ||
      typeof row.actual_seconds !== "number" ||
      !Number.isFinite(row.actual_seconds) ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedTask();
    }
    let recurrence: TaskRecurrence | null = null;
    if (typeof row.recurrence_json === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(row.recurrence_json);
      } catch {
        return corruptedTask();
      }
      if (!validRecurrence(parsed)) return corruptedTask();
      recurrence = parsed;
    }
    const links = taskTags.get(String(row.id)) ?? [];
    links.sort(
      (left, right) => left.sortOrder - right.sortOrder || left.tagId.localeCompare(right.tagId),
    );
    const task: Task = {
      id: row.id as string,
      title: row.title,
      notes: row.notes,
      status: row.status,
      priority: row.priority,
      dueAt: row.due_at,
      projectId: row.project_id,
      tagIds: links.map((link) => link.tagId),
      completedAt: row.completed_at,
      reopenedAt: row.reopened_at,
      recurrence,
      estimateMinutes: row.estimate_minutes,
      actualSeconds: row.actual_seconds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validTask(task)) return corruptedTask();
    tasks.push(task);
  }
  return { ok: true, value: tasks };
}

async function readTasks(
  query: Extract<DbRequestNoId, { readonly kind: "query" }>,
): Promise<DataResult<readonly Task[]>> {
  const response = await sendDbRequest(query);
  if (!response.ok) return toDataResult(response, () => []);
  const taskId = query.op === "getTask" ? query.params.id : undefined;
  const linksResponse = await sendDbRequest({
    kind: "query",
    op: "listTaskTags",
    params: typeof taskId === "string" ? { task_id: taskId } : {},
  });
  if (!linksResponse.ok) return toDataResult(linksResponse, () => []);
  return parseTaskRows(response.rows, linksResponse.rows);
}

async function migrateLegacyTasks(): Promise<DataResult<true>> {
  const [projectsResult, tagsResult] = await Promise.all([
    createSqliteProjectStore().list(),
    createSqliteTagStore().list(),
  ]);
  if (!projectsResult.ok) return projectsResult;
  if (!tagsResult.ok) return tagsResult;
  const projectIds = new Set(projectsResult.value.map((project) => project.id));
  const tagIds = new Set(tagsResult.value.map((tag) => tag.id));

  const legacyResult = await createSqliteEntityDocStore<Task>(ENTITY_TYPE).list();
  if (!legacyResult.ok) return legacyResult;
  const tasks = legacyResult.value.map(normalizeLegacyTask);
  const legacyIds = new Set<string>();
  for (const task of tasks) {
    if (
      !validTask(task) ||
      legacyIds.has(task.id) ||
      (task.projectId !== null && !projectIds.has(task.projectId)) ||
      task.tagIds.some((tagId) => !tagIds.has(tagId))
    ) {
      return corruptedTask();
    }
    legacyIds.add(task.id);
  }

  const currentResult = await readTasks({ kind: "query", op: "listTasks", params: {} });
  if (!currentResult.ok) return currentResult;
  const currentIds = new Set(currentResult.value.map((task) => task.id));
  if (tasks.some((task) => currentIds.has(task.id))) return corruptedTask();

  for (let offset = 0; offset < tasks.length; offset += LEGACY_BATCH_SIZE) {
    const batch = tasks.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const task of batch) {
      ops.push(putTaskOp(task));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: task.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteTaskStore(): EntityStore<Task> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyTasks();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Task> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Task[]>> {
      const migrated = await ensureMigrated();
      return migrated.ok ? readTasks({ kind: "query", op: "listTasks", params: {} }) : migrated;
    },
    async getById(id: EntityId): Promise<DataResult<Task>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const result = await readTasks({ kind: "query", op: "getTask", params: { id } });
      if (!result.ok) return result;
      const task = result.value[0];
      return task === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: task };
    },
    async save(value: Task): Promise<DataResult<Task>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const task = normalizeLegacyTask(value);
      if (!validTask(task)) {
        return {
          ok: false,
          error: invalidInput("data.task.invalid", "Tehtävän tiedot eivät kelpaa."),
        };
      }
      const response = await sendDbRequest({ kind: "transaction", ops: [putTaskOp(task)] });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: task } : result;
    },
    async saveWithSyncOperation(value: Task, context: SyncWriteContext): Promise<DataResult<Task>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const task = normalizeLegacyTask(value);
      if (!validTask(task)) {
        return {
          ok: false,
          error: invalidInput("data.task.invalid", "Tehtävän tiedot eivät kelpaa."),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: task.id,
        operation: context.operation,
        entityVersion: task.version,
        occurredAt: context.occurredAt,
        createdAt: task.createdAt,
        entity: task as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putTaskOp(task)],
      });
      return committed.ok ? { ok: true, value: task } : committed;
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
