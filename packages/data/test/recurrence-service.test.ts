// T110: completeTaskService + toistuvuus (data-paketti, muististore).
// Kriteeri: toistuvan tehtävän valmistuminen luo seuraavan instanssin
// deterministisesti (sama sisältö, uusi id, seuraava paikallispäivä samalla
// kelloajalla); ei-toistuva ei luo ylimääräistä riviä; ilman offsetia ei
// arvata aikavyöhykettä (§50).
import {
  InMemoryStore,
  completeTaskService,
  createEntityRepository,
  createTask,
  fixedClock,
  sequentialIdGenerator,
  type Clock,
} from "@lifeos/data";
import { describe, expect, it } from "vitest";
import type { Task } from "@lifeos/domain";

const AT = "2026-09-18T12:00:00.000Z";

function depsWith(store: InMemoryStore<Task>, clock: Clock) {
  return {
    clock,
    tasks: createEntityRepository<Task>(store, {
      clock,
      ids: sequentialIdGenerator("t110"),
    }),
  };
}

async function seedDailyTask(clock: Clock): Promise<{
  store: InMemoryStore<Task>;
  deps: ReturnType<typeof depsWith>;
  id: string;
}> {
  const store = new InMemoryStore<Task>("task");
  const deps = depsWith(store, clock);
  const created = await createTask(deps, {
    title: "T110-päivittäinen",
    dueAt: "2026-09-18T09:30:00.000Z", // 12:30 paikallista (+180)
    recurrence: { kind: "daily", everyDays: 1 },
  });
  if (!created.ok) {
    throw new Error("seed epäonnistui");
  }
  return { store, deps, id: created.value.id };
}

describe("completeTaskService + recurrence (T110)", () => {
  it("toistuva: valmistuu JA seuraava instanssi syntyy samalla paikallisajalla", async () => {
    const clock = fixedClock(AT);
    const { deps, id } = await seedDailyTask(clock);
    const done = await completeTaskService(deps, id, { timezoneOffsetMinutes: 180 });
    expect(done.ok).toBe(true);

    const listed = await storeList(deps);
    expect(listed).toHaveLength(2);
    const completed = listed.find((task) => task.id === id);
    const next = listed.find((task) => task.id !== id);
    expect(completed?.status).toBe("done");
    expect(next?.status).toBe("open");
    // Sama paikallinen kelloaika seuraavana päivänä: 19.9. 12:30 (+180) = 09:30Z.
    expect(next?.dueAt).toBe("2026-09-19T09:30:00.000Z");
    expect(next?.title).toBe("T110-päivittäinen");
    expect(next?.recurrence).toEqual({ kind: "daily", everyDays: 1 });
    expect(next?.completedAt).toBeNull();
    expect(next?.id).not.toBe(id);
  });

  it("ei-toistuva: valmistuu ilman uutta instanssia", async () => {
    const clock = fixedClock(AT);
    const store = new InMemoryStore<Task>("task");
    const deps = depsWith(store, clock);
    const created = await createTask(deps, { title: "T110-kertaluontoinen" });
    if (!created.ok) {
      throw new Error("seed epäonnistui");
    }
    const done = await completeTaskService(deps, created.value.id, {
      timezoneOffsetMinutes: 180,
    });
    expect(done.ok).toBe(true);
    const listed = await storeList(deps);
    expect(listed).toHaveLength(1);
  });

  it("ilman offsetia: valmistuu mutta ei arvaa aikavyöhykettä (ei uutta instanssia)", async () => {
    const clock = fixedClock(AT);
    const { deps, id } = await seedDailyTask(clock);
    const done = await completeTaskService(deps, id);
    expect(done.ok).toBe(true);
    const listed = await storeList(deps);
    expect(listed).toHaveLength(1);
  });
});

async function storeList(deps: ReturnType<typeof depsWith>): Promise<readonly Task[]> {
  const listed = await deps.tasks.list();
  if (!listed.ok) {
    throw new Error("listaus epäonnistui");
  }
  return listed.value;
}
