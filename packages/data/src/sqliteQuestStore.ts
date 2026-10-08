import type {
  EntityId,
  Quest,
  QuestCondition,
  QuestConditionKind,
  QuestProgress,
} from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const QUEST_TYPE = "quest";
const PROGRESS_TYPE = "quest-progress";
const LEGACY_BATCH_SIZE = 32;

interface QuestRow {
  readonly id?: unknown;
  readonly title?: unknown;
  readonly description?: unknown;
  readonly active_from?: unknown;
  readonly active_until?: unknown;
  readonly condition_kind?: unknown;
  readonly condition_goal?: unknown;
  readonly minimum_amount?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

interface QuestProgressRow {
  readonly id?: unknown;
  readonly quest_id?: unknown;
  readonly progress?: unknown;
  readonly goal?: unknown;
  readonly completed_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corrupted(type: typeof QUEST_TYPE | typeof PROGRESS_TYPE): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua haastetta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: `data.${type}.invalid`,
    },
  };
}

function normalizeQuest(quest: Quest): Quest {
  const description: unknown = quest.description;
  return {
    ...quest,
    description:
      description === null || description === undefined || description === ""
        ? null
        : quest.description,
    activeFrom: quest.activeFrom ?? null,
    activeUntil: quest.activeUntil ?? null,
    condition: quest.condition ?? null,
  };
}

function validConditionKind(value: unknown): value is QuestConditionKind {
  return value === "event-count" || value === "active-day-count";
}

function validQuestCondition(condition: QuestCondition | null): boolean {
  return (
    condition === null ||
    (validConditionKind(condition.kind) &&
      Number.isInteger(condition.goal) &&
      condition.goal >= 1 &&
      (condition.minimumAmount === undefined ||
        (Number.isFinite(condition.minimumAmount) && condition.minimumAmount > 0)))
  );
}

export function validQuest(quest: Quest): boolean {
  return (
    typeof quest.id === "string" &&
    quest.id.length > 0 &&
    typeof quest.title === "string" &&
    quest.title.trim().length > 0 &&
    quest.title.length <= 200 &&
    (quest.description === null || typeof quest.description === "string") &&
    (quest.activeFrom === null ||
      (typeof quest.activeFrom === "string" && quest.activeFrom.length > 0)) &&
    (quest.activeUntil === null ||
      (typeof quest.activeUntil === "string" && quest.activeUntil.length > 0)) &&
    (quest.activeFrom === null ||
      quest.activeUntil === null ||
      quest.activeUntil >= quest.activeFrom) &&
    validQuestCondition(quest.condition) &&
    typeof quest.createdAt === "string" &&
    quest.createdAt.length > 0 &&
    typeof quest.updatedAt === "string" &&
    quest.updatedAt.length > 0 &&
    Number.isInteger(quest.version) &&
    quest.version >= 1
  );
}

function normalizeProgress(progress: QuestProgress): QuestProgress {
  return { ...progress, completedAt: progress.completedAt ?? null };
}

export function validProgress(progress: QuestProgress): boolean {
  return (
    typeof progress.id === "string" &&
    progress.id.length > 0 &&
    typeof progress.questId === "string" &&
    progress.questId.length > 0 &&
    Number.isInteger(progress.progress) &&
    progress.progress >= 0 &&
    Number.isInteger(progress.goal) &&
    progress.goal >= 1 &&
    (progress.completedAt === null ||
      (typeof progress.completedAt === "string" && progress.completedAt.length > 0)) &&
    typeof progress.createdAt === "string" &&
    progress.createdAt.length > 0 &&
    typeof progress.updatedAt === "string" &&
    progress.updatedAt.length > 0 &&
    Number.isInteger(progress.version) &&
    progress.version >= 1
  );
}

export function putQuestOp(quest: Quest): DbTransactionOp {
  return {
    op: "putQuest",
    params: {
      id: quest.id,
      title: quest.title,
      description: quest.description ?? "",
      active_from: quest.activeFrom ?? "",
      active_until: quest.activeUntil ?? "",
      condition_kind: quest.condition?.kind ?? "",
      condition_goal: quest.condition?.goal ?? "",
      minimum_amount: quest.condition?.minimumAmount ?? "",
      created_at: quest.createdAt,
      updated_at: quest.updatedAt,
      version: quest.version,
    },
  };
}

export function putProgressOp(progress: QuestProgress): DbTransactionOp {
  return {
    op: "putQuestProgress",
    params: {
      id: progress.id,
      quest_id: progress.questId,
      progress: progress.progress,
      goal: progress.goal,
      completed_at: progress.completedAt ?? "",
      created_at: progress.createdAt,
      updated_at: progress.updatedAt,
      version: progress.version,
    },
  };
}

async function migrateLegacyQuests(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<Quest>(QUEST_TYPE).list();
  if (!legacy.ok) return legacy;
  const quests = legacy.value.map(normalizeQuest);
  if (quests.some((quest) => !validQuest(quest))) return corrupted(QUEST_TYPE);

  for (let offset = 0; offset < quests.length; offset += LEGACY_BATCH_SIZE) {
    const batch = quests.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const quest of batch) {
      ops.push(putQuestOp(quest));
      ops.push({ op: "deleteEntity", params: { entity_type: QUEST_TYPE, id: quest.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

async function migrateLegacyProgress(questStore: EntityStore<Quest>): Promise<DataResult<true>> {
  // Questin FK edellyttää, että vanhat quest-rivit siirretään ensin.
  const questResult = await questStore.list();
  if (!questResult.ok) return questResult;
  const questIds = new Set(questResult.value.map((quest) => quest.id));
  const legacy = await createSqliteEntityDocStore<QuestProgress>(PROGRESS_TYPE).list();
  if (!legacy.ok) return legacy;
  const progressRows = legacy.value.map(normalizeProgress);
  if (
    progressRows.some((progress) => !validProgress(progress) || !questIds.has(progress.questId))
  ) {
    return corrupted(PROGRESS_TYPE);
  }

  for (let offset = 0; offset < progressRows.length; offset += LEGACY_BATCH_SIZE) {
    const batch = progressRows.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const progress of batch) {
      ops.push(putProgressOp(progress));
      ops.push({ op: "deleteEntity", params: { entity_type: PROGRESS_TYPE, id: progress.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

function parseQuests(rows: readonly unknown[]): DataResult<readonly Quest[]> {
  const quests: Quest[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corrupted(QUEST_TYPE);
    }
    const row = value as QuestRow;
    if (
      typeof row.id !== "string" ||
      typeof row.title !== "string" ||
      (row.description !== null && typeof row.description !== "string") ||
      (row.active_from !== null && typeof row.active_from !== "string") ||
      (row.active_until !== null && typeof row.active_until !== "string") ||
      (row.condition_kind !== null && typeof row.condition_kind !== "string") ||
      (row.condition_goal !== null && typeof row.condition_goal !== "number") ||
      (row.minimum_amount !== null && typeof row.minimum_amount !== "number") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corrupted(QUEST_TYPE);
    }
    let condition: QuestCondition | null;
    if (row.condition_kind === null && row.condition_goal === null && row.minimum_amount === null) {
      condition = null;
    } else if (validConditionKind(row.condition_kind) && typeof row.condition_goal === "number") {
      condition = {
        kind: row.condition_kind,
        goal: row.condition_goal,
        ...(row.minimum_amount === null ? {} : { minimumAmount: row.minimum_amount }),
      };
    } else {
      return corrupted(QUEST_TYPE);
    }
    const quest: Quest = {
      id: row.id,
      title: row.title,
      description: row.description,
      activeFrom: row.active_from,
      activeUntil: row.active_until,
      condition,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validQuest(quest)) return corrupted(QUEST_TYPE);
    quests.push(quest);
  }
  return { ok: true, value: quests };
}

function parseProgress(rows: readonly unknown[]): DataResult<readonly QuestProgress[]> {
  const progressRows: QuestProgress[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corrupted(PROGRESS_TYPE);
    }
    const row = value as QuestProgressRow;
    if (
      typeof row.id !== "string" ||
      typeof row.quest_id !== "string" ||
      typeof row.progress !== "number" ||
      typeof row.goal !== "number" ||
      (row.completed_at !== null && typeof row.completed_at !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corrupted(PROGRESS_TYPE);
    }
    const progress: QuestProgress = {
      id: row.id,
      questId: row.quest_id,
      progress: row.progress,
      goal: row.goal,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validProgress(progress)) return corrupted(PROGRESS_TYPE);
    progressRows.push(progress);
  }
  return { ok: true, value: progressRows };
}

export function createSqliteQuestStore(): EntityStore<Quest> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyQuests();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Quest> = {
    entityType: QUEST_TYPE,
    async list(): Promise<DataResult<readonly Quest[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listQuests", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseQuests(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Quest>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getQuest", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as Quest);
      const parsed = parseQuests(response.rows);
      if (!parsed.ok) return parsed;
      const quest = parsed.value[0];
      return quest === undefined
        ? { ok: false, error: notFound(QUEST_TYPE) }
        : { ok: true, value: quest };
    },
    async save(value: Quest): Promise<DataResult<Quest>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const quest = normalizeQuest(value);
      if (!validQuest(quest)) {
        return {
          ok: false,
          error: invalidInput("data.quest.invalid", "Haasteen tiedot eivät kelpaa."),
        };
      }
      const response = await sendDbRequest({ kind: "transaction", ops: [putQuestOp(quest)] });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: quest } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      // Siirrä ensin vanhat progress-rivit, jotta cascade ei jätä legacy-docien
      // viitteitä orvoiksi.
      const progress = await createSqliteQuestProgressStore().list();
      if (!progress.ok) return progress;
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteQuest", params: { id } }],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}

export function createSqliteQuestProgressStore(): EntityStore<QuestProgress> {
  const questStore = createSqliteQuestStore();
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyProgress(questStore);
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<QuestProgress> = {
    entityType: PROGRESS_TYPE,
    async list(): Promise<DataResult<readonly QuestProgress[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listQuestProgress", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseProgress(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<QuestProgress>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getQuestProgress",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as QuestProgress);
      const parsed = parseProgress(response.rows);
      if (!parsed.ok) return parsed;
      const progress = parsed.value[0];
      return progress === undefined
        ? { ok: false, error: notFound(PROGRESS_TYPE) }
        : { ok: true, value: progress };
    },
    async save(value: QuestProgress): Promise<DataResult<QuestProgress>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const progress = normalizeProgress(value);
      if (!validProgress(progress)) {
        return {
          ok: false,
          error: invalidInput(
            "data.quest-progress.invalid",
            "Haasteen etenemätiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putProgressOp(progress)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: progress } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [{ op: "deleteQuestProgress", params: { id } }],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: true } : result;
    },
  };
  return store;
}
