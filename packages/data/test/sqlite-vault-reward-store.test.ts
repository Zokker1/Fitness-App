import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultReward, VaultRewardClaim } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteVaultRewardClaimStore,
  createSqliteVaultRewardStore,
  isDbRequest,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface StoredDoc {
  readonly entity_type: string;
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

interface Write {
  readonly op: string;
  readonly params: Record<string, unknown>;
}

interface Request {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly Write[];
  readonly params?: Record<string, unknown>;
}

function createWorker(initialDocs: readonly StoredDoc[]) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const rewardRows = new Map<string, Record<string, unknown>>();
  const claimRows = new Map<string, Record<string, unknown>>();
  const requests: Request[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listVaultRewards") {
          rows = [...rewardRows.values()];
        } else if (request.kind === "query" && request.op === "getVaultReward") {
          const row = rewardRows.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listVaultRewardClaims") {
          rows = [...claimRows.values()];
        } else if (request.kind === "query" && request.op === "getVaultRewardClaim") {
          const row = claimRows.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextRewards = new Map(rewardRows);
          const nextClaims = new Map(claimRows);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putVaultReward") {
              const params = write.params;
              const existing = nextRewards.get(id);
              nextRewards.set(id, {
                id,
                title: params.title,
                note: params.note === "" ? null : params.note,
                xp_threshold: params.xp_threshold,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteVaultReward") {
              nextRewards.delete(id);
            } else if (write.op === "putVaultRewardClaim") {
              const params = write.params;
              nextClaims.set(id, {
                id,
                reward_id: params.reward_id,
                claimed_at: params.claimed_at,
                xp_deducted: params.xp_deducted,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          rewardRows.clear();
          for (const [id, row] of nextRewards) rewardRows.set(id, row);
          claimRows.clear();
          for (const [id, row] of nextClaims) claimRows.set(id, row);
        }
        onmessage?.({
          data: {
            requestId: request.requestId,
            ok: true,
            rows,
            backend: "memory",
            persisted: false,
          },
        } as MessageEvent);
      });
    },
    terminate() {},
    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      onmessage = listener;
    },
    set onerror(_listener: ((event: ErrorEvent) => void) | null) {},
  };
  return { worker: worker as unknown as Worker, docs, rewardRows, claimRows, requests };
}

function legacyDoc(
  entityType: string,
  entity: { readonly id: string; readonly createdAt: string; readonly updatedAt: string },
): StoredDoc {
  return {
    entity_type: entityType,
    id: entity.id,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    doc_version: 0,
    value: JSON.stringify(entity),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite VaultReward relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const reward: VaultReward = {
    id: "vault-movie-night",
    title: "Elokuvailta",
    note: "Valitse joku hyvä elokuva.",
    xpThreshold: 1000,
    createdAt: at,
    updatedAt: at,
    version: 2,
  };

  it("siirtää vanhan palkinnon, lukee/säilyttää kentät ja estää lunastetun poiston", async () => {
    const claim: VaultRewardClaim = {
      id: "vault-claim-vault-movie-night",
      rewardId: reward.id,
      claimedAt: at,
      xpDeducted: 0,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([
      legacyDoc("vault-reward", reward),
      legacyDoc("vault-claim", claim),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteVaultRewardStore();

    expect(await store.list()).toEqual({ ok: true, value: [reward] });
    expect(fixture.rewardRows.get(reward.id)).toMatchObject({
      title: reward.title,
      note: reward.note,
      xp_threshold: reward.xpThreshold,
    });
    expect(fixture.docs.has(reward.id)).toBe(false);
    expect(fixture.docs.has(claim.id)).toBe(true);

    const updated: VaultReward = {
      ...reward,
      note: null,
      xpThreshold: 1200,
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 3,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(reward.id)).toEqual({ ok: true, value: updated });
    expect(await store.remove(reward.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.vault-reward.already-claimed" },
    });
    expect(fixture.claimRows.get(claim.id)).toMatchObject({ reward_id: reward.id });
    expect(fixture.docs.has(claim.id)).toBe(false);
    expect(fixture.rewardRows.has(reward.id)).toBe(true);
    expect(
      fixture.requests.some(
        (request) =>
          request.kind === "transaction" &&
          request.ops?.some((write) => write.op === "deleteVaultReward"),
      ),
    ).toBe(false);
  });

  it("siirtää legacy-claimit ja pitää relaatiomerkinnät append-only-muodossa", async () => {
    const claim: VaultRewardClaim = {
      id: "claim-old-format",
      rewardId: reward.id,
      claimedAt: at,
      xpDeducted: 125,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createWorker([
      legacyDoc("vault-reward", reward),
      legacyDoc("vault-claim", claim),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteVaultRewardClaimStore();

    expect(await store.list()).toEqual({ ok: true, value: [claim] });
    expect(await store.getById(claim.id)).toEqual({ ok: true, value: claim });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.claimRows.get(claim.id)).toMatchObject({
      reward_id: reward.id,
      claimed_at: at,
      xp_deducted: 125,
    });
    expect(await store.save(claim)).toMatchObject({
      ok: false,
      error: { code: "already-exists" },
    });
    expect(await store.remove(claim.id)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "data.vault-claim.append-only" },
    });

    const invalidLegacyClaim = { ...claim, id: "claim-orphan", rewardId: "missing-reward" };
    const invalidFixture = createWorker([legacyDoc("vault-claim", invalidLegacyClaim)]);
    resetDatabaseWorkerForTests();
    configureDatabaseWorker({ create: () => invalidFixture.worker });
    const invalidStore = createSqliteVaultRewardClaimStore();
    expect(await invalidStore.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.vault-claim.invalid" },
    });
    expect(invalidFixture.docs.has(invalidLegacyClaim.id)).toBe(true);
    expect(invalidFixture.claimRows.size).toBe(0);
  });

  it("normalisoi vapaaehtoisen muistutuksen, validoi XP-kynnyksen ja tukee poistoa", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteVaultRewardStore();
    const normalized: VaultReward = { ...reward, title: "  Elokuva  ", note: "  " };
    const expected: VaultReward = { ...normalized, title: "Elokuva", note: null };
    expect(await store.save(normalized)).toEqual({ ok: true, value: expected });
    expect(await store.remove(reward.id)).toEqual({ ok: true, value: true });

    const invalid = { ...reward, xpThreshold: 0 };
    expect(await store.save(invalid)).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(
      isDbRequest({
        requestId: "vault-reward-write",
        kind: "exec",
        op: "putVaultReward",
        params: {
          id: reward.id,
          title: reward.title,
          note: "",
          xp_threshold: reward.xpThreshold,
          created_at: reward.createdAt,
          updated_at: reward.updatedAt,
          version: reward.version,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "vault-reward-invalid",
        kind: "exec",
        op: "putVaultReward",
        params: { id: "reward" },
      }),
    ).toBe(false);
  });
});
