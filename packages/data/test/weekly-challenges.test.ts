// T186: weekly challenges (§9 rajatut haasteet, §25 ei tyhjiä moduuleita,
// §51 reiluus). Kriteeri: viikkotehtävät syntyvät VAIN aktivoiduista
// moduuleista.
// - planWeeklyChallenges rajaa pohjat enabledSectionsin mukaan;
// - ensureWeeklyChallenges luo quest+progress-rivit (ma–su ikkuna) ja on
//   idempotentti: retry ei luo kaksoiskappaleita (deterministinen id);
// - samalla viikolla kahdella instanssilla sama id → synkka säilyttää yhden.
import { describe, expect, it } from "vitest";
import type { Quest, QuestProgress } from "@lifeos/domain";
import {
  InMemoryStore,
  createEntityRepository,
  ensureWeeklyChallenges,
  fixedClock,
  planWeeklyChallenges,
  sequentialIdGenerator,
  WEEKLY_CHALLENGE_TEMPLATES,
  weeklyChallengeQuestId,
  type WeeklyChallengeDeps,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";
const OFFSET = 0;
// 18.9.2026 on perjantai → viikko 14.–20.9.2026 (ma–su).
const LOCAL_DATE = "2026-09-18";
const ALL_SECTIONS = ["today", "tasks", "calendar", "goals", "focus", "health", "insights"];

function setup(prefix = "wc"): WeeklyChallengeDeps {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  return {
    clock,
    quests: createEntityRepository<Quest>(new InMemoryStore<Quest>("quest"), { clock, ids }),
    questProgress: createEntityRepository<QuestProgress>(
      new InMemoryStore<QuestProgress>("quest-progress"),
      { clock, ids },
    ),
  };
}

describe("planWeeklyChallenges (T186)", () => {
  it("vain aktivoiduista moduuleista syntyneet pohjat", () => {
    const plan = planWeeklyChallenges({
      enabledSections: ["focus", "health"],
      localDate: LOCAL_DATE,
    });
    expect(plan.templates.map((template) => template.key)).toEqual([
      "focus-sessions",
      "water-days",
    ]);

    const focusOnly = planWeeklyChallenges({
      enabledSections: ["focus"],
      localDate: LOCAL_DATE,
    });
    expect(focusOnly.templates).toHaveLength(1);
    expect(focusOnly.templates[0]?.section).toBe("focus");
  });

  it("ei aktivointia → ei haasteita; ei-tunnettu osio ei laajenna mallistoa", () => {
    const empty = planWeeklyChallenges({ enabledSections: [], localDate: LOCAL_DATE });
    expect(empty.templates).toHaveLength(0);
    const unknown = planWeeklyChallenges({
      enabledSections: ["today", "calendar", "insights"],
      localDate: LOCAL_DATE,
    });
    // today/calendar/insights eivät tuota viikkojaasteita (ei tekohahmoja).
    expect(unknown.templates).toHaveLength(0);
  });

  it("viikko on paikallinen ma–su", () => {
    const plan = planWeeklyChallenges({ enabledSections: ALL_SECTIONS, localDate: LOCAL_DATE });
    expect(plan.weekStartLocalDate).toBe("2026-09-14");
    expect(plan.weekEndLocalDate).toBe("2026-09-20");
    // Eri päivä samalla viikolla → sama viikko.
    const sunday = planWeeklyChallenges({
      enabledSections: ALL_SECTIONS,
      localDate: "2026-09-20",
    });
    expect(sunday.weekStartLocalDate).toBe(plan.weekStartLocalDate);
  });
});

describe("ensureWeeklyChallenges (T186)", () => {
  it("luo quest+progress-rivit vain aktivoiduille moduuleille", async () => {
    const deps = setup();
    const result = await ensureWeeklyChallenges(deps, {
      enabledSections: ["focus", "tasks"],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instances.map((instance) => instance.template.key)).toEqual([
      "focus-sessions",
      "task-completions",
    ]);
    expect(result.value.createdQuestIds).toHaveLength(2);

    const quests = await deps.quests.list();
    expect(quests.ok && quests.value).toHaveLength(2);
    const progress = await deps.questProgress.list();
    expect(progress.ok && progress.value).toHaveLength(2);
    if (!progress.ok) return;
    const focus = progress.value.find(
      (row) => row.questId === weeklyChallengeQuestId("2026-09-14", "focus-sessions"),
    );
    expect(focus).toMatchObject({ progress: 0, goal: 3, completedAt: null });
  });

  it("viikon ikkuna tallentuu questille (ma 00:00 – su 23:59 UTC)", async () => {
    const deps = setup("win");
    const result = await ensureWeeklyChallenges(deps, {
      enabledSections: ["focus"],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.instances[0]?.quest).toMatchObject({
      activeFrom: "2026-09-14T00:00:00.000Z",
      activeUntil: "2026-09-20T23:59:00.000Z",
      title: "Tee 3 fokus-sessiota tällä viikolla",
      condition: { kind: "event-count", goal: 3 },
    });
  });

  it("retry on idempotentti: sama viikko ei luo kaksoiskappaleita", async () => {
    const deps = setup("retry");
    const input = {
      enabledSections: ALL_SECTIONS,
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    };
    const first = await ensureWeeklyChallenges(deps, input);
    const second = await ensureWeeklyChallenges(deps, input);
    expect(first.ok && first.value.createdQuestIds).toHaveLength(WEEKLY_CHALLENGE_TEMPLATES.length);
    expect(second.ok && second.value.createdQuestIds).toHaveLength(0);
    const quests = await deps.quests.list();
    expect(quests.ok && quests.value).toHaveLength(WEEKLY_CHALLENGE_TEMPLATES.length);
    // Identtiset id:t molemmilta kerroilta (synkka säilyttää yhden).
    if (first.ok && second.ok) {
      expect(second.value.instances.map((instance) => instance.quest.id)).toEqual(
        first.value.instances.map((instance) => instance.quest.id),
      );
    }
  });

  it("uusi viikko syntyy omilla id:llään viikon vaihtuessa", async () => {
    const deps = setup("weeks");
    const thisWeek = await ensureWeeklyChallenges(deps, {
      enabledSections: ["focus"],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    const nextWeek = await ensureWeeklyChallenges(deps, {
      enabledSections: ["focus"],
      localDate: "2026-09-25",
      timezoneOffsetMinutes: OFFSET,
    });
    expect(thisWeek.ok && thisWeek.value.createdQuestIds).toEqual([
      weeklyChallengeQuestId("2026-09-14", "focus-sessions"),
    ]);
    expect(nextWeek.ok && nextWeek.value.createdQuestIds).toEqual([
      weeklyChallengeQuestId("2026-09-21", "focus-sessions"),
    ]);
    const quests = await deps.quests.list();
    expect(quests.ok && quests.value).toHaveLength(2);
  });

  it("kahden instanssin sama viikko → sama id (synkka: yksi rivi)", async () => {
    const a = setup("rep-a");
    const b = setup("rep-b");
    const input = {
      enabledSections: ["focus"],
      localDate: LOCAL_DATE,
      timezoneOffsetMinutes: OFFSET,
    };
    const first = await ensureWeeklyChallenges(a, input);
    const second = await ensureWeeklyChallenges(b, input);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.instances[0]?.quest.id).toBe(first.value.instances[0]?.quest.id);
  });
});
