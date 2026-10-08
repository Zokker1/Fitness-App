import { afterEach, describe, expect, it } from "vitest";
import type { Food, NutritionEntry } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteNutritionEntryStore,
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

function nullable(value: string | number | boolean | undefined): string | number | null {
  return value === "" || value === undefined || typeof value === "boolean" ? null : value;
}

function foodRow(params: FakeWrite["params"]): Record<string, unknown> {
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

function nutritionRow(params: FakeWrite["params"]): Record<string, unknown> {
  return {
    id: params.id,
    eaten_at: params.eaten_at,
    food_id: nullable(params.food_id),
    amount_g: nullable(params.amount_g),
    meal_slot_id: nullable(params.meal_slot_id),
    label: params.label,
    calories: nullable(params.calories),
    protein_g: nullable(params.protein_g),
    carbs_g: nullable(params.carbs_g),
    fat_g: nullable(params.fat_g),
    fiber_g: nullable(params.fiber_g),
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
    deleted_at: nullable(params.deleted_at),
  };
}

function docKey(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function createNutritionWorker(initialDocs: readonly EntityDocRow[]) {
  const entityDocs = new Map(initialDocs.map((row) => [docKey(row.entity_type, row.id), row]));
  const foods = new Map<string, Record<string, unknown>>();
  const nutritionEntries = new Map<string, Record<string, unknown>>();
  const requests: FakeRequest[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as FakeRequest;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        let errorCode: string | null = null;
        if (request.kind === "query" && request.op === "listEntities") {
          const entityType = String(request.params?.entity_type ?? "");
          rows = [...entityDocs.values()].filter((row) => row.entity_type === entityType);
        } else if (request.kind === "query" && request.op === "listFoods") {
          rows = [...foods.values()];
        } else if (request.kind === "query" && request.op === "getFood") {
          const row = foods.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listNutritionEntries") {
          rows = [...nutritionEntries.values()];
        } else if (request.kind === "query" && request.op === "getNutritionEntry") {
          const row = nutritionEntries.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(entityDocs);
          const nextFoods = new Map(foods);
          const nextEntries = new Map(nutritionEntries);
          for (const write of request.ops ?? []) {
            const id = String(write.params.id ?? "");
            if (write.op === "putFood") {
              const row = foodRow(write.params);
              const existing = nextFoods.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextFoods.set(id, row);
            } else if (write.op === "putNutritionEntry") {
              const foodId = String(write.params.food_id ?? "");
              if (foodId !== "" && !nextFoods.has(foodId)) {
                errorCode = "invalid-input";
                break;
              }
              const row = nutritionRow(write.params);
              const existing = nextEntries.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextEntries.set(id, row);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(docKey(String(write.params.entity_type ?? ""), id));
            }
          }
          if (errorCode === null) {
            entityDocs.clear();
            for (const [key, row] of nextDocs) entityDocs.set(key, row);
            foods.clear();
            for (const [id, row] of nextFoods) foods.set(id, row);
            nutritionEntries.clear();
            for (const [id, row] of nextEntries) nutritionEntries.set(id, row);
          }
        } else if (request.kind === "exec" && request.op === "putNutritionEntry") {
          const params = request.params ?? {};
          const foodId = String(params.food_id ?? "");
          if (foodId !== "" && !foods.has(foodId)) {
            errorCode = "invalid-input";
          } else {
            nutritionEntries.set(String(params.id ?? ""), nutritionRow(params));
          }
        }

        onmessage?.({
          data:
            errorCode === null
              ? {
                  requestId: request.requestId,
                  ok: true,
                  rows,
                  backend: "memory",
                  persisted: false,
                }
              : {
                  requestId: request.requestId,
                  ok: false,
                  code: errorCode,
                  diagnosticCode: "db.constraint.foreign-key",
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
  return { worker: worker as unknown as Worker, entityDocs, foods, nutritionEntries, requests };
}

function legacyFood(food: Food): EntityDocRow {
  return {
    entity_type: "food",
    id: food.id,
    created_at: food.createdAt,
    updated_at: food.updatedAt,
    doc_version: 0,
    value: JSON.stringify(food),
  };
}

function legacyNutrition(entry: NutritionEntry, docVersion = 0): EntityDocRow {
  return {
    entity_type: "nutrition-entry",
    id: entry.id,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
    doc_version: docVersion,
    value: JSON.stringify(entry),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite nutrition-entry relational store", () => {
  it("migrates Food first, preserves nutrition snapshots, and uses relations for CRUD", async () => {
    const timestamp = "2026-08-01T08:00:00.000Z";
    const food: Food = {
      id: "food-legacy",
      name: "Kaurapuuro",
      caloriesPer100G: 70,
      proteinPer100G: 2.5,
      carbsPer100G: 12,
      fatPer100G: 1.5,
      fiberPer100G: 1.8,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 2,
    };
    const legacy: NutritionEntry = {
      id: "nutrition-legacy",
      eatenAt: "2026-08-01T07:45:00.000Z",
      foodId: food.id,
      amountG: 150,
      mealSlotId: "breakfast",
      label: food.name,
      calories: 105,
      proteinG: 3.75,
      carbsG: 18,
      fatG: 2.25,
      fiberG: 2.7,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 3,
    };
    const { worker, entityDocs, foods, nutritionEntries, requests } = createNutritionWorker([
      legacyFood(food),
      legacyNutrition(legacy, 1),
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteNutritionEntryStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(entityDocs.size).toBe(0);
    expect(foods.get(food.id)).toMatchObject({ id: food.id, name: food.name });
    expect(nutritionEntries.get(legacy.id)).toMatchObject({
      id: legacy.id,
      food_id: food.id,
      amount_g: legacy.amountG,
      meal_slot_id: legacy.mealSlotId,
      calories: legacy.calories,
      fiber_g: legacy.fiberG,
    });
    const foodTransfer = requests.findIndex((request) =>
      request.ops?.some((write) => write.op === "putFood"),
    );
    const nutritionTransfer = requests.findIndex((request) =>
      request.ops?.some((write) => write.op === "putNutritionEntry"),
    );
    expect(foodTransfer).toBeGreaterThanOrEqual(0);
    expect(nutritionTransfer).toBeGreaterThan(foodTransfer);

    const saved: NutritionEntry = {
      ...legacy,
      id: "nutrition-new",
      version: 1,
      label: "Oma snapshot",
    };
    expect(await store.save(saved)).toEqual({ ok: true, value: saved });
    expect(await store.getById(saved.id)).toEqual({ ok: true, value: saved });
    expect(await store.remove(saved.id)).toEqual({ ok: true, value: true });
    expect(typeof nutritionEntries.get(saved.id)?.deleted_at).toBe("string");
    expect(nutritionEntries.get(saved.id)).toMatchObject({
      version: 2,
      calories: saved.calories,
    });
    expect(requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("normalizes old missing optional fields and blocks orphaned legacy food links", async () => {
    const timestamp = "2026-08-01T08:00:00.000Z";
    const oldEntry: NutritionEntry = {
      id: "nutrition-old",
      eatenAt: "2026-08-01T07:45:00.000Z",
      label: "Vanha kirjaus",
      calories: 120,
      proteinG: null,
      carbsG: null,
      fatG: null,
      deletedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const oldSource = legacyNutrition(oldEntry);
    const first = createNutritionWorker([oldSource]);
    configureDatabaseWorker({ create: () => first.worker });
    expect(await createSqliteNutritionEntryStore().list()).toEqual({
      ok: true,
      value: [
        {
          ...oldEntry,
          foodId: null,
          amountG: null,
          mealSlotId: null,
          fiberG: null,
          deletedAt: null,
        },
      ],
    });
    expect(first.entityDocs.size).toBe(0);

    resetDatabaseWorkerForTests();
    const orphan: NutritionEntry = { ...oldEntry, id: "nutrition-orphan", foodId: "missing-food" };
    const second = createNutritionWorker([legacyNutrition(orphan)]);
    configureDatabaseWorker({ create: () => second.worker });
    const result = await createSqliteNutritionEntryStore().list();
    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(second.entityDocs.get(docKey("nutrition-entry", orphan.id))).toEqual(
      legacyNutrition(orphan),
    );
    expect(second.nutritionEntries.size).toBe(0);
    expect(second.requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits a nutrition entry and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const entry: NutritionEntry = {
      id: "nutrition-sync",
      eatenAt: at,
      foodId: null,
      amountG: null,
      mealSlotId: null,
      label: "Kaurapuuro",
      calories: 210,
      proteinG: 7,
      carbsG: 34,
      fatG: 5,
      fiberG: 4,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const { worker, nutritionEntries, requests } = createNutritionWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteNutritionEntryStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(14));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(entry, {
          operationId: "installation-1:nutrition-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "eatenAt",
            "foodId",
            "amountG",
            "mealSlotId",
            "label",
            "calories",
            "proteinG",
            "carbsG",
            "fatG",
            "fiberG",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: entry });

      const transaction = requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putNutritionEntry",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(nutritionEntries.get(entry.id)?.label).toBe(entry.label);
    } finally {
      keySession.lock();
    }
  });
});
