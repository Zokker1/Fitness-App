// T188: Achievement engine (§9 kertasaavutukset, §51 reiluus). Kriteeri:
// kertasaavutukset ovat idempotentteja ja versionoitavia.
// - registerAchievementService: idempotentti KEY:n mukaan; sisältömuutos
//   bumpaa versiota, sama sisältö ei (versionointi);
// - earnAchievementService: kertasaavutus kerran (retry/synkka → duplicate);
//   legacy-rivi (satunnais-id) tunnistetaan;
// - listEarnedAchievementIds: ansaittujen id:t (T189-gallerian lähde).
import { describe, expect, it } from "vitest";
import type { Achievement, UserReward } from "@lifeos/domain";
import {
  InMemoryStore,
  achievementEntityId,
  achievementRewardId,
  createEntityRepository,
  earnAchievementService,
  findEarnedReward,
  fixedClock,
  listEarnedAchievementIds,
  registerAchievementService,
  sequentialIdGenerator,
  type AchievementEngineDeps,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";

function setup(prefix = "ach"): AchievementEngineDeps {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  return {
    clock,
    achievements: createEntityRepository<Achievement>(
      new InMemoryStore<Achievement>("achievement"),
      { clock, ids },
    ),
    userRewards: createEntityRepository<UserReward>(new InMemoryStore<UserReward>("user-reward"), {
      clock,
      ids,
    }),
  };
}

const FIRST = { key: "first-task", title: "Ensimmäinen tehtävä", description: "Valmis." };

describe("registerAchievementService (T188)", () => {
  it("luo määrittelyn deterministisellä id:llä", async () => {
    const deps = setup();
    const result = await registerAchievementService(deps.achievements, FIRST);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("created");
    expect(result.value.achievement.id).toBe(achievementEntityId("first-task"));
    expect(result.value.achievement.version).toBe(1);
  });

  it("idempotentti: sama sisältä → unchanged ilman versiobumpia", async () => {
    const deps = setup("same");
    await registerAchievementService(deps.achievements, FIRST);
    const retry = await registerAchievementService(deps.achievements, FIRST);
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.kind).toBe("unchanged");
    expect(retry.value.achievement.version).toBe(1);
    const listed = await deps.achievements.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("versiointi: sisältömuutos bumpaa version, ansaitut säilyvät", async () => {
    const deps = setup("ver");
    await registerAchievementService(deps.achievements, FIRST);
    const earned = await earnAchievementService(deps, {
      achievementId: achievementEntityId("first-task"),
    });
    expect(earned.ok && earned.value.kind).toBe("awarded");

    const updated = await registerAchievementService(deps.achievements, {
      ...FIRST,
      title: "Ensimmäinen tehtävä!",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.kind).toBe("updated");
    expect(updated.value.achievement.version).toBe(2);
    expect(updated.value.achievement.title).toBe("Ensimmäinen tehtävä!");
    // Ansaittu palkinto ei katoa määrittelypäivityksestä.
    const rewards = await deps.userRewards.list();
    expect(rewards.ok && rewards.value).toHaveLength(1);
  });

  it("legacy-rivi (satunnais-id, sama key) päivittyy eikä monistu", async () => {
    const deps = setup("legacy");
    await deps.achievements.create({ ...FIRST });
    const result = await registerAchievementService(deps.achievements, {
      ...FIRST,
      title: "Uusi otsikko",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("updated");
    const listed = await deps.achievements.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("kelvoton määrittely hylätään", async () => {
    const deps = setup("bad");
    const result = await registerAchievementService(deps.achievements, {
      key: "  ",
      title: "Otsikko",
      description: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnosticCode).toBe("data.achievement.register.bad-definition");
    }
  });
});

describe("earnAchievementService (T188)", () => {
  it("kertasaavutus: awarded → duplicate, yksi rivi (retry)", async () => {
    const deps = setup("earn");
    await registerAchievementService(deps.achievements, FIRST);
    const achievementId = achievementEntityId("first-task");

    const first = await earnAchievementService(deps, { achievementId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("awarded");
    expect(first.value.reward.id).toBe(achievementRewardId(achievementId));
    expect(first.value.reward.earnedAt).toBe(AT);

    const retry = await earnAchievementService(deps, { achievementId });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.kind).toBe("duplicate");
    const listed = await deps.userRewards.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("legacy-palkinto (satunnais-id) tunnistetaan → duplicate", async () => {
    const deps = setup("leg-earn");
    await registerAchievementService(deps.achievements, FIRST);
    const achievementId = achievementEntityId("first-task");
    await deps.userRewards.create({
      achievementId,
      collectibleId: null,
      earnedAt: "2026-09-01T00:00:00.000Z",
    });
    const result = await earnAchievementService(deps, { achievementId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe("duplicate");
    const listed = await deps.userRewards.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("tuntematon saavutus → not-found, ei riviä", async () => {
    const deps = setup("unknown");
    const result = await earnAchievementService(deps, { achievementId: "ach-missing" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("not-found");
    }
  });

  it("synkka: kaksi replikkaa tuottaa saman palkkioavaimen", async () => {
    const a = setup("rep-a");
    const b = setup("rep-b");
    for (const deps of [a, b]) {
      await registerAchievementService(deps.achievements, FIRST);
    }
    const achievementId = achievementEntityId("first-task");
    const first = await earnAchievementService(a, { achievementId });
    const second = await earnAchievementService(b, { achievementId });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    if (first.value.kind !== "awarded" || second.value.kind !== "awarded") return;
    // Molemmat "ansaitsevat" saman suorituksen → sama entiteetti-id (1 rivi).
    expect(second.value.reward.id).toBe(first.value.reward.id);
  });

  it("rinnakkaispalkinto (collectible) tallentuu samaan riviin", async () => {
    const deps = setup("coll");
    await registerAchievementService(deps.achievements, FIRST);
    const result = await earnAchievementService(deps, {
      achievementId: achievementEntityId("first-task"),
      collectibleId: "coll-medal",
      at: "2026-09-10T00:00:00.000Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    if (result.value.kind !== "awarded") return;
    expect(result.value.reward.collectibleId).toBe("coll-medal");
    expect(result.value.reward.earnedAt).toBe("2026-09-10T00:00:00.000Z");
  });
});

describe("listEarnedAchievementIds (T188)", () => {
  it("kerää ansaitut id:t, ohittaa pelkät collectiblet", () => {
    const rewards = [
      {
        id: "r-1",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        achievementId: "ach-1",
        collectibleId: null,
        earnedAt: AT,
      },
      {
        id: "r-2",
        createdAt: AT,
        updatedAt: AT,
        version: 1,
        achievementId: null,
        collectibleId: "coll-1",
        earnedAt: AT,
      },
    ] as readonly UserReward[];
    expect([...listEarnedAchievementIds(rewards)]).toEqual(["ach-1"]);
    expect(findEarnedReward(rewards, "ach-1")?.id).toBe("r-1");
    expect(findEarnedReward(rewards, "ach-2")).toBeUndefined();
  });
});
