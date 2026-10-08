// T100: deleteTaskService/restoreTaskService unit-testit (muististore,
// deterministinen kello + sarja-ID:t). Kriteeri: delete merkitsee tombstonen
// historian säilyttäen, restore palauttaa avoimeksi, idempotenssi virheenä,
// completed-tehtävän poisto sallittu (tombstone ei koske statusa).
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";
import {
  createEntityRepository,
  createTask,
  deleteTaskService,
  fixedClock,
  InMemoryStore,
  restoreTaskService,
  sequentialIdGenerator,
} from "../src/index.ts";

const AT = "2026-09-15T12:00:00.000Z";

function setup() {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator("t");
  const store = new InMemoryStore<Task>("task");
  const repo = createEntityRepository<Task>(store, { clock, ids });
  return { clock, store, repo, deps: { clock, tasks: repo } };
}

describe("delete/restore service (T100)", () => {
  it("poisto merkitsee tombstonen historian säilyttäen (status/version säilyy)", async () => {
    const { deps, repo } = setup();
    const created = await createTask(deps, { title: "Poistettava" });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      return;
    }
    const id = created.value.id;
    const versionBefore = created.value.version;

    const deleted = await deleteTaskService(deps, id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) {
      return;
    }
    // Tombstone: deletedAt asetettu, muu historia ennallaan.
    expect(deleted.value.deletedAt).toBe(AT);
    expect(deleted.value.deletedAt).toBe(deleted.value.updatedAt);
    expect(deleted.value.status).toBe("open");
    expect(deleted.value.title).toBe("Poistettava");
    expect(deleted.value.version).toBe(versionBefore + 1);

    // Rivi yhä kannassa (ei kovapoistoa).
    const listed = await repo.list();
    expect(listed.ok && listed.value.length).toBe(1);
  });

  it("restore palauttaa tombstonen tyhjäksi; avoin hylätään", async () => {
    const { deps } = setup();
    const created = await createTask(deps, { title: "Palautettava" });
    if (!created.ok) {
      return;
    }
    const id = created.value.id;
    await deleteTaskService(deps, id);

    const restored = await restoreTaskService(deps, id);
    expect(restored.ok).toBe(true);
    if (!restored.ok) {
      return;
    }
    expect(restored.value.deletedAt).toBeNull();

    // Restore avoimeen (ei tombstonea) hylätään.
    expect((await restoreTaskService(deps, id)).ok).toBe(false);
  });

  it("tupla-delete hylätään (idempotenssi virheenä, ei hiljaista ok:ta)", async () => {
    const { deps } = setup();
    const created = await createTask(deps, { title: "Kertaalleen" });
    if (!created.ok) {
      return;
    }
    const id = created.value.id;
    const first = await deleteTaskService(deps, id);
    expect(first.ok).toBe(true);
    const second = await deleteTaskService(deps, id);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.diagnosticCode).toBe("data.task.delete.invalid-transition");
    }
  });

  it("completed-tehtävän poisto säilyttää completedAt:n (historia ei häviy)", async () => {
    const { deps } = setup();
    const created = await createTask(deps, { title: "Valmis ennen poistoa" });
    if (!created.ok) {
      return;
    }
    const completedAt = "2026-09-14T10:00:00.000Z";
    await deps.tasks.update(created.value.id, {
      status: "done",
      completedAt,
    });
    const deleted = await deleteTaskService(deps, created.value.id);
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) {
      return;
    }
    expect(deleted.value.status).toBe("done");
    expect(deleted.value.completedAt).toBe(completedAt);
    expect(deleted.value.deletedAt).toBe(AT);
  });
});
