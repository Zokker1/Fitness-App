import { afterEach, describe, expect, it } from "vitest";
import type { CalendarBlock, Routine, Task } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteCalendarBlockStore,
  createSyncCryptoAdapter,
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

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialTasks: readonly Record<string, unknown>[] = [],
  initialRoutines: readonly Record<string, unknown>[] = [],
  initialBlocks: readonly Record<string, unknown>[] = [],
) {
  const docKey = (entityType: string, id: string) => `${entityType}\u0000${id}`;
  const docs = new Map(initialDocs.map((doc) => [docKey(doc.entity_type, doc.id), doc]));
  const tasks = new Map(initialTasks.map((row) => [String(row.id), row]));
  const routines = new Map(initialRoutines.map((row) => [String(row.id), row]));
  const blocks = new Map(initialBlocks.map((row) => [String(row.id), row]));
  const transactions: (readonly Write[])[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        const params = request.params ?? {};
        let rows: readonly unknown[] = [];
        let ok = true;
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter((doc) => doc.entity_type === params.entity_type);
        } else if (
          request.kind === "query" &&
          (request.op === "listProjects" || request.op === "listTags")
        ) {
          rows = [];
        } else if (request.kind === "query" && request.op === "listTasks") {
          rows = [...tasks.values()];
        } else if (request.kind === "query" && request.op === "getTask") {
          const row = tasks.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listTaskTags") {
          rows = [];
        } else if (request.kind === "query" && request.op === "listRoutines") {
          rows = [...routines.values()];
        } else if (request.kind === "query" && request.op === "getRoutine") {
          const row = routines.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listCalendarBlocks") {
          rows = [...blocks.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getCalendarBlock") {
          const row = blocks.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextTasks = new Map(tasks);
          const nextRoutines = new Map(routines);
          const nextBlocks = new Map(blocks);
          for (const write of request.ops ?? []) {
            const values = write.params;
            const id = stringValue(values.id);
            if (write.op === "putTask") {
              const existing = nextTasks.get(id);
              nextTasks.set(id, {
                id,
                title: values.title,
                notes: values.notes_is_null ? null : values.notes,
                status: values.status,
                priority: values.priority,
                due_at: values.due_at_is_null ? null : values.due_at,
                project_id: values.project_id_is_null ? null : values.project_id,
                completed_at: values.completed_at_is_null ? null : values.completed_at,
                reopened_at: values.reopened_at_is_null ? null : values.reopened_at,
                recurrence_json: values.recurrence_is_null ? null : values.recurrence_json,
                estimate_minutes: values.estimate_minutes_is_null ? null : values.estimate_minutes,
                actual_seconds: values.actual_seconds,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "putRoutine") {
              const existing = nextRoutines.get(id);
              nextRoutines.set(id, {
                id,
                title: values.title,
                archived_at: values.archived_at_is_null ? null : values.archived_at,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "putCalendarBlock") {
              const taskId = values.linked_task_id_is_null
                ? null
                : stringValue(values.linked_task_id);
              const routineId = values.linked_routine_id_is_null
                ? null
                : stringValue(values.linked_routine_id);
              if (
                (taskId !== null && !nextTasks.has(taskId)) ||
                (routineId !== null && !nextRoutines.has(routineId))
              ) {
                ok = false;
                break;
              }
              const existing = nextBlocks.get(id);
              nextBlocks.set(id, {
                id,
                kind: values.kind,
                title: values.title,
                starts_at: values.starts_at,
                ends_at: values.ends_at,
                linked_task_id: taskId,
                linked_routine_id: routineId,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
                deleted_at: values.deleted_at_is_null ? null : values.deleted_at,
              });
            } else if (write.op === "deleteEntity") {
              const key = docKey(stringValue(values.entity_type), id);
              nextDocs.delete(key);
            }
          }
          if (ok) {
            docs.clear();
            for (const [key, doc] of nextDocs) docs.set(key, doc);
            tasks.clear();
            for (const [id, row] of nextTasks) tasks.set(id, row);
            routines.clear();
            for (const [id, row] of nextRoutines) routines.set(id, row);
            blocks.clear();
            for (const [id, row] of nextBlocks) blocks.set(id, row);
          }
        }
        onmessage?.({
          data: ok
            ? { requestId: request.requestId, ok: true, rows, backend: "memory", persisted: false }
            : {
                requestId: request.requestId,
                ok: false,
                code: "invalid-input",
                diagnosticCode: "db.calendar-block.parent-missing",
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
  return { worker: worker as unknown as Worker, docs, tasks, routines, blocks, transactions };
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

describe("SQLite CalendarBlock relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const task: Task = {
    id: "task-parent",
    title: "Analysoi",
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
    version: 1,
    deletedAt: null,
  };
  const routine: Routine = {
    id: "routine-parent",
    title: "Aamurutiini",
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const taskBlock: CalendarBlock = {
    id: "block-task",
    kind: "task",
    title: "Työskentely",
    startsAt: "2026-09-02T08:00:00.000Z",
    endsAt: "2026-09-02T09:00:00.000Z",
    linkedTaskId: task.id,
    linkedRoutineId: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };
  const routineBlock: CalendarBlock = {
    ...taskBlock,
    id: "block-routine",
    kind: "routine",
    title: "Rutiini",
    linkedTaskId: null,
    linkedRoutineId: routine.id,
  };

  it("migrates Task and Routine parents before linked blocks and supports CRUD", async () => {
    const fixture = createWorker([
      legacyDoc("task", task),
      legacyDoc("routine", routine),
      legacyDoc("calendar-block", taskBlock),
      legacyDoc("calendar-block", routineBlock),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteCalendarBlockStore();

    const listed = await store.list();
    expect(listed).toEqual({ ok: true, value: [routineBlock, taskBlock] });
    expect(fixture.tasks.has(task.id)).toBe(true);
    expect(fixture.routines.has(routine.id)).toBe(true);
    expect(fixture.blocks.get(taskBlock.id)?.linked_task_id).toBe(task.id);
    expect(fixture.blocks.get(routineBlock.id)?.linked_routine_id).toBe(routine.id);
    expect(fixture.docs.size).toBe(0);
    expect(await store.getById(routineBlock.id)).toEqual({ ok: true, value: routineBlock });

    const invalid = await store.save({ ...taskBlock, id: "bad-kind", kind: "event" });
    expect(invalid).toMatchObject({ ok: false, error: { code: "invalid-input" } });

    expect(await store.remove(taskBlock.id)).toEqual({ ok: true, value: true });
    expect(fixture.blocks.get(taskBlock.id)?.deleted_at).toEqual(expect.any(String));
    expect(fixture.blocks.has(taskBlock.id)).toBe(true);
  });

  it("commits a calendar block and encrypted sync operation in one transaction", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteCalendarBlockStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(4));
    if (keySession === null) throw new Error("Test data key is invalid.");
    const block: CalendarBlock = {
      ...taskBlock,
      id: "block-sync",
      kind: "event",
      linkedTaskId: null,
    };

    try {
      const saved = await store.saveWithSyncOperation?.(block, {
        operationId: "installation-1:block-1",
        installationId: "installation-1",
        operation: "create",
        occurredAt: block.updatedAt,
        changedFields: [
          "kind",
          "title",
          "startsAt",
          "endsAt",
          "linkedTaskId",
          "linkedRoutineId",
          "deletedAt",
        ],
        keySession,
        crypto: createSyncCryptoAdapter(),
      });

      expect(saved).toEqual({ ok: true, value: block });
      const writeBatch = fixture.transactions.at(-1);
      expect(writeBatch?.map((write) => write.op)).toEqual([
        "putCalendarBlock",
        "putSyncOperation",
      ]);
      expect(writeBatch?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.blocks.get(block.id)?.title).toBe(block.title);
    } finally {
      keySession.lock();
    }
  });

  it("keeps legacy blocks when either linked parent is missing", async () => {
    const orphanTaskBlock = { ...taskBlock, linkedTaskId: "missing-task" };
    const orphanRoutineBlock = { ...routineBlock, linkedRoutineId: "missing-routine" };
    const fixture = createWorker([
      legacyDoc("calendar-block", orphanTaskBlock),
      legacyDoc("calendar-block", orphanRoutineBlock),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteCalendarBlockStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.size).toBe(2);
    expect(fixture.blocks.size).toBe(0);
  });

  it("leaves malformed legacy intervals untouched", async () => {
    const malformed = { ...taskBlock, startsAt: "2026-09-03T09:00:00.000Z" };
    const malformedLegacy: CalendarBlock = {
      ...malformed,
      endsAt: "2026-09-03T08:00:00.000Z",
    };
    const fixture = createWorker([
      legacyDoc("task", task),
      legacyDoc("calendar-block", malformedLegacy),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteCalendarBlockStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.has("calendar-block\u0000block-task")).toBe(true);
    expect(fixture.blocks.size).toBe(0);
  });

  it("detects a relational ID collision before migrating legacy documents", async () => {
    const fixture = createWorker(
      [legacyDoc("task", task), legacyDoc("calendar-block", taskBlock)],
      [],
      [],
      [
        {
          id: taskBlock.id,
          kind: "task",
          title: "Vanha relaatiorivi",
          starts_at: taskBlock.startsAt,
          ends_at: taskBlock.endsAt,
          linked_task_id: null,
          linked_routine_id: null,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
    );
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteCalendarBlockStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.has("calendar-block\u0000block-task")).toBe(true);
    expect(fixture.blocks.get(taskBlock.id)?.title).toBe("Vanha relaatiorivi");
  });
});
