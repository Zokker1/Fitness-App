import type { EntityId, Tag } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";

const ENTITY_TYPE = "tag";
const LEGACY_BATCH_SIZE = 32;

interface TagRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly color_key?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedTag(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tunnistetta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.tag.invalid",
    },
  };
}

export function validTag(tag: Tag): boolean {
  return (
    typeof tag.id === "string" &&
    tag.id.length > 0 &&
    typeof tag.name === "string" &&
    tag.name.trim().length > 0 &&
    tag.name.length <= 60 &&
    (tag.colorKey === null || typeof tag.colorKey === "string") &&
    typeof tag.createdAt === "string" &&
    tag.createdAt.length > 0 &&
    typeof tag.updatedAt === "string" &&
    tag.updatedAt.length > 0 &&
    Number.isInteger(tag.version) &&
    tag.version >= 1 &&
    (tag.deletedAt === null || typeof tag.deletedAt === "string")
  );
}

export function putTagOp(tag: Tag): DbTransactionOp {
  return {
    op: "putTag",
    params: {
      id: tag.id,
      name: tag.name,
      color_key: tag.colorKey ?? "",
      color_key_is_null: tag.colorKey === null,
      created_at: tag.createdAt,
      updated_at: tag.updatedAt,
      version: tag.version,
      deleted_at: tag.deletedAt ?? "",
      deleted_at_is_null: tag.deletedAt === null,
    },
  };
}

function parseTags(rows: readonly unknown[]): DataResult<readonly Tag[]> {
  const tags: Tag[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedTag();
    }
    const row = value as TagRow;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      (row.color_key !== null && typeof row.color_key !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedTag();
    }
    const tag: Tag = {
      id: row.id,
      name: row.name,
      colorKey: row.color_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validTag(tag)) return corruptedTag();
    tags.push(tag);
  }
  return { ok: true, value: tags };
}

async function migrateLegacyTags(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<Tag>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const tags = legacy.value;
  const legacyIds = new Set<string>();
  const legacyNames = new Set<string>();
  for (const tag of tags) {
    if (!validTag(tag) || legacyIds.has(tag.id) || legacyNames.has(tag.name)) {
      return corruptedTag();
    }
    legacyIds.add(tag.id);
    legacyNames.add(tag.name);
  }

  const currentResponse = await sendDbRequest({ kind: "query", op: "listTags", params: {} });
  if (!currentResponse.ok) return toDataResult(currentResponse, () => true as const);
  const current = parseTags(currentResponse.rows);
  if (!current.ok) return current;
  const currentIds = new Set(current.value.map((tag) => tag.id));
  const currentNames = new Set(current.value.map((tag) => tag.name));
  if (tags.some((tag) => currentIds.has(tag.id) || currentNames.has(tag.name))) {
    return corruptedTag();
  }

  for (let offset = 0; offset < tags.length; offset += LEGACY_BATCH_SIZE) {
    const batch = tags.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const tag of batch) {
      ops.push(putTagOp(tag));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: tag.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteTagStore(): EntityStore<Tag> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyTags();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Tag> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Tag[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listTags", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseTags(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Tag>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getTag", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as Tag);
      const parsed = parseTags(response.rows);
      if (!parsed.ok) return parsed;
      const tag = parsed.value[0];
      return tag === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: tag };
    },
    async save(value: Tag): Promise<DataResult<Tag>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validTag(value)) {
        return {
          ok: false,
          error: invalidInput("data.tag.invalid", "Tunnisteen tiedot eivät kelpaa."),
        };
      }
      const listed = await store.list();
      if (!listed.ok) return listed;
      if (listed.value.some((tag) => tag.name === value.name && tag.id !== value.id)) {
        return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      }
      const response = await sendDbRequest({ kind: "transaction", ops: [putTagOp(value)] });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async saveWithSyncOperation(value: Tag, context: SyncWriteContext): Promise<DataResult<Tag>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validTag(value)) {
        return {
          ok: false,
          error: invalidInput("data.tag.invalid", "Tunnisteen tiedot eivät kelpaa."),
        };
      }
      const listed = await store.list();
      if (!listed.ok) return listed;
      if (listed.value.some((tag) => tag.name === value.name && tag.id !== value.id)) {
        return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: value.id,
        operation: context.operation,
        entityVersion: value.version,
        occurredAt: context.occurredAt,
        createdAt: value.createdAt,
        entity: value as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putTagOp(value)],
      });
      return committed.ok ? { ok: true, value } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const now = new Date().toISOString();
      const saved = await store.save({ ...existing.value, deletedAt: now, updatedAt: now });
      return saved.ok ? { ok: true, value: true } : saved;
    },
  };
  return store;
}
