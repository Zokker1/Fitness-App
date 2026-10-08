import { afterEach, describe, expect, it } from "vitest";
import type { Measurement } from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createSqliteMeasurementStore,
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

function relationalRow(params: FakeWrite["params"]): Record<string, unknown> {
  return {
    id: params.id,
    type: params.type,
    value: params.value,
    secondary_value: params.secondary_value === "" ? null : params.secondary_value,
    unit: params.unit,
    metric_name: params.metric_name === "" ? null : params.metric_name,
    pulse_bpm: params.pulse_bpm === "" ? null : params.pulse_bpm,
    context: params.context === "" ? null : params.context,
    measured_at: params.measured_at,
    note: params.note === "" ? null : params.note,
    created_at: params.created_at,
    updated_at: params.updated_at,
    version: params.version,
  };
}

function createMeasurementWorker(initialDocs: readonly EntityDocRow[]) {
  const entityDocs = new Map(initialDocs.map((row) => [row.id, row]));
  const measurements = new Map<string, Record<string, unknown>>();
  const requests: FakeRequest[] = [];
  let onmessage: ((event: MessageEvent) => void) | null = null;

  const worker = {
    postMessage(message: unknown) {
      const request = message as FakeRequest;
      requests.push(request);
      queueMicrotask(() => {
        let rows: readonly unknown[] = [];
        if (request.kind === "query" && request.op === "listEntities") {
          rows = [...entityDocs.values()];
        } else if (request.kind === "query" && request.op === "listMeasurements") {
          rows = [...measurements.values()];
        } else if (request.kind === "query" && request.op === "getMeasurement") {
          const row = measurements.get(String(request.params?.id ?? ""));
          rows = row === undefined ? [] : [row];
        } else if (request.kind === "transaction") {
          for (const write of request.ops ?? []) {
            if (write.op === "putMeasurement") {
              measurements.set(String(write.params.id), relationalRow(write.params));
            } else if (write.op === "deleteEntity") {
              entityDocs.delete(String(write.params.id));
            }
          }
        } else if (request.kind === "exec" && request.op === "putMeasurement") {
          measurements.set(String(request.params?.id ?? ""), relationalRow(request.params ?? {}));
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

  return { worker: worker as unknown as Worker, entityDocs, measurements, requests };
}

function legacyDoc(measurement: Measurement): EntityDocRow {
  return {
    entity_type: "measurement",
    id: measurement.id,
    created_at: measurement.createdAt,
    updated_at: measurement.updatedAt,
    doc_version: 0,
    value: JSON.stringify(measurement),
  };
}

afterEach(() => {
  resetDatabaseWorkerForTests();
});

describe("SQLite measurement relational store", () => {
  it("moves legacy documents and preserves the full measurement model", async () => {
    const timestamp = "2026-08-01T08:00:00.000Z";
    const legacy: Measurement = {
      id: "measurement-legacy",
      type: "blood-pressure",
      value: 128,
      secondaryValue: 82,
      unit: "mmHg",
      pulseBpm: 64,
      context: "morning",
      measuredAt: "2026-08-01T07:55:00.000Z",
      note: "Ennen aamiaista",
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 2,
    };
    const { worker, entityDocs, measurements, requests } = createMeasurementWorker([
      legacyDoc(legacy),
    ]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteMeasurementStore();

    expect(await store.list()).toEqual({ ok: true, value: [legacy] });
    expect(entityDocs.size).toBe(0);
    expect(measurements.get(legacy.id)).toEqual({
      id: legacy.id,
      type: legacy.type,
      value: legacy.value,
      secondary_value: legacy.secondaryValue,
      unit: legacy.unit,
      metric_name: null,
      pulse_bpm: legacy.pulseBpm,
      context: legacy.context,
      measured_at: legacy.measuredAt,
      note: legacy.note,
      created_at: legacy.createdAt,
      updated_at: legacy.updatedAt,
      version: legacy.version,
    });
    expect(requests.find((request) => request.kind === "transaction")?.ops).toHaveLength(2);

    const created: Measurement = {
      id: "measurement-new",
      type: "body-measure",
      value: 84,
      secondaryValue: null,
      unit: "cm",
      metricName: "Vyötärö",
      measuredAt: legacy.measuredAt,
      note: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      version: 1,
    };
    expect(await store.save(created)).toEqual({ ok: true, value: created });
    expect(await store.getById(created.id)).toEqual({ ok: true, value: created });
    expect(await store.save(created)).toMatchObject({
      ok: false,
      error: { code: "already-exists" },
    });
    expect(await store.remove(created.id)).toMatchObject({
      ok: false,
      error: { code: "invalid-input" },
    });
    expect(measurements.has(created.id)).toBe(true);
    expect(requests.some((request) => request.op === "putEntity")).toBe(false);
  });

  it("leaves invalid legacy rows untouched", async () => {
    const invalid: EntityDocRow = {
      entity_type: "measurement",
      id: "measurement-invalid",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-01T08:00:00.000Z",
      doc_version: 0,
      value: "not-json",
    };
    const { worker, entityDocs, measurements, requests } = createMeasurementWorker([invalid]);
    configureDatabaseWorker({ create: () => worker });

    const result = await createSqliteMeasurementStore().list();

    expect(result).toMatchObject({ ok: false, error: { code: "data-corrupted" } });
    expect(entityDocs.get(invalid.id)).toEqual(invalid);
    expect(measurements.size).toBe(0);
    expect(requests.some((request) => request.kind === "transaction")).toBe(false);
  });

  it("commits an append-only measurement and its encrypted sync operation atomically", async () => {
    const at = "2026-09-03T08:00:00.000Z";
    const measurement: Measurement = {
      id: "measurement-sync",
      type: "blood-pressure",
      value: 122,
      secondaryValue: 78,
      unit: "mmHg",
      metricName: null,
      pulseBpm: 63,
      context: "morning",
      measuredAt: at,
      note: null,
      createdAt: at,
      updatedAt: at,
      version: 1,
    };
    const { worker, measurements, requests } = createMeasurementWorker([]);
    configureDatabaseWorker({ create: () => worker });
    const store = createSqliteMeasurementStore();
    const keySession = createDataKeySession(new Uint8Array(32).fill(17));
    if (keySession === null) throw new Error("Test data key is invalid.");

    try {
      expect(
        await store.saveWithSyncOperation?.(measurement, {
          operationId: "installation-1:measurement-sync",
          installationId: "installation-1",
          operation: "create",
          occurredAt: at,
          changedFields: [
            "type",
            "value",
            "secondaryValue",
            "unit",
            "metricName",
            "pulseBpm",
            "context",
            "measuredAt",
            "note",
          ],
          keySession,
          crypto: createSyncCryptoAdapter(),
        }),
      ).toEqual({ ok: true, value: measurement });

      const transaction = requests.at(-1);
      expect(transaction?.ops?.map((write) => write.op)).toEqual([
        "putMeasurement",
        "putSyncOperation",
      ]);
      expect(transaction?.ops?.[1]?.params.encrypted_payload_ref).toEqual(expect.any(String));
      expect(measurements.get(measurement.id)?.value).toBe(measurement.value);
    } finally {
      keySession.lock();
    }
  });
});
