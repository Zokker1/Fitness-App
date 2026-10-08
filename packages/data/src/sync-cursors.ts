// T315: provider-specific durable remote checkpoints.

import type { SyncCursor } from "@lifeos/domain";
import type { DataError, DataResult } from "./errors.ts";
import { invalidInput } from "./errors.ts";
import { systemClock } from "./clock.ts";
import { ulidLikeId } from "./ids.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import { runAtomicWrite } from "./transactions.ts";

export const MAX_SYNC_PROVIDER_CURSOR_LENGTH = 1_400_000;
const MAX_SYNC_PROVIDER_ID_LENGTH = 128;
const MAX_SYNC_INSTALLATION_ID_LENGTH = 128;
const MAX_SYNC_OPERATION_ID_LENGTH = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parseSyncCursorRow(value: unknown): SyncCursor | null {
  if (!isRecord(value)) return null;
  const {
    id,
    installation_id: installationId,
    provider_id: providerId,
    provider_cursor: providerCursor,
    last_seen_operation_id: lastSeenOperationId,
    updated_through: updatedThrough,
    created_at: createdAt,
    updated_at: updatedAt,
    version,
  } = value;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof installationId !== "string" ||
    installationId.length === 0 ||
    installationId.length > MAX_SYNC_INSTALLATION_ID_LENGTH ||
    typeof providerId !== "string" ||
    providerId.length === 0 ||
    providerId.length > MAX_SYNC_PROVIDER_ID_LENGTH ||
    (providerCursor !== null &&
      (typeof providerCursor !== "string" ||
        providerCursor.length === 0 ||
        providerCursor.length > MAX_SYNC_PROVIDER_CURSOR_LENGTH)) ||
    (lastSeenOperationId !== null &&
      (typeof lastSeenOperationId !== "string" ||
        lastSeenOperationId.length === 0 ||
        lastSeenOperationId.length > MAX_SYNC_OPERATION_ID_LENGTH)) ||
    !isTimestamp(updatedThrough) ||
    !isTimestamp(createdAt) ||
    !isTimestamp(updatedAt) ||
    !isPositiveSafeInteger(version)
  ) {
    return null;
  }
  return {
    id,
    installationId,
    providerId,
    providerCursor,
    lastSeenOperationId,
    updatedThrough,
    createdAt,
    updatedAt,
    version,
  };
}

function invalidCursorStore(): DataError {
  return {
    code: "data-corrupted",
    userMessage: "Synkronoinnin tallennettua jatkokohtaa ei voitu lukea turvallisesti.",
    diagnosticCode: "data.sync.cursor.invalid-row",
  };
}

function validCursorKey(installationId: string, providerId: string): boolean {
  return (
    typeof installationId === "string" &&
    installationId.length > 0 &&
    installationId.length <= MAX_SYNC_INSTALLATION_ID_LENGTH &&
    typeof providerId === "string" &&
    providerId.length > 0 &&
    providerId.length <= MAX_SYNC_PROVIDER_ID_LENGTH
  );
}

export async function getSyncCursor(
  installationId: string,
  providerId: string,
): Promise<DataResult<SyncCursor | null>> {
  if (!validCursorKey(installationId, providerId)) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync.cursor.invalid-key",
        "Synkronoinnin tallennettua jatkokohtaa ei voitu lukea.",
      ),
    };
  }
  const response = await sendDbRequest({
    kind: "query",
    op: "getSyncCursor",
    params: { installation_id: installationId, provider_id: providerId },
  });
  if (!response.ok) return toDataResult(response, () => null);
  if (!Array.isArray(response.rows) || response.rows.length > 1) {
    return { ok: false, error: invalidCursorStore() };
  }
  const row: unknown = response.rows[0];
  if (row === undefined) return { ok: true, value: null };
  const cursor = parseSyncCursorRow(row);
  return cursor === null ||
    cursor.installationId !== installationId ||
    cursor.providerId !== providerId
    ? { ok: false, error: invalidCursorStore() }
    : { ok: true, value: cursor };
}

export interface SaveSyncCursorInput {
  readonly installationId: string;
  readonly providerId: string;
  readonly providerCursor: string;
  readonly lastSeenOperationId?: string | null;
}

function createCursorId(): string | null {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  try {
    return ulidLikeId(Date.now(), bytes);
  } finally {
    bytes.fill(0);
  }
}

export async function saveSyncCursor(input: SaveSyncCursorInput): Promise<DataResult<true>> {
  if (
    !validCursorKey(input.installationId, input.providerId) ||
    typeof input.providerCursor !== "string" ||
    input.providerCursor.length === 0 ||
    input.providerCursor.length > MAX_SYNC_PROVIDER_CURSOR_LENGTH ||
    (input.lastSeenOperationId !== undefined &&
      input.lastSeenOperationId !== null &&
      (typeof input.lastSeenOperationId !== "string" ||
        input.lastSeenOperationId.length === 0 ||
        input.lastSeenOperationId.length > MAX_SYNC_OPERATION_ID_LENGTH))
  ) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync.cursor.invalid-value",
        "Synkronoinnin jatkokohta ei ole kelvollinen.",
      ),
    };
  }
  const id = createCursorId();
  if (id === null) {
    return {
      ok: false,
      error: invalidInput(
        "data.sync.cursor.random-unavailable",
        "Synkronoinnin jatkokohtaa ei voitu tallentaa turvallisesti.",
      ),
    };
  }
  const now = systemClock().nowIso();
  return runAtomicWrite([
    {
      op: "putSyncCursor",
      params: {
        id,
        installation_id: input.installationId,
        provider_id: input.providerId,
        provider_cursor: input.providerCursor,
        last_seen_operation_id: input.lastSeenOperationId ?? "",
        updated_through: now,
        created_at: now,
        updated_at: now,
        version: 1,
      },
    },
  ]);
}
