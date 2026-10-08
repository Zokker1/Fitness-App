import { describe, expect, it } from "vitest";
import type { FocusSession, Task } from "@lifeos/domain";
import {
  createDataKeySession,
  createEntityRepository,
  createSyncCryptoAdapter,
  fixedClock,
  InMemoryStore,
  sequentialIdGenerator,
} from "../src/index.ts";
import type { ActiveSyncWriteContext, EntityStore, SyncWriteContext } from "../src/index.ts";

const AT = "2026-10-02T10:00:00.000Z";

describe("repository sync writes", () => {
  it("routes task create, update, and soft-delete through sync operations", async () => {
    const memory = new InMemoryStore<Task>("task");
    const writes: SyncWriteContext[] = [];
    const store: EntityStore<Task> = {
      entityType: "task",
      list: () => memory.list(),
      getById: (id) => memory.getById(id),
      save: (entity) => memory.save(entity),
      remove: (id) => memory.remove(id),
      async saveWithSyncOperation(entity, context) {
        writes.push(context);
        return memory.save(entity);
      },
    };
    const keySession = createDataKeySession(new Uint8Array(32));
    if (keySession === null) throw new Error("Test data key is invalid.");
    const activeContext: ActiveSyncWriteContext = {
      installationId: "installation-test",
      keySession,
      crypto: createSyncCryptoAdapter(),
    };
    let committedWriteEvents = 0;
    const repository = createEntityRepository(store, {
      clock: fixedClock(AT),
      ids: sequentialIdGenerator("sync-write"),
      getSyncContext: () => activeContext,
      onSyncWrite: () => {
        committedWriteEvents += 1;
      },
    });

    try {
      const created = await repository.create({
        title: "Test task",
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
        deletedAt: null,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const updated = await repository.update(created.value.id, {
        title: "Updated task",
        priority: "high",
      });
      expect(updated.ok).toBe(true);

      const deletedAt = "2026-10-02T10:01:00.000Z";
      const deleted = await repository.update(created.value.id, { deletedAt });
      expect(deleted.ok).toBe(true);

      expect(writes.map((write) => write.operation)).toEqual(["create", "update", "delete"]);
      expect(writes[1]?.changedFields).toEqual(["title", "priority"]);
      expect(writes[2]?.changedFields).toEqual(["deletedAt"]);
      expect(writes.every((write) => write.installationId === "installation-test")).toBe(true);
      expect(committedWriteEvents).toBe(3);
    } finally {
      keySession.lock();
    }
  });

  it("keeps hard-delete stores on their physical remove path", async () => {
    const memory = new InMemoryStore<FocusSession>("focus-session");
    const writes: SyncWriteContext[] = [];
    const store: EntityStore<FocusSession> = {
      entityType: "focus-session",
      list: () => memory.list(),
      getById: (id) => memory.getById(id),
      save: (entity) => memory.save(entity),
      remove: (id) => memory.remove(id),
      async saveWithSyncOperation(entity, context) {
        writes.push(context);
        return memory.save(entity);
      },
    };
    const keySession = createDataKeySession(new Uint8Array(32));
    if (keySession === null) throw new Error("Test data key is invalid.");
    const repository = createEntityRepository(store, {
      clock: fixedClock(AT),
      ids: sequentialIdGenerator("hard-delete"),
      getSyncContext: () => ({
        installationId: "installation-test",
        keySession,
        crypto: createSyncCryptoAdapter(),
      }),
    });

    try {
      const created = await repository.create({
        taskId: null,
        routineId: null,
        calendarBlockId: null,
        phase: "planned",
        startedAt: null,
        endedAt: null,
        durationSeconds: 1500,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      expect(await repository.remove(created.value.id)).toEqual({ ok: true, value: true });
      expect(writes.map((write) => write.operation)).toEqual(["create"]);
      expect(await repository.getById(created.value.id)).toMatchObject({
        ok: false,
        error: { code: "not-found" },
      });
    } finally {
      keySession.lock();
    }
  });
});
