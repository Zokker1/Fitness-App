// T181: idempotentti XPTransaction. Sama suoritus ei voi antaa XP:tä kahdesti
// retryllä/syncillä.
// - palkkioavain (source + sourceEntityId) → deterministinen tapahtuma-id;
// - uudelleenyritys (retry) palauttaa olemassa olevan tapahtuman, ei uutta riviä;
// - vanhalla satunnais-id:llä luotu rivi tunnetaan edelleen (legacy + sync-merge);
// - kahden "replikan" palkkiot yhdistyvät yhdeksi tapahtumaksi id:n kautta.
import { describe, expect, it } from "vitest";
import {
  InMemoryStore,
  completeTaskService,
  createEntityRepository,
  createTask,
  createXpAward,
  fixedClock,
  findXpAward,
  reopenTaskService,
  sequentialIdGenerator,
  xpAwardEventId,
  type Clock,
  type IdGenerator,
  type TaskServiceDeps,
  type XPTransaction,
} from "../src/index.ts";
import type { Task } from "@lifeos/domain";

const AT = "2026-09-23T08:00:00.000Z";

function ledgerSetup(prefix = "x") {
  const clock: Clock = fixedClock(AT);
  const ids: IdGenerator = sequentialIdGenerator(prefix);
  const store = new InMemoryStore<XPTransaction>("xp-transaction");
  const repo = createEntityRepository<XPTransaction>(store, { clock, ids });
  return { clock, ids, store, repo };
}

describe("xpAwardEventId (T181)", () => {
  it("deterministinen palkkioavain", () => {
    const key = { source: "task" as const, sourceEntityId: "task-1" };
    expect(xpAwardEventId(key)).toBe("xp-task-task-1");
    expect(xpAwardEventId(key)).toBe(xpAwardEventId({ ...key }));
    expect(xpAwardEventId({ source: "focus", sourceEntityId: "task-1" })).not.toBe(
      xpAwardEventId(key),
    );
  });
});

describe("createXpAward (T181)", () => {
  it("luo yhden tapahtuman ja palauttaa awarded-tuloksen", async () => {
    const { store, repo } = ledgerSetup();
    const result = await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-1",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("awarded");
    if (result.value.kind !== "awarded") return;
    expect(result.value.transaction.id).toBe("xp-task-task-1");
    expect(result.value.transaction.amount).toBe(10);
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("retry ei tuota toista riviä vaan duplicate-tyypin", async () => {
    const { store, repo } = ledgerSetup();
    const input = {
      source: "routine" as const,
      sourceEntityId: "run-9",
      amount: 5,
      earnedAt: AT,
      reason: null,
    };
    const first = await createXpAward(repo, input);
    const second = await createXpAward(repo, { ...input, amount: 99 });
    expect(first.ok && first.value.kind).toBe("awarded");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.kind).toBe("duplicate");
    if (second.value.kind !== "duplicate") return;
    expect(second.value.transaction.amount).toBe(5);
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("tunnistaa legacy-rivin joka on luotu satunnais-id:llä", async () => {
    const { store, repo } = ledgerSetup("legacy");
    await repo.create({
      source: "habit",
      sourceEntityId: "goal-day-3",
      amount: 5,
      earnedAt: AT,
      reason: "Tavoitepäivä valmis.",
    });
    const result = await createXpAward(repo, {
      source: "habit",
      sourceEntityId: "goal-day-3",
      amount: 5,
      earnedAt: AT,
      reason: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("duplicate");
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("synkka: kaksi replikkaa tuottaa saman id:n joka mergessa on yksi rivi", async () => {
    const a = ledgerSetup("rep-a");
    const b = ledgerSetup("rep-b");
    const input = {
      source: "focus" as const,
      sourceEntityId: "session-7",
      amount: 15,
      earnedAt: AT,
      reason: "Fokusjakso valmis.",
    };
    await createXpAward(a.repo, input);
    await createXpAward(b.repo, input);
    const listedA = await a.store.list();
    const listedB = await b.store.list();
    expect(listedA.ok && listedB.ok).toBe(true);
    if (!listedA.ok || !listedB.ok) return;
    // Eri generaattorit, sama palkkioavain → sama entiteetti-id.
    expect(listedA.value[0]?.id).toBe(listedB.value[0]?.id);
    // Merge (append-only union id:n mukaan) säilyttää yhden rivin.
    const merged = new Map<string, XPTransaction>();
    for (const tx of [...listedA.value, ...listedB.value]) {
      merged.set(tx.id, tx);
    }
    expect(merged.size).toBe(1);
  });

  it("eri palkkioavaimet ovat erillisiä tapahtumia", async () => {
    const { store, repo } = ledgerSetup("multi");
    await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-1",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    await createXpAward(repo, {
      source: "task",
      sourceEntityId: "task-2",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    const listed = await store.list();
    expect(listed.ok && listed.value).toHaveLength(2);
    if (!listed.ok) return;
    expect(findXpAward(listed.value, { source: "task", sourceEntityId: "task-2" })?.amount).toBe(
      10,
    );
    expect(findXpAward(listed.value, { source: "task", sourceEntityId: "task-3" })).toBeUndefined();
  });
});

describe("createWithId repository (T181)", () => {
  it("varattu id → already-exists, ei päällekirjoitusta", async () => {
    const { repo } = ledgerSetup("with-id");
    const first = await repo.createWithId("xp-task-1", {
      source: "task",
      sourceEntityId: "1",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    const second = await repo.createWithId("xp-task-1", {
      source: "task",
      sourceEntityId: "1",
      amount: 99,
      earnedAt: AT,
      reason: null,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("already-exists");
    }
    const fetched = await repo.getById("xp-task-1");
    expect(fetched.ok && fetched.value.amount).toBe(10);
  });

  it("virheellinen id hylätään", async () => {
    const { repo } = ledgerSetup("bad-id");
    const result = await repo.createWithId("", {
      source: "task",
      sourceEntityId: "1",
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    expect(result.ok).toBe(false);
  });
});

describe("palveluketjun idempotenssi retryllä (T181)", () => {
  it("completeTaskService kahdesti (ilman reopenia) ei anna XP:tä uudestaan", async () => {
    const clock: Clock = fixedClock(AT);
    const ids = sequentialIdGenerator("svc");
    const taskStore = new InMemoryStore<Task>("task");
    const xpStore = new InMemoryStore<XPTransaction>("xp-transaction");
    const deps: TaskServiceDeps = {
      clock,
      tasks: createEntityRepository<Task>(taskStore, { clock, ids }),
      xpTransactions: createEntityRepository<XPTransaction>(xpStore, { clock, ids }),
    };
    const created = await createTask(deps, { title: "T181-tehtävä" });
    if (!created.ok) throw new Error("luonti epäonnistui");
    const xpRepo = deps.xpTransactions;
    if (xpRepo === undefined) throw new Error("XP-repo puuttuu");
    await completeTaskService(deps, created.value.id);
    // Toisto suoraan ledger-kautta (simuloi retrytä samalle suoritukselle).
    await createXpAward(xpRepo, {
      source: "task",
      sourceEntityId: created.value.id,
      amount: 10,
      earnedAt: AT,
      reason: null,
    });
    await reopenTaskService(deps, created.value.id);
    await completeTaskService(deps, created.value.id);
    const listed = await xpStore.list();
    expect(listed.ok && listed.value).toHaveLength(1);
    if (!listed.ok) return;
    expect(listed.value[0]?.id).toBe(`xp-task-${created.value.id}`);
  });
});
