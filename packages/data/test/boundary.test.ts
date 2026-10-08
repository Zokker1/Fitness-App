// T033: repository/service-boundaryn unit-testit (T032-sopimus lukittuna).
// Deterministinen kello + sarja-ID:t; muististore toteutuksena.
import { describe, expect, it } from "vitest";
import type { FocusSession, Task } from "@lifeos/domain";
import {
  InMemoryStore,
  InMemoryUnitOfWork,
  completeTaskService,
  createEntityRepository,
  createTask,
  fixedClock,
  moveFocusSession,
  reopenTaskService,
  sequentialIdGenerator,
  startFocusSession,
} from "../src/index.ts";

const AT = "2026-09-15T12:00:00.000Z";

function taskSetup(prefix = "t") {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  const store = new InMemoryStore<Task>("task");
  const repo = createEntityRepository<Task>(store, { clock, ids });
  return { clock, ids, store, repo, deps: { clock, tasks: repo } };
}

describe("repository invariantit", () => {
  it("create täyttää id/kello/version", async () => {
    const { repo } = taskSetup();
    const created = await repo.create({ title: "Rajapinta" } as Omit<
      Task,
      "id" | "createdAt" | "updatedAt" | "version"
    >);
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.id).toBe("t-0001");
      expect(created.value.createdAt).toBe(AT);
      expect(created.value.updatedAt).toBe(AT);
      expect(created.value.version).toBe(1);
    }
  });

  it("update kasvattaa version ja suojaa id/createdAt", async () => {
    const { repo } = taskSetup();
    await repo.create({ title: "A" } as Omit<Task, "id" | "createdAt" | "updatedAt" | "version">);
    const updated = await repo.update("t-0001", { title: "B" });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.version).toBe(2);
      expect(updated.value.id).toBe("t-0001");
      expect(updated.value.createdAt).toBe(AT);
    }
  });

  it("tuntematon getById/remove -> not-found", async () => {
    const { repo } = taskSetup();
    expect((await repo.getById("t-9999")).ok).toBe(false);
    const removed = await repo.remove("t-9999");
    expect(removed.ok).toBe(false);
    if (!removed.ok) {
      expect(removed.error.code).toBe("not-found");
    }
  });

  it("transaktio-rollback säilyttää eheyden", async () => {
    const clock = fixedClock(AT);
    const ids = sequentialIdGenerator("r");
    const store = new InMemoryStore<Task>("task");
    const repo = createEntityRepository<Task>(store, { clock, ids });
    await repo.create({ title: "Ennen" } as Omit<
      Task,
      "id" | "createdAt" | "updatedAt" | "version"
    >);
    const uow = new InMemoryUnitOfWork([store]);
    await expect(
      uow.runInTransaction(async () => {
        await repo.create({ title: "Sisällä" } as Omit<
          Task,
          "id" | "createdAt" | "updatedAt" | "version"
        >);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const after = await repo.list();
    expect(after.ok && after.value.length).toBe(1);
  });
});

describe("task service", () => {
  it("hylkää tyhjän otsikon", async () => {
    const { deps } = taskSetup();
    const result = await createTask(deps, { title: "   " });
    expect(result.ok).toBe(false);
  });

  it("complete/reopen-kierto toimii ja tupla hylätään", async () => {
    const { deps } = taskSetup();
    const created = await createTask(deps, { title: "Siivous" });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const done = await completeTaskService(deps, created.value.id);
    expect(done.ok && done.value.status).toBe("done");
    expect((await completeTaskService(deps, created.value.id)).ok).toBe(false);
    const reopened = await reopenTaskService(deps, created.value.id);
    expect(reopened.ok && reopened.value.status).toBe("open");
    expect((await reopenTaskService(deps, created.value.id)).ok).toBe(false);
  });
});

describe("focus service", () => {
  it("planned -> running -> completed täyttää ajat", async () => {
    const clock = fixedClock(AT);
    const ids = sequentialIdGenerator("f");
    const store = new InMemoryStore<FocusSession>("focus-session");
    const repo = createEntityRepository<FocusSession>(store, { clock, ids });
    const deps = { clock, sessions: repo };
    const started = await startFocusSession(deps, {});
    expect(started.ok && started.value.phase).toBe("planned");
    if (!started.ok) {
      return;
    }
    const running = await moveFocusSession(deps, started.value.id, "running");
    expect(running.ok && running.value.startedAt).toBe(AT);
    const done = await moveFocusSession(deps, started.value.id, "completed");
    expect(done.ok && done.value.endedAt).toBe(AT);
    expect((await moveFocusSession(deps, started.value.id, "running")).ok).toBe(false);
  });
});
