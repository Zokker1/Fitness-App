import { afterEach, describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import {
  commitSyncableChange,
  createEncryptedSyncOperation,
  configureDatabaseWorker,
  createDataKeySession,
  createMockSyncProvider,
  createSyncCryptoAdapter,
  appendSyncOperation,
  listSyncOperations,
  resetDatabaseWorkerForTests,
  saveSyncCursor,
  syncReplica,
} from "../src/index.ts";
import type {
  DataKeySession,
  SyncEntityStoreAdapter,
  DomainTransactionWrite,
  SyncPayloadEntity,
  SyncProvider,
} from "../src/index.ts";

interface TestWrite {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

interface TestRequest {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly params?: Record<string, unknown>;
  readonly ops?: readonly TestWrite[];
}

interface StoredCursor {
  readonly id: string;
  readonly installation_id: string;
  readonly provider_id: string;
  readonly provider_cursor: string | null;
  readonly last_seen_operation_id: string | null;
  readonly updated_through: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
}

interface Replica {
  readonly installationId: string;
  readonly worker: Worker;
  readonly operations: Map<string, Record<string, unknown>>;
  readonly cursors: Map<string, StoredCursor>;
  readonly tasks: Map<string, Task>;
  readonly installations: Map<string, SyncPayloadEntity>;
  readonly keySession: DataKeySession;
}

const AT = "2026-10-02T12:00:00.000Z";
const OPERATION_KIND = new Set(["create", "update", "delete", "resolve"]);

function cursorKey(installationId: string, providerId: string): string {
  return `${installationId}\u0000${providerId}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function taskWrite(task: Task): DomainTransactionWrite {
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

function createReplica(installationId: string): Replica {
  const operations = new Map<string, Record<string, unknown>>();
  const cursors = new Map<string, StoredCursor>();
  const tasks = new Map<string, Task>();
  const installations = new Map<string, SyncPayloadEntity>();
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as TestRequest;
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listSyncOperations") {
          rows = [...operations.values()];
        } else if (request.kind === "query" && request.op === "getSyncCursor") {
          const installation = request.params?.installation_id;
          const provider = request.params?.provider_id;
          const cursor =
            typeof installation === "string" && typeof provider === "string"
              ? cursors.get(cursorKey(installation, provider))
              : undefined;
          rows = cursor === undefined ? [] : [cursor];
        } else if (request.kind === "transaction") {
          for (const write of request.ops ?? []) {
            const params = write.params;
            if (write.op === "putSyncOperation") {
              const operationId = params.operation_id;
              const operation = params.operation;
              if (
                typeof operationId === "string" &&
                typeof operation === "string" &&
                OPERATION_KIND.has(operation)
              ) {
                operations.set(operationId, { ...params });
              }
            } else if (write.op === "putSyncCursor") {
              const installation = params.installation_id;
              const provider = params.provider_id;
              if (typeof installation === "string" && typeof provider === "string") {
                cursors.set(cursorKey(installation, provider), {
                  id: readString(params.id),
                  installation_id: installation,
                  provider_id: provider,
                  provider_cursor:
                    typeof params.provider_cursor === "string" ? params.provider_cursor : null,
                  last_seen_operation_id:
                    typeof params.last_seen_operation_id === "string" &&
                    params.last_seen_operation_id.length > 0
                      ? params.last_seen_operation_id
                      : null,
                  updated_through: readString(params.updated_through),
                  created_at: readString(params.created_at),
                  updated_at: readString(params.updated_at),
                  version: Number(params.version ?? 1),
                });
              }
            }
          }
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

  const keySession = createDataKeySession(new Uint8Array(32).fill(7));
  if (keySession === null) throw new Error("Test data key is invalid.");
  return {
    installationId,
    worker: worker as unknown as Worker,
    operations,
    cursors,
    tasks,
    installations,
    keySession,
  };
}

function connectReplica(replica: Replica): void {
  resetDatabaseWorkerForTests();
  configureDatabaseWorker({ create: () => replica.worker });
}

function entityStore(replica: Replica): SyncEntityStoreAdapter {
  return {
    read(entityType, entityId) {
      if (entityType === "browser-installation") {
        return Promise.resolve({
          ok: true,
          value: replica.installations.get(entityId) ?? null,
        });
      }
      if (entityType !== "task") return Promise.resolve({ ok: true, value: null });
      return Promise.resolve({
        ok: true,
        value: (replica.tasks.get(entityId) as unknown as SyncPayloadEntity | undefined) ?? null,
      });
    },
    write(entityType, entityId, entity) {
      if (entityType === "browser-installation") {
        if (entity.id !== entityId || entity.installationId !== entityId) {
          return Promise.resolve({
            ok: false,
            error: {
              code: "invalid-input",
              diagnosticCode: "test.sync-installation.invalid",
              userMessage: "Test installation does not match its key.",
            },
          });
        }
        replica.installations.set(entityId, entity);
        return Promise.resolve({ ok: true, value: true });
      }
      if (entityType !== "task" || entity.id !== entityId) {
        return Promise.resolve({
          ok: false,
          error: {
            code: "invalid-input",
            diagnosticCode: "test.sync-entity.invalid",
            userMessage: "Test entity does not match its key.",
          },
        });
      }
      replica.tasks.set(entityId, entity as unknown as Task);
      return Promise.resolve({ ok: true, value: true });
    },
  };
}

function makeTask(id: string, title: string): Task {
  return {
    id,
    title,
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
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    deletedAt: null,
  };
}

function makeInstallation(installationId: string, name: string): SyncPayloadEntity {
  return {
    id: installationId,
    installationId,
    installationName: name,
    lastSeenAppVersion: "0.1.0",
    lastSyncAt: null,
    revokedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
  };
}

async function createOfflineTask(replica: Replica, task: Task): Promise<void> {
  connectReplica(replica);
  const changedFields = Object.keys(task).filter(
    (field) => !["id", "createdAt", "updatedAt", "version"].includes(field),
  );
  const committed = await commitSyncableChange({
    operationId: `${replica.installationId}:create:${task.id}`,
    installationId: replica.installationId,
    entityType: "task",
    entityId: task.id,
    operation: "create",
    entityVersion: task.version,
    occurredAt: task.updatedAt,
    createdAt: task.createdAt,
    entity: task as unknown as SyncPayloadEntity,
    changedFields,
    keySession: replica.keySession,
    crypto: createSyncCryptoAdapter(),
    writes: [taskWrite(task)],
  });
  if (!committed.ok) throw new Error(committed.error.diagnosticCode);
  replica.tasks.set(task.id, task);
}

async function updateOfflineTask(
  replica: Replica,
  task: Task,
  changedFields: readonly string[],
): Promise<void> {
  connectReplica(replica);
  const committed = await commitSyncableChange({
    operationId: `${replica.installationId}:update:${task.id}:${changedFields.join("-")}`,
    installationId: replica.installationId,
    entityType: "task",
    entityId: task.id,
    operation: "update",
    entityVersion: task.version,
    occurredAt: task.updatedAt,
    createdAt: task.createdAt,
    entity: task as unknown as SyncPayloadEntity,
    changedFields,
    keySession: replica.keySession,
    crypto: createSyncCryptoAdapter(),
    writes: [taskWrite(task)],
  });
  if (!committed.ok) throw new Error(committed.error.diagnosticCode);
  replica.tasks.set(task.id, task);
}

async function revokeOfflineInstallation(
  actor: Replica,
  target: SyncPayloadEntity,
  revokedAt: string,
): Promise<void> {
  connectReplica(actor);
  const targetInstallationId = target.installationId;
  const targetCreatedAt = target.createdAt;
  if (typeof targetInstallationId !== "string" || typeof targetCreatedAt !== "string") {
    throw new Error("Target installation metadata is invalid.");
  }
  const next: SyncPayloadEntity = {
    ...target,
    revokedAt,
    updatedAt: revokedAt,
    version: Number(target.version) + 1,
  };
  const encrypted = await createEncryptedSyncOperation({
    operationId: `${actor.installationId}:revoke:${targetInstallationId}`,
    installationId: actor.installationId,
    entityType: "browser-installation",
    entityId: targetInstallationId,
    operation: "update",
    entityVersion: Number(next.version),
    occurredAt: revokedAt,
    createdAt: targetCreatedAt,
    entity: next,
    changedFields: ["revokedAt"],
    keySession: actor.keySession,
    crypto: createSyncCryptoAdapter(),
  });
  if (!encrypted.ok) throw new Error(encrypted.error.diagnosticCode);
  const appended = await appendSyncOperation(encrypted.value);
  if (!appended.ok) throw new Error(appended.error.diagnosticCode);
  actor.installations.set(targetInstallationId, next);
}

async function reconnect(replica: Replica, provider: SyncProvider) {
  connectReplica(replica);
  return syncReplica({
    provider,
    installationId: replica.installationId,
    keySession: replica.keySession,
    crypto: createSyncCryptoAdapter(),
    entityStore: entityStore(replica),
  });
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("offline multi-replica sync", () => {
  it("stops a locally revoked browser before it uploads queued operations", async () => {
    const revoked = createReplica("replica-revoked");
    const other = createReplica("replica-other");
    const provider = createMockSyncProvider();
    await createOfflineTask(revoked, makeTask("queued-before-revoke", "Private pending item"));
    revoked.installations.set("replica-revoked", {
      ...makeInstallation("replica-revoked", "Peruttu selain"),
      revokedAt: "2026-10-02T12:01:00.000Z",
      updatedAt: "2026-10-02T12:01:00.000Z",
      version: 2,
    });

    try {
      const blocked = await reconnect(revoked, provider);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) {
        expect(blocked.error.diagnosticCode).toBe("data.sync.installation.revoked");
      }
      expect((await reconnect(other, provider)).ok).toBe(true);
      expect(other.tasks.has("queued-before-revoke")).toBe(false);
    } finally {
      revoked.keySession.lock();
      other.keySession.lock();
    }
  });

  it("ignores new operations from an installation revoked in the same sync download", async () => {
    const first = createReplica("replica-a");
    const second = createReplica("replica-b");
    const third = createReplica("replica-c");
    const provider = createMockSyncProvider();
    first.installations.set("replica-a", makeInstallation("replica-a", "Työkone"));
    second.installations.set("replica-b", makeInstallation("replica-b", "Kotiselain"));
    third.installations.set("replica-c", makeInstallation("replica-c", "Tabletti"));

    try {
      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(second, provider)).ok).toBe(true);
      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(third, provider)).ok).toBe(true);

      const target = first.installations.get("replica-b");
      if (target === undefined) throw new Error("Remote installation is missing.");
      await revokeOfflineInstallation(first, target, "2026-10-02T12:03:00.000Z");
      expect((await reconnect(first, provider)).ok).toBe(true);

      const postRevokeTask = {
        ...makeTask("post-revocation-task", "Must not be accepted"),
        updatedAt: "2026-10-02T12:04:00.000Z",
      };
      await createOfflineTask(second, postRevokeTask);
      expect((await reconnect(second, provider)).ok).toBe(true);

      const downloaded = await reconnect(third, provider);
      expect(downloaded.ok).toBe(true);
      expect(third.installations.get("replica-b")?.revokedAt).toBe("2026-10-02T12:03:00.000Z");
      expect(third.tasks.has("post-revocation-task")).toBe(false);
    } finally {
      first.keySession.lock();
      second.keySession.lock();
      third.keySession.lock();
    }
  });

  it("publishes encrypted installation metadata and syncs a renamed browser across profiles", async () => {
    const first = createReplica("replica-a");
    const second = createReplica("replica-b");
    const provider = createMockSyncProvider();
    first.installations.set("replica-a", makeInstallation("replica-a", "Työkone"));
    second.installations.set("replica-b", makeInstallation("replica-b", "Kotiselain"));

    try {
      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(second, provider)).ok).toBe(true);
      expect((await reconnect(first, provider)).ok).toBe(true);

      expect(first.installations.get("replica-b")?.installationName).toBe("Kotiselain");
      expect(second.installations.get("replica-a")?.installationName).toBe("Työkone");

      const current = first.installations.get("replica-a");
      if (current === undefined) throw new Error("First installation is missing.");
      first.installations.set("replica-a", {
        ...current,
        installationName: "Työkoneen uusi nimi",
        updatedAt: "2026-10-02T12:01:00.000Z",
        version: 2,
      });

      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(second, provider)).ok).toBe(true);

      expect(second.installations.get("replica-a")).toMatchObject({
        id: "replica-a",
        installationId: "replica-a",
        installationName: "Työkoneen uusi nimi",
      });
      connectReplica(second);
      const operations = await listSyncOperations();
      expect(
        operations.ok &&
          operations.value.filter((item) => item.entityType === "browser-installation"),
      ).toHaveLength(3);
    } finally {
      first.keySession.lock();
      second.keySession.lock();
    }
  });

  it("merges tasks created offline on separate profiles after reconnect", async () => {
    const first = createReplica("replica-a");
    const second = createReplica("replica-b");
    const provider = createMockSyncProvider();

    try {
      await createOfflineTask(first, makeTask("task-a", "Tehtävä A"));
      await createOfflineTask(second, makeTask("task-b", "Tehtävä B"));

      expect(first.tasks.size).toBe(1);
      expect(second.tasks.size).toBe(1);

      const firstReconnect = await reconnect(first, provider);
      expect(firstReconnect.ok).toBe(true);
      const secondReconnect = await reconnect(second, provider);
      expect(secondReconnect.ok).toBe(true);
      const finalReconnect = await reconnect(first, provider);
      expect(finalReconnect.ok).toBe(true);

      expect([...first.tasks.keys()].sort()).toEqual(["task-a", "task-b"]);
      expect([...second.tasks.keys()].sort()).toEqual(["task-a", "task-b"]);
      expect(first.tasks.get("task-b")?.title).toBe("Tehtävä B");
      expect(second.tasks.get("task-a")?.title).toBe("Tehtävä A");

      connectReplica(first);
      const firstOperations = await listSyncOperations();
      connectReplica(second);
      const secondOperations = await listSyncOperations();
      expect(firstOperations.ok && firstOperations.value).toHaveLength(2);
      expect(secondOperations.ok && secondOperations.value).toHaveLength(2);
      expect(
        firstOperations.ok && firstOperations.value.map((item) => item.installationId).sort(),
      ).toEqual(["replica-a", "replica-b"]);
      expect(
        secondOperations.ok && secondOperations.value.map((item) => item.installationId).sort(),
      ).toEqual(["replica-a", "replica-b"]);
    } finally {
      first.keySession.lock();
      second.keySession.lock();
    }
  });

  it("applies a redelivered remote operation idempotently after cursor rewind", async () => {
    const first = createReplica("replica-a");
    const second = createReplica("replica-b");
    const provider = createMockSyncProvider();
    const task = makeTask("task-replayed", "Redelivered operation");

    try {
      await createOfflineTask(first, task);
      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(second, provider)).ok).toBe(true);
      expect(second.tasks.get(task.id)?.title).toBe(task.title);

      connectReplica(second);
      const initialLog = await listSyncOperations();
      expect(initialLog.ok && initialLog.value).toHaveLength(1);
      const rewound = await saveSyncCursor({
        installationId: second.installationId,
        providerId: provider.providerId,
        providerCursor: "0",
        lastSeenOperationId: null,
      });
      expect(rewound.ok).toBe(true);

      expect((await reconnect(second, provider)).ok).toBe(true);
      expect(second.tasks.get(task.id)?.title).toBe(task.title);
      connectReplica(second);
      const replayedLog = await listSyncOperations();
      expect(replayedLog.ok && replayedLog.value).toHaveLength(1);
    } finally {
      first.keySession.lock();
      second.keySession.lock();
    }
  });

  it("merges disjoint edits made offline to the same task on two profiles", async () => {
    const first = createReplica("replica-a");
    const second = createReplica("replica-b");
    const provider = createMockSyncProvider();

    try {
      await createOfflineTask(first, makeTask("task-shared", "Original title"));
      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(second, provider)).ok).toBe(true);

      const firstBase = first.tasks.get("task-shared");
      const secondBase = second.tasks.get("task-shared");
      if (firstBase === undefined || secondBase === undefined) {
        throw new Error("Initial task did not reach both profiles.");
      }

      await updateOfflineTask(
        first,
        {
          ...firstBase,
          title: "Edited on A",
          updatedAt: "2026-10-02T12:01:00.000Z",
          version: firstBase.version + 1,
        },
        ["title"],
      );
      await updateOfflineTask(
        second,
        {
          ...secondBase,
          notes: "Edited on B",
          updatedAt: "2026-10-02T12:02:00.000Z",
          version: secondBase.version + 1,
        },
        ["notes"],
      );

      expect((await reconnect(first, provider)).ok).toBe(true);
      expect((await reconnect(second, provider)).ok).toBe(true);
      expect((await reconnect(first, provider)).ok).toBe(true);

      expect(first.tasks.get("task-shared")).toMatchObject({
        title: "Edited on A",
        notes: "Edited on B",
      });
      expect(second.tasks.get("task-shared")).toMatchObject({
        title: "Edited on A",
        notes: "Edited on B",
      });

      connectReplica(first);
      const firstOperations = await listSyncOperations();
      connectReplica(second);
      const secondOperations = await listSyncOperations();
      expect(firstOperations.ok && firstOperations.value.length).toBeGreaterThanOrEqual(3);
      expect(secondOperations.ok && secondOperations.value.length).toBeGreaterThanOrEqual(3);
    } finally {
      first.keySession.lock();
      second.keySession.lock();
    }
  });
});
