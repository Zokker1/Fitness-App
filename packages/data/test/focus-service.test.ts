// T160: FocusSession-palvelun nimetty elinkaari ja repository-persistenssi.
import { describe, expect, it } from "vitest";
import type { FocusSession } from "@lifeos/domain";
import {
  InMemoryStore,
  beginFocusSession,
  cancelFocusSession,
  createEntityRepository,
  createXpRules,
  finishFocusSession,
  fixedClock,
  pauseFocusSession,
  resumeFocusSession,
  sequentialIdGenerator,
  startFocusSession,
  type XPTransaction,
} from "../src/index.ts";

const AT = "2026-09-21T08:00:00.000Z";

function setup() {
  const clock = fixedClock(AT);
  const store = new InMemoryStore<FocusSession>("focus-session");
  const repo = createEntityRepository<FocusSession>(store, {
    clock,
    ids: sequentialIdGenerator("focus"),
  });
  return { clock, store, repo, deps: { clock, sessions: repo } };
}

describe("FocusSession service", () => {
  it("persistoi eksplisiittisen start/pause/resume/finish-elinkaaren", async () => {
    const { clock, store, deps } = setup();
    const planned = await startFocusSession(deps, { plannedSeconds: 1500 });

    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.value.phase).toBe("planned");
    expect(planned.value.version).toBe(1);
    expect(planned.value.durationSeconds).toBe(1500);

    const running = await beginFocusSession(deps, planned.value.id);
    expect(running.ok).toBe(true);
    if (!running.ok) return;
    expect(running.value.phase).toBe("running");
    expect(running.value.startedAt).toBe(AT);
    expect(running.value.endedAt).toBeNull();
    expect(running.value.version).toBe(2);

    const paused = await pauseFocusSession(deps, planned.value.id);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    expect(paused.value.phase).toBe("paused");
    expect(paused.value.startedAt).toBe(AT);
    expect(paused.value.endedAt).toBeNull();
    expect(paused.value.version).toBe(3);

    const resumed = await resumeFocusSession(deps, planned.value.id);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.phase).toBe("running");
    expect(resumed.value.startedAt).toBe(AT);
    expect(resumed.value.version).toBe(4);

    const finished = await finishFocusSession(deps, planned.value.id);
    expect(finished.ok).toBe(true);
    if (!finished.ok) return;
    expect(finished.value.phase).toBe("completed");
    expect(finished.value.startedAt).toBe(AT);
    expect(finished.value.endedAt).toBe(AT);
    expect(finished.value.version).toBe(5);

    // Sama store uuden repository-instanssin läpi: elinkaari ei ole vain
    // palvelun palauttama objekti, vaan päivittynyt historia löytyy uudelleen.
    const reloaded = createEntityRepository<FocusSession>(store, {
      clock,
      ids: sequentialIdGenerator("reloaded"),
    });
    const persisted = await reloaded.getById(planned.value.id);
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;
    expect(persisted.value).toEqual(finished.value);
  });

  it("cancel säilyttää planned-istunnon historian ja estää jatkon", async () => {
    const { deps } = setup();
    const planned = await startFocusSession(deps, { plannedSeconds: 0 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const cancelled = await cancelFocusSession(deps, planned.value.id);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.value.phase).toBe("cancelled");
    expect(cancelled.value.startedAt).toBeNull();
    expect(cancelled.value.endedAt).toBe(AT);

    const resumed = await resumeFocusSession(deps, planned.value.id);
    expect(resumed.ok).toBe(false);
    if (!resumed.ok) {
      expect(resumed.error.diagnosticCode).toBe("data.focus.resume.invalid-transition");
    }
  });

  it("hylkää negatiivisen tai murto-osaisen suunnitellun keston", async () => {
    const { deps } = setup();
    expect((await startFocusSession(deps, { plannedSeconds: -1 })).ok).toBe(false);
    expect((await startFocusSession(deps, { plannedSeconds: 1.5 })).ok).toBe(false);
  });
});

describe("Focus XP rule configuration (T180)", () => {
  it("uses the configured award and shared local-day cap across sessions", async () => {
    let now = Date.parse(AT);
    const clock = { nowIso: () => new Date(now).toISOString() };
    const sessions = createEntityRepository<FocusSession>(
      new InMemoryStore<FocusSession>("focus-session"),
      { clock, ids: sequentialIdGenerator("focus-config") },
    );
    const xpStore = new InMemoryStore<XPTransaction>("xp-transaction");
    const xpTransactions = createEntityRepository<XPTransaction>(xpStore, {
      clock,
      ids: sequentialIdGenerator("focus-xp-config"),
    });
    const deps = {
      clock,
      sessions,
      xpTransactions,
      xpRules: createXpRules({
        focusCompletion: 7,
        focusMinimumActiveSeconds: 60,
        focusDailyCap: 7,
      }),
    };

    for (let index = 0; index < 2; index += 1) {
      const planned = await startFocusSession(deps, { plannedSeconds: 60 });
      if (!planned.ok) throw new Error("Fokusistunnon luonti epäonnistui");
      const running = await beginFocusSession(deps, planned.value.id);
      if (!running.ok) throw new Error("Fokusistunnon aloitus epäonnistui");
      now += 60_000;
      const completed = await finishFocusSession(deps, planned.value.id);
      if (!completed.ok) throw new Error("Fokusistunnon päättäminen epäonnistui");
    }

    const listed = await xpStore.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(1);
    expect(listed.value[0]?.amount).toBe(7);
  });
});
