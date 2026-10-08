// T185: quest engine (§9 ehto/ajanjakso/progress/claim, §51 reiluus).
// - ehto: event-count (esim. 3 fokus-sessiota) ja active-day-count
//   (esim. vettä 5 päivänä) + minimimääräsuodatin;
// - ajanjakso: vain ikkunan sisällä syntyneet suoritukset täyttävät ehdon;
// - progress: eventId-deduplointi → retry/synkka ei tuplaa (T181-henki);
// - claim/completion: idempotentti, myöhäinen claim sallittu (§57.14),
//   tavoittamaton/alkamaton/expired claim hylätään.
import { describe, expect, it } from "vitest";
import type { Quest, QuestProgress } from "@lifeos/domain";
import {
  InMemoryStore,
  claimQuestService,
  computeQuestProgress,
  createEntityRepository,
  evaluateQuestState,
  fixedClock,
  sequentialIdGenerator,
  updateQuestProgressService,
  type QuestCondition,
  type QuestEventSample,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";
const EARLIER = "2026-09-10T12:00:00.000Z";
const LATER = "2026-09-25T12:00:00.000Z";

function event(eventId: string, at: string, amount?: number): QuestEventSample {
  return { eventId, at, amount };
}

function setup() {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator("q");
  const quests = createEntityRepository<Quest>(new InMemoryStore<Quest>("quest"), {
    clock,
    ids,
  });
  const questProgress = createEntityRepository<QuestProgress>(
    new InMemoryStore<QuestProgress>("quest-progress"),
    { clock, ids },
  );
  return { clock, ids, quests, questProgress, deps: { clock, quests, questProgress } };
}

async function seedQuest(
  deps: ReturnType<typeof setup>["deps"],
  window: { activeFrom: string | null; activeUntil: string | null },
  progress: { progress: number; goal: number; completedAt?: string | null },
  condition: QuestCondition | null = null,
) {
  const quest = await deps.quests.create({
    title: "Viikon haaste",
    description: null,
    activeFrom: window.activeFrom,
    activeUntil: window.activeUntil,
    condition,
  });
  if (!quest.ok) throw new Error("questin luonti epäonnistui");
  const row = await deps.questProgress.create({
    questId: quest.value.id,
    progress: progress.progress,
    goal: progress.goal,
    completedAt: progress.completedAt ?? null,
  });
  if (!row.ok) throw new Error("progress-rivin luonti epäonnistui");
  return { quest: quest.value, row: row.value };
}

describe("computeQuestProgress (T185)", () => {
  const threeFocus: QuestCondition = { kind: "event-count", goal: 3 };

  it("event-count: tapahtumamäärä → maali", () => {
    const snapshot = computeQuestProgress(threeFocus, [event("e-1", AT), event("e-2", AT)]);
    expect(snapshot).toEqual({ progress: 2, goal: 3, complete: false });
    const done = computeQuestProgress(threeFocus, [
      event("e-1", AT),
      event("e-2", AT),
      event("e-3", AT),
      event("e-4", AT),
    ]);
    // Progress clampataan maaliin (ei 4/3).
    expect(done).toEqual({ progress: 3, goal: 3, complete: true });
  });

  it("active-day-count: eri päivät lasketaan, sama päivä kerran", () => {
    const water: QuestCondition = { kind: "active-day-count", goal: 5 };
    const snapshot = computeQuestProgress(water, [
      event("e-1", "2026-09-14T08:00:00.000Z"),
      event("e-2", "2026-09-14T20:00:00.000Z"),
      event("e-3", "2026-09-15T08:00:00.000Z"),
    ]);
    expect(snapshot).toEqual({ progress: 2, goal: 5, complete: false });
  });

  it("retry/synkka: sama eventId lasketaan vain kerran", () => {
    const duplicated = computeQuestProgress(threeFocus, [
      event("e-1", AT),
      event("e-1", AT),
      event("e-2", AT),
    ]);
    expect(duplicated).toEqual({ progress: 2, goal: 3, complete: false });
  });

  it("minimimäärä suodattaa pienet tapahtumat", () => {
    const longFocus: QuestCondition = {
      kind: "event-count",
      goal: 2,
      minimumAmount: 1500,
    };
    const snapshot = computeQuestProgress(longFocus, [
      event("e-1", AT, 1500),
      event("e-2", AT, 600),
    ]);
    expect(snapshot).toEqual({ progress: 1, goal: 2, complete: false });
  });

  it("ajanjakso: ikkunan ulkopuoliset eivät täytä ehtoa", () => {
    const window = { activeFrom: EARLIER, activeUntil: LATER };
    const snapshot = computeQuestProgress(
      threeFocus,
      [
        event("e-before", "2026-09-09T12:00:00.000Z"),
        event("e-in", AT),
        event("e-after", "2026-09-26T12:00:00.000Z"),
      ],
      { window },
    );
    expect(snapshot).toEqual({ progress: 1, goal: 3, complete: false });
  });

  it("hylätty ehto heittää RangeError:n", () => {
    expect(() => computeQuestProgress({ kind: "event-count", goal: 0 }, [])).toThrow(RangeError);
    expect(() =>
      computeQuestProgress({ kind: "event-count", goal: 1, minimumAmount: -2 }, []),
    ).toThrow(RangeError);
  });
});

describe("evaluateQuestState (T185)", () => {
  const open = { activeFrom: null, activeUntil: null };
  const window = { activeFrom: EARLIER, activeUntil: LATER };

  it("upcoming / active / claimable / completed / expired", () => {
    expect(
      evaluateQuestState({
        window: { activeFrom: LATER, activeUntil: null },
        progress: 0,
        goal: 3,
        completedAt: null,
        now: AT,
      }),
    ).toBe("upcoming");
    expect(evaluateQuestState({ window, progress: 1, goal: 3, completedAt: null, now: AT })).toBe(
      "active",
    );
    expect(evaluateQuestState({ window, progress: 3, goal: 3, completedAt: null, now: AT })).toBe(
      "claimable",
    );
    expect(evaluateQuestState({ window, progress: 3, goal: 3, completedAt: AT, now: AT })).toBe(
      "completed",
    );
    expect(
      evaluateQuestState({
        window: { activeFrom: EARLIER, activeUntil: AT },
        progress: 1,
        goal: 3,
        completedAt: null,
        now: LATER,
      }),
    ).toBe("expired");
  });

  it("myöhäinen claim sallitaan: maaliin ehditty ennen ikkunan loppua", () => {
    expect(
      evaluateQuestState({
        window: { activeFrom: EARLIER, activeUntil: AT },
        progress: 3,
        goal: 3,
        completedAt: null,
        now: LATER,
      }),
    ).toBe("claimable");
  });

  it("ikkunaton quest on aina aktiivinen", () => {
    expect(
      evaluateQuestState({ window: open, progress: 0, goal: 2, completedAt: null, now: AT }),
    ).toBe("active");
  });
});

describe("quest services (T185)", () => {
  const condition: QuestCondition = { kind: "event-count", goal: 2 };

  it("updateQuestProgressService tallentaa derivoidun snapshotin", async () => {
    const { deps } = setup();
    const { row } = await seedQuest(
      deps,
      { activeFrom: null, activeUntil: null },
      {
        progress: 0,
        goal: 2,
      },
    );
    const updated = await updateQuestProgressService(deps, {
      progressId: row.id,
      condition,
      events: [event("e-1", AT), event("e-2", AT)],
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value.progress).toBe(2);
      expect(updated.value.version).toBe(2);
    }
    // Uusi laskenta samalla datalla → ei turhaa versiobumpia.
    const again = await updateQuestProgressService(deps, {
      progressId: row.id,
      condition,
      events: [event("e-1", AT), event("e-2", AT), event("e-1", AT)],
    });
    expect(again.ok && again.value.version).toBe(2);
  });

  it("käyttää questille tallennettua sääntöä ja sen vähimmäismäärää", async () => {
    const { deps } = setup();
    const storedCondition: QuestCondition = {
      kind: "event-count",
      goal: 3,
      minimumAmount: 300,
    };
    const { row } = await seedQuest(
      deps,
      { activeFrom: null, activeUntil: null },
      { progress: 0, goal: 3 },
      storedCondition,
    );
    const updated = await updateQuestProgressService(deps, {
      progressId: row.id,
      events: [event("small", AT, 200), event("first", AT, 300), event("second", EARLIER, 500)],
    });
    expect(updated.ok).toBe(true);
    if (updated.ok) {
      expect(updated.value).toMatchObject({ progress: 2, goal: 3 });
    }
  });

  it("vanhan ehdottoman questin etenemä vaatii edelleen eksplisiittisen fallback-ehdon", async () => {
    const { deps } = setup();
    const { row } = await seedQuest(
      deps,
      { activeFrom: null, activeUntil: null },
      { progress: 0, goal: 1 },
    );
    const missing = await updateQuestProgressService(deps, {
      progressId: row.id,
      events: [event("event", AT)],
    });
    expect(missing).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.quest.condition.missing" },
    });
    const fallback = await updateQuestProgressService(deps, {
      progressId: row.id,
      condition: { kind: "event-count", goal: 1 },
      events: [event("event", AT)],
    });
    expect(fallback.ok && fallback.value.progress).toBe(1);
  });

  it("claim on idempotentti: claimed → duplicate, snapshot säilyy", async () => {
    const { deps } = setup();
    const { row } = await seedQuest(
      deps,
      { activeFrom: null, activeUntil: null },
      {
        progress: 2,
        goal: 2,
      },
    );
    const first = await claimQuestService(deps, { progressId: row.id });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("claimed");
    expect(first.value.progress.completedAt).toBe(AT);

    const retry = await claimQuestService(deps, { progressId: row.id });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.kind).toBe("duplicate");
    expect(retry.value.progress.completedAt).toBe(AT);
    expect(retry.value.progress.version).toBe(2);
  });

  it("claim hylätään ennen maalia, ennen alkua ja expired-tilassa", async () => {
    const { deps } = setup();
    const before = await seedQuest(
      deps,
      { activeFrom: null, activeUntil: null },
      {
        progress: 1,
        goal: 2,
      },
    );
    const notYet = await claimQuestService(deps, { progressId: before.row.id });
    expect(notYet.ok).toBe(false);
    if (!notYet.ok) {
      expect(notYet.error.diagnosticCode).toBe("data.quest.claim.active");
    }

    const upcoming = await seedQuest(
      deps,
      { activeFrom: LATER, activeUntil: null },
      {
        progress: 0,
        goal: 2,
      },
    );
    const tooEarly = await claimQuestService(deps, { progressId: upcoming.row.id });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) {
      expect(tooEarly.error.diagnosticCode).toBe("data.quest.claim.upcoming");
    }

    const expired = await seedQuest(
      deps,
      { activeFrom: EARLIER, activeUntil: AT },
      {
        progress: 1,
        goal: 2,
      },
    );
    const tooLate = await claimQuestService(deps, {
      progressId: expired.row.id,
      at: LATER,
    });
    expect(tooLate.ok).toBe(false);
    if (!tooLate.ok) {
      expect(tooLate.error.diagnosticCode).toBe("data.quest.claim.expired");
    }
  });

  it("tuntematon progress-rivi → not-found", async () => {
    const { deps } = setup();
    const missing = await claimQuestService(deps, { progressId: "q-9999" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("not-found");
    }
  });
});
