// T312: siirrettävän sync-payloadin versionoitu JSON-kuori ja kenttämuutoslista.

import type { DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";

export const CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION = 2 as const;

export type SyncPayloadJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly SyncPayloadJsonValue[]
  | { readonly [key: string]: SyncPayloadJsonValue };

export type SyncPayloadEntity = { readonly [key: string]: SyncPayloadJsonValue };

export interface SyncPayloadV1 {
  readonly payloadSchemaVersion: 1;
  readonly entity: SyncPayloadEntity;
}

export interface SyncPayloadV2 {
  readonly payloadSchemaVersion: typeof CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION;
  /** Täysi snapshot luontiin ja kenttien validointiin. */
  readonly entity: SyncPayloadEntity;
  /** Päivityksessä muuttuneet kentät; metadata-kentät eivät kuulu maskiin. */
  readonly changedFields: readonly string[];
}

/** Dekooderi normalisoi vanhan V1-snapshotin V2:n kenttälistaksi. */
export type SyncPayload = SyncPayloadV2;

const ENTITY_METADATA_FIELDS = new Set(["id", "createdAt", "updatedAt", "version"]);
const FORBIDDEN_FIELD_NAMES = new Set(["__proto__", "prototype", "constructor"]);
const MAX_SYNC_FIELDS = 256;
const MAX_SYNC_FIELD_NAME_LENGTH = 128;

function isJsonValue(value: unknown, ancestors: WeakSet<object>): value is SyncPayloadJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;

  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? Array.from({ length: value.length }, (_, index) => index).every(
        (index) => index in value && isJsonValue(value[index], ancestors),
      )
    : Object.entries(value).every(
        ([key, item]) => !FORBIDDEN_FIELD_NAMES.has(key) && isJsonValue(item, ancestors),
      );
  ancestors.delete(value);
  return valid;
}

function isSyncPayloadEntity(value: unknown): value is SyncPayloadEntity {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null) &&
    isJsonValue(value, new WeakSet())
  );
}

function isChangedFields(value: unknown): value is readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_SYNC_FIELDS) return false;
  const seen = new Set<string>();
  for (const field of value) {
    if (
      typeof field !== "string" ||
      field.length === 0 ||
      field.length > MAX_SYNC_FIELD_NAME_LENGTH ||
      ENTITY_METADATA_FIELDS.has(field) ||
      FORBIDDEN_FIELD_NAMES.has(field) ||
      seen.has(field)
    ) {
      return false;
    }
    seen.add(field);
  }
  return true;
}

function invalidPayload(): DataResult<never> {
  return {
    ok: false,
    error: invalidInput("data.sync-payload.invalid", "Synkronointitiedon muoto ei kelpaa."),
  };
}

/** Serialisoi snapshotin sekä eksplisiittisen, validoidun muutettujen kenttien listan. */
export function encodeSyncPayload(
  entity: SyncPayloadEntity,
  changedFields: readonly string[],
): DataResult<Uint8Array> {
  try {
    if (!isSyncPayloadEntity(entity) || !isChangedFields(changedFields)) {
      return invalidPayload();
    }
    const serialized = JSON.stringify({
      payloadSchemaVersion: CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION,
      entity,
      changedFields: [...changedFields].sort(),
    } satisfies SyncPayloadV2);
    return { ok: true, value: new TextEncoder().encode(serialized) };
  } catch {
    return invalidPayload();
  }
}

/**
 * Lukee V2-payloadit ja muuntaa V1-koko-snapshotit konservatiiviseksi
 * muutokseksi, jossa kaikki tavalliset entity-kentät on merkitty muuttuneiksi.
 */
export function decodeSyncPayload(bytes: Uint8Array): DataResult<SyncPayload> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    return invalidPayload();
  }

  if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
    return invalidPayload();
  }
  const envelope = decoded as Record<string, unknown>;
  if (envelope.payloadSchemaVersion === 1) {
    if (
      Object.keys(envelope).length !== 2 ||
      !Object.hasOwn(envelope, "entity") ||
      !isSyncPayloadEntity(envelope.entity)
    ) {
      return invalidPayload();
    }
    return {
      ok: true,
      value: {
        payloadSchemaVersion: CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION,
        entity: envelope.entity,
        changedFields: Object.keys(envelope.entity)
          .filter((field) => !ENTITY_METADATA_FIELDS.has(field))
          .sort(),
      },
    };
  }

  if (
    Object.keys(envelope).length !== 3 ||
    envelope.payloadSchemaVersion !== CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION ||
    !Object.hasOwn(envelope, "entity") ||
    !Object.hasOwn(envelope, "changedFields") ||
    !isSyncPayloadEntity(envelope.entity) ||
    !isChangedFields(envelope.changedFields)
  ) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync-payload.unsupported-version-or-shape",
        "Synkronointitiedon versiota tai rakennetta ei tueta tässä sovellusversiossa.",
      ),
    };
  }

  return {
    ok: true,
    value: {
      payloadSchemaVersion: CURRENT_SYNC_PAYLOAD_SCHEMA_VERSION,
      entity: envelope.entity,
      changedFields: envelope.changedFields,
    },
  };
}
