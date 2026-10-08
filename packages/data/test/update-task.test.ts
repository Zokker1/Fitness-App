// T112: updateTaskService unit-testit (data-paketti, muististore).
// Kriteeri: kaikki kentät selkeästi muokattavissa — vain mukana olleet
// kentät päivittyvät, otsikko validoidaan, versio kasvaa, historia säilyy
// (createdAt/alkuperäiset kentät ennallaan ilman patchia).
import { describe, expect, it } from "vitest";
import {
  InMemoryStore,
  createEntityRepository,
  createTask,
  fixedClock,
  sequentialIdGenerator,
  updateTaskService,
  type Clock,
} from "@lifeos/data";
import type { Task } from "@lifeos/domain";

const AT = "2026-09-18T12:00:00.000Z";

function makeDeps(): {
  store: InMemoryStore<Task>;
  deps: ReturnType<typeof buildDeps>;
} {
  const store = new InMemoryStore<Task>("task");
  return { store, deps: buildDeps(store) };
}

function buildDeps(store: InMemoryStore<Task>) {
  const clock: Clock = fixedClock(AT);
  return {
    clock,
    tasks: createEntityRepository<Task>(store, {
      clock,
      ids: sequentialIdGenerator("t112"),
    }),
  };
}

async function seed(): Promise<ReturnType<typeof makeDeps> & { id: string }> {
  const { store, deps } = makeDeps();
  const created = await createTask(deps, {
    title: "Alkuperäinen",
    notes: "Vanha muistiinpano",
    priority: "normal",
    dueAt: "2026-09-18T15:00:00.000Z",
    estimateMinutes: 25,
  });
  if (!created.ok) {
    throw new Error("seed epäonnistui");
  }
  return { store, deps, id: created.value.id };
}

describe("updateTaskService (T112)", () => {
  it("päivittää vain mukana olevat kentät; version kasvaa; createdAt säilyy", async () => {
    const ctx = await seed();
    const before = await ctx.deps.tasks.getById(ctx.id);
    if (!before.ok) {
      throw new Error("seed puuttuu");
    }
    const updated = await updateTaskService(ctx.deps, ctx.id, {
      title: "Muokattu otsikko",
      priority: "high",
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.title).toBe("Muokattu otsikko");
      expect(updated.value.priority).toBe("high");
      // Ei-mukana olleet kentät ennallaan.
      expect(updated.value.notes).toBe("Vanha muistiinpano");
      expect(updated.value.estimateMinutes).toBe(25);
      expect(updated.value.dueAt).toBe("2026-09-18T15:00:00.000Z");
      expect(updated.value.createdAt).toBe(before.value.createdAt);
      expect(updated.value.version).toBe(before.value.version + 1);
    }
  });

  it("tyhjä otsikko → validointivirhe, ei muutosta", async () => {
    const ctx = await seed();
    const updated = await updateTaskService(ctx.deps, ctx.id, { title: "   " });
    expect(updated.ok).toBe(false);
    const listed = await ctx.deps.tasks.list();
    expect(listed.ok && listed.value[0]?.title).toBe("Alkuperäinen");
  });

  it("dueAt null → deadline poistuu; arvio voidaan tyhjentää", async () => {
    const ctx = await seed();
    const updated = await updateTaskService(ctx.deps, ctx.id, {
      dueAt: null,
      estimateMinutes: null,
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.dueAt).toBeNull();
      expect(updated.value.estimateMinutes).toBeNull();
    }
  });

  it("toistuvuus ja linkitykset päivittyvät", async () => {
    const ctx = await seed();
    const updated = await updateTaskService(ctx.deps, ctx.id, {
      recurrence: { kind: "weekly", everyWeeks: 1, weekdays: [1] },
      projectId: "project-9",
      tagIds: ["tag-1"],
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.recurrence).toEqual({
        kind: "weekly",
        everyWeeks: 1,
        weekdays: [1],
      });
      expect(updated.value.projectId).toBe("project-9");
      expect(updated.value.tagIds).toEqual(["tag-1"]);
    }
  });
});
