// T312: deterministic field-level merge over authenticated sync operations.

import type { SyncOperation } from "@lifeos/domain";
import type { DataError, DataResult } from "./errors.ts";
import type { SyncPayloadEntity, SyncPayloadJsonValue } from "./sync-payload.ts";

/** Only cosmetic fields are allowed to resolve automatically with LWW. */
export const SYNC_LWW_FIELDS: Readonly<Record<string, readonly string[]>> = {
  project: ["colorKey"],
  tag: ["colorKey"],
  "browser-installation": ["installationName"],
};

export interface SyncFieldClock {
  readonly operationId: string;
  readonly installationId: string;
  readonly operation: SyncOperation["operation"];
  readonly occurredAt: string;
  readonly entityVersion: number;
}

export interface SyncEntityChange {
  readonly operation: SyncOperation;
  readonly entity: SyncPayloadEntity;
  readonly changedFields: readonly string[];
}

export interface SyncFieldConflict {
  readonly field: string;
  readonly currentOperationId: string;
  readonly incomingOperationId: string;
  readonly currentInstallationId: string;
  readonly incomingInstallationId: string;
  readonly currentValue: SyncPayloadJsonValue | undefined;
  readonly incomingValue: SyncPayloadJsonValue | undefined;
  readonly winnerOperationId: string;
}

export interface SyncEntityMergeResult {
  readonly entity: SyncPayloadEntity;
  readonly changed: boolean;
  readonly fieldClocks: Readonly<Record<string, SyncFieldClock>>;
  readonly conflicts: readonly SyncFieldConflict[];
}

export interface MergeSyncEntityChangesInput {
  readonly entityType: string;
  readonly currentEntity: SyncPayloadEntity | null;
  readonly currentFieldClocks?: Readonly<Record<string, SyncFieldClock>>;
  readonly changes: readonly SyncEntityChange[];
}

const IMMUTABLE_FIELDS = new Set(["id", "createdAt"]);
const DERIVED_METADATA_FIELDS = new Set(["updatedAt", "version"]);
const FORBIDDEN_FIELDS = new Set(["__proto__", "prototype", "constructor"]);

function mergeError(diagnosticCode: string, userMessage: string): DataError {
  return { code: "data-corrupted", diagnosticCode, userMessage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidDeletedAt(entity: SyncPayloadEntity): boolean {
  return (
    !Object.hasOwn(entity, "deletedAt") ||
    entity.deletedAt === null ||
    (typeof entity.deletedAt === "string" && Number.isFinite(Date.parse(entity.deletedAt)))
  );
}

function isValidClock(value: unknown): value is SyncFieldClock {
  return (
    isRecord(value) &&
    typeof value.operationId === "string" &&
    value.operationId.length > 0 &&
    typeof value.installationId === "string" &&
    value.installationId.length > 0 &&
    ["create", "update", "delete", "resolve"].includes(value.operation as string) &&
    typeof value.occurredAt === "string" &&
    Number.isFinite(Date.parse(value.occurredAt)) &&
    Number.isSafeInteger(value.entityVersion) &&
    typeof value.entityVersion === "number" &&
    value.entityVersion > 0
  );
}

function isValidEntitySnapshot(value: SyncPayloadEntity, operation: SyncOperation): boolean {
  return (
    typeof value.id === "string" &&
    value.id === operation.entityId &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(Date.parse(value.updatedAt)) &&
    Number.isSafeInteger(value.version) &&
    typeof value.version === "number" &&
    value.version > 0 &&
    hasValidDeletedAt(value)
  );
}

function isValidDeleteChange(change: SyncEntityChange): boolean {
  return (
    change.operation.operation !== "delete" ||
    (typeof change.entity.deletedAt === "string" &&
      Number.isFinite(Date.parse(change.entity.deletedAt)) &&
      change.changedFields.length === 1 &&
      change.changedFields[0] === "deletedAt")
  );
}

function fieldClockForChange(
  operation: SyncOperation,
  field: string,
  value: SyncPayloadJsonValue | undefined,
): SyncOperation {
  return field === "deletedAt" && typeof value === "string"
    ? { ...operation, operation: "delete" }
    : operation;
}

function compareClocks(first: SyncFieldClock, second: SyncFieldClock): number {
  const timeDifference = Date.parse(first.occurredAt) - Date.parse(second.occurredAt);
  if (timeDifference !== 0) return timeDifference;
  const deletionDifference =
    Number(first.operation === "delete") - Number(second.operation === "delete");
  if (deletionDifference !== 0) return deletionDifference;
  const installationDifference = first.installationId.localeCompare(second.installationId);
  if (installationDifference !== 0) return installationDifference;
  return first.operationId.localeCompare(second.operationId);
}

function compareChanges(first: SyncEntityChange, second: SyncEntityChange): number {
  const firstIsCreate = first.operation.operation === "create";
  const secondIsCreate = second.operation.operation === "create";
  if (firstIsCreate !== secondIsCreate) return firstIsCreate ? -1 : 1;
  return compareClocks(first.operation, second.operation);
}

export function syncJsonValuesEqual(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true;
  if (
    typeof first !== "object" ||
    first === null ||
    typeof second !== "object" ||
    second === null
  ) {
    return false;
  }
  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
      return false;
    }
    return first.every((value, index) => syncJsonValuesEqual(value, second[index]));
  }
  const firstRecord = first as Record<string, unknown>;
  const secondRecord = second as Record<string, unknown>;
  const firstKeys = Object.keys(firstRecord).sort();
  const secondKeys = Object.keys(secondRecord).sort();
  return (
    firstKeys.length === secondKeys.length &&
    firstKeys.every(
      (key, index) =>
        key === secondKeys[index] && syncJsonValuesEqual(firstRecord[key], secondRecord[key]),
    )
  );
}

function isLwwField(entityType: string, field: string): boolean {
  return SYNC_LWW_FIELDS[entityType]?.includes(field) === true;
}

function setMergedField(
  entity: Record<string, SyncPayloadJsonValue>,
  field: string,
  exists: boolean,
  value: SyncPayloadJsonValue | undefined,
): Record<string, SyncPayloadJsonValue> {
  if (exists && value !== undefined) {
    entity[field] = value;
    return entity;
  }
  const withoutField: Record<string, SyncPayloadJsonValue> = {};
  for (const [key, existingValue] of Object.entries(entity)) {
    if (key !== field) withoutField[key] = existingValue;
  }
  return withoutField;
}

function mergeAppendOnlyEntity(
  input: MergeSyncEntityChangesInput,
): DataResult<SyncEntityMergeResult> {
  const current = input.currentEntity;
  const changes = [...input.changes].sort(compareChanges);
  if (current !== null && changes[0] && !isValidEntitySnapshot(current, changes[0].operation)) {
    return {
      ok: false,
      error: mergeError(
        "data.sync.merge.invalid-current-entity",
        "Paikallisen synkronoitavan tietueen rakenne ei kelpaa.",
      ),
    };
  }
  let entity = current;
  const conflicts: SyncFieldConflict[] = [];
  const fieldClocks: Record<string, SyncFieldClock> = { ...(input.currentFieldClocks ?? {}) };

  for (const change of changes) {
    if (!isValidEntitySnapshot(change.entity, change.operation)) {
      return {
        ok: false,
        error: mergeError(
          "data.sync.merge.invalid-snapshot",
          "Synkronointimuutoksen sisältö ei vastannut sen tunnistetta.",
        ),
      };
    }
    if (!isValidDeleteChange(change)) {
      return {
        ok: false,
        error: mergeError(
          "data.sync.merge.invalid-tombstone",
          "Poiston synkronointitombstone ei kelpaa.",
        ),
      };
    }
    if (change.operation.operation !== "create") {
      conflicts.push({
        field: "$entity",
        currentOperationId: fieldClocks.$entity?.operationId ?? "local-snapshot",
        incomingOperationId: change.operation.operationId,
        currentInstallationId: fieldClocks.$entity?.installationId ?? "local",
        incomingInstallationId: change.operation.installationId,
        currentValue: entity,
        incomingValue: change.entity,
        winnerOperationId: fieldClocks.$entity?.operationId ?? "local-snapshot",
      });
      continue;
    }
    if (entity === null) {
      entity = change.entity;
      fieldClocks.$entity = change.operation;
      continue;
    }
    if (!syncJsonValuesEqual(entity, change.entity)) {
      const currentClock = fieldClocks.$entity ?? {
        operationId: "local-snapshot",
        installationId: "local",
        operation: "create" as const,
        occurredAt: entity.updatedAt as string,
        entityVersion: entity.version as number,
      };
      const incomingWins = compareClocks(currentClock, change.operation) < 0;
      conflicts.push({
        field: "$entity",
        currentOperationId: currentClock.operationId,
        incomingOperationId: change.operation.operationId,
        currentInstallationId: currentClock.installationId,
        incomingInstallationId: change.operation.installationId,
        currentValue: entity,
        incomingValue: change.entity,
        winnerOperationId: incomingWins ? change.operation.operationId : currentClock.operationId,
      });
      if (incomingWins) {
        entity = change.entity;
        fieldClocks.$entity = change.operation;
      }
    }
  }

  if (entity === null) {
    return {
      ok: false,
      error: mergeError(
        "data.sync.merge.append-only-missing-create",
        "Append-only-tietueelta puuttui luontitoimenpide.",
      ),
    };
  }
  return {
    ok: true,
    value: {
      entity,
      changed:
        current === null && changes.some((change) => change.operation.operation === "create"),
      fieldClocks,
      conflicts,
    },
  };
}

/**
 * Merge all authenticated changes for one entity. Unchanged snapshot fields
 * are ignored; same-field edits from different installations are surfaced as
 * conflicts and use a stable operation ordering while T313 stores references
 * to both encrypted operation snapshots.
 */
export function mergeSyncEntityChanges(
  input: MergeSyncEntityChangesInput,
): DataResult<SyncEntityMergeResult> {
  if (input.entityType === "measurement") return mergeAppendOnlyEntity(input);
  if (input.changes.length === 0 && input.currentEntity === null) {
    return {
      ok: false,
      error: mergeError("data.sync.merge.empty", "Yhdistettävää synkronointimuutosta ei löytynyt."),
    };
  }
  if (input.currentEntity !== null) {
    const firstOperation = input.changes[0]?.operation;
    if (
      typeof input.currentEntity.id !== "string" ||
      (firstOperation !== undefined && input.currentEntity.id !== firstOperation.entityId) ||
      typeof input.currentEntity.createdAt !== "string" ||
      !Number.isFinite(Date.parse(input.currentEntity.createdAt)) ||
      typeof input.currentEntity.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(input.currentEntity.updatedAt)) ||
      typeof input.currentEntity.version !== "number" ||
      !Number.isSafeInteger(input.currentEntity.version) ||
      input.currentEntity.version < 1 ||
      !hasValidDeletedAt(input.currentEntity)
    ) {
      return {
        ok: false,
        error: mergeError(
          "data.sync.merge.invalid-current-entity",
          "Paikallisen synkronoitavan tietueen rakenne ei kelpaa.",
        ),
      };
    }
  }

  let entity: Record<string, SyncPayloadJsonValue> | null =
    input.currentEntity === null ? null : { ...input.currentEntity };
  const fieldClocks: Record<string, SyncFieldClock> = {};
  for (const [field, clock] of Object.entries(input.currentFieldClocks ?? {})) {
    if (isValidClock(clock)) fieldClocks[field] = clock;
  }
  if (
    input.currentEntity !== null &&
    Object.hasOwn(input.currentEntity, "deletedAt") &&
    fieldClocks.deletedAt === undefined
  ) {
    const hasTombstone = typeof input.currentEntity.deletedAt === "string";
    fieldClocks.deletedAt = {
      operationId: hasTombstone ? "local-tombstone" : "local-deletion-state",
      installationId: "local-snapshot",
      operation: hasTombstone ? "delete" : "create",
      occurredAt: hasTombstone
        ? (input.currentEntity.deletedAt as string)
        : (input.currentEntity.createdAt as string),
      entityVersion: input.currentEntity.version as number,
    };
  }
  const conflicts: SyncFieldConflict[] = [];
  let changed = false;
  const changes = [...input.changes].sort(compareChanges);

  for (const change of changes) {
    const { operation, entity: incomingEntity, changedFields } = change;
    if (!isValidEntitySnapshot(incomingEntity, operation)) {
      return {
        ok: false,
        error: mergeError(
          "data.sync.merge.invalid-snapshot",
          "Synkronointimuutoksen sisältö ei vastannut sen tunnistetta.",
        ),
      };
    }
    if (!isValidDeleteChange(change)) {
      return {
        ok: false,
        error: mergeError(
          "data.sync.merge.invalid-tombstone",
          "Poiston synkronointitombstone ei kelpaa.",
        ),
      };
    }
    if (entity === null) {
      if (operation.operation !== "create" && operation.operation !== "delete") {
        return {
          ok: false,
          error: mergeError(
            "data.sync.merge.missing-create",
            "Tietueelta puuttui sen alkuperäinen luontitoimenpide.",
          ),
        };
      }
      entity = { ...incomingEntity };
      for (const field of Object.keys(incomingEntity)) {
        if (!DERIVED_METADATA_FIELDS.has(field)) {
          fieldClocks[field] = fieldClockForChange(operation, field, incomingEntity[field]);
        }
      }
      changed = true;
      continue;
    }
    if (entity.id !== incomingEntity.id || entity.createdAt !== incomingEntity.createdAt) {
      return {
        ok: false,
        error: mergeError(
          "data.sync.merge.immutable-field-conflict",
          "Synkronointimuutos törmäsi tietueen pysyvään tunnisteeseen.",
        ),
      };
    }
    if (operation.operation === "create" && typeof entity.deletedAt === "string") {
      continue;
    }

    for (const field of changedFields) {
      if (
        typeof field !== "string" ||
        field.length === 0 ||
        field.length > 128 ||
        IMMUTABLE_FIELDS.has(field) ||
        DERIVED_METADATA_FIELDS.has(field) ||
        FORBIDDEN_FIELDS.has(field)
      ) {
        return {
          ok: false,
          error: mergeError(
            "data.sync.merge.invalid-field-mask",
            "Synkronointimuutoksen kenttäluettelo ei kelpaa.",
          ),
        };
      }
      const incomingHasField = Object.hasOwn(incomingEntity, field);
      const currentHasField = Object.hasOwn(entity, field);
      const incomingValue = incomingHasField ? incomingEntity[field] : undefined;
      const currentValue = currentHasField ? entity[field] : undefined;
      const currentClock = fieldClocks[field];
      if (input.entityType === "browser-installation" && field === "revokedAt") {
        const currentRevocation =
          typeof currentValue === "string" && Number.isFinite(Date.parse(currentValue))
            ? Date.parse(currentValue)
            : null;
        const incomingRevocation =
          typeof incomingValue === "string" && Number.isFinite(Date.parse(incomingValue))
            ? Date.parse(incomingValue)
            : null;
        if (currentRevocation !== null) {
          if (incomingRevocation !== null && incomingRevocation < currentRevocation) {
            entity = setMergedField(entity, field, true, incomingValue);
            fieldClocks[field] = fieldClockForChange(operation, field, incomingValue);
            changed = true;
          }
          continue;
        }
        if (incomingRevocation !== null) {
          entity = setMergedField(entity, field, true, incomingValue);
          fieldClocks[field] = fieldClockForChange(operation, field, incomingValue);
          changed = true;
          continue;
        }
      }
      if (
        currentHasField === incomingHasField &&
        syncJsonValuesEqual(currentValue, incomingValue)
      ) {
        const matchingClock = fieldClockForChange(operation, field, incomingValue);
        if (currentClock === undefined || compareClocks(currentClock, matchingClock) < 0) {
          fieldClocks[field] = matchingClock;
        }
        continue;
      }
      if (currentClock === undefined) {
        entity = setMergedField(entity, field, incomingHasField, incomingValue);
        fieldClocks[field] = fieldClockForChange(operation, field, incomingValue);
        changed = true;
        continue;
      }

      const incomingClock = fieldClockForChange(operation, field, incomingValue);
      const incomingWins = compareClocks(currentClock, incomingClock) < 0;
      const lww = isLwwField(input.entityType, field) || field === "deletedAt";
      if (!lww && currentClock.installationId !== operation.installationId) {
        conflicts.push({
          field,
          currentOperationId: currentClock.operationId,
          incomingOperationId: operation.operationId,
          currentInstallationId: currentClock.installationId,
          incomingInstallationId: operation.installationId,
          currentValue,
          incomingValue,
          winnerOperationId: incomingWins ? operation.operationId : currentClock.operationId,
        });
      }
      if (incomingWins) {
        entity = setMergedField(entity, field, incomingHasField, incomingValue);
        fieldClocks[field] = incomingClock;
        changed = true;
      }
    }

    const currentUpdatedAt = entity.updatedAt;
    const incomingUpdatedAt = incomingEntity.updatedAt;
    if (
      typeof currentUpdatedAt === "string" &&
      typeof incomingUpdatedAt === "string" &&
      Date.parse(currentUpdatedAt) < Date.parse(incomingUpdatedAt)
    ) {
      entity.updatedAt = incomingUpdatedAt;
      changed = true;
    }
    const currentVersion = entity.version;
    const incomingVersion = incomingEntity.version;
    if (
      typeof currentVersion === "number" &&
      typeof incomingVersion === "number" &&
      incomingVersion > currentVersion
    ) {
      entity.version = incomingVersion;
      changed = true;
    }
  }

  if (entity === null) {
    return {
      ok: false,
      error: mergeError("data.sync.merge.empty", "Yhdistämisen tuloksena ei syntynyt tietuetta."),
    };
  }
  return {
    ok: true,
    value: { entity, changed, fieldClocks, conflicts },
  };
}
