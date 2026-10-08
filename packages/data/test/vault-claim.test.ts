// T193: reward unlock/claim (§9 Reward Vault, §51 reiluus). Kriteeri:
// palkinnon lunastus säilyttää historian eikä vähennä XP:tä ellei erikseen
// valita.
// - oletuslunastus EI muuta XP-historiaa eikä palkintoriviä (§51);
// - nimenomainen deductXp kirjaa negatiivisen manual-tapahtuman (append-only,
//   myös vähennys on historiaa);
// - idempotentti: retry/synkka lunastaa kerran eikä vähennä kahteen kertaan;
// - kynnys täyttymättä ei lunasteta (selkeä syy, ei häpeää).
import { describe, expect, it } from "vitest";
import type { VaultReward, VaultRewardClaim, XPTransaction } from "@lifeos/domain";
import {
  InMemoryStore,
  claimVaultRewardService,
  createEntityRepository,
  createXpAward,
  findVaultClaim,
  fixedClock,
  sequentialIdGenerator,
  vaultClaimEntityId,
  vaultClaimStatus,
  type VaultClaimDeps,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";

function setup(prefix = "claim"): VaultClaimDeps {
  const clock = fixedClock(AT);
  const ids = sequentialIdGenerator(prefix);
  return {
    clock,
    vaultRewards: createEntityRepository<VaultReward>(
      new InMemoryStore<VaultReward>("vault-reward"),
      { clock, ids },
    ),
    vaultClaims: createEntityRepository<VaultRewardClaim>(
      new InMemoryStore<VaultRewardClaim>("vault-claim"),
      { clock, ids },
    ),
    xpTransactions: createEntityRepository<XPTransaction>(
      new InMemoryStore<XPTransaction>("xp-transaction"),
      { clock, ids },
    ),
  };
}

async function seedRewardAndXp(
  deps: VaultClaimDeps,
  threshold: number,
  totalXp: number,
): Promise<string> {
  const reward = await deps.vaultRewards.create({
    title: "Elokuvailta",
    note: null,
    xpThreshold: threshold,
  });
  if (!reward.ok) throw new Error("palkinnon luonti epäonnistui");
  let remaining = totalXp;
  let index = 0;
  while (remaining > 0) {
    const chunk = Math.min(remaining, 500);
    const awarded = await createXpAward(deps.xpTransactions, {
      source: "task",
      sourceEntityId: `task-${String(index)}`,
      amount: chunk,
      earnedAt: "2026-09-10T08:00:00.000Z",
      reason: null,
    });
    if (!awarded.ok) throw new Error("XP:n luonti epäonnistui");
    remaining -= chunk;
    index += 1;
  }
  return reward.value.id;
}

describe("claimVaultRewardService (T193)", () => {
  it("oletuslunastus säilyttää historian: XP ja palkinto ennallaan", async () => {
    const deps = setup();
    const rewardId = await seedRewardAndXp(deps, 1000, 1500);

    const claimed = await claimVaultRewardService(deps, { rewardId });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    expect(claimed.value.kind).toBe("claimed");
    if (claimed.value.kind !== "claimed") return;
    // Ei vähennetty (oletus) eikä negatiivista tapahtumaa.
    expect(claimed.value.claim).toMatchObject({ rewardId, xpDeducted: 0 });
    expect(claimed.value.deduction).toBeNull();

    // Historia säilyy: XP-tapahtumat ennallaan, palkintorivi ennallaan.
    const listedXp = await deps.xpTransactions.list();
    expect(listedXp.ok && listedXp.value).toHaveLength(3);
    if (listedXp.ok) {
      expect(listedXp.value.reduce((sum, tx) => sum + tx.amount, 0)).toBe(1500);
    }
    const reward = await deps.vaultRewards.getById(rewardId);
    expect(reward.ok && reward.value.version).toBe(1);
  });

  it("nimenomainen vähennys kirjataan append-only-tapahtumana", async () => {
    const deps = setup("deduct");
    const rewardId = await seedRewardAndXp(deps, 1000, 1500);

    const claimed = await claimVaultRewardService(deps, { rewardId, deductXp: 300 });
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    if (claimed.value.kind !== "claimed") return;
    expect(claimed.value.claim.xpDeducted).toBe(300);
    // Vähennys on negatiivinen manual-tapahtuma — historia, ei saldo-rewrite.
    expect(claimed.value.deduction).toMatchObject({
      source: "manual",
      sourceEntityId: vaultClaimEntityId(rewardId),
      amount: -300,
    });
    const listedXp = await deps.xpTransactions.list();
    expect(listedXp.ok && listedXp.value).toHaveLength(4);
    if (listedXp.ok) {
      expect(listedXp.value.reduce((sum, tx) => sum + tx.amount, 0)).toBe(1200);
    }
  });

  it("retry lunastaa kerran eikä vähennä kahteen kertaan", async () => {
    const deps = setup("retry");
    const rewardId = await seedRewardAndXp(deps, 1000, 1500);

    const first = await claimVaultRewardService(deps, { rewardId, deductXp: 300 });
    const retry = await claimVaultRewardService(deps, { rewardId, deductXp: 300 });
    expect(first.ok && first.value.kind).toBe("claimed");
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.value.kind).toBe("duplicate");

    const listedClaims = await deps.vaultClaims.list();
    expect(listedClaims.ok && listedClaims.value).toHaveLength(1);
    const listedXp = await deps.xpTransactions.list();
    // 3 alkuperäistä + 1 vähennys — ei tuplaa.
    expect(listedXp.ok && listedXp.value).toHaveLength(4);
    if (listedXp.ok) {
      expect(listedXp.value.reduce((sum, tx) => sum + tx.amount, 0)).toBe(1200);
    }
  });

  it("kynnys täyttymättä ei lunasteta; kelvoton vähennys hylätään", async () => {
    const deps = setup("early");
    const rewardId = await seedRewardAndXp(deps, 1000, 500);

    const tooEarly = await claimVaultRewardService(deps, { rewardId });
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) {
      expect(tooEarly.error.diagnosticCode).toBe("data.vault-claim.validation.not-reached");
    }
    const claims = await deps.vaultClaims.list();
    expect(claims.ok && claims.value).toHaveLength(0);

    const rewardId2 = await seedRewardAndXp(deps, 100, 1500);
    const badDeduction = await claimVaultRewardService(deps, { rewardId: rewardId2, deductXp: -5 });
    expect(badDeduction.ok).toBe(false);
    if (!badDeduction.ok) {
      expect(badDeduction.error.diagnosticCode).toBe("data.vault-claim.validation.bad-deduction");
    }
  });

  it("tuntematon palkinto → not-found; legacy-claim tunnistetaan", async () => {
    const deps = setup("missing");
    const missing = await claimVaultRewardService(deps, { rewardId: "vault-ghost" });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error.code).toBe("not-found");
    }

    const rewardId = await seedRewardAndXp(deps, 100, 1500);
    // Legacy-rivi (satunnais-id, sama rewardId) → duplicate, ei uutta lunastusta.
    await deps.vaultClaims.create({
      rewardId,
      claimedAt: "2026-09-12T08:00:00.000Z",
      xpDeducted: 0,
    });
    const again = await claimVaultRewardService(deps, { rewardId });
    expect(again.ok && again.value.kind).toBe("duplicate");
  });
});

describe("vaultClaimStatus (T193)", () => {
  const reward: VaultReward = {
    id: "vault-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    title: "Elokuvailta",
    note: null,
    xpThreshold: 1000,
  };
  const claim: VaultRewardClaim = {
    id: "vault-claim-vault-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    rewardId: "vault-1",
    claimedAt: AT,
    xpDeducted: 0,
  };

  it("claimed / reached / waiting sanoin (§31)", () => {
    // Lunastus pysyy voimassa vaikka saldo laskisi (§51 ei nollautumista).
    expect(vaultClaimStatus(reward, claim, 0)).toBe("claimed");
    expect(vaultClaimStatus(reward, undefined, 1000)).toBe("reached");
    expect(vaultClaimStatus(reward, undefined, 10)).toBe("waiting");
    expect(findVaultClaim([claim], "vault-1")?.id).toBe("vault-claim-vault-1");
  });
});
