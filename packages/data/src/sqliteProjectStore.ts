import type { EntityId, Project } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";

const ENTITY_TYPE = "project";
const LEGACY_BATCH_SIZE = 32;

interface ProjectRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly color_key?: unknown;
  readonly archived_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedProject(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua projektia ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.project.invalid",
    },
  };
}

export function validProject(project: Project): boolean {
  return (
    typeof project.id === "string" &&
    project.id.length > 0 &&
    typeof project.name === "string" &&
    project.name.trim().length > 0 &&
    project.name.length <= 200 &&
    (project.colorKey === null || typeof project.colorKey === "string") &&
    (project.archivedAt === null || typeof project.archivedAt === "string") &&
    typeof project.createdAt === "string" &&
    project.createdAt.length > 0 &&
    typeof project.updatedAt === "string" &&
    project.updatedAt.length > 0 &&
    Number.isInteger(project.version) &&
    project.version >= 1 &&
    (project.deletedAt === null || typeof project.deletedAt === "string")
  );
}

export function putProjectOp(project: Project): DbTransactionOp {
  return {
    op: "putProject",
    params: {
      id: project.id,
      name: project.name,
      color_key: project.colorKey ?? "",
      color_key_is_null: project.colorKey === null,
      archived_at: project.archivedAt ?? "",
      archived_at_is_null: project.archivedAt === null,
      created_at: project.createdAt,
      updated_at: project.updatedAt,
      version: project.version,
      deleted_at: project.deletedAt ?? "",
      deleted_at_is_null: project.deletedAt === null,
    },
  };
}

function parseProjects(rows: readonly unknown[]): DataResult<readonly Project[]> {
  const projects: Project[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedProject();
    }
    const row = value as ProjectRow;
    if (
      typeof row.id !== "string" ||
      typeof row.name !== "string" ||
      (row.color_key !== null && typeof row.color_key !== "string") ||
      (row.archived_at !== null && typeof row.archived_at !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedProject();
    }
    const project: Project = {
      id: row.id,
      name: row.name,
      colorKey: row.color_key,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if (!validProject(project)) return corruptedProject();
    projects.push(project);
  }
  return { ok: true, value: projects };
}

async function migrateLegacyProjects(): Promise<DataResult<true>> {
  const legacy = await createSqliteEntityDocStore<Project>(ENTITY_TYPE).list();
  if (!legacy.ok) return legacy;
  const projects = legacy.value;
  const legacyIds = new Set<string>();
  const legacyNames = new Set<string>();
  for (const project of projects) {
    if (!validProject(project) || legacyIds.has(project.id) || legacyNames.has(project.name)) {
      return corruptedProject();
    }
    legacyIds.add(project.id);
    legacyNames.add(project.name);
  }

  const currentResponse = await sendDbRequest({ kind: "query", op: "listProjects", params: {} });
  if (!currentResponse.ok) return toDataResult(currentResponse, () => true as const);
  const current = parseProjects(currentResponse.rows);
  if (!current.ok) return current;
  const currentIds = new Set(current.value.map((project) => project.id));
  const currentNames = new Set(current.value.map((project) => project.name));
  if (projects.some((project) => currentIds.has(project.id) || currentNames.has(project.name))) {
    return corruptedProject();
  }

  for (let offset = 0; offset < projects.length; offset += LEGACY_BATCH_SIZE) {
    const batch = projects.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const project of batch) {
      ops.push(putProjectOp(project));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: project.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) return result;
  }
  return { ok: true, value: true };
}

export function createSqliteProjectStore(): EntityStore<Project> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyProjects();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) migrationPromise = null;
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Project> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Project[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listProjects", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseProjects(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Project>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getProject", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as Project);
      const parsed = parseProjects(response.rows);
      if (!parsed.ok) return parsed;
      const project = parsed.value[0];
      return project === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: project };
    },
    async save(value: Project): Promise<DataResult<Project>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validProject(value)) {
        return {
          ok: false,
          error: invalidInput("data.project.invalid", "Projektin tiedot eivät kelpaa."),
        };
      }
      const listed = await store.list();
      if (!listed.ok) return listed;
      if (listed.value.some((project) => project.name === value.name && project.id !== value.id)) {
        return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      }
      const response = await sendDbRequest({ kind: "transaction", ops: [putProjectOp(value)] });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value } : result;
    },
    async saveWithSyncOperation(
      value: Project,
      context: SyncWriteContext,
    ): Promise<DataResult<Project>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validProject(value)) {
        return {
          ok: false,
          error: invalidInput("data.project.invalid", "Projektin tiedot eivät kelpaa."),
        };
      }
      const listed = await store.list();
      if (!listed.ok) return listed;
      if (listed.value.some((project) => project.name === value.name && project.id !== value.id)) {
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
        writes: [putProjectOp(value)],
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
