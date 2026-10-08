// T193: reward unlock/claim (§9 Reward Vault, §30 palaute, §51 reiluus).
// Kriteeri: palkinnon lunastus säilyttää historian eikä vähennä XP:tä
// ellei erikseen valita.
// - Claim on append-only historiankirjaus (VaultRewardClaim): palkintorivi
//   pysyy ennallaan eikä aikaisempia XP-tapahtumia muuteta (§51 historia
//   säilyy; ei "kuluta pois" -logiikkaa).
// - Oletus EI vähennä XP:tä: lunastus on ilmainen merkintä. Vähennys tapahtuu
//   VAIN jos käyttäjä nimenomaisesti valitsee (deductXp > 0) — silloin
//   kirjataan negatiivinen manual-XP append-only-tapahtumana (T181-ledger),
//   joten myös vähennys on historiaa eikä saldo-rewrite.
// - Idempotentti (T181-henki): claim-id `vault-claim-<rewardId>` → retry tai
//   synkka ei lunasta kahdesti eikä vähennä kahteen kertaan.
// §57.14: lunastus on palkitseva hetki, ei rahaliikennettä eikä rankaisua.

import type { EntityId, VaultReward, VaultRewardClaim, XPTransaction } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import { isVaultRewardReached } from "./vault-reward.ts";
import { createXpAward } from "./xp-ledger.ts";

export interface VaultClaimDeps {
  readonly clock: Clock;
  readonly vaultRewards: EntityRepository<VaultReward>;
  readonly vaultClaims: EntityRepository<VaultRewardClaim>;
  readonly xpTransactions: EntityRepository<XPTransaction>;
}

export interface ClaimVaultRewardInput {
  readonly rewardId: EntityId;
  /**
   * Nimenomainen valinta vähentää XP:tä (0/undefined = ei vähennetä).
   * §51: oletus on maksuton lunastus; vähennys vaatii erillisen päätöksen.
   */
  readonly deductXp?: number | undefined;
  readonly at?: string | undefined;
}

export type ClaimVaultRewardResult =
  | {
      readonly kind: "claimed";
      readonly claim: VaultRewardClaim;
      readonly deduction: XPTransaction | null;
    }
  | {
      readonly kind: "duplicate";
      readonly claim: VaultRewardClaim;
    };

/** Deterministinen claim-id: yksi lunastus per palkinto (retry/synkka turvattu). */
export function vaultClaimEntityId(rewardId: EntityId): EntityId {
  return `vault-claim-${rewardId}`;
}

/** Löytää aiemmin lunastuksen (myös legacy-satunnais-id:llä). */
export function findVaultClaim(
  claims: readonly VaultRewardClaim[],
  rewardId: EntityId,
): VaultRewardClaim | undefined {
  return claims.find((claim) => claim.rewardId === rewardId);
}

export type VaultClaimStatus = "claimed" | "reached" | "waiting";

/**
 * Palkinnon tila sanoin (§31): lunastettu, lunastettavissa tai odottaa.
 * Lunastus pysyy voimassa vaikka kynnystä myöhemmin muutettaisiin (§51).
 */
export function vaultClaimStatus(
  reward: VaultReward,
  claim: VaultRewardClaim | undefined,
  totalXp: number,
): VaultClaimStatus {
  if (claim !== undefined) {
    return "claimed";
  }
  return isVaultRewardReached(reward, totalXp) ? "reached" : "waiting";
}

/**
 * Lunastaa palkinnon kerran. Säilyttää historian: palkintoriviä ei poisteta
 * eikä muuteta, XP-historia jää sellaisenaan (vähennys vain erikseen valittuna
 * append-only-tapahtumana).
 */
export async function claimVaultRewardService(
  deps: VaultClaimDeps,
  input: ClaimVaultRewardInput,
): Promise<DataResult<ClaimVaultRewardResult>> {
  const deductXp = input.deductXp ?? 0;
  if (!Number.isSafeInteger(deductXp) || deductXp < 0) {
    return {
      ok: false,
      error: invalidInput(
        "data.vault-claim.validation.bad-deduction",
        "XP-vähennyksen on oltava vähintään 0.",
      ),
    };
  }
  const reward = await deps.vaultRewards.getById(input.rewardId);
  if (!reward.ok) {
    return { ok: false, error: notFound("vault-reward") };
  }

  const claimId = vaultClaimEntityId(input.rewardId);
  const existing = await deps.vaultClaims.getById(claimId);
  if (existing.ok) {
    // Jo lunastettu — ei uutta riviä eikä uutta vähennystä (retry/synkka §51).
    return { ok: true, value: { kind: "duplicate", claim: existing.value } };
  }
  if (existing.error.code !== "not-found") {
    return { ok: false, error: existing.error };
  }
  const listedClaims = await deps.vaultClaims.list();
  if (!listedClaims.ok) {
    return { ok: false, error: listedClaims.error };
  }
  const legacy = findVaultClaim(listedClaims.value, input.rewardId);
  if (legacy !== undefined) {
    return { ok: true, value: { kind: "duplicate", claim: legacy } };
  }

  // Lunastus edellyttää kynnyksen täyttymistä (§9 pistekynnys).
  const listedXp = await deps.xpTransactions.list();
  if (!listedXp.ok) {
    return { ok: false, error: listedXp.error };
  }
  const totalXp = listedXp.value.reduce((sum, tx) => sum + tx.amount, 0);
  if (!isVaultRewardReached(reward.value, totalXp)) {
    return {
      ok: false,
      error: invalidInput(
        "data.vault-claim.validation.not-reached",
        "Palkinnon kynnys ei ole vielä täyttynyt.",
      ),
    };
  }

  // Nimenomainen XP-vähennys (valinta, ei oletus): negatiivinen manual-tapahtuma
  // T181-ledgerille — vähennyskin on historiaa, ei saldo-rewrite (§51).
  let deduction: XPTransaction | null = null;
  if (deductXp > 0) {
    const awarded = await createXpAward(deps.xpTransactions, {
      source: "manual",
      sourceEntityId: claimId,
      amount: -deductXp,
      earnedAt: input.at ?? deps.clock.nowIso(),
      reason: `Lunastuksen XP-vähennys: ${reward.value.title}`,
    });
    if (!awarded.ok) {
      return awarded;
    }
    deduction = awarded.value.transaction;
  }

  const created = await deps.vaultClaims.createWithId(claimId, {
    rewardId: input.rewardId,
    claimedAt: input.at ?? deps.clock.nowIso(),
    xpDeducted: deductXp,
  });
  if (created.ok) {
    return { ok: true, value: { kind: "claimed", claim: created.value, deduction } };
  }
  // Retry-rasitus: toinen lunastus ehti samaan id:seen → olemassa oleva voittaa.
  if (created.error.code === "already-exists") {
    const raced = await deps.vaultClaims.getById(claimId);
    if (raced.ok) {
      return { ok: true, value: { kind: "duplicate", claim: raced.value } };
    }
  }
  return { ok: false, error: created.error };
}
