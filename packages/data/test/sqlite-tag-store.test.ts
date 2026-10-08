import { sqlText } from "./sqlite-test-values.ts";
import { afterEach, describe, expect, it } from "vitest";
import type { Tag } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createSqliteTagStore,
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
  initialTags: readonly Record<string, unknown>[] = [],
) {
  const docs = new Map(initialDocs.map((doc) => [doc.id, doc]));
  const tags = new Map(initialTags.map((tag) => [String(tag.id), tag]));
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
        } else if (request.kind === "query" && request.op === "listTags") {
          rows = [...tags.values()];
        } else if (request.kind === "query" && request.op === "getTag") {
          const row = tags.get(sqlText(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(docs);
          const nextTags = new Map(tags);
          for (const write of request.ops ?? []) {
            const id = sqlText(write.params.id);
            if (write.op === "putTag") {
              const params = write.params;
              const existing = nextTags.get(id);
              nextTags.set(id, {
                id,
                name: params.name,
                color_key: params.color_key_is_null ? null : params.color_key,
                created_at: existing?.created_at ?? params.created_at,
                updated_at: params.updated_at,
                version: params.version,
                deleted_at: params.deleted_at_is_null ? null : params.deleted_at,
              });
            } else if (write.op === "deleteEntity" && write.params.entity_type === "tag") {
              nextDocs.delete(id);
            }
          }
          docs.clear();
          for (const [id, doc] of nextDocs) docs.set(id, doc);
          tags.clear();
          for (const [id, tag] of nextTags) tags.set(id, tag);
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
  return { worker: worker as unknown as Worker, docs, tags };
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

describe("SQLite Tag relational store", () => {
  const at = "2026-09-01T08:00:00.000Z";
  const tag: Tag = {
    id: "tag-home",
    name: "Koti",
    colorKey: "",
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
  };

  it("migrates legacy tags and preserves nullable and empty values", async () => {
    const fixture = createWorker([legacyDoc("tag", tag)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTagStore();

    expect(await store.list()).toEqual({ ok: true, value: [tag] });
    expect(fixture.docs.has(tag.id)).toBe(false);
    expect(fixture.tags.get(tag.id)).toMatchObject({ color_key: "" });

    const updated: Tag = {
      ...tag,
      name: "Koti ja arki",
      colorKey: null,
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 2,
    };
    expect(await store.save(updated)).toEqual({ ok: true, value: updated });
    expect(await store.getById(tag.id)).toEqual({ ok: true, value: updated });
    expect(fixture.tags.get(tag.id)?.created_at).toBe(at);

    expect(await store.remove(tag.id)).toEqual({ ok: true, value: true });
    expect(fixture.tags.get(tag.id)?.deleted_at).toEqual(expect.any(String));
  });

  it("rejects duplicate legacy tag names without deleting either document", async () => {
    const duplicate: Tag = { ...tag, id: "tag-home-duplicate" };
    const fixture = createWorker([legacyDoc("tag", tag), legacyDoc("tag", duplicate)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTagStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.tag.invalid" },
    });
    expect(fixture.docs.size).toBe(2);
    expect(fixture.tags.size).toBe(0);
  });

  it("keeps legacy data untouched when its name conflicts with a relational row", async () => {
    const current: Tag = { ...tag, id: "tag-current" };
    const currentRow = {
      id: current.id,
      name: current.name,
      color_key: current.colorKey,
      created_at: current.createdAt,
      updated_at: current.updatedAt,
      version: current.version,
      deleted_at: current.deletedAt,
    };
    const fixture = createWorker([legacyDoc("tag", tag)], [currentRow]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTagStore();

    expect(await store.list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted", diagnosticCode: "data.tag.invalid" },
    });
    expect(fixture.docs.has(tag.id)).toBe(true);
    expect(fixture.tags.size).toBe(1);
  });

  it("rejects another tag with the same name", async () => {
    const fixture = createWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteTagStore();

    expect(await store.save(tag)).toEqual({ ok: true, value: tag });
    expect(await store.save({ ...tag, id: "tag-home-copy" })).toMatchObject({
      ok: false,
      error: { code: "already-exists" },
    });
    expect(fixture.tags.size).toBe(1);
  });
});
