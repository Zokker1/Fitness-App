import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { TaskChecklistItem } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteTaskChecklistItemStore,
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

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialTasks: readonly Record<string, unknown>[] = [],
  initialItems: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const tasks = new Map(initialTasks.map((row) => [String(row.id), row]));
  const items = new Map(initialItems.map((row) => [String(row.id), row]));
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        const params = request.params ?? {};
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter((doc) => doc.entity_type === params.entity_type);
        } else if (request.kind === "query" && request.op === "listProjects") {
          rows = [];
        } else if (request.kind === "query" && request.op === "listTags") {
          rows = [];
        } else if (request.kind === "query" && request.op === "listTasks") {
          rows = [...tasks.values()];
        } else if (request.kind === "query" && request.op === "getTask") {
          const row = tasks.get(sqlText(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listTaskTags") {
          rows = [];
        } else if (request.kind === "query" && request.op === "listTaskChecklistItems") {
          rows = [...items.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getTaskChecklistItem") {
          const row = items.get(sqlText(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextItems = new Map(items);
          for (const write of request.ops ?? []) {
            const values = write.params;
            const id = sqlText(values.id);
            if (write.op === "putTaskChecklistItem") {
              const existing = nextItems.get(id);
              nextItems.set(id, {
                id,
                task_id: values.task_id,
                title: values.title,
                done: values.done,
                sort_order: values.sort_order,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "deleteEntity") {
              const existing = nextDocs.get(id);
              if (existing?.entity_type === values.entity_type) nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          items.clear();
          for (const [id, row] of nextItems) items.set(id, row);
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
  return { worker: worker as unknown as Worker, docs, tasks, items };
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

function taskRow(id = "task-parent"): Record<string, unknown> {
  return {
    id,
    title: "Parent task",
    notes: null,
    status: "open",
    priority: "normal",
    due_at: null,
    project_id: null,
    completed_at: null,
    reopened_at: null,
    recurrence_json: null,
    estimate_minutes: null,
    actual_seconds: 0,
    created_at: "2026-09-01T08:00:00.000Z",
    updated_at: "2026-09-01T08:00:00.000Z",
    version: 1,
    deleted_at: null,
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite TaskChecklistItem relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const item: TaskChecklistItem = {
    id: "checklist-summary",
    taskId: "task-parent",
    title: "Tee yhteenveto",
    done: true,
    sortOrder: 3,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };

  it("migrates under an existing Task parent and preserves fields through CRUD", async () => {
    const fixture = createWorker([legacyDoc("task-checklist-item", item)], [taskRow()]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskChecklistItemStore();

    expect(await store.list()).toEqual({ ok: true, value: [item] });
    expect(fixture.docs.has(item.id)).toBe(false);
    expect(fixture.items.get(item.id)).toMatchObject({
      task_id: item.taskId,
      done: 1,
      sort_order: item.sortOrder,
      deleted_at: null,
    });

    const updated: TaskChecklistItem = {
      ...item,
      title: "Tarkista yhteenveto",
      done: false,
      sortOrder: 1,
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(item.id)).toEqual({ ok: true, value: updated });
    expect(fixture.items.get(item.id)?.created_at).toBe(at);

    expect(await store.remove(item.id)).toEqual({ ok: true, value: true });
    expect(fixture.items.get(item.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("leaves legacy checklist data untouched when its Task parent is missing", async () => {
    const fixture = createWorker([legacyDoc("task-checklist-item", item)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskChecklistItemStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.task-checklist-item.invalid" },
    });
    expect(fixture.docs.has(item.id)).toBe(true);
    expect(fixture.items.size).toBe(0);
  });

  it("rejects malformed writes and conflicting legacy IDs before changing data", async () => {
    const fixture = createWorker(
      [legacyDoc("task-checklist-item", item)],
      [taskRow()],
      [
        {
          id: item.id,
          task_id: item.taskId,
          title: "Already migrated",
          done: 0,
          sort_order: 0,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTaskChecklistItemStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.task-checklist-item.invalid" },
    });
    expect(fixture.docs.has(item.id)).toBe(true);
    expect(fixture.items.get(item.id)?.title).toBe("Already migrated");

    resetDatabaseWorkerForTests();
    const validFixture = createWorker([], [taskRow()]);
    configureDatabaseWorker({ create: () => validFixture.worker });
    const validStore = createSqliteTaskChecklistItemStore();
    expect(await validStore.save({ ...item, id: "bad", title: "   " })).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(validFixture.items.size).toBe(0);
  });
});
