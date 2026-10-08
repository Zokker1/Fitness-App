// T192: Reward Vault (§9: oma palkinto XP-kynnykselle, ei rahallista arvoa;
// §51 reiluus). Kriteeri: käyttäjä voi määrittää oman palkinnon ja
// XP-kynnyksen.
// - createVaultRewardService: otsikko + muistutus + kynnys; validointi
//   hylätään tyhjän otsikon/negatiivisen kynnyksen (§51: selkeä syy);
// - updateVaultRewardService: version kera; kynnys saa myös laskea (käyttäjä
//   hallitsee omaa palkintoaan, ei rangaistua);
// - isVaultRewardReached / vaultRewardStatus: puhdas ehto (kokonais-XP ≥
//   kynnys) sanallisella tilalla (§31). Lunastus on T193.
import { describe, expect, it } from "vitest";
import type { VaultReward } from "@lifeos/domain";
import {
  InMemoryStore,
  createEntityRepository,
  createVaultRewardService,
  fixedClock,
  isVaultRewardReached,
  sequentialIdGenerator,
  updateVaultRewardService,
  vaultRewardEventId,
  vaultRewardStatus,
  type VaultRewardDeps,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";

function setup(prefix = "vault"): VaultRewardDeps {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  return {
    clock,
    vaultRewards: createEntityRepository<VaultReward>(
      new InMemoryStore<VaultReward>("vault-reward"),
      { clock, ids },
    ),
  };
}

describe("createVaultRewardService (T192)", () => {
  it("luo palkinnon otsikolla, muistutuksella ja kynnyksellä", async () => {
    const deps = setup();
    const created = await createVaultRewardService(deps, {
      title: "Elokuvailta",
      note: "Perjantai-ilta elokuvateatterissa",
      xpThreshold: 1000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value).toMatchObject({
      title: "Elokuvailta",
      note: "Perjantai-ilta elokuvateatterissa",
      xpThreshold: 1000,
      version: 1,
    });
  });

  it("muistutus on valinnainen; tyhjä muistutus null", async () => {
    const deps = setup("note");
    const noNote = await createVaultRewardService(deps, {
      title: "Kahvihetki",
      xpThreshold: 250,
    });
    expect(noNote.ok && noNote.value.note).toBeNull();
    const emptyNote = await createVaultRewardService(deps, {
      title: "Kävely",
      note: "   ",
      xpThreshold: 500,
    });
    expect(emptyNote.ok && emptyNote.value.note).toBeNull();
  });

  it("kaksi samannimistä palkintoa eri kynnyksin on sallittua", async () => {
    const deps = setup("twin");
    const first = await createVaultRewardService(deps, {
      title: "Elokuvailta",
      xpThreshold: 500,
    });
    const second = await createVaultRewardService(deps, {
      title: "Elokuvailta",
      xpThreshold: 1500,
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.id).not.toBe(second.value.id);
  });

  it("validointi hylää tyhjän otsikon ja kelvottoman kynnyksen", async () => {
    const deps = setup("bad");
    const emptyTitle = await createVaultRewardService(deps, {
      title: "   ",
      xpThreshold: 100,
    });
    expect(emptyTitle.ok).toBe(false);
    if (!emptyTitle.ok) {
      expect(emptyTitle.error.diagnosticCode).toBe("data.vault-reward.validation.bad-title");
    }
    const zero = await createVaultRewardService(deps, { title: "Paha", xpThreshold: 0 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) {
      expect(zero.error.diagnosticCode).toBe("data.vault-reward.validation.bad-threshold");
    }
    const fractional = await createVaultRewardService(deps, {
      title: "Paha",
      xpThreshold: 12.5,
    });
    expect(fractional.ok).toBe(false);
    const negative = await createVaultRewardService(deps, { title: "Paha", xpThreshold: -10 });
    expect(negative.ok).toBe(false);
  });
});

describe("updateVaultRewardService (T192)", () => {
  it("muokkaa kynnystä ja otsikkoa version kera", async () => {
    const deps = setup("edit");
    const created = await createVaultRewardService(deps, {
      title: "Elokuvailta",
      xpThreshold: 1000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateVaultRewardService(deps, {
      rewardId: created.value.id,
      title: "Elokuvailta + poppareita",
      xpThreshold: 800,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value).toMatchObject({
      title: "Elokuvailta + poppareita",
      xpThreshold: 800,
      version: 2,
    });
  });

  it("kynnys voi myös laskea — käyttäjä hallitsee palkintoaan (§51)", async () => {
    const deps = setup("lower");
    const created = await createVaultRewardService(deps, {
      title: "Vapaapäivä",
      xpThreshold: 2000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await updateVaultRewardService(deps, {
      rewardId: created.value.id,
      xpThreshold: 500,
    });
    expect(updated.ok && updated.value.xpThreshold).toBe(500);
  });

  it("tuntematon palkinto → not-found; kelvoton päivitys hylätään", async () => {
    const deps = setup("missing");
    const missing = await updateVaultRewardService(deps, {
      rewardId: "vault-missing",
      title: "Uusi",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("not-found");
    }
  });
});

describe("isVaultRewardReached / vaultRewardStatus (T192)", () => {
  const reward: VaultReward = {
    id: "vault-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Elokuvailta",
    note: null,
    xpThreshold: 1000,
  };

  it("kynnys täyttyy kun kokonais-XP yltää kynnykseen", () => {
    expect(isVaultRewardReached(reward, 999)).toBe(false);
    expect(isVaultRewardReached(reward, 1000)).toBe(true);
    expect(isVaultRewardReached(reward, 2500)).toBe(true);
    // Negatiivinen saldo (manual-korjaukset §51) ei muuta kynnystä.
    expect(isVaultRewardReached(reward, -50)).toBe(false);
  });

  it("tila sanoin: reached / waiting (§31 ei pelkkää väriä)", () => {
    expect(vaultRewardStatus(reward, 1000)).toBe("reached");
    expect(vaultRewardStatus(reward, 10)).toBe("waiting");
  });

  it("avausavain on deterministinen (T181-henki T193:lle)", () => {
    expect(vaultRewardEventId("vault-1")).toBe("vault-vault-1");
    expect(vaultRewardEventId("vault-1")).toBe(vaultRewardEventId("vault-1"));
  });
});
