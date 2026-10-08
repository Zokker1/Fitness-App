// T190: Collectible-malli (§9 keräily ilman rahaa, §51 reiluus). Kriteeri:
// virtuaalinen keräilyesine voidaan avata saavutuksesta/levelistä.
// - registerCollectibleService: idempotentti KEY:n mukaan, sisältömuutos
//   bumpaa versiota (T188-malli);
// - evaluateCollectibleUnlocks: saavutusavain TAI levelikynnys (puhdas);
// - unlockCollectibleService: esine avataan kerran — myös T188:n saavutusrivin
//   sivukentästä avattu tunnistetaan (retry/synkka → duplicate);
// - unlockEligibleCollectiblesService: avaa automaattisesti, uudelleenajo tyhjä;
// - listUnlockedThemeKeys: teeman avaus keräyksestä (aurora §9-esimerkki).
import { describe, expect, it } from "vitest";
import type { Achievement, Collectible, UserReward } from "@lifeos/domain";
import {
  COLLECTIBLE_DEFINITIONS,
  InMemoryStore,
  collectibleEntityId,
  collectibleRewardId,
  createEntityRepository,
  earnAchievementService,
  evaluateCollectibleUnlocks,
  fixedClock,
  listUnlockedThemeKeys,
  registerAchievementService,
  registerCollectibleService,
  sequentialIdGenerator,
  unlockCollectibleService,
  unlockEligibleCollectiblesService,
  type CollectibleDefinition,
  type CollectibleEngineDeps,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";

const STAR: CollectibleDefinition = {
  key: "star-first-light",
  title: "Ensimmäinen tähti",
  unlocksThemeKey: null,
  unlockedBy: { kind: "achievement", achievementKey: "first-task" },
};
const AURORA: CollectibleDefinition = {
  key: "region-aurora",
  title: "Revontulialue",
  unlocksThemeKey: "aurora",
  unlockedBy: { kind: "level", level: 5 },
};

function setup(prefix = "col"): CollectibleEngineDeps {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  return {
    clock,
    collectibles: createEntityRepository<Collectible>(
      new InMemoryStore<Collectible>("collectible"),
      { clock, ids },
    ),
    userRewards: createEntityRepository<UserReward>(new InMemoryStore<UserReward>("user-reward"), {
      clock,
      ids,
    }),
  };
}

describe("registerCollectibleService (T190)", () => {
  it("luo katalogirivin deterministisellä id:llä; retry unchanged", async () => {
    const deps = setup();
    const first = await registerCollectibleService(deps.collectibles, STAR);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("created");
    expect(first.value.collectible.id).toBe(collectibleEntityId("star-first-light"));

    const retry = await registerCollectibleService(deps.collectibles, STAR);
    expect(retry.ok && retry.value.kind).toBe("unchanged");
    expect(retry.ok && retry.value.collectible.version).toBe(1);
    const listed = await deps.collectibles.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("versiointi: sisältömuutos bumpaa version", async () => {
    const deps = setup("ver");
    await registerCollectibleService(deps.collectibles, AURORA);
    const updated = await registerCollectibleService(deps.collectibles, {
      ...AURORA,
      title: "Revontulialue II",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.kind).toBe("updated");
    expect(updated.value.collectible.version).toBe(2);
    expect(updated.value.collectible.unlocksThemeKey).toBe("aurora");
  });

  it("kelvoton sääntö/otsikko hylätään", async () => {
    const deps = setup("bad");
    const badLevel = await registerCollectibleService(deps.collectibles, {
      key: "bad",
      title: "Paha",
      unlocksThemeKey: null,
      unlockedBy: { kind: "level", level: 0 },
    });
    expect(badLevel.ok).toBe(false);
  });
});

describe("evaluateCollectibleUnlocks (T190)", () => {
  it("saavutusavain avaa; puuttuva avain ei", () => {
    const unlocked = evaluateCollectibleUnlocks([STAR], {
      earnedAchievementKeys: new Set(["first-task"]),
      level: 1,
    });
    expect(unlocked.map((definition) => definition.key)).toEqual(["star-first-light"]);
    const none = evaluateCollectibleUnlocks([STAR], {
      earnedAchievementKeys: new Set(),
      level: 10,
    });
    expect(none).toHaveLength(0);
  });

  it("levelikynnys avaa kun level riittää", () => {
    const below = evaluateCollectibleUnlocks([AURORA], {
      earnedAchievementKeys: new Set(),
      level: 4,
    });
    expect(below).toHaveLength(0);
    const reached = evaluateCollectibleUnlocks([AURORA], {
      earnedAchievementKeys: new Set(),
      level: 5,
    });
    expect(reached.map((definition) => definition.key)).toEqual(["region-aurora"]);
  });
});

describe("unlockCollectibleService (T190)", () => {
  it("avataan kerran — retry duplicate, yksi rivi", async () => {
    const deps = setup("unlock");
    await registerCollectibleService(deps.collectibles, STAR);
    const collectibleId = collectibleEntityId("star-first-light");

    const first = await unlockCollectibleService(deps, { collectibleId });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.kind).toBe("unlocked");
    expect(first.value.reward.id).toBe(collectibleRewardId(collectibleId));

    const retry = await unlockCollectibleService(deps, { collectibleId });
    expect(retry.ok && retry.value.kind).toBe("duplicate");
    const listed = await deps.userRewards.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("T188:n saavutusrivin sivukentästä avattu ei palkitse uudestaan", async () => {
    const deps = setup("sidecar");
    await registerCollectibleService(deps.collectibles, STAR);
    // T188: saavutus + rinnakkaispalkinto samalle UserReward-riville.
    const achievements = createEntityRepository<Achievement>(
      new InMemoryStore<Achievement>("achievement"),
      { clock: deps.clock, ids: sequentialIdGenerator("side-ach") },
    );
    await registerAchievementService(achievements, {
      key: "first-task",
      title: "Ensimmäinen tehtävä",
      description: null,
    });
    const earned = await earnAchievementService(
      { clock: deps.clock, achievements, userRewards: deps.userRewards },
      {
        achievementId: "ach-first-task",
        collectibleId: collectibleEntityId("star-first-light"),
      },
    );
    expect(earned.ok && earned.value.kind).toBe("awarded");

    // Sama esine avataan uudestaan (esim. levelistä) → duplicate, ei riviä lisää.
    const again = await unlockCollectibleService(deps, {
      collectibleId: collectibleEntityId("star-first-light"),
    });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.kind).toBe("duplicate");
    expect(again.value.reward.id).toBe("reward-ach-first-task");
    const listed = await deps.userRewards.list();
    expect(listed.ok && listed.value).toHaveLength(1);
  });

  it("tuntematon esine → not-found", async () => {
    const deps = setup("unknown");
    const missing = await unlockCollectibleService(deps, { collectibleId: "col-missing" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("not-found");
    }
  });
});

describe("unlockEligibleCollectiblesService (T190)", () => {
  it("avaa saavutus- ja levelipalkinnot; uudelleenajo tyhjä", async () => {
    const deps = setup("eligible");
    for (const definition of COLLECTIBLE_DEFINITIONS) {
      await registerCollectibleService(deps.collectibles, definition);
    }
    const result = await unlockEligibleCollectiblesService(deps, {
      state: { earnedAchievementKeys: new Set(["first-task", "focus-hour"]), level: 5 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 tähteä saavutuksista + revontulialue levelistä 5.
    expect(result.value.unlocked.map((item) => item.definition.key)).toEqual([
      "star-first-light",
      "star-focus",
      "region-aurora",
    ]);
    // Teema avautui keräyksestä.
    const collectibles = await deps.collectibles.list();
    const rewards = await deps.userRewards.list();
    if (collectibles.ok && rewards.ok) {
      expect([...listUnlockedThemeKeys(collectibles.value, rewards.value)]).toEqual(["aurora"]);
    }

    const again = await unlockEligibleCollectiblesService(deps, {
      state: { earnedAchievementKeys: new Set(["first-task", "focus-hour"]), level: 5 },
    });
    expect(again.ok && again.value.unlocked).toHaveLength(0);
  });
});
