import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Quest, QuestProgress } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteQuestProgressStore,
  createSqliteQuestStore,
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
  const questRows = new Map<string, Record<string, unknown>>();
  const progressRows = new Map<string, Record<string, unknown>>();
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
        } else if (request.kind === "query" && request.op === "listQuests") {
          rows = [...questRows.values()];
        } else if (request.kind === "query" && request.op === "getQuest") {
          const row = questRows.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listQuestProgress") {
          rows = [...progressRows.values()];
        } else if (request.kind === "query" && request.op === "getQuestProgress") {
          const row = progressRows.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextQuests = new Map(questRows);
          const nextProgress = new Map(progressRows);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putQuest") {
              const params = write.params;
              nextQuests.set(id, {
                id,
                title: params.title,
                description: params.description === "" ? null : params.description,
                active_from: params.active_from === "" ? null : params.active_from,
                active_until: params.active_until === "" ? null : params.active_until,
                condition_kind: params.condition_kind === "" ? null : params.condition_kind,
                condition_goal: params.condition_goal === "" ? null : params.condition_goal,
                minimum_amount: params.minimum_amount === "" ? null : params.minimum_amount,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "putQuestProgress") {
              const params = write.params;
              if (![...nextQuests.keys()].includes(String(params.quest_id))) {
                throw new Error("missing quest");
              }
              nextProgress.set(id, {
                id,
                quest_id: params.quest_id,
                progress: params.progress,
                goal: params.goal,
                completed_at: params.completed_at === "" ? null : params.completed_at,
                created_at: params.created_at,
                updated_at: params.updated_at,
                version: params.version,
              });
            } else if (write.op === "deleteQuestProgress") {
              nextProgress.delete(id);
            } else if (write.op === "deleteQuest") {
              nextQuests.delete(id);
              for (const [progressId, progress] of nextProgress) {
                if (progress.quest_id === id) nextProgress.delete(progressId);
              }
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          questRows.clear();
          for (const [id, row] of nextQuests) questRows.set(id, row);
          progressRows.clear();
          for (const [id, row] of nextProgress) progressRows.set(id, row);
        } else if (request.kind === "exec" && request.op === "deleteQuestProgress") {
          progressRows.delete(sqlText(request.params?.id));
        } else if (request.kind === "exec" && request.op === "deleteQuest") {
          const id = sqlText(request.params?.id);
          questRows.delete(id);
          for (const [progressId, progress] of progressRows) {
            if (progress.quest_id === id) progressRows.delete(progressId);
          }
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
  return { worker: worker as unknown as Worker, docs, questRows, progressRows, requests };
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

describe("SQLite Quest and QuestProgress relational stores", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const quest: Quest = {
    id: "quest-week",
    title: "Viikon haaste",
    description: "Tee kolme fokus-sessiota.",
    activeFrom: at,
    activeUntil: "2026-09-07T20:59:00.000Z",
    condition: null,
    createdAt: at,
    updatedAt: at,
    version: 2,
  };
  const progress: QuestProgress = {
    id: "quest-progress-week",
    questId: quest.id,
    progress: 2,
    goal: 3,
    completedAt: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
  };

  it("siirtää vanhan questin ennen progressia ja tukee get/save/remove-operaatioita", async () => {
    const legacyQuest = { ...quest, condition: undefined };
    const fixture = createWorker([
      legacyDoc("quest", legacyQuest),
      legacyDoc("quest-progress", progress),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const quests = createSqliteQuestStore();
    const progressStore = createSqliteQuestProgressStore();

    expect(await progressStore.list()).toEqual({ ok: true, value: [progress] });
    expect(fixture.docs.size).toBe(0);
    expect(fixture.questRows.get(quest.id)).toMatchObject({
      title: quest.title,
      condition_kind: null,
      condition_goal: null,
      minimum_amount: null,
    });
    expect(fixture.progressRows.get(progress.id)).toMatchObject({ quest_id: quest.id, goal: 3 });
    const writes = fixture.requests
      .filter((request) => request.kind === "transaction")
      .flatMap((request) => request.ops ?? []);
    expect(writes.findIndex((write) => write.op === "putQuest")).toBeLessThan(
      writes.findIndex((write) => write.op === "putQuestProgress"),
    );

    const configuredQuest: Quest = {
      ...quest,
      condition: { kind: "active-day-count", goal: 5, minimumAmount: 100 },
    };
    expect(await quests.save(configuredQuest)).toEqual({ ok: true, value: configuredQuest });
    expect(await quests.getById(quest.id)).toEqual({ ok: true, value: configuredQuest });
    expect(fixture.questRows.get(quest.id)).toMatchObject({
      condition_kind: "active-day-count",
      condition_goal: 5,
      minimum_amount: 100,
    });

    const updated = { ...progress, progress: 3, completedAt: "2026-09-06T12:00:00.000Z" };
    expect(await progressStore.save(updated)).toEqual({ ok: true, value: updated });
    expect(await progressStore.getById(progress.id)).toEqual({ ok: true, value: updated });
    expect(await progressStore.remove(progress.id)).toEqual({ ok: true, value: true });
    expect(await quests.remove(quest.id)).toEqual({ ok: true, value: true });
    expect(fixture.progressRows.size).toBe(0);
    expect(fixture.questRows.size).toBe(0);
  });

  it("hylkää virheellisen questin ennen kirjoitusta ja rajaa nimetyt worker-operaatiot", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const quests = createSqliteQuestStore();
    const invalid = { ...quest, activeFrom: "2026-09-08T00:00:00.000Z" };
    expect(await quests.save(invalid)).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });

    expect(
      isDbRequest({
        requestId: "quest-write",
        kind: "exec",
        op: "putQuest",
        params: {
          id: "q-1",
          title: "Haaste",
          description: "",
          active_from: "",
          active_until: "",
          condition_kind: "event-count",
          condition_goal: 3,
          minimum_amount: "",
          created_at: at,
          updated_at: at,
          version: 1,
        },
      }),
    ).toBe(true);
    expect(
      isDbRequest({
        requestId: "quest-write-invalid",
        kind: "exec",
        op: "putQuest",
        params: { id: "q-1" },
      }),
    ).toBe(false);
    expect(fixture.requests.filter((request) => request.kind === "transaction")).toHaveLength(0);
  });
});
