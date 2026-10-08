import type { EntityId, MoodCheckin } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "mood-checkin";
const LEGACY_BATCH_SIZE = 32;

interface MoodCheckinRow {
  readonly id?: unknown;
  readonly checked_at?: unknown;
  readonly mood?: unknown;
  readonly stress?: unknown;
  readonly energy?: unknown;
  readonly motivation?: unknown;
  readonly focus?: unknown;
  readonly note?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedMoodCheckin(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua mielialakirjausta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.mood-checkin.invalid",
    },
  };
}

function isOptionalScale(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5)
  );
}

function normalizeLegacyMoodCheckin(checkin: MoodCheckin): MoodCheckin {
  return {
    ...checkin,
    stress: checkin.stress ?? null,
    energy: checkin.energy ?? null,
    motivation: checkin.motivation ?? null,
    focus: checkin.focus ?? null,
  };
}

export function validMoodCheckin(checkin: MoodCheckin): boolean {
  return (
    typeof checkin.id === "string" &&
    checkin.id.length > 0 &&
    typeof checkin.checkedAt === "string" &&
    Number.isInteger(checkin.mood) &&
    checkin.mood >= 1 &&
    checkin.mood <= 5 &&
    isOptionalScale(checkin.stress) &&
    isOptionalScale(checkin.energy) &&
    isOptionalScale(checkin.motivation) &&
    isOptionalScale(checkin.focus) &&
    (checkin.note === null || (typeof checkin.note === "string" && checkin.note.length <= 500)) &&
    typeof checkin.createdAt === "string" &&
    typeof checkin.updatedAt === "string" &&
    Number.isInteger(checkin.version) &&
    checkin.version >= 1
  );
}

export function putMoodCheckinOp(checkin: MoodCheckin): DbTransactionOp {
  return {
    op: "putMoodCheckin",
    params: {
      id: checkin.id,
      checked_at: checkin.checkedAt,
      mood: checkin.mood,
      stress: checkin.stress ?? "",
      energy: checkin.energy ?? "",
      motivation: checkin.motivation ?? "",
      focus: checkin.focus ?? "",
      note: checkin.note ?? "",
      created_at: checkin.createdAt,
      updated_at: checkin.updatedAt,
      version: checkin.version,
    },
  };
}

async function migrateLegacyMoodCheckins(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<MoodCheckin>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const normalizedLegacy = legacyResult.value.map(normalizeLegacyMoodCheckin);
  if (normalizedLegacy.some((checkin) => !validMoodCheckin(checkin))) {
    return corruptedMoodCheckin();
  }

  for (let offset = 0; offset < normalizedLegacy.length; offset += LEGACY_BATCH_SIZE) {
    const batch = normalizedLegacy.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const checkin of batch) {
      ops.push(putMoodCheckinOp(checkin));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: checkin.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseMoodCheckins(rows: readonly unknown[]): DataResult<readonly MoodCheckin[]> {
  const checkins: MoodCheckin[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedMoodCheckin();
    }
    const row = value as MoodCheckinRow;
    const stress = row.stress;
    const energy = row.energy;
    const motivation = row.motivation;
    const focus = row.focus;
    if (
      typeof row.id !== "string" ||
      typeof row.checked_at !== "string" ||
      typeof row.mood !== "number" ||
      !isOptionalScale(stress) ||
      !isOptionalScale(energy) ||
      !isOptionalScale(motivation) ||
      !isOptionalScale(focus) ||
      (row.note !== null && typeof row.note !== "string") ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedMoodCheckin();
    }
    const checkin: MoodCheckin = {
      id: row.id,
      checkedAt: row.checked_at,
      mood: row.mood,
      stress,
      energy,
      motivation,
      focus,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validMoodCheckin(checkin)) {
      return corruptedMoodCheckin();
    }
    checkins.push(checkin);
  }
  return { ok: true, value: checkins };
}

export function createSqliteMoodCheckinStore(): EntityStore<MoodCheckin> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyMoodCheckins();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<MoodCheckin> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly MoodCheckin[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listMoodCheckins", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseMoodCheckins(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<MoodCheckin>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getMoodCheckin", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as MoodCheckin);
      const parsed = parseMoodCheckins(response.rows);
      if (!parsed.ok) return parsed;
      const checkin = parsed.value[0];
      return checkin === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: checkin };
    },
    async save(checkin: MoodCheckin): Promise<DataResult<MoodCheckin>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      if (!validMoodCheckin(checkin)) {
        return {
          ok: false,
          error: invalidInput(
            "data.mood-checkin.invalid",
            "Mielialakirjausta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putMoodCheckinOp(checkin)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: checkin } : result;
    },
    async saveWithSyncOperation(
      checkin: MoodCheckin,
      context: SyncWriteContext,
    ): Promise<DataResult<MoodCheckin>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeLegacyMoodCheckin(checkin);
      if (!validMoodCheckin(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.mood-checkin.invalid",
            "Mielialakirjausta ei voi tallentaa näillä tiedoilla.",
          ),
        };
      }
      const committed = await commitSyncableChange({
        operationId: context.operationId,
        installationId: context.installationId,
        entityType: ENTITY_TYPE,
        entityId: normalized.id,
        operation: context.operation,
        entityVersion: normalized.version,
        occurredAt: context.occurredAt,
        createdAt: normalized.createdAt,
        entity: normalized as unknown as SyncPayloadEntity,
        changedFields: context.changedFields,
        keySession: context.keySession,
        crypto: context.crypto,
        writes: [putMoodCheckinOp(normalized)],
      });
      return committed.ok ? { ok: true, value: normalized } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteMoodCheckin",
        params: { id },
      });
      return toDataResult(response, () => true);
    },
  };
  return store;
}
