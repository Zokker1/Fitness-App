import { afterEach, describe, expect, it } from "vitest";
import type { Food } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteFoodStore,
  createSyncCryptoAdapter,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface EntityDocRow {
  readonly entity_type: string;
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

interface FakeWrite {
  readonly op: string;
  readonly params: Record<string, string | number | boolean>;
}

interface FakeRequest {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly FakeWrite[];
  readonly params?: Record<string, string | number | boolean>;
}

function relationalRow(params: FakeWrite["params"]): Record<string, unknown> {
  const nullable = (value: string | number | boolean | undefined): string | number | null => {
    if (typeof value === "boolean" || value === "" || value === undefined) {
      return null;
    }
    return value;
  };
  return {
    id: params.id,
    name: params.name,
    calories_per_100g: nullable(params.calories_per_100g),
    protein_per_100g: nullable(params.protein_per_100g),
    carbs_per_100g: nullable(params.carbs_per_100g),
    fat_per_100g: nullable(params.fat_per_100g),
    fiber_per_100g: nullable(params.fiber_per_100g),
    serving_size_g: nullable(params.serving_size_g),
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
    deleted_at: nullable(params.deleted_at),
  };
}

function createFoodWorker(initialDocs: readonly EntityDocRow[]) {
  const entityDocs = new Map(initialDocs.map((row) => [row.id, row]));
  const foods = new Map<string, Record<string, unknown>>();
  const requests: FakeRequest[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as FakeRequest;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...entityDocs.values()];
        } else if (request.kind === "query" && request.op === "listFoods") {
          rows = [...foods.values()];
        } else if (request.kind === "query" && request.op === "getFood") {
          const row = foods.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(entityDocs);
          const nextFoods = new Map(foods);
          for (const write of request.ops ?? []) {
            if (write.op === "putFood") {
              const row = relationalRow(write.params);
              const existing = nextFoods.get(String(write.params.id));
              if (existing !== undefined) row.created_at = existing.created_at;
              nextFoods.set(String(write.params.id), row);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(String(write.params.id));
            }
          }
          entityDocs.clear();
          for (const [id, row] of nextDocs) entityDocs.set(id, row);
          foods.clear();
          for (const [id, row] of nextFoods) foods.set(id, row);
        } else if (request.kind === "exec" && request.op === "putFood") {
          const params = request.params ?? {};
          const row = relationalRow(params);
          const existing = foods.get(String(params.id ?? ""));
          if (existing !== undefined) row.created_at = existing.created_at;
          foods.set(String(params.id ?? ""), row);
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
  return { worker: worker as unknown as Worker, entityDocs, foods, requests };
}

function legacyDoc(food: Food): EntityDocRow {
  return {
    entity_type: "food",
    id: food.id,
    created_at: food.createdAt,
    updated_at: food.updatedAt,
    doc_version: 0,
    value: JSON.stringify(food),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite food relational store", () => {
  it("migrates legacy foods and persists updates and soft deletion relationally", async () => {
    const timestamp = "2026-08-01T08:00:00.000Z";
    const legacy: Food = {
      id: "food-legacy",
      name: "Kaurapuuro",
      caloriesPer100G: 70,
      proteinPer100G: 2.5,
      carbsPer100G: 12,
      fatPer100G: 1.5,
      fiberPer100G: 1.8,
      servingSizeG: 250,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 3,
    };
    const { worker, entityDocs, foods, requests } = createFoodWorker([legacyDoc(legacy)]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteFoodStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(entityDocs.size).toBe(0);
    expect(foods.get(legacy.id)).toMatchObject({
      id: legacy.id,
      fiber_per_100g: legacy.fiberPer100G,
      serving_size_g: legacy.servingSizeG,
      deleted_at: null,
    });
    expect(requests.find((request) => request.kind === "transaction")?.ops).toHaveLength(2);

    const updated: Food = {
      ...legacy,
      name: "Kaurapuuro, päivitetty",
      servingSizeG: 300,
      updatedAt: "2026-08-01T08:05:00.000Z",
      version: 4,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(legacy.id)).toEqual({ ok: true, value: updated });
    expect(await store.remove(legacy.id)).toEqual({ ok: true, value: true });
    expect(typeof foods.get(legacy.id)?.deleted_at).toBe("string");
    expect(foods.get(legacy.id)?.version).toBe(5);
    expect(requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("leaves every legacy row untouched if any row is invalid", async () => {
    const invalid = legacyDoc({
      id: "food-invalid",
      name: "Virheellinen",
      caloriesPer100G: -1,
      proteinPer100G: null,
      carbsPer100G: null,
      fatPer100G: null,
      deletedAt: null,
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:00:00.000Z",
      version: 1,
    });
    const { worker, entityDocs, foods, requests } = createFoodWorker([invalid]);
    configureDatabaseWorker({ create: () => worker });

    const result = await createSqliteFoodStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.get(invalid.id)).toEqual(invalid);
    expect(foods.size).toBe(0);
    expect(requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a food and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const food: Food = {
      id: "food-sync",
      name: "Jogurtti",
      caloriesPer100G: 63,
      proteinPer100G: 4.5,
      carbsPer100G: 5.2,
      fatPer100G: 2.1,
      fiberPer100G: null,
      servingSizeG: null,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const { worker, foods, requests } = createFoodWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteFoodStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(22));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(food, {
          operationId: "installation-1:food-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "name",
            "caloriesPer100G",
            "proteinPer100G",
            "carbsPer100G",
            "fatPer100G",
            "fiberPer100G",
            "servingSizeG",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: food });

      const transaction = requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual(["putFood", "putSyncOperation"]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(foods.get(food.id)?.name).toBe(food.name);
    } finally {
      keySession.lock();
    }
  });
});
