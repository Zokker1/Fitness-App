import type { Collectible, EntityId, UserReward } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "collectible";
const USER_REWARD_ENTITY_TYPE = "user-reward";
const LEGACY_BATCH_SIZE = 32;

interface CollectibleRow {
  readonly id?: unknown;
  readonly key?: unknown;
  readonly title?: unknown;
  readonly unlocks_theme_key?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedCollectible(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua keräilyesinettä ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.collectible.invalid",
    },
  };
}

export function validCollectible(collectible: Collectible): boolean {
  return (
    typeof collectible.id === "string" &&
    collectible.id.length > 0 &&
    typeof collectible.key === "string" &&
    collectible.key.trim().length > 0 &&
    collectible.key.length <= 100 &&
    typeof collectible.title === "string" &&
    collectible.title.trim().length > 0 &&
    collectible.title.length <= 200 &&
    (collectible.unlocksThemeKey === null || typeof collectible.unlocksThemeKey === "string") &&
    typeof collectible.createdAt === "string" &&
    collectible.createdAt.length > 0 &&
    typeof collectible.updatedAt === "string" &&
    collectible.updatedAt.length > 0 &&
    Number.isInteger(collectible.version) &&
    collectible.version >= 1
  );
}

export function putCollectibleOp(collectible: Collectible): DbTransactionOp {
  return {
    op: "putCollectible",
    params: {
      id: collectible.id,
      key: collectible.key,
      title: collectible.title,
      unlocks_theme_key: collectible.unlocksThemeKey ?? "",
      unlocks_theme_key_is_null: collectible.unlocksThemeKey === null,
      created_at: collectible.createdAt,
      updated_at: collectible.updatedAt,
      version: collectible.version,
    },
  };
}

function parseCollectibles(rows: readonly unknown[]): DataResult<readonly Collectible[]> {
  const collectibles: Collectible[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedCollectible();
    }
    const row = value as CollectibleRow;
    if (
      typeof row.id !== "string" ||
      typeof row.key !== "string" ||
      typeof row.title !== "string" ||
      (row.unlocks_theme_key !== null && typeof row.unlocks_theme_key !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedCollectible();
    }
    const collectible: Collectible = {
      id: row.id,
      key: row.key,
      title: row.title,
      unlocksThemeKey: row.unlocks_theme_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validCollectible(collectible)) return corruptedCollectible();
    collectibles.push(collectible);
  }
  return { ok: true, value: collectibles };
}

async function migrateLegacyCollectibles(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<Collectible>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const collectibles = legacy.value;
  const legacyIds = new Set<string>();
  const legacyKeys = new Set<string>();
  for (const collectible of collectibles) {
    if (
      !validCollectible(collectible) ||
      legacyIds.has(collectible.id) ||
      legacyKeys.has(collectible.key)
    ) {
      return corruptedCollectible();
    }
    legacyIds.add(collectible.id);
    legacyKeys.add(collectible.key);
  }

  const currentResponse = await sendDbRequest({
    kind: "query",
    op: "listCollectibles",
    params: {},
  });
  if (!currentResponse.ok) return toDataResult(currentResponse, () => true as const);
  const current = parseCollectibles(currentResponse.rows);
  if (!current.ok) return current;
  const currentIds = new Set(current.value.map((collectible) => collectible.id));
  const currentKeys = new Set(current.value.map((collectible) => collectible.key));
  if (
    collectibles.some(
      (collectible) => currentIds.has(collectible.id) || currentKeys.has(collectible.key),
    )
  ) {
    return corruptedCollectible();
  }

  for (let offset = 0; offset < collectibles.length; offset += LEGACY_BATCH_SIZE) {
    const batch = collectibles.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const collectible of batch) {
      ops.push(putCollectibleOp(collectible));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: collectible.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function earnedCollectibleError(): DataResult<never> {
  return {
    ok: false,
    error: invalidInput(
      "data.collectible.earned",
      "Keräilyesinettä ei voi poistaa, koska käyttäjälle annettu palkinto säilytetään.",
    ),
  };
}

export function createSqliteCollectibleStore(): EntityStore<Collectible> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyCollectibles();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Collectible> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Collectible[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listCollectibles", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseCollectibles(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Collectible>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getCollectible", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as Collectible);
      const parsed = parseCollectibles(response.rows);
      if (!parsed.ok) return parsed;
      const collectible = parsed.value[0];
      return collectible === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: collectible };
    },
    async save(value: Collectible): Promise<DataResult<Collectible>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validCollectible(value)) {
        return {
          ok: false,
          error: invalidInput("data.collectible.invalid", "Keräilyesineen tiedot eivät kelpaa."),
        };
      }
      const listed = await store.list();
      if (!listed.ok) return listed;
      if (
        listed.value.some(
          (collectible) => collectible.key === value.key && collectible.id !== value.id,
        )
      ) {
        return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putCollectibleOp(value)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const legacyRewards =
        await createSqliteEntityDocStore<UserReward>(USER_REWARD_ENTITY_TYPE).list();
      if (!legacyRewards.ok) return legacyRewards;
      if (legacyRewards.value.some((reward) => reward.collectibleId === id)) {
        return earnedCollectibleError();
      }
      const relationalReward = await sendDbRequest({
        kind: "query",
        op: "getCollectibleRewardReference",
        params: { id },
      });
      if (!relationalReward.ok) return toDataResult(relationalReward, () => false);
      if (relationalReward.rows.length > 0) return earnedCollectibleError();

      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteCollectible", params: { id } }],
      });
      const result = toDataResult(response, () => true as const);
      if (
        !response.ok &&
        response.code === "invalid-input" &&
        response.diagnosticCode === "db.transaction.failed.op0"
      ) {
        return earnedCollectibleError();
      }
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
