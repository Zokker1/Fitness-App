import type { EntityId, VaultRewardClaim } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteVaultRewardStore } from "./sqliteVaultRewardStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "vault-claim";
const LEGACY_BATCH_SIZE = 32;

interface VaultRewardClaimRow {
  readonly id?: unknown;
  readonly reward_id?: unknown;
  readonly claimed_at?: unknown;
  readonly xp_deducted?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedClaim(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua lunastushistoriaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.vault-claim.invalid",
    },
  };
}

export function validClaim(claim: VaultRewardClaim): boolean {
  return (
    typeof claim.id === "string" &&
    claim.id.length > 0 &&
    typeof claim.rewardId === "string" &&
    claim.rewardId.length > 0 &&
    typeof claim.claimedAt === "string" &&
    claim.claimedAt.length > 0 &&
    Number.isSafeInteger(claim.xpDeducted) &&
    claim.xpDeducted >= 0 &&
    typeof claim.createdAt === "string" &&
    claim.createdAt.length > 0 &&
    typeof claim.updatedAt === "string" &&
    claim.updatedAt.length > 0 &&
    Number.isInteger(claim.version) &&
    claim.version >= 1
  );
}

export function putClaimOp(claim: VaultRewardClaim): DbTransactionOp {
  return {
    op: "putVaultRewardClaim",
    params: {
      id: claim.id,
      reward_id: claim.rewardId,
      claimed_at: claim.claimedAt,
      xp_deducted: claim.xpDeducted,
      created_at: claim.createdAt,
      updated_at: claim.updatedAt,
      version: claim.version,
    },
  };
}

async function migrateLegacyVaultRewardClaims(): Promise<DataResult<true>> {
  // Claim-FK:n parentit siirretään ensin entity-docista M036-tauluun.
  const rewards = await createSqliteVaultRewardStore().list();
  if (!rewards.ok) return rewards;
  const rewardIds = new Set(rewards.value.map((reward) => reward.id));

  const legacy = await createSqliteEntityDocStore<VaultRewardClaim>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const claims = legacy.value;
  if (claims.some((claim) => !validClaim(claim) || !rewardIds.has(claim.rewardId))) {
    return corruptedClaim();
  }

  for (let offset = 0; offset < claims.length; offset += LEGACY_BATCH_SIZE) {
    const batch = claims.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const claim of batch) {
      ops.push(putClaimOp(claim));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: claim.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function parseClaims(rows: readonly unknown[]): DataResult<readonly VaultRewardClaim[]> {
  const claims: VaultRewardClaim[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedClaim();
    }
    const row = value as VaultRewardClaimRow;
    if (
      typeof row.id !== "string" ||
      typeof row.reward_id !== "string" ||
      typeof row.claimed_at !== "string" ||
      typeof row.xp_deducted !== "number" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedClaim();
    }
    const claim: VaultRewardClaim = {
      id: row.id,
      rewardId: row.reward_id,
      claimedAt: row.claimed_at,
      xpDeducted: row.xp_deducted,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validClaim(claim)) return corruptedClaim();
    claims.push(claim);
  }
  return { ok: true, value: claims };
}

export function createSqliteVaultRewardClaimStore(): EntityStore<VaultRewardClaim> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyVaultRewardClaims();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<VaultRewardClaim> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly VaultRewardClaim[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "listVaultRewardClaims",
        params: {},
      });
      if (!response.ok) return toDataResult(response, () => []);
      return parseClaims(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<VaultRewardClaim>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getVaultRewardClaim",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as VaultRewardClaim);
      const parsed = parseClaims(response.rows);
      if (!parsed.ok) return parsed;
      const claim = parsed.value[0];
      return claim === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: claim };
    },
    async save(value: VaultRewardClaim): Promise<DataResult<VaultRewardClaim>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validClaim(value)) {
        return {
          ok: false,
          error: invalidInput("data.vault-claim.invalid", "Lunastuksen tiedot eivät kelpaa."),
        };
      }
      const existing = await store.getById(value.id);
      if (existing.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      if (existing.error.code !== "not-found") return existing;

      const reward = await createSqliteVaultRewardStore().getById(value.rewardId);
      if (!reward.ok) {
        if (reward.error.code !== "not-found") return reward;
        return {
          ok: false,
          error: invalidInput("data.vault-claim.reward-missing", "Lunastuksen palkintoa ei löydy."),
        };
      }

      const response = await sendDbRequest({ kind: "transaction", ops: [putClaimOp(value)] });
      const result = toDataResult(response, () => true as const);
      if (!result.ok) {
        // Käsittele kilpaileva saman tunnisteen lisäys idempotentisti samoin
        // kuin repositoryn tavallinen occupied-id-polku.
        const raced = await store.getById(value.id);
        if (raced.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
        return result;
      }
      return { ok: true, value };
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      return {
        ok: false,
        error: invalidInput(
          "data.vault-claim.append-only",
          "Lunastushistoriaa ei voi muuttaa tai poistaa.",
        ),
      };
    },
  };
  return store;
}
