import type { EntityId, Measurement } from "@lifeos/domain";
import {
  BLOOD_PRESSURE_PULSE_RANGE,
  containsControlCharacters,
  isBloodPressureContext,
  isMeasurementType,
  MEASUREMENT_UNIT_MAX_LENGTH,
} from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { listEntityDocs } from "./sqliteEntityClient.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "measurement";
const LEGACY_BATCH_SIZE = 32;

interface LegacyEntityRow {
  readonly id?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly doc_version?: unknown;
  readonly value?: unknown;
}

function corruptedData(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua mittausta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.measurement.doc.invalid",
    },
  };
}

export function validMeasurement(measurement: Measurement): boolean {
  const metricName = measurement.metricName;
  const pulseBpm = measurement.pulseBpm;
  const context = measurement.context;
  return (
    typeof measurement.id === "string" &&
    measurement.id.length > 0 &&
    isMeasurementType(measurement.type) &&
    typeof measurement.value === "number" &&
    Number.isFinite(measurement.value) &&
    (measurement.secondaryValue === null ||
      (typeof measurement.secondaryValue === "number" &&
        Number.isFinite(measurement.secondaryValue))) &&
    typeof measurement.unit === "string" &&
    measurement.unit.trim().length > 0 &&
    measurement.unit.length <= MEASUREMENT_UNIT_MAX_LENGTH &&
    !containsControlCharacters(measurement.unit) &&
    (metricName === undefined ||
      metricName === null ||
      (typeof metricName === "string" &&
        metricName.length > 0 &&
        metricName.length <= 60 &&
        !containsControlCharacters(metricName))) &&
    (metricName === undefined ||
      metricName === null ||
      measurement.type === "body-measure" ||
      measurement.type === "custom") &&
    (pulseBpm === undefined ||
      pulseBpm === null ||
      (typeof pulseBpm === "number" &&
        Number.isInteger(pulseBpm) &&
        pulseBpm >= BLOOD_PRESSURE_PULSE_RANGE.minimum &&
        pulseBpm <= BLOOD_PRESSURE_PULSE_RANGE.maximum)) &&
    (context === undefined || context === null || isBloodPressureContext(context)) &&
    ((pulseBpm === undefined || pulseBpm === null) && (context === undefined || context === null)
      ? true
      : measurement.type === "blood-pressure") &&
    typeof measurement.measuredAt === "string" &&
    (measurement.note === null ||
      (typeof measurement.note === "string" && measurement.note.length <= 500)) &&
    typeof measurement.createdAt === "string" &&
    typeof measurement.updatedAt === "string" &&
    Number.isInteger(measurement.version) &&
    measurement.version >= 1
  );
}

function parseLegacyRow(value: unknown): Measurement | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as LegacyEntityRow;
  if (row.doc_version !== 0 || typeof row.value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const measurement = parsed as Measurement;
    if (
      row.id !== measurement.id ||
      row.created_at !== measurement.createdAt ||
      row.updated_at !== measurement.updatedAt ||
      !validMeasurement(measurement)
    ) {
      return null;
    }
    return measurement;
  } catch {
    return null;
  }
}

function parseRelationalRow(value: unknown): Measurement | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.id !== "string" ||
    typeof row.type !== "string" ||
    !isMeasurementType(row.type) ||
    typeof row.value !== "number" ||
    (row.secondary_value !== null && typeof row.secondary_value !== "number") ||
    typeof row.unit !== "string" ||
    (row.metric_name !== null && typeof row.metric_name !== "string") ||
    (row.pulse_bpm !== null && typeof row.pulse_bpm !== "number") ||
    (row.context !== null && typeof row.context !== "string") ||
    typeof row.measured_at !== "string" ||
    (row.note !== null && typeof row.note !== "string") ||
    typeof row.created_at !== "string" ||
    typeof row.updated_at !== "string" ||
    typeof row.version !== "number"
  ) {
    return null;
  }
  const measurement: Measurement = {
    id: row.id,
    type: row.type,
    value: row.value,
    secondaryValue: row.secondary_value,
    unit: row.unit,
    ...(row.metric_name === null ? {} : { metricName: row.metric_name }),
    ...(row.pulse_bpm === null ? {} : { pulseBpm: row.pulse_bpm }),
    ...(row.context === null ? {} : { context: row.context as Measurement["context"] }),
    measuredAt: row.measured_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version,
  };
  return validMeasurement(measurement) ? measurement : null;
}

export function putMeasurementOp(measurement: Measurement): DbTransactionOp {
  return {
    op: "putMeasurement",
    params: {
      id: measurement.id,
      type: measurement.type,
      value: measurement.value,
      secondary_value: measurement.secondaryValue ?? "",
      unit: measurement.unit,
      metric_name: measurement.metricName ?? "",
      pulse_bpm: measurement.pulseBpm ?? "",
      context: measurement.context ?? "",
      measured_at: measurement.measuredAt,
      note: measurement.note ?? "",
      created_at: measurement.createdAt,
      updated_at: measurement.updatedAt,
      version: measurement.version,
    },
  };
}

async function migrateLegacyMeasurements(): Promise<DataResult<true>> {
  const legacyResult = await listEntityDocs(ENTITY_TYPE);
  if (!legacyResult.ok) {
    return legacyResult;
  }

  const measurements: Measurement[] = [];
  for (const row of legacyResult.value) {
    const measurement = parseLegacyRow(row);
    if (measurement === null) {
      return corruptedData();
    }
    measurements.push(measurement);
  }

  for (let offset = 0; offset < measurements.length; offset += LEGACY_BATCH_SIZE) {
    const batch = measurements.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const measurement of batch) {
      ops.push(putMeasurementOp(measurement));
      ops.push({
        op: "deleteEntity",
        params: { entity_type: ENTITY_TYPE, id: measurement.id },
      });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseQueryRows(rows: readonly unknown[]): DataResult<readonly Measurement[]> {
  const measurements: Measurement[] = [];
  for (const row of rows) {
    const measurement = parseRelationalRow(row);
    if (measurement === null) {
      return corruptedData();
    }
    measurements.push(measurement);
  }
  return { ok: true, value: measurements };
}

export function createSqliteMeasurementStore(): EntityStore<Measurement> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyMeasurements();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Measurement> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Measurement[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "listMeasurements",
        params: {},
      });
      if (!response.ok) {
        return toDataResult(response, () => []);
      }
      return parseQueryRows(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Measurement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      const response = await sendDbRequest({
        kind: "query",
        op: "getMeasurement",
        params: { id },
      });
      if (!response.ok) {
        return toDataResult(response, () => ({}) as Measurement);
      }
      const parsed = parseQueryRows(response.rows);
      if (!parsed.ok) {
        return parsed;
      }
      const measurement = parsed.value[0];
      return measurement === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: measurement };
    },
    async save(measurement: Measurement): Promise<DataResult<Measurement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) {
        return migrated;
      }
      if (!validMeasurement(measurement)) {
        return {
          ok: false,
          error: invalidInput(
            "data.measurement.invalid",
            "Mittaus ei ole tallennettavassa muodossa.",
          ),
        };
      }
      const existing = await store.getById(measurement.id);
      if (existing.ok) {
        return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      }
      if (existing.error.code !== "not-found") {
        return existing;
      }
      const response = await sendDbRequest({ kind: "exec", ...putMeasurementOp(measurement) });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: measurement } : result;
    },
    async saveWithSyncOperation(
      measurement: Measurement,
      context: SyncWriteContext,
    ): Promise<DataResult<Measurement>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validMeasurement(measurement)) {
        return {
          ok: false,
          error: invalidInput(
            "data.measurement.invalid",
            "Mittaus ei ole tallennettavassa muodossa.",
          ),
        };
      }
      const existing = await store.getById(measurement.id);
      if (existing.ok) return { ok: false, error: alreadyExists(ENTITY_TYPE) };
      if (existing.error.code !== "not-found") return existing;
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: measurement.id,
        operation: context.operation,
        entityVersion: measurement.version,
        occurredAt: context.occurredAt,
        createdAt: measurement.createdAt,
        entity: measurement as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putMeasurementOp(measurement)],
      });
      return committed.ok ? { ok: true, value: measurement } : committed;
    },
    remove(): Promise<DataResult<boolean>> {
      return Promise.resolve({
        ok: false,
        error: invalidInput(
          "data.measurement.append-only",
          "Mittausmerkintää ei voi muuttaa tai poistaa.",
        ),
      });
    },
  };
  return store;
}
