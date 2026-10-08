import { sqlText, parseSqlDocument } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Goal, NutritionEntry, RoutineStep, SupplementLog, Task } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteEntityDocStore,
  resetDatabaseWorkerForTests,
} from "../src/index.ts";

interface EntityDocRow {
  readonly id: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly doc_version: number;
  readonly value: string;
}

function createEntityDocWorker(initialRows: readonly EntityDocRow[]) {
  const rows = new Map(initialRows.map((row) => [row.id, row]));
  const writes: Record<string, unknown>[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as {
        readonly requestId: string;
        readonly kind: string;
        readonly op?: string;
        readonly params?: Record<string, unknown>;
      };
      queueMicrotask(() => {
        let resultRows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "getEntity") {
          const id = sqlText(request.params?.id);
          const row = rows.get(id);
          resultRows = row === undefined ? [] : [row];
        } else if (request.kind === "exec" && request.op === "putEntity") {
          const params = request.params ?? {};
          writes.push(params);
          const id = sqlText(params.id);
          const existing = rows.get(id);
          if (existing !== undefined) {
            rows.set(id, {
              ...existing,
              doc_version: Number(params.doc_version),
              value: sqlText(params.doc),
            });
          }
        }
        onmessage?.({
          data: {
            requestId: request.requestId,
            ok: true,
            rows: resultRows,
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

  return { worker: worker as unknown as Worker, rows, writes };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite entity-doc versioning", () => {
  it("normalizes missing legacy nutrition details to null and preserves recorded values", async () => {
    const createdAt = "2026-05-01T00:00:00.000Z";
    const updatedAt = "2026-05-02T00:00:00.000Z";
    const { worker, writes } = createEntityDocWorker([
      {
        id: "nutrition-entry-legacy",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "nutrition-entry-legacy",
          createdAt,
          updatedAt,
          version: 1,
          eatenAt: createdAt,
          label: "Vanha käsinkirjaus",
          calories: null,
          proteinG: null,
          carbsG: null,
          fatG: null,
          deletedAt: null,
        }),
      },
      {
        id: "nutrition-entry-linked",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "nutrition-entry-linked",
          createdAt,
          updatedAt,
          version: 2,
          eatenAt: createdAt,
          foodId: "food-1",
          amountG: 125,
          mealSlotId: "lunch",
          label: "Riisipuuro",
          calories: 150,
          proteinG: 5,
          carbsG: 25,
          fatG: 3,
          fiberG: 2,
          deletedAt: null,
        }),
      },
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteEntityDocStore<NutritionEntry>("nutrition-entry");

    const legacy = await store.getById("nutrition-entry-legacy");
    const linked = await store.getById("nutrition-entry-linked");

    expect(
      legacy.ok && [
        legacy.value.foodId,
        legacy.value.amountG,
        legacy.value.mealSlotId,
        legacy.value.fiberG,
      ],
    ).toEqual([null, null, null, null]);
    expect(
      linked.ok && [
        linked.value.foodId,
        linked.value.amountG,
        linked.value.mealSlotId,
        linked.value.fiberG,
      ],
    ).toEqual(["food-1", 125, "lunch", 2]);
    expect(writes.map((write) => write.doc_version)).toEqual([1, 1]);
  });

  it("normalizes legacy goal date bounds to open-ended null values", async () => {
    const createdAt = "2026-03-01T00:00:00.000Z";
    const updatedAt = "2026-03-02T00:00:00.000Z";
    const { worker, writes } = createEntityDocWorker([
      {
        id: "goal-without-date-bounds",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "goal-without-date-bounds",
          createdAt,
          updatedAt,
          version: 1,
          title: "Avoin tavoite",
        }),
      },
      {
        id: "goal-with-existing-bounds",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "goal-with-existing-bounds",
          createdAt,
          updatedAt,
          version: 2,
          title: "Rajattu tavoite",
          activeFrom: "2026-03-01",
          activeUntil: "2026-03-31",
        }),
      },
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteEntityDocStore<Goal>("goal");

    const openGoal = await store.getById("goal-without-date-bounds");
    const boundedGoal = await store.getById("goal-with-existing-bounds");

    expect(openGoal.ok && [openGoal.value.activeFrom, openGoal.value.activeUntil]).toEqual([
      null,
      null,
    ]);
    expect(boundedGoal.ok && [boundedGoal.value.activeFrom, boundedGoal.value.activeUntil]).toEqual(
      ["2026-03-01", "2026-03-31"],
    );
    expect(writes.map((write) => write.doc_version)).toEqual([1, 1]);
  });

  it("infers a legacy supplement-log status from takenAt", async () => {
    const createdAt = "2026-04-01T00:00:00.000Z";
    const updatedAt = "2026-04-02T00:00:00.000Z";
    const { worker, writes } = createEntityDocWorker([
      {
        id: "supplement-log-taken",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "supplement-log-taken",
          createdAt,
          updatedAt,
          version: 1,
          takenAt: "2026-04-01T09:00:00.000Z",
        }),
      },
      {
        id: "supplement-log-pending",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "supplement-log-pending",
          createdAt,
          updatedAt,
          version: 2,
          takenAt: null,
        }),
      },
      {
        id: "supplement-log-skipped",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "supplement-log-skipped",
          createdAt,
          updatedAt,
          version: 3,
          status: "skipped",
          takenAt: null,
        }),
      },
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteEntityDocStore<SupplementLog>("supplement-log");

    const taken = await store.getById("supplement-log-taken");
    const pending = await store.getById("supplement-log-pending");
    const skipped = await store.getById("supplement-log-skipped");

    expect(taken.ok && taken.value.status).toBe("taken");
    expect(pending.ok && pending.value.status).toBe("pending");
    expect(skipped.ok && skipped.value.status).toBe("skipped");
    expect(writes.map((write) => write.doc_version)).toEqual([1, 1, 1]);
    expect(writes.map((write) => parseSqlDocument(write.doc).status)).toEqual([
      "taken",
      "pending",
      "skipped",
    ]);
  });

  it("defaults missing legacy task actualSeconds to zero and preserves recorded time", async () => {
    const createdAt = "2026-02-01T00:00:00.000Z";
    const updatedAt = "2026-02-02T00:00:00.000Z";
    const { worker, writes } = createEntityDocWorker([
      {
        id: "task-without-actual-time",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "task-without-actual-time",
          createdAt,
          updatedAt,
          version: 4,
        }),
      },
      {
        id: "task-with-recorded-time",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "task-with-recorded-time",
          createdAt,
          updatedAt,
          version: 5,
          actualSeconds: 840,
        }),
      },
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteEntityDocStore<Task>("task");

    const missingTime = await store.getById("task-without-actual-time");
    const recordedTime = await store.getById("task-with-recorded-time");

    expect(missingTime.ok && missingTime.value.actualSeconds).toBe(0);
    expect(recordedTime.ok && recordedTime.value.actualSeconds).toBe(840);
    expect(writes.map((write) => write.doc_version)).toEqual([1, 1]);
    expect(writes.map((write) => parseSqlDocument(write.doc).actualSeconds)).toEqual([0, 840]);
  });

  it("migrates legacy routine steps on read and preserves an existing optional choice", async () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const updatedAt = "2026-01-02T00:00:00.000Z";
    const { worker, writes } = createEntityDocWorker([
      {
        id: "routine-step-old-required",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "routine-step-old-required",
          createdAt,
          updatedAt,
          version: 3,
          title: "Vanha vaihe",
        }),
      },
      {
        id: "routine-step-old-optional",
        created_at: createdAt,
        updated_at: updatedAt,
        doc_version: 0,
        value: JSON.stringify({
          id: "routine-step-old-optional",
          createdAt,
          updatedAt,
          version: 2,
          title: "Valinnainen vaihe",
          optional: true,
        }),
      },
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteEntityDocStore<RoutineStep>("routine-step");

    const required = await store.getById("routine-step-old-required");
    const optional = await store.getById("routine-step-old-optional");

    expect(required.ok && required.value.optional).toBe(false);
    expect(optional.ok && optional.value.optional).toBe(true);
    expect(writes).toHaveLength(2);
    expect(writes.map((write) => write.doc_version)).toEqual([1, 1]);
    expect(writes.map((write) => parseSqlDocument(write.doc).optional)).toEqual([false, true]);
    expect(writes.map((write) => [write.created_at, write.updated_at])).toEqual([
      [createdAt, updatedAt],
      [createdAt, updatedAt],
    ]);
  });
});
