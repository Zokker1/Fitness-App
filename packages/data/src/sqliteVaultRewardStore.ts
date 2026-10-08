import type { EntityId, VaultReward } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { createSqliteVaultRewardClaimStore } from "./sqliteVaultRewardClaimStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "vault-reward";
const LEGACY_BATCH_SIZE = 32;

interface VaultRewardRow {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly note?: unknown;
  readonly xp_threshold?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedVaultReward(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua palkintoa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.vault-reward.invalid",
    },
  };
}

function normalizeReward(reward: VaultReward): VaultReward {
  const rawTitle: unknown = reward.title;
  const rawNote: unknown = reward.note;
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  const note =
    typeof rawNote === "string"
      ? rawNote.trim() || null
      : rawNote === null || rawNote === undefined
        ? null
        : (rawNote as string | null);
  return {
    ...reward,
    title,
    note,
  };
}

export function validReward(reward: VaultReward): boolean {
  return (
    typeof reward.id === "string" &&
    reward.id.length > 0 &&
    typeof reward.title === "string" &&
    reward.title.trim().length > 0 &&
    reward.title.length <= 200 &&
    (reward.note === null || (typeof reward.note === "string" && reward.note.length <= 500)) &&
    Number.isSafeInteger(reward.xpThreshold) &&
    reward.xpThreshold >= 1 &&
    typeof reward.createdAt === "string" &&
    reward.createdAt.length > 0 &&
    typeof reward.updatedAt === "string" &&
    reward.updatedAt.length > 0 &&
    Number.isInteger(reward.version) &&
    reward.version >= 1
  );
}

export function putRewardOp(reward: VaultReward): DbTransactionOp {
  return {
    op: "putVaultReward",
    params: {
      id: reward.id,
      title: reward.title,
      note: reward.note ?? "",
      xp_threshold: reward.xpThreshold,
      created_at: reward.createdAt,
      updated_at: reward.updatedAt,
      version: reward.version,
    },
  };
}

async function migrateLegacyVaultRewards(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<VaultReward>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const rewards = legacy.value.map(normalizeReward);
  if (rewards.some((reward) => !validReward(reward))) return corruptedVaultReward();

  for (let offset = 0; offset < rewards.length; offset += LEGACY_BATCH_SIZE) {
    const batch = rewards.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const reward of batch) {
      ops.push(putRewardOp(reward));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: reward.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function parseVaultRewards(rows: readonly unknown[]): DataResult<readonly VaultReward[]> {
  const rewards: VaultReward[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedVaultReward();
    }
    const row = value as VaultRewardRow;
    if (
      typeof row.id !== "string" ||
      typeof row.title !== "string" ||
      (row.note !== null && typeof row.note !== "string") ||
      typeof row.xp_threshold !== "number" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedVaultReward();
    }
    const reward: VaultReward = {
      id: row.id,
      title: row.title,
      note: row.note,
      xpThreshold: row.xp_threshold,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validReward(reward)) return corruptedVaultReward();
    rewards.push(reward);
  }
  return { ok: true, value: rewards };
}

export function createSqliteVaultRewardStore(): EntityStore<VaultReward> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyVaultRewards();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<VaultReward> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly VaultReward[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listVaultRewards", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseVaultRewards(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<VaultReward>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getVaultReward", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as VaultReward);
      const parsed = parseVaultRewards(response.rows);
      if (!parsed.ok) return parsed;
      const reward = parsed.value[0];
      return reward === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: reward };
    },
    async save(value: VaultReward): Promise<DataResult<VaultReward>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const reward = normalizeReward(value);
      if (!validReward(reward)) {
        return {
          ok: false,
          error: invalidInput(
            "data.vault-reward.invalid",
            "Palkinnon otsikon, muistutuksen, XP-kynnyksen tai metatietojen arvo ei kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({ kind: "transaction", ops: [putRewardOp(reward)] });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: reward } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const existing = await store.getById(id);
      if (!existing.ok) return existing;

      // Lunastushistoria on append-only: varmista, ettei palkinnolla ole
      // relaatiotauluun tai vanhaan entity-doc-muotoon tallennettua claimia.
      const claims = await createSqliteVaultRewardClaimStore().list();
      if (!claims.ok) return claims;
      if (claims.value.some((claim) => claim.rewardId === id)) {
        return {
          ok: false,
          error: invalidInput(
            "data.vault-reward.already-claimed",
            "Lunastettua palkintoa ei voi poistaa, koska lunastushistoria säilytetään.",
          ),
        };
      }

      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteVaultReward", params: { id } }],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
