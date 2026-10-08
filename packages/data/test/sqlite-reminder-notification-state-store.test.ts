import { afterEach, describe, expect, it } from "vitest";
import type { NotificationState, Reminder } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteNotificationStateStore,
  createSqliteReminderStore,
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

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const reminderRows = new Map<string, Record<string, unknown>>();
  const stateRows = new Map<string, Record<string, unknown>>();
  const requests: Request[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listReminders") {
          rows = [...reminderRows.values()];
        } else if (request.kind === "query" && request.op === "getReminder") {
          const row = reminderRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listNotificationStates") {
          rows = [...stateRows.values()];
        } else if (request.kind === "query" && request.op === "getNotificationState") {
          const row = stateRows.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextReminders = new Map(reminderRows);
          const nextStates = new Map(stateRows);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putReminder") {
              const params = write.params;
              const row: Record<string, unknown> = {
                id,
                kind: params.kind,
                route: params.route,
                title: params.title,
                fire_at: params.fire_at === "" ? null : params.fire_at,
                snoozed_until: params.snoozed_until === "" ? null : params.snoozed_until,
                rule_json: params.rule_json === "" ? null : params.rule_json,
                category_key: params.category_key,
                enabled: params.enabled,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at === "" ? null : params.deleted_at,
              };
              const existing = nextReminders.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextReminders.set(id, row);
            } else if (write.op === "putNotificationState") {
              const params = write.params;
              const row: Record<string, unknown> = {
                id,
                reminder_id: params.reminder_id === "" ? null : params.reminder_id,
                category_key: params.category_key,
                delivery: params.delivery,
                last_evaluated_at: params.last_evaluated_at,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              };
              const existing = nextStates.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextStates.set(id, row);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          reminderRows.clear();
          for (const [id, row] of nextReminders) reminderRows.set(id, row);
          stateRows.clear();
          for (const [id, row] of nextStates) stateRows.set(id, row);
        } else if (request.kind === "exec" && request.op === "deleteNotificationState") {
          stateRows.delete(stringValue(request.params?.id));
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
  return { worker: worker as unknown as Worker, docs, reminderRows, stateRows, requests };
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

describe("SQLite Reminder and NotificationState stores", () => {
  it("migrates reminders before linked states and supports both CRUD policies", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const reminder: Reminder = {
      id: "reminder-old",
      kind: "recurring",
      route: "/tasks",
      title: "Iltakirjaus",
      rule: null,
      fireAt: null,
      snoozedUntil: null,
      categoryKey: "tasks",
      enabled: true,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const state: NotificationState = {
      id: "state-old",
      reminderId: reminder.id,
      categoryKey: "tasks",
      delivery: "shown",
      lastEvaluatedAt: at,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([
      legacyDoc("reminder", reminder),
      legacyDoc("notification-state", state),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const reminderStore = createSqliteReminderStore();
    const stateStore = createSqliteNotificationStateStore();

    expect(await stateStore.list()).toEqual({ ok: true, value: [state] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.reminderRows.get(reminder.id)).toMatchObject({
      kind: "recurring",
      fire_at: null,
      enabled: 1,
    });
    expect(fixture.stateRows.get(state.id)).toMatchObject({
      reminder_id: reminder.id,
      delivery: "shown",
    });
    const migrationTransactions = fixture.requests.filter(
      (request) => request.kind === "transaction",
    );
    expect(migrationTransactions[0]?.ops?.map((write) => write.op)).toEqual([
      "putReminder",
      "deleteEntity",
    ]);
    expect(migrationTransactions[1]?.ops?.map((write) => write.op)).toEqual([
      "putNotificationState",
      "deleteEntity",
    ]);

    expect(await reminderStore.remove(reminder.id)).toEqual({ ok: true, value: true });
    expect(typeof fixture.reminderRows.get(reminder.id)?.deleted_at).toBe("string");
    expect(fixture.reminderRows.get(reminder.id)?.version).toBe(2);
    expect(fixture.stateRows.get(state.id)?.reminder_id).toBe(reminder.id);

    const pending: NotificationState = {
      ...state,
      id: "state-pending",
      reminderId: null,
      delivery: "pending",
      version: 1,
    };
    expect(await stateStore.save(pending)).toEqual({ ok: true, value: pending });
    expect(await stateStore.getById(pending.id)).toEqual({ ok: true, value: pending });
    expect(await stateStore.remove(pending.id)).toEqual({ ok: true, value: true });
    expect(fixture.stateRows.has(pending.id)).toBe(false);
  });

  it("leaves an orphaned legacy notification state untouched", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const orphan: NotificationState = {
      id: "state-orphan",
      reminderId: "missing-reminder",
      categoryKey: "tasks",
      delivery: "pending",
      lastEvaluatedAt: at,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const source = legacyDoc("notification-state", orphan);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteNotificationStateStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(orphan.id)).toEqual(source);
    expect(fixture.stateRows.size).toBe(0);
    expect(
      fixture.requests.some((request) =>
        request.ops?.some((op) => op.op === "putNotificationState"),
      ),
    ).toBe(false);
  });

  it("commits a reminder and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const reminder: Reminder = {
      id: "reminder-sync",
      kind: "recurring",
      route: "/tasks",
      title: "Päivän suunnittelu",
      rule: {
        kind: "recurring",
        schedule: { cadence: "daily", localTime: "08:00", weekdays: [] },
      },
      fireAt: null,
      snoozedUntil: null,
      categoryKey: "tasks",
      enabled: true,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteReminderStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(27));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(reminder, {
          operationId: "installation-1:reminder-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "kind",
            "route",
            "title",
            "rule",
            "fireAt",
            "snoozedUntil",
            "categoryKey",
            "enabled",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: reminder });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putReminder",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.reminderRows.get(reminder.id)?.title).toBe(reminder.title);
    } finally {
      keySession.lock();
    }
  });

  it("blocks invalid legacy reminder fields without deleting their source", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const invalid: Reminder = {
      id: "reminder-invalid",
      kind: "time",
      route: " ",
      title: "Tyhjä reitti",
      rule: null,
      fireAt: at,
      snoozedUntil: null,
      categoryKey: "tasks",
      enabled: true,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const source = legacyDoc("reminder", invalid);
    const fixture = createWorker([source]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteReminderStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.docs.get(invalid.id)).toEqual(source);
    expect(fixture.reminderRows.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });
});
