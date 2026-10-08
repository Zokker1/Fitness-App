import { afterEach, describe, expect, it } from "vitest";
import type { Goal, GoalDay, HabitRule } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteHabitRuleStore,
  createSqliteGoalDayStore,
  createSqliteGoalStore,
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

function createGoalWorker(
  initialDocs: readonly EntityDocRow[],
  initialHabitRules: readonly Record<string, unknown>[] = [],
) {
  const entityDocs = new Map(initialDocs.map((row) => [`${row.entity_type}:${row.id}`, row]));
  const goals = new Map<string, Record<string, unknown>>();
  const goalDays = new Map<string, Record<string, unknown>>();
  const habitRules = new Map(initialHabitRules.map((row) => [String(row.id), row]));
  const requests: FakeRequest[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as FakeRequest;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        let failure: { readonly code: string; readonly diagnosticCode: string } | null = null;
        const applyWrite = (
          write: FakeWrite,
          nextDocs: Map<string, EntityDocRow>,
          nextGoals: Map<string, Record<string, unknown>>,
          nextDays: Map<string, Record<string, unknown>>,
          nextRules: Map<string, Record<string, unknown>>,
        ): void => {
          const params = write.params;
          if (write.op === "putEntity") {
            const key = `${String(params.entity_type)}:${String(params.id)}`;
            const existing = nextDocs.get(key);
            if (existing !== undefined) {
              nextDocs.set(key, {
                ...existing,
                doc_version: Number(params.doc_version),
                value: String(params.doc),
              });
            }
          } else if (write.op === "putGoal") {
            const id = String(params.id);
            const existing = nextGoals.get(id);
            nextGoals.set(id, {
              id,
              title: params.title,
              description: params.description === "" ? null : params.description,
              active_from: params.active_from === "" ? null : params.active_from,
              active_until: params.active_until === "" ? null : params.active_until,
              archived_at: params.archived_at === "" ? null : params.archived_at,
              created_at: existing?.created_at ?? params.created_at,
              updated_at: params.updated_at,
              version: params.version,
              deleted_at: params.deleted_at === "" ? null : params.deleted_at,
            });
          } else if (write.op === "putGoalDay") {
            const goalId = String(params.goal_id);
            const localDate = String(params.local_date);
            const uniqueConflict = [...nextDays.values()].some(
              (day) =>
                day.goal_id === goalId && day.local_date === localDate && day.id !== params.id,
            );
            if (!nextGoals.has(goalId) || uniqueConflict) {
              throw new Error("goal-day-constraint");
            }
            const id = String(params.id);
            const existing = nextDays.get(id);
            nextDays.set(id, {
              id,
              goal_id: goalId,
              local_date: localDate,
              completed: params.completed,
              created_at: existing?.created_at ?? params.created_at,
              updated_at: params.updated_at,
              version: params.version,
            });
          } else if (write.op === "putHabitRule") {
            const goalId = params.goal_id_is_null ? null : params.goal_id;
            if (goalId !== null && !nextGoals.has(String(goalId))) {
              throw new Error("habit-rule-goal-foreign-key");
            }
            const id = String(params.id);
            const existing = nextRules.get(id);
            nextRules.set(id, {
              id,
              goal_id: goalId,
              title: params.title,
              cadence: params.cadence,
              target_per_period: params.target_per_period,
              created_at: existing?.created_at ?? params.created_at,
              updated_at: params.updated_at,
              version: params.version,
              deleted_at: params.deleted_at_is_null ? null : params.deleted_at,
            });
          } else if (write.op === "deleteEntity") {
            nextDocs.delete(`${String(params.entity_type)}:${String(params.id)}`);
          } else if (write.op === "deleteGoalDay") {
            nextDays.delete(String(params.id));
          }
        };

        if (request.kind === "query" && request.op === "listEntities") {
          const entityType = String(request.params?.entity_type ?? "");
          rows = [...entityDocs.values()].filter((row) => row.entity_type === entityType);
        } else if (request.kind === "query" && request.op === "listGoals") {
          rows = [...goals.values()];
        } else if (request.kind === "query" && request.op === "getGoal") {
          const row = goals.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listHabitRules") {
          rows = [...habitRules.values()];
        } else if (request.kind === "query" && request.op === "getHabitRule") {
          const row = habitRules.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listGoalDays") {
          rows = [...goalDays.values()];
        } else if (request.kind === "query" && request.op === "getGoalDay") {
          const row = goalDays.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(entityDocs);
          const nextGoals = new Map(goals);
          const nextDays = new Map(goalDays);
          const nextRules = new Map(habitRules);
          try {
            for (const write of request.ops ?? []) {
              applyWrite(write, nextDocs, nextGoals, nextDays, nextRules);
            }
            entityDocs.clear();
            for (const [key, row] of nextDocs) entityDocs.set(key, row);
            goals.clear();
            for (const [key, row] of nextGoals) goals.set(key, row);
            goalDays.clear();
            for (const [key, row] of nextDays) goalDays.set(key, row);
            habitRules.clear();
            for (const [key, row] of nextRules) habitRules.set(key, row);
          } catch {
            failure = { code: "invalid-input", diagnosticCode: "fake.goal-day.constraint" };
          }
        } else if (request.kind === "exec" && request.op === "putEntity") {
          const nextDocs = new Map(entityDocs);
          applyWrite(
            { op: request.op, params: request.params ?? {} },
            nextDocs,
            new Map(goals),
            new Map(goalDays),
            new Map(habitRules),
          );
          entityDocs.clear();
          for (const [key, row] of nextDocs) entityDocs.set(key, row);
        } else if (request.kind === "exec" && request.op === "putGoal") {
          applyWrite(
            { op: request.op, params: request.params ?? {} },
            new Map(entityDocs),
            goals,
            goalDays,
            habitRules,
          );
        } else if (request.kind === "exec" && request.op === "putGoalDay") {
          try {
            applyWrite(
              { op: request.op, params: request.params ?? {} },
              new Map(entityDocs),
              new Map(goals),
              goalDays,
              new Map(habitRules),
            );
          } catch {
            failure = { code: "invalid-input", diagnosticCode: "fake.goal-day.constraint" };
          }
        } else if (request.kind === "exec" && request.op === "deleteGoalDay") {
          goalDays.delete(String(request.params?.id ?? ""));
        } else if (request.kind === "exec" && request.op === "putHabitRule") {
          try {
            applyWrite(
              { op: request.op, params: request.params ?? {} },
              new Map(entityDocs),
              new Map(goals),
              new Map(goalDays),
              habitRules,
            );
          } catch {
            failure = { code: "invalid-input", diagnosticCode: "fake.habit-rule.constraint" };
          }
        }

        onmessage?.({
          data:
            failure === null
              ? {
                  requestId: request.requestId,
                  ok: true,
                  rows,
                  backend: "memory",
                  persisted: false,
                }
              : { requestId: request.requestId, ok: false, ...failure },
        } as MessageEvent);
      });
    },
    terminate() {},
    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      onmessage = listener;
    },
    set onerror(_listener: ((event: ErrorEvent) => void) | null) {},
  };

  return { worker: worker as unknown as Worker, entityDocs, goals, goalDays, habitRules, requests };
}

function legacyDoc(
  entityType: string,
  doc: { readonly id: string; readonly createdAt: string; readonly updatedAt: string },
  docVersion = 0,
): EntityDocRow {
  return {
    entity_type: entityType,
    id: doc.id,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    doc_version: docVersion,
    value: JSON.stringify(doc),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite goal relational stores", () => {
  it("migrates HabitRule only after goals and keeps nullable goal references", async () => {
    const timestamp = "2026-09-01T08:00:00.000Z";
    const legacyGoal: Goal = {
      id: "goal-habit-parent",
      title: "Liiku",
      description: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    const legacyRule: HabitRule = {
      id: "habit-rule-legacy",
      goalId: legacyGoal.id,
      title: "Kävely",
      cadence: "weekly",
      targetPerPeriod: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 2,
      deletedAt: null,
    };
    const { worker, entityDocs, goals, habitRules } = createGoalWorker([
      legacyDoc("goal", legacyGoal),
      legacyDoc("habit-rule", legacyRule),
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteHabitRuleStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacyRule] });
    expect(entityDocs.size).toBe(0);
    expect(goals.has(legacyGoal.id)).toBe(true);
    expect(habitRules.get(legacyRule.id)).toMatchObject({
      goal_id: legacyGoal.id,
      cadence: "weekly",
    });

    const changed = { ...legacyRule, goalId: null, title: "Aamukävely", version: 3 };
    expect(await store.save(changed)).toEqual({ ok: true, value: changed });
    expect(await store.getById(changed.id)).toEqual({ ok: true, value: changed });
    expect(await store.remove(changed.id)).toEqual({ ok: true, value: true });
    expect(habitRules.get(changed.id)?.goal_id).toBeNull();
    expect(habitRules.get(changed.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("migrates goal parents before goal days and enforces unique days on later writes", async () => {
    const timestamp = "2026-09-01T08:00:00.000Z";
    const legacyGoal = {
      id: "goal-legacy",
      title: "Aamu-ulkoilu",
      description: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    const legacyDay: GoalDay = {
      id: "goal-day-legacy",
      goalId: legacyGoal.id,
      localDate: "2026-09-01",
      completed: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 2,
    };
    const { worker, entityDocs, goals, goalDays } = createGoalWorker([
      legacyDoc("goal", legacyGoal),
      legacyDoc("goal-day", legacyDay),
    ]);
    configureDatabaseWorker({ create: () => worker });
    const goalStore = createSqliteGoalStore();
    const dayStore = createSqliteGoalDayStore();

    const listedDays = await dayStore.list();

    expect(listedDays).toEqual({ ok: true, value: [legacyDay] });
    expect(entityDocs.size).toBe(0);
    expect(goals.get(legacyGoal.id)).toMatchObject({
      id: legacyGoal.id,
      active_from: null,
      active_until: null,
    });
    expect(goalDays.get(legacyDay.id)).toMatchObject({
      goal_id: legacyGoal.id,
      local_date: legacyDay.localDate,
      completed: 1,
    });

    const goalWithBounds: Goal = {
      id: "goal-new",
      title: "Rajattu tavoite",
      description: "Voimassa syyskuussa",
      activeFrom: "2026-09-01",
      activeUntil: "2026-09-30",
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    expect(await goalStore.save(goalWithBounds)).toEqual({ ok: true, value: goalWithBounds });
    expect(await goalStore.getById(goalWithBounds.id)).toEqual({
      ok: true,
      value: goalWithBounds,
    });

    const anotherDay: GoalDay = {
      ...legacyDay,
      id: "goal-day-new",
      goalId: goalWithBounds.id,
      completed: false,
      version: 1,
    };
    expect(await dayStore.save(anotherDay)).toEqual({ ok: true, value: anotherDay });
    expect(
      await dayStore.save({ ...anotherDay, id: "goal-day-duplicate", completed: true }),
    ).toMatchObject({ ok: false });
    expect(await dayStore.remove(anotherDay.id)).toEqual({ ok: true, value: true });
    expect(goalDays.has(anotherDay.id)).toBe(false);
    expect(await goalStore.remove(goalWithBounds.id)).toEqual({ ok: true, value: true });
    const deletedGoal = await goalStore.getById(goalWithBounds.id);
    expect(deletedGoal.ok && deletedGoal.value.deletedAt).toEqual(expect.any(String));
    expect(goals.has(goalWithBounds.id)).toBe(true);
  });

  it("commits a goal day and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const goal: Goal = {
      id: "goal-day-sync-parent",
      title: "Päivittäinen kävely",
      description: null,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
      deletedAt: null,
    };
    const day: GoalDay = {
      id: "goal-day-sync",
      goalId: goal.id,
      localDate: "2026-09-03",
      completed: true,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createGoalWorker([legacyDoc("goal", goal)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteGoalDayStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(19));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(day, {
          operationId: "installation-1:goal-day-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: ["goalId", "localDate", "completed"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: day });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putGoalDay",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.goalDays.get(day.id)?.completed).toBe(1);
    } finally {
      keySession.lock();
    }
  });

  it("commits a goal and encrypted sync operation in one transaction", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const goal: Goal = {
      id: "goal-sync",
      title: "Synkattava tavoite",
      description: null,
      activeFrom: null,
      activeUntil: null,
      archivedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
      deletedAt: null,
    };
    const { worker, goals, requests } = createGoalWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteGoalStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(6));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(goal, {
          operationId: "installation-1:goal-1",
          installationId: "installation-1",
          operation: "create",
          occurredAt: goal.updatedAt,
          changedFields: [
            "title",
            "description",
            "activeFrom",
            "activeUntil",
            "archivedAt",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: goal });

      const writeBatch = requests.at(-1);
      expect(writeBatch?.kind).toBe("transaction");
      expect(writeBatch?.ops?.map((write) => write.op)).toEqual(["putGoal", "putSyncOperation"]);
      expect(writeBatch?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(goals.get(goal.id)?.title).toBe(goal.title);
    } finally {
      keySession.lock();
    }
  });

  it("commits a habit rule and encrypted sync operation in one transaction", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const rule: HabitRule = {
      id: "habit-rule-sync",
      goalId: null,
      title: "Viikkokävely",
      cadence: "weekly",
      targetPerPeriod: 3,
      createdAt: at,
      updatedAt: at,
      version: 1,
      deletedAt: null,
    };
    const { worker, habitRules, requests } = createGoalWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteHabitRuleStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(8));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(rule, {
          operationId: "installation-1:habit-rule-1",
          installationId: "installation-1",
          operation: "create",
          occurredAt: rule.updatedAt,
          changedFields: ["goalId", "title", "cadence", "targetPerPeriod", "deletedAt"],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: rule });

      const writeBatch = requests.at(-1);
      expect(writeBatch?.kind).toBe("transaction");
      expect(writeBatch?.ops?.map((write) => write.op)).toEqual([
        "putHabitRule",
        "putSyncOperation",
      ]);
      expect(writeBatch?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(habitRules.get(rule.id)?.title).toBe(rule.title);
    } finally {
      keySession.lock();
    }
  });

  it("keeps orphaned legacy goal days unchanged instead of violating the foreign key", async () => {
    const timestamp = "2026-09-01T08:00:00.000Z";
    const orphan: GoalDay = {
      id: "goal-day-orphan",
      goalId: "missing-goal",
      localDate: "2026-09-01",
      completed: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const row = legacyDoc("goal-day", orphan);
    const { worker, entityDocs, goalDays } = createGoalWorker([row]);
    configureDatabaseWorker({ create: () => worker });

    const result = await createSqliteGoalDayStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.get(`goal-day:${orphan.id}`)).toEqual(row);
    expect(goalDays.size).toBe(0);
  });

  it("keeps duplicate legacy goal dates unchanged instead of losing rows", async () => {
    const timestamp = "2026-09-01T08:00:00.000Z";
    const goal = {
      id: "goal-duplicate-parent",
      title: "Kävely",
      description: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    const first: GoalDay = {
      id: "goal-day-duplicate-1",
      goalId: goal.id,
      localDate: "2026-09-01",
      completed: true,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    const second: GoalDay = { ...first, id: "goal-day-duplicate-2", completed: false };
    const { worker, entityDocs, goalDays, requests } = createGoalWorker([
      legacyDoc("goal", goal),
      legacyDoc("goal-day", first),
      legacyDoc("goal-day", second),
    ]);
    configureDatabaseWorker({ create: () => worker });

    const result = await createSqliteGoalDayStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.has(`goal-day:${first.id}`)).toBe(true);
    expect(entityDocs.has(`goal-day:${second.id}`)).toBe(true);
    expect(goalDays.size).toBe(0);
    expect(
      requests.some((request) => request.ops?.some((write) => write.op === "putGoalDay")),
    ).toBe(false);
  });

  it("keeps a habit rule with a missing goal in entity_docs", async () => {
    const timestamp = "2026-09-01T08:00:00.000Z";
    const orphan: HabitRule = {
      id: "habit-rule-orphan",
      goalId: "missing-goal",
      title: "Kävely",
      cadence: "weekly",
      targetPerPeriod: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    const row = legacyDoc("habit-rule", orphan);
    const { worker, entityDocs, habitRules } = createGoalWorker([row]);
    configureDatabaseWorker({ create: () => worker });

    const result = await createSqliteHabitRuleStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.get(`habit-rule:${orphan.id}`)).toEqual(row);
    expect(habitRules.size).toBe(0);
  });

  it("does not delete a legacy HabitRule when its relational id already exists", async () => {
    const timestamp = "2026-09-01T08:00:00.000Z";
    const goal: Goal = {
      id: "goal-habit-collision",
      title: "Liiku",
      description: null,
      archivedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    const legacyRule: HabitRule = {
      id: "habit-rule-collision",
      goalId: goal.id,
      title: "Kävely",
      cadence: "weekly",
      targetPerPeriod: 3,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
      deletedAt: null,
    };
    const existing = {
      id: legacyRule.id,
      goal_id: null,
      title: "Vanha nykyinen rivi",
      cadence: "daily",
      target_per_period: 1,
      created_at: timestamp,
      updated_at: timestamp,
      version: 1,
      deleted_at: null,
    };
    const { worker, entityDocs, habitRules } = createGoalWorker(
      [legacyDoc("goal", goal), legacyDoc("habit-rule", legacyRule)],
      [existing],
    );
    configureDatabaseWorker({ create: () => worker });

    const result = await createSqliteHabitRuleStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.has(`habit-rule:${legacyRule.id}`)).toBe(true);
    expect(habitRules.get(legacyRule.id)?.title).toBe("Vanha nykyinen rivi");
  });
});
