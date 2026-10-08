import { afterEach, describe, expect, it } from "vitest";
import type { CalendarBlock, Distraction, FocusSession, Routine, Task } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteDistractionStore,
  createSqliteFocusSessionStore,
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

function createWorker(
  initialDocs: readonly StoredDoc[] = [],
  initialTasks: readonly Record<string, unknown>[] = [],
  initialRoutines: readonly Record<string, unknown>[] = [],
  initialBlocks: readonly Record<string, unknown>[] = [],
  initialSessions: readonly Record<string, unknown>[] = [],
  initialDistractions: readonly Record<string, unknown>[] = [],
) {
  const docKey = (entityType: string, id: string) => `${entityType}\u0000${id}`;
  const docs = new Map(initialDocs.map((doc) => [docKey(doc.entity_type, doc.id), doc]));
  const tasks = new Map(initialTasks.map((row) => [String(row.id), row]));
  const routines = new Map(initialRoutines.map((row) => [String(row.id), row]));
  const blocks = new Map(initialBlocks.map((row) => [String(row.id), row]));
  const sessions = new Map(initialSessions.map((row) => [String(row.id), row]));
  const distractions = new Map(initialDistractions.map((row) => [String(row.id), row]));
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
          rows = [...blocks.values()];
        } else if (request.kind === "query" && request.op === "getCalendarBlock") {
          const row = blocks.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listFocusSessions") {
          rows = [...sessions.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getFocusSession") {
          const row = sessions.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listDistractions") {
          rows = [...distractions.values()].sort(
            (left, right) =>
              String(left.created_at).localeCompare(String(right.created_at)) ||
              String(left.id).localeCompare(String(right.id)),
          );
        } else if (request.kind === "query" && request.op === "getDistraction") {
          const row = distractions.get(stringValue(params.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          transactions.push(request.ops ?? []);
          const nextDocs = new Map(docs);
          const nextSessions = new Map(sessions);
          const nextDistractions = new Map(distractions);
          for (const write of request.ops ?? []) {
            const values = write.params;
            const id = stringValue(values.id);
            if (write.op === "putFocusSession") {
              const taskId = values.task_id_is_null ? null : values.task_id;
              const routineId = values.routine_id_is_null ? null : values.routine_id;
              const blockId = values.calendar_block_id_is_null ? null : values.calendar_block_id;
              if (
                (taskId !== null && !tasks.has(stringValue(taskId))) ||
                (routineId !== null && !routines.has(stringValue(routineId))) ||
                (blockId !== null && !blocks.has(stringValue(blockId)))
              ) {
                ok = false;
                break;
              }
              const existing = nextSessions.get(id);
              nextSessions.set(id, {
                id,
                task_id: taskId,
                routine_id: routineId,
                calendar_block_id: blockId,
                phase: values.phase,
                started_at: values.started_at_is_null ? null : values.started_at,
                ended_at: values.ended_at_is_null ? null : values.ended_at,
                duration_seconds: values.duration_seconds_is_null ? null : values.duration_seconds,
                active_elapsed_seconds: values.active_elapsed_seconds_is_null
                  ? null
                  : values.active_elapsed_seconds,
                active_segment_started_at: values.active_segment_started_at_is_null
                  ? null
                  : values.active_segment_started_at,
                accumulated_pause_seconds: values.accumulated_pause_seconds_is_null
                  ? null
                  : values.accumulated_pause_seconds,
                interruption_count: values.interruption_count_is_null
                  ? null
                  : values.interruption_count,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(docKey(stringValue(values.entity_type), id));
            } else if (write.op === "deleteFocusSession") {
              nextSessions.delete(id);
              for (const [distractionId, distraction] of nextDistractions) {
                if (distraction.focus_session_id === id) nextDistractions.delete(distractionId);
              }
            } else if (write.op === "putDistraction") {
              if (!nextSessions.has(stringValue(values.focus_session_id))) {
                ok = false;
                break;
              }
              const existing = nextDistractions.get(id);
              nextDistractions.set(id, {
                id,
                focus_session_id: values.focus_session_id,
                noted_at: values.noted_at,
                note: values.note_is_null ? null : values.note,
                created_at: existing?.created_at ?? values.created_at,
                updated_at: values.updated_at,
                version: values.version,
              });
            } else if (write.op === "deleteDistraction") {
              nextDistractions.delete(id);
            }
          }
          if (ok) {
            docs.clear();
            for (const [key, doc] of nextDocs) docs.set(key, doc);
            sessions.clear();
            for (const [id, session] of nextSessions) sessions.set(id, session);
            distractions.clear();
            for (const [id, distraction] of nextDistractions) distractions.set(id, distraction);
          }
        }
        onmessage?.({
          data: ok
            ? { requestId: request.requestId, ok: true, rows, backend: "memory", persisted: false }
            : {
                requestId: request.requestId,
                ok: false,
                code: "invalid-input",
                diagnosticCode: "db.focus-session.parent-missing",
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
    tasks,
    routines,
    blocks,
    sessions,
    distractions,
    transactions,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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

describe("SQLite FocusSession relational store", () => {
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
  const calendarBlock: CalendarBlock = {
    id: "block-parent",
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
  const session: FocusSession = {
    id: "focus-legacy",
    taskId: task.id,
    routineId: routine.id,
    calendarBlockId: calendarBlock.id,
    phase: "running",
    startedAt: "2026-09-02T08:00:00.000Z",
    endedAt: null,
    durationSeconds: 1500,
    activeElapsedSeconds: 720,
    activeSegmentStartedAt: "2026-09-02T08:12:00.000Z",
    accumulatedPauseSeconds: 30,
    interruptionCount: 2,
    createdAt: at,
    updatedAt: at,
    version: 3,
  };
  const distraction: Distraction = {
    id: "distraction-legacy",
    focusSessionId: session.id,
    notedAt: "2026-09-02T08:04:00.000Z",
    note: null,
    createdAt: at,
    updatedAt: at,
    version: 2,
  };

  function relationalSessionRow(value: FocusSession): Record<string, unknown> {
    return {
      id: value.id,
      task_id: value.taskId,
      routine_id: value.routineId,
      calendar_block_id: value.calendarBlockId,
      phase: value.phase,
      started_at: value.startedAt,
      ended_at: value.endedAt,
      duration_seconds: value.durationSeconds,
      active_elapsed_seconds: value.activeElapsedSeconds ?? null,
      active_segment_started_at: value.activeSegmentStartedAt ?? null,
      accumulated_pause_seconds: value.accumulatedPauseSeconds ?? null,
      interruption_count: value.interruptionCount ?? null,
      created_at: value.createdAt,
      updated_at: value.updatedAt,
      version: value.version,
    };
  }

  function relationalDistractionRow(value: Distraction): Record<string, unknown> {
    return {
      id: value.id,
      focus_session_id: value.focusSessionId,
      noted_at: value.notedAt,
      note: value.note,
      created_at: value.createdAt,
      updated_at: value.updatedAt,
      version: value.version,
    };
  }

  function parents() {
    return {
      tasks: [
        {
          id: task.id,
          title: task.title,
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
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
      routines: [
        {
          id: routine.id,
          title: routine.title,
          archived_at: null,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
      blocks: [
        {
          id: calendarBlock.id,
          kind: calendarBlock.kind,
          title: calendarBlock.title,
          starts_at: calendarBlock.startsAt,
          ends_at: calendarBlock.endsAt,
          linked_task_id: calendarBlock.linkedTaskId,
          linked_routine_id: null,
          created_at: at,
          updated_at: at,
          version: 1,
          deleted_at: null,
        },
      ],
    };
  }

  it("migrates all parents first and preserves T168/T170/T172 fields", async () => {
    const parentRows = parents();
    const fixture = createWorker(
      [legacyDoc("focus-session", session)],
      parentRows.tasks,
      parentRows.routines,
      parentRows.blocks,
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteFocusSessionStore();

    expect(await store.list()).toEqual({ ok: true, value: [session] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.sessions.get(session.id)).toMatchObject({
      task_id: task.id,
      routine_id: routine.id,
      calendar_block_id: calendarBlock.id,
      active_elapsed_seconds: 720,
      active_segment_started_at: session.activeSegmentStartedAt,
      accumulated_pause_seconds: 30,
      interruption_count: 2,
    });
    expect(await store.getById(session.id)).toEqual({ ok: true, value: session });

    const changed = { ...session, interruptionCount: 3, version: 4 };
    expect(await store.save(changed)).toEqual({ ok: true, value: changed });
    expect(fixture.sessions.get(session.id)?.created_at).toBe(at);
    expect(fixture.sessions.get(session.id)?.interruption_count).toBe(3);
    expect(await store.remove(session.id)).toEqual({ ok: true, value: true });
    expect(fixture.sessions.has(session.id)).toBe(false);
  });

  it("keeps a legacy focus session when one of its parents is absent", async () => {
    const orphan = { ...session, calendarBlockId: "missing-block" };
    const fixture = createWorker(
      [legacyDoc("focus-session", orphan)],
      parents().tasks,
      parents().routines,
    );
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteFocusSessionStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.has("focus-session\u0000focus-legacy")).toBe(true);
    expect(fixture.sessions.size).toBe(0);
  });

  it("commits a focus session and its encrypted sync operation atomically", async () => {
    const created: FocusSession = {
      id: "focus-sync",
      taskId: null,
      routineId: null,
      calendarBlockId: null,
      phase: "planned",
      startedAt: null,
      endedAt: null,
      durationSeconds: 1500,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker();
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteFocusSessionStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(16));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(created, {
          operationId: "installation-1:focus-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "taskId",
            "routineId",
            "calendarBlockId",
            "phase",
            "startedAt",
            "endedAt",
            "durationSeconds",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: created });

      const transaction = fixture.transactions.at(-1);
      expect(transaction?.map((write) => write.op)).toEqual([
        "putFocusSession",
        "putSyncOperation",
      ]);
      expect(transaction?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.sessions.get(created.id)?.phase).toBe("planned");
    } finally {
      keySession.lock();
    }
  });

  it("commits a distraction and its encrypted sync operation atomically", async () => {
    const parentRows = parents();
    const fixture = createWorker([], parentRows.tasks, parentRows.routines, parentRows.blocks, [
      relationalSessionRow(session),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteDistractionStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(26));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(distraction, {
          operationId: "installation-1:distraction-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: distraction.updatedAt,
          changedFields: ["focusSessionId", "notedAt", "note"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: distraction });

      const transaction = fixture.transactions.at(-1);
      expect(transaction?.map((write) => write.op)).toEqual(["putDistraction", "putSyncOperation"]);
      expect(transaction?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.distractions.get(distraction.id)?.note).toBe(distraction.note);
    } finally {
      keySession.lock();
    }
  });

  it("rejects relational ID collisions before deleting legacy documents", async () => {
    const parentRows = parents();
    const existing = {
      id: session.id,
      task_id: null,
      routine_id: null,
      calendar_block_id: null,
      phase: "planned",
      started_at: null,
      ended_at: null,
      duration_seconds: null,
      active_elapsed_seconds: null,
      active_segment_started_at: null,
      accumulated_pause_seconds: null,
      interruption_count: null,
      created_at: at,
      updated_at: at,
      version: 1,
    };
    const fixture = createWorker(
      [legacyDoc("focus-session", session)],
      parentRows.tasks,
      parentRows.routines,
      parentRows.blocks,
      [existing],
    );
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteFocusSessionStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.has("focus-session\u0000focus-legacy")).toBe(true);
    expect(fixture.sessions.get(session.id)?.phase).toBe("planned");
  });

  it("migrates distraction rows after their focus-session parent and preserves nullable notes", async () => {
    const parentRows = parents();
    const fixture = createWorker(
      [legacyDoc("focus-session", session), legacyDoc("distraction", distraction)],
      parentRows.tasks,
      parentRows.routines,
      parentRows.blocks,
    );
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteDistractionStore();

    expect(await store.list()).toEqual({ ok: true, value: [distraction] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.sessions.has(session.id)).toBe(true);
    expect(fixture.distractions.get(distraction.id)).toMatchObject({
      focus_session_id: session.id,
      note: distraction.note,
      version: 2,
    });

    const changed = { ...distraction, note: "", version: 3 };
    expect(await store.save(changed)).toEqual({ ok: true, value: changed });
    expect(await store.getById(distraction.id)).toEqual({ ok: true, value: changed });
    expect(await store.remove(distraction.id)).toEqual({ ok: true, value: true });
    expect(fixture.distractions.has(distraction.id)).toBe(false);
  });

  it("keeps an orphaned legacy distraction document when its session is missing", async () => {
    const fixture = createWorker([legacyDoc("distraction", distraction)]);
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteDistractionStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.has("distraction\u0000distraction-legacy")).toBe(true);
    expect(fixture.distractions.size).toBe(0);
  });

  it("does not delete a legacy distraction when its relational id already exists", async () => {
    const fixture = createWorker(
      [legacyDoc("distraction", distraction)],
      [],
      [],
      [],
      [relationalSessionRow(session)],
      [relationalDistractionRow({ ...distraction, note: null })],
    );
    configureDatabaseWorker({ create: () => fixture.worker });

    const result = await createSqliteDistractionStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(fixture.docs.has("distraction\u0000distraction-legacy")).toBe(true);
    expect(fixture.distractions.get(distraction.id)?.note).toBeNull();
  });
});
