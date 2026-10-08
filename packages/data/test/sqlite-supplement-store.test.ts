import { afterEach, describe, expect, it } from "vitest";
import type { Supplement, SupplementLog } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteSupplementLogStore,
  createSqliteSupplementStore,
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
  readonly params: Record<string, unknown>;
}

interface FakeRequest {
  readonly requestId: string;
  readonly kind: string;
  readonly op?: string;
  readonly ops?: readonly FakeWrite[];
  readonly params?: Record<string, unknown>;
}

function key(entityType: string, id: string): string {
  return `${entityType}:${id}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullable(value: unknown): unknown {
  return value === "" || value === undefined ? null : value;
}

function supplementRow(params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: params.id,
    name: params.name,
    dose_label: nullable(params.dose_label),
    amount: nullable(params.amount),
    unit: nullable(params.unit),
    schedule_json: nullable(params.schedule_json),
    stock_amount: nullable(params.stock_amount),
    stock_unit: nullable(params.stock_unit),
    stock_counted_at: nullable(params.stock_counted_at),
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
    deleted_at: nullable(params.deleted_at),
  };
}

function supplementLogRow(params: Record<string, unknown>): Record<string, unknown> {
  return {
    id: params.id,
    supplement_id: params.supplement_id,
    status: params.status,
    scheduled_at: nullable(params.scheduled_at),
    dose_amount: nullable(params.dose_amount),
    dose_unit: nullable(params.dose_unit),
    taken_at: nullable(params.taken_at),
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
  };
}

function legacyDoc(entityType: string, value: object, docVersion = 0): EntityDocRow {
  const doc = value as { id: string; createdAt: string; updatedAt: string };
  return {
    entity_type: entityType,
    id: doc.id,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    doc_version: docVersion,
    value: JSON.stringify(value),
  };
}

function createSupplementWorker(initialDocs: readonly EntityDocRow[]) {
  const entityDocs = new Map(initialDocs.map((row) => [key(row.entity_type, row.id), row]));
  const supplements = new Map<string, Record<string, unknown>>();
  const supplementLogs = new Map<string, Record<string, unknown>>();
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
          const entityType = stringValue(request.params?.entity_type);
          rows = [...entityDocs.values()].filter((row) => row.entity_type === entityType);
        } else if (request.kind === "query" && request.op === "listSupplements") {
          rows = [...supplements.values()];
        } else if (request.kind === "query" && request.op === "getSupplement") {
          const row = supplements.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "query" && request.op === "listSupplementLogs") {
          rows = [...supplementLogs.values()];
        } else if (request.kind === "query" && request.op === "getSupplementLog") {
          const row = supplementLogs.get(stringValue(request.params?.id));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          const nextDocs = new Map(entityDocs);
          const nextSupplements = new Map(supplements);
          const nextLogs = new Map(supplementLogs);
          for (const write of request.ops ?? []) {
            const id = stringValue(write.params.id);
            if (write.op === "putSupplement") {
              const row = supplementRow(write.params);
              const existing = nextSupplements.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextSupplements.set(id, row);
            } else if (write.op === "putSupplementLog") {
              const supplementId = stringValue(write.params.supplement_id);
              if (!nextSupplements.has(supplementId)) {
                errorCode = "invalid-input";
                break;
              }
              const scheduledAt = stringValue(write.params.scheduled_at);
              if (
                scheduledAt !== "" &&
                [...nextLogs.values()].some(
                  (row) =>
                    row.id !== id &&
                    row.supplement_id === supplementId &&
                    row.scheduled_at === scheduledAt,
                )
              ) {
                errorCode = "invalid-input";
                break;
              }
              const row = supplementLogRow(write.params);
              const existing = nextLogs.get(id);
              if (existing !== undefined) row.created_at = existing.created_at;
              nextLogs.set(id, row);
            } else if (write.op === "deleteEntity") {
              nextDocs.delete(key(stringValue(write.params.entity_type), id));
            }
          }
          if (errorCode === null) {
            entityDocs.clear();
            for (const [docKey, row] of nextDocs) entityDocs.set(docKey, row);
            supplements.clear();
            for (const [supplementId, row] of nextSupplements) supplements.set(supplementId, row);
            supplementLogs.clear();
            for (const [logId, row] of nextLogs) supplementLogs.set(logId, row);
          }
        } else if (request.kind === "exec" && request.op === "deleteSupplementLog") {
          supplementLogs.delete(stringValue(request.params?.id));
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
  return { worker: worker as unknown as Worker, entityDocs, supplements, supplementLogs, requests };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite supplement relational stores", () => {
  it("migrates parents before logs, preserves plan/snapshot fields, and uses relational CRUD", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const supplement: Supplement = {
      id: "supplement-old",
      name: "D-vitamiini",
      amount: 1,
      unit: "kapseli",
      doseLabel: "1 kapseli",
      schedule: ["08:00", "20:00"],
      stockAmount: 24,
      stockUnit: "kapselia",
      stockCountedAt: at,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 3,
    };
    const takenLog: SupplementLog = {
      id: "log-taken-old",
      supplementId: supplement.id,
      status: "taken",
      scheduledAt: "2026-09-01T05:00:00.000Z",
      doseAmount: 1,
      doseUnit: "kapseli",
      takenAt: at,
      createdAt: at,
      updatedAt: at,
      version: 2,
    };
    const pendingLog: SupplementLog = {
      id: "log-pending-old",
      supplementId: supplement.id,
      scheduledAt: "2026-09-01T17:00:00.000Z",
      doseAmount: 1,
      doseUnit: "kapseli",
      takenAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createSupplementWorker([
      legacyDoc("supplement", supplement),
      legacyDoc("supplement-log", takenLog),
      legacyDoc("supplement-log", pendingLog),
    ]);
    configureDatabaseWorker({ create: () => fixture.worker });

    const logs = createSqliteSupplementLogStore();
    expect(await logs.list()).toEqual({
      ok: true,
      value: [{ ...takenLog }, { ...pendingLog, status: "pending" }],
    });
    expect(fixture.entityDocs.size).toBe(0);
    expect(fixture.supplements.get(supplement.id)).toMatchObject({
      schedule_json: '["08:00","20:00"]',
      stock_amount: 24,
      stock_unit: "kapselia",
      stock_counted_at: at,
    });
    expect(fixture.supplementLogs.get(takenLog.id)).toMatchObject({
      status: "taken",
      scheduled_at: takenLog.scheduledAt,
      dose_amount: 1,
      taken_at: at,
    });
    expect(fixture.supplementLogs.get(pendingLog.id)).toMatchObject({
      status: "pending",
      scheduled_at: pendingLog.scheduledAt,
      taken_at: null,
    });

    const supplementWriteIndex = fixture.requests.findIndex((request) =>
      request.ops?.some((write) => write.op === "putSupplement"),
    );
    const logWriteIndex = fixture.requests.findIndex((request) =>
      request.ops?.some((write) => write.op === "putSupplementLog"),
    );
    expect(supplementWriteIndex).toBeGreaterThanOrEqual(0);
    expect(logWriteIndex).toBeGreaterThan(supplementWriteIndex);

    const createdLog: SupplementLog = {
      id: "log-new",
      supplementId: supplement.id,
      status: "taken",
      scheduledAt: null,
      doseAmount: 1,
      doseUnit: "kapseli",
      takenAt: "2026-09-02T08:00:00.000Z",
      createdAt: "2026-09-02T08:00:00.000Z",
      updatedAt: "2026-09-02T08:00:00.000Z",
      version: 1,
    };
    expect(await logs.save(createdLog)).toEqual({ ok: true, value: createdLog });
    expect(await logs.getById(createdLog.id)).toEqual({ ok: true, value: createdLog });
    expect(await logs.remove(createdLog.id)).toEqual({ ok: true, value: true });
    expect(fixture.supplementLogs.has(createdLog.id)).toBe(false);

    const supplements = createSqliteSupplementStore();
    const loaded = await supplements.getById(supplement.id);
    expect(loaded).toEqual({ ok: true, value: supplement });
    if (!loaded.ok) throw new Error("expected a supplement");
    expect(await supplements.remove(supplement.id)).toEqual({ ok: true, value: true });
    expect(typeof fixture.supplements.get(supplement.id)?.deleted_at).toBe("string");
  });

  it("commits a supplement and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const supplement: Supplement = {
      id: "supplement-sync",
      name: "D-vitamiini",
      doseLabel: "1 kapseli",
      amount: 1,
      unit: "kapseli",
      schedule: ["08:00"],
      stockAmount: 20,
      stockUnit: "kapselia",
      stockCountedAt: at,
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createSupplementWorker([]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteSupplementStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(15));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(supplement, {
          operationId: "installation-1:supplement-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "name",
            "doseLabel",
            "amount",
            "unit",
            "schedule",
            "stockAmount",
            "stockUnit",
            "stockCountedAt",
            "deletedAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: supplement });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putSupplement",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.supplements.get(supplement.id)?.name).toBe(supplement.name);
    } finally {
      keySession.lock();
    }
  });

  it("commits a supplement log and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const supplement: Supplement = {
      id: "supplement-log-parent",
      name: "D-vitamiini",
      doseLabel: "1 kapseli",
      deletedAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const log: SupplementLog = {
      id: "supplement-log-sync",
      supplementId: supplement.id,
      status: "taken",
      scheduledAt: null,
      doseAmount: 1,
      doseUnit: "kapseli",
      takenAt: at,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createSupplementWorker([legacyDoc("supplement", supplement)]);
    configureDatabaseWorker({ create: () => fixture.worker });
    const store = createSqliteSupplementLogStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(25));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(log, {
          operationId: "installation-1:supplement-log-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "supplementId",
            "status",
            "scheduledAt",
            "doseAmount",
            "doseUnit",
            "takenAt",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: log });

      const transaction = fixture.requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putSupplementLog",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(fixture.supplementLogs.get(log.id)?.status).toBe("taken");
    } finally {
      keySession.lock();
    }
  });

  it("blocks orphaned legacy logs without consuming the source document", async () => {
    const at = "2026-09-01T08:00:00.000Z";
    const orphan: SupplementLog = {
      id: "log-orphan",
      supplementId: "missing-supplement",
      status: "pending",
      takenAt: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const fixture = createSupplementWorker([legacyDoc("supplement-log", orphan)]);
    configureDatabaseWorker({ create: () => fixture.worker });

    expect(await createSqliteSupplementLogStore().list()).toMatchObject({
      ok: false,
      error: { code: "data-corrupted" },
    });
    expect(fixture.entityDocs.get(key("supplement-log", orphan.id))).toEqual(
      legacyDoc("supplement-log", orphan),
    );
    expect(fixture.supplementLogs.size).toBe(0);
    expect(fixture.requests.some((request) => request.kind === "transaction")).toBe(false);
  });
});
