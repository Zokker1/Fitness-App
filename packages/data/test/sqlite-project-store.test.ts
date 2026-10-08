import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteProjectStore,
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

function createWorker(
  initialDocs: readonly StoredDoc[],
  initialProjects: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const projects = new Map(initialProjects.map((project) => [String(project.id), project]));
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as Request;
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...docs.values()].filter(
            (doc) => doc.entity_type === request.params?.entity_type,
          );
        } else if (request.kind === "query" && request.op === "listProjects") {
          rows = [...projects.values()];
        } else if (request.kind === "query" && request.op === "getProject") {
          const row = projects.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextProjects = new Map(projects);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putProject") {
              const params = write.params;
              const existing = nextProjects.get(id);
              nextProjects.set(id, {
                id,
                name: params.name,
                color_key: params.color_key_is_null ? null : params.color_key,
                archived_at: params.archived_at_is_null ? null : params.archived_at,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at_is_null ? null : params.deleted_at,
              });
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          projects.clear();
          for (const [id, project] of nextProjects) projects.set(id, project);
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
  return { worker: worker as unknown as Worker, docs, projects };
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

describe("SQLite Project relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const project: Project = {
    id: "project-home",
    name: "Koti",
    colorKey: "",
    archivedAt: "",
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };

  it("migrates legacy projects and preserves nullable and empty values", async () => {
    const fixture = createWorker([legacyDoc("project", project)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteProjectStore();

    expect(await store.list()).toEqual({ ok: true, value: [project] });
    expect(fixture.docs.has(project.id)).toBe(false);
    expect(fixture.projects.get(project.id)).toMatchObject({ color_key: "", archived_at: "" });

    const updated: Project = {
      ...project,
      colorKey: null,
      archivedAt: null,
      name: "Koti ja arki",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(project.id)).toEqual({ ok: true, value: updated });
    expect(fixture.projects.get(project.id)?.created_at).toBe(at);

    expect(await store.remove(project.id)).toEqual({ ok: true, value: true });
    expect(fixture.projects.get(project.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("rejects duplicate legacy project names without deleting either document", async () => {
    const duplicate: Project = { ...project, id: "project-home-duplicate" };
    const fixture = createWorker([legacyDoc("project", project), legacyDoc("project", duplicate)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteProjectStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.project.invalid" },
    });
    expect(fixture.docs.size).toBe(2);
    expect(fixture.projects.size).toBe(0);
  });

  it("keeps legacy data untouched when its name conflicts with a relational row", async () => {
    const current: Project = { ...project, id: "project-current" };
    const currentRow = {
      id: current.id,
      name: current.name,
      color_key: current.colorKey,
      archived_at: current.archivedAt,
      created_at: current.createdAt,
      updated_at: current.updatedAt,
      version: current.version,
      deleted_at: current.deletedAt,
    };
    const fixture = createWorker([legacyDoc("project", project)], [currentRow]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteProjectStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.project.invalid" },
    });
    expect(fixture.docs.has(project.id)).toBe(true);
    expect(fixture.projects.size).toBe(1);
  });

  it("rejects another project with the same name", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteProjectStore();

    expect(await store.save(project)).toEqual({ ok: true, value: project });
    expect(await store.save({ ...project, id: "project-home-copy" })).toMatchObject({
      ok: false,
      error: { code: "already-exists" },
    });
    expect(fixture.projects.size).toBe(1);
  });
});
