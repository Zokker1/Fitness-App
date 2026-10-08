import { describe, expect, it } from "vitest";
import type { SyncOperation } from "@lifeos/domain";
import { mergeSyncEntityChanges } from "../src/sync-merge.ts";
import type { SyncEntityChange } from "../src/sync-merge.ts";
import type { SyncPayloadEntity } from "../src/sync-payload.ts";

const CREATED_AT = "2026-10-03T10:00:00.000Z";

function operation(
  operationId: string,
  installationId: string,
  occurredAt: string,
  entityVersion: number,
): SyncOperation {
  return {
    id: operationId,
    operationId,
    installationId,
    entityType: "browser-installation",
    entityId: "browser-b",
    operation: "update",
    entityVersion,
    occurredAt,
    encryptedPayloadRef: "ciphertext",
    integrityRef: "integrity",
    createdAt: CREATED_AT,
    updatedAt: occurredAt,
    version: 1,
  };
}

function change(syncOperation: SyncOperation, revokedAt: string | null): SyncEntityChange {
  return {
    operation: syncOperation,
    entity: {
      id: "browser-b",
      installationId: "browser-b",
      installationName: "Kotiselain",
      lastSeenAppVersion: "0.1.0",
      lastSyncAt: null,
      revokedAt,
      createdAt: CREATED_AT,
      updatedAt: syncOperation.occurredAt,
      version: syncOperation.entityVersion,
    },
    changedFields: ["revokedAt"],
  };
}

describe("browser installation revocation merge", () => {
  it("keeps revocation terminal when a later update tries to clear it", () => {
    const current: SyncPayloadEntity = {
      id: "browser-b",
      installationId: "browser-b",
      installationName: "Kotiselain",
      lastSeenAppVersion: "0.1.0",
      lastSyncAt: null,
      revokedAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      version: 1,
    };
    const revokedAt = "2026-10-03T11:00:00.000Z";
    const merged = mergeSyncEntityChanges({
      entityType: "browser-installation",
      currentEntity: current,
      changes: [
        change(operation("revoke-b", "browser-a", revokedAt, 2), revokedAt),
        change(operation("clear-revoke-b", "browser-c", "2026-10-03T12:00:00.000Z", 3), null),
      ],
    });

    expect(merged.ok).toBe(true);
    if (merged.ok) expect(merged.value.entity.revokedAt).toBe(revokedAt);
  });
});
