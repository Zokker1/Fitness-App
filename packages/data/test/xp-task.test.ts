// T117: completion → XP-tapahtuma unit-testit (data-paketti, muististore).
// Kriteeri: completion tuottaa sääntöjen mukaisen XP-tapahtuman
// idempotentisti.
// - Valmistuminen → yksi XP (source "task", sourceEntityId, amount 10,
//   earnedAt = valmistumishetki);
// - reopen + uudelleen valmistuminen → EI uutta XP:tä (ei XP-farmia §9);
// - XP-repo puuttuu → valmistuminen onnistuu ilman XP:tä (vanhat kutsujat).
import { describe, expect, it } from "vitest";
import {
  InMemoryStore,
  completeTaskService,
  createEntityRepository,
  createTask,
  fixedClock,
  reopenTaskService,
  sequentialIdGenerator,
  TASK_COMPLETION_XP,
  createXpRules,
  type Clock,
  type TaskServiceDeps,
  type XpRules,
  type XPTransaction,
} from "@lifeos/data";
import type { Task } from "@lifeos/domain";

const AT = "2026-09-18T12:00:00.000Z";

function makeDeps(options: { readonly withXp: boolean; readonly xpRules?: XpRules }): {
  store: InMemoryStore<Task>;
  xpStore: InMemoryStore<XPTransaction>;
  deps: TaskServiceDeps;
} {
  const store = new InMemoryStore<Task>("task");
  const xpStore = new InMemoryStore<XPTransaction>("xp-transaction");
  const clock: Clock = fixedClock(AT);
  const base = { clock, ids: sequentialIdGenerator("t117") };
  const deps: TaskServiceDeps = {
    clock,
    tasks: createEntityRepository<Task>(store, base),
    ...(options.withXp
      ? { xpTransactions: createEntityRepository<XPTransaction>(xpStore, base) }
      : {}),
    ...(options.xpRules === undefined ? {} : { xpRules: options.xpRules }),
  };
  return { store, xpStore, deps };
}

async function seedTask(deps: TaskServiceDeps): Promise<string> {
  const created = await createTask(deps, { title: "T117-tehtävä" });
  if (!created.ok) {
    throw new Error("seed epäonnistui");
  }
  return created.value.id;
}

describe("completeTaskService + XP (T117)", () => {
  it("valmistuminen luo yhden XP-tapahtuman (10 XP, lähde task)", async () => {
    const { xpStore, deps } = makeDeps({ withXp: true });
    const id = await seedTask(deps);
    const done = await completeTaskService(deps, id);
    if (!done.ok) {
      throw new Error("valmistuminen epäonnistui");
    }
    expect(done.value.status).toBe("done");
    const listed = await xpStore.list();
    expect(listed.ok && listed.value).toHaveLength(1);
    if (!listed.ok) {
      return;
    }
    const tx = listed.value[0];
    if (tx === undefined) {
      throw new Error("XP puuttuu");
    }
    expect(tx.source).toBe("task");
    expect(tx.sourceEntityId).toBe(id);
    expect(tx.amount).toBe(TASK_COMPLETION_XP);
    expect(tx.amount).toBe(10);
    expect(tx.earnedAt).toBe(AT);
  });

  it("idempotentti: reopen + uudelleen valmistuminen ei tee toista XP:tä", async () => {
    const { xpStore, deps } = makeDeps({ withXp: true });
    const id = await seedTask(deps);
    await completeTaskService(deps, id);
    const reopened = await reopenTaskService(deps, id);
    expect(reopened.ok).toBe(true);
    await completeTaskService(deps, id);
    const listed = await xpStore.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("XP-repo puuttuu → valmistuminen onnistuu ilman XP:tä", async () => {
    const { xpStore, deps } = makeDeps({ withXp: false });
    const id = await seedTask(deps);
    const done = await completeTaskService(deps, id);
    if (!done.ok) {
      throw new Error("valmistuminen epäonnistui");
    }
    expect(done.value.status).toBe("done");
    const listed = await xpStore.list();
    expect(listed.ok && listed.value).toHaveLength(0);
  });

  it("käyttää injektoitua XP-sääntöä palvelukerroksessa", async () => {
    const { xpStore, deps } = makeDeps({
      withXp: true,
      xpRules: createXpRules({ taskCompletion: 22 }),
    });
    const id = await seedTask(deps);
    await completeTaskService(deps, id);
    const listed = await xpStore.list();
    expect(listed.ok && listed.value[0]?.amount).toBe(22);
  });
});

describe("TASK_COMPLETION_XP (T117)", () => {
  it("sääntö: 10 XP per tehtävä (sama kuin seed-datassa)", () => {
    expect(TASK_COMPLETION_XP).toBe(10);
  });
});
