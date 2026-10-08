import { afterEach, describe, expect, it } from "vitest";
import type { Project, Tag, Task } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteProjectStore,
  createSqliteTagStore,
  createSyncCryptoAdapter,
  createSqliteTaskStore,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface StoredDoc {
  readonly entity_type: string;
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

interface Write {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

interface Request {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly Write[];
  readonly params?: Record<string, unknown>;
}

interface Link {
  readonly task_id: string;
  readonly tag_id: string;
  readonly sort_order: number;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialProjects: readonly Record<string, unknown>[] = [],
  initialTags: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const projects = new Map(initialProjects.map((row) => [String(row.id), row]));
  const tags = new Map(initialTags.map((row) => [String(row.id), row]));
  const tasks = new Map<string, Record<string, unknown>>();
  const taskTags = new Map<string, Link>();
  const transactions: (readonly Write[])[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const readTaskRow = (row: Record<string, unknown>): Record<string, unknown> => ({ ...row });
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listProjects") {
          rows = [...projects.values()];
        } else if (request.kind === "query" && request.op === "getProject") {
          const row = projects.get(readString(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listTags") {
          rows = [...tags.values()];
        } else if (request.kind === "query" && request.op === "getTag") {
          const row = tags.get(readString(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listTasks") {
          rows = [...tasks.values()].map(readTaskRow);
        } else if (request.kind === "query" && request.op === "getTask") {
          const row = tasks.get(readString(request.params?.id));
          rows = row === undefined ? [] : [readTaskRow(row)];
        } else if (request.kind === "query" && request.op === "listTaskTags") {
          const taskId = request.params?.task_id;
          rows = [...taskTags.values()]
            .filter((link) => taskId === undefined || link.task_id === taskId)
            .sort(
              (left, right) =>
                left.task_id.localeCompare(right.task_id) ||
                left.sort_order - right.sort_order ||
                left.tag_id.localeCompare(right.tag_id),
            );
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextProjects = new Map(projects);
          const nextTags = new Map(tags);
          const nextTasks = new Map(tasks);
          const nextTaskTags = new Map(taskTags);
          for (const write of request.ops ?? []) {
            const params = write.params;
            const id = readString(params.id);
            if (write.op === "putProject") {
              const existing = nextProjects.get(id);
              nextProjects.set(id, {
                id,
                name: params.name,
                color_key: params.color_key_is_null ? null : params.color_key,
                archived_at: params.archived_at_is_null ? null : params.archived_at,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at_is_null ? null : params.deleted_at,
              });
            } else if (write.op === "putTag") {
              const existing = nextTags.get(id);
              nextTags.set(id, {
                id,
                name: params.name,
                color_key: params.color_key_is_null ? null : params.color_key,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at_is_null ? null : params.deleted_at,
              });
            } else if (write.op === "putTask") {
              const existing = nextTasks.get(id);
              nextTasks.set(id, {
                id,
                title: params.title,
                notes: params.notes_is_null ? null : params.notes,
                status: params.status,
                priority: params.priority,
                due_at: params.due_at_is_null ? null : params.due_at,
                project_id: params.project_id_is_null ? null : params.project_id,
                completed_at: params.completed_at_is_null ? null : params.completed_at,
                reopened_at: params.reopened_at_is_null ? null : params.reopened_at,
                recurrence_json: params.recurrence_is_null ? null : params.recurrence_json,
                estimate_minutes: params.estimate_minutes_is_null ? null : params.estimate_minutes,
                actual_seconds: params.actual_seconds,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at_is_null ? null : params.deleted_at,
              });
              for (const [key, link] of nextTaskTags) {
                if (link.task_id === id) nextTaskTags.delete(key);
              }
              const tagIds = JSON.parse(String(params.tag_ids_json)) as string[];
              tagIds.forEach((tagId, sortOrder) => {
                nextTaskTags.set(`${id}\u0000${tagId}`, {
                  task_id: id,
                  tag_id: tagId,
                  sort_order: sortOrder,
                });
              });
            } else if (write.op === "deleteEntity") {
              const entityType = readString(params.entity_type);
              const doc = nextDocs.get(id);
              if (doc?.entity_type === entityType) nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          projects.clear();
          for (const [id, row] of nextProjects) projects.set(id, row);
          tags.clear();
          for (const [id, row] of nextTags) tags.set(id, row);
          tasks.clear();
          for (const [id, row] of nextTasks) tasks.set(id, row);
          taskTags.clear();
          for (const [key, link] of nextTaskTags) taskTags.set(key, link);
        }
        onmessage?.({
          data: {
            requestId: request.requestId,
            ok: true,
            rows,
            backend: "memory",
            persisted: false,
          },
        } as MessageEvent);
      });
    },
    terminate() {},
    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      onmessage = listener;
    },
    set onerror(_listener: ((event: ErrorEvent) => void) | null) {},
  };
  return {
    worker: worker as unknown as Worker,
    docs,
    projects,
    tags,
    tasks,
    taskTags,
    transactions,
  };
}

function legacyDoc(
  entityType: string,
  entity: { readonly id: string; readonly createdAt: string; readonly updatedAt: string },
): StoredDoc {
  return {
    entity_type: entityType,
    id: entity.id,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    doc_version: 0,
    value: JSON.stringify(entity),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite Task relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const project: Project = {
    id: "project-work",
    name: "Työ",
    colorKey: null,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const firstTag: Tag = {
    id: "tag-important",
    name: "Tärkeä",
    colorKey: "red",
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const secondTag: Tag = {
    id: "tag-home",
    name: "Koti",
    colorKey: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const task: Task = {
    id: "task-analysis",
    title: "Analysoi tulokset",
    notes: "",
    status: "open",
    priority: "high",
    dueAt: "2026-09-04T12:30:00.000Z",
    projectId: project.id,
    tagIds: [secondTag.id, firstTag.id],
    completedAt: null,
    reopenedAt: null,
    recurrence: { kind: "weekly", everyWeeks: 2, weekdays: [1, 3] },
    estimateMinutes: 25.5,
    actualSeconds: 1750,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };

  it("migrates parent rows first and round-trips task fields and tag order", async () => {
    const fixture = createWorker([
      legacyDoc("project", project),
      legacyDoc("tag", firstTag),
      legacyDoc("tag", secondTag),
      legacyDoc("task", task),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskStore();

    expect(await store.list()).toEqual({ ok: true, value: [task] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.projects.has(project.id)).toBe(true);
    expect(fixture.tags.has(firstTag.id)).toBe(true);
    expect(fixture.tags.has(secondTag.id)).toBe(true);
    expect([...fixture.taskTags.values()].sort((a, b) => a.sort_order - b.sort_order)).toEqual([
      { task_id: task.id, tag_id: secondTag.id, sort_order: 0 },
      { task_id: task.id, tag_id: firstTag.id, sort_order: 1 },
    ]);

    const updated: Task = {
      ...task,
      notes: null,
      status: "done",
      completedAt: "2026-09-02T09:00:00.000Z",
      recurrence: null,
      estimateMinutes: null,
      actualSeconds: 3600,
      tagIds: [firstTag.id],
      updatedAt: "2026-09-02T09:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(task.id)).toEqual({ ok: true, value: updated });
    expect(fixture.tasks.get(task.id)?.created_at).toBe(at);
    expect([...fixture.taskTags.values()]).toEqual([
      { task_id: task.id, tag_id: firstTag.id, sort_order: 0 },
    ]);

    expect(await store.remove(task.id)).toEqual({ ok: true, value: true });
    expect(fixture.tasks.get(task.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("keeps legacy tasks untouched when a project parent is missing", async () => {
    const invalid: Task = { ...task, projectId: "project-missing" };
    const fixture = createWorker([legacyDoc("task", invalid)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.task.invalid" },
    });
    expect(fixture.docs.has(invalid.id)).toBe(true);
    expect(fixture.tasks.size).toBe(0);
  });

  it("keeps legacy tasks untouched when their recurrence data is invalid", async () => {
    const invalid: Task = {
      ...task,
      projectId: null,
      recurrence: { kind: "daily", everyDays: 0 },
    };
    const fixture = createWorker(
      [legacyDoc("task", invalid)],
      [],
      [
        {
          id: firstTag.id,
          name: firstTag.name,
          color_key: firstTag.colorKey,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
        {
          id: secondTag.id,
          name: secondTag.name,
          color_key: secondTag.colorKey,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.task.invalid" },
    });
    expect(fixture.docs.has(invalid.id)).toBe(true);
    expect(fixture.tasks.size).toBe(0);
  });

  it("normalizes fields absent from older task documents without losing their metadata", async () => {
    const olderTask = {
      id: "task-old",
      title: "Vanha tehtävä",
      status: "open",
      priority: "normal",
      createdAt: at,
      updatedAt: at,
      version: 3,
    };
    const fixture = createWorker([legacyDoc("task", olderTask)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskStore();

    expect(await store.list()).toEqual({
      ok: true,
      value: [
        {
          id: "task-old",
          title: "Vanha tehtävä",
          notes: null,
          status: "open",
          priority: "normal",
          dueAt: null,
          projectId: null,
          tagIds: [],
          completedAt: null,
          reopenedAt: null,
          recurrence: null,
          estimateMinutes: null,
          actualSeconds: 0,
          createdAt: at,
          updatedAt: at,
          version: 3,
          deletedAt: null,
        },
      ],
    });
    expect(fixture.docs.has(olderTask.id)).toBe(false);
  });

  it("rejects duplicate tag links before writing", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskStore();

    expect(await store.save({ ...task, tagIds: [firstTag.id, firstTag.id] })).toMatchObject({
      ok: false,
      error: { code: "invalid-input", diagnosticCode: "data.task.invalid" },
    });
    expect(fixture.tasks.size).toBe(0);
  });

  it("commits the encrypted create operation with its task in one transaction", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskStore();
    const keySession = createDataKeySession(new Uint8Array(32));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      const changedFields = Object.keys(task).filter(
        (field) => !["id", "createdAt", "updatedAt", "version"].includes(field),
      );
      const saved = await store.saveWithSyncOperation?.(task, {
        operationId: "installation-1:operation-1",
        installationId: "installation-1",
        operation: "create",
        occurredAt: task.updatedAt,
        changedFields,
        keySession,
        crypto: createSyncCryptoAdapter(),
      });

      expect(saved).toEqual({ ok: true, value: task });
      const writeBatch = fixture.transactions.at(-1);
      expect(writeBatch?.map((write) => write.op)).toEqual(["putTask", "putSyncOperation"]);
      expect(writeBatch?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.tasks.get(task.id)?.title).toBe(task.title);
    } finally {
      keySession.lock();
    }
  });

  it("commits project and tag create operations with their rows", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const keySession = createDataKeySession(new Uint8Array(32).fill(9));
    if (keySession === null) throw new Error("Test data key is invalid.");
    const crypto = createSyncCryptoAdapter();

    try {
      const project: Project = {
        id: "project-sync",
        name: "Synkattava projekti",
        colorKey: null,
        archivedAt: null,
        createdAt: at,
        updatedAt: at,
        version: 1,
        deletedAt: null,
      };
      const projectStore = createSqliteProjectStore();
      const savedProject = await projectStore.saveWithSyncOperation?.(project, {
        operationId: "installation-1:project-1",
        installationId: "installation-1",
        operation: "create",
        occurredAt: at,
        changedFields: ["name", "colorKey", "archivedAt", "deletedAt"],
        keySession,
        crypto,
      });
      expect(savedProject).toEqual({ ok: true, value: project });
      expect(fixture.transactions.at(-1)?.map((write) => write.op)).toEqual([
        "putProject",
        "putSyncOperation",
      ]);

      const tag: Tag = {
        id: "tag-sync",
        name: "Synkattava tunniste",
        colorKey: null,
        createdAt: at,
        updatedAt: at,
        version: 1,
        deletedAt: null,
      };
      const tagStore = createSqliteTagStore();
      const savedTag = await tagStore.saveWithSyncOperation?.(tag, {
        operationId: "installation-1:tag-1",
        installationId: "installation-1",
        operation: "create",
        occurredAt: at,
        changedFields: ["name", "colorKey", "deletedAt"],
        keySession,
        crypto,
      });
      expect(savedTag).toEqual({ ok: true, value: tag });
      expect(fixture.transactions.at(-1)?.map((write) => write.op)).toEqual([
        "putTag",
        "putSyncOperation",
      ]);
    } finally {
      keySession.lock();
    }
  });
});
