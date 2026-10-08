import type { EntityId, Reminder, ReminderKind } from "@lifeos/domain";
import { validateReminderRule } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore, SyncWriteContext } from "./store.ts";
import { commitSyncableChange } from "./sync-engine.ts";
import type { SyncPayloadEntity } from "./sync-payload.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

const ENTITY_TYPE = "reminder";
const LEGACY_BATCH_SIZE = 32;
const REMINDER_KINDS: readonly ReminderKind[] = ["time", "recurring", "deadline", "conditional"];

interface ReminderRow {
  readonly id?: unknown;
  readonly kind?: unknown;
  readonly route?: unknown;
  readonly title?: unknown;
  readonly fire_at?: unknown;
  readonly snoozed_until?: unknown;
  readonly rule_json?: unknown;
  readonly category_key?: unknown;
  readonly enabled?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
  readonly deleted_at?: unknown;
}

function corruptedReminder(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua muistutusta ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.reminder.invalid",
    },
  };
}

function normalizeReminder(reminder: Reminder): Reminder {
  return {
    ...reminder,
    rule: reminder.rule ?? null,
    fireAt: reminder.fireAt ?? null,
    snoozedUntil: reminder.snoozedUntil ?? null,
    deletedAt: reminder.deletedAt ?? null,
  };
}

function hasSerializableRule(reminder: Reminder): boolean {
  if (reminder.rule === null) return true;
  try {
    const serialized = JSON.stringify(reminder.rule);
    return typeof serialized === "string" && serialized.length <= 2048;
  } catch {
    return false;
  }
}

export function validReminder(reminder: Reminder): boolean {
  const validRule =
    reminder.rule === null ||
    (reminder.rule.kind === reminder.kind &&
      validateReminderRule(reminder.rule).ok &&
      hasSerializableRule(reminder));
  return (
    typeof reminder.id === "string" &&
    reminder.id.length > 0 &&
    REMINDER_KINDS.includes(reminder.kind) &&
    typeof reminder.route === "string" &&
    reminder.route.trim().length > 0 &&
    reminder.route.length <= 200 &&
    typeof reminder.title === "string" &&
    reminder.title.trim().length > 0 &&
    reminder.title.length <= 200 &&
    validRule &&
    (reminder.fireAt === null ||
      (typeof reminder.fireAt === "string" && reminder.fireAt.length > 0)) &&
    (reminder.snoozedUntil === null ||
      (typeof reminder.snoozedUntil === "string" && reminder.snoozedUntil.length > 0)) &&
    typeof reminder.categoryKey === "string" &&
    reminder.categoryKey.trim().length > 0 &&
    reminder.categoryKey.length <= 60 &&
    typeof reminder.enabled === "boolean" &&
    typeof reminder.createdAt === "string" &&
    typeof reminder.updatedAt === "string" &&
    Number.isInteger(reminder.version) &&
    reminder.version >= 1 &&
    (reminder.deletedAt === null || typeof reminder.deletedAt === "string")
  );
}

export function putReminderOp(reminder: Reminder): DbTransactionOp {
  return {
    op: "putReminder",
    params: {
      id: reminder.id,
      kind: reminder.kind,
      route: reminder.route,
      title: reminder.title,
      fire_at: reminder.fireAt ?? "",
      snoozed_until: reminder.snoozedUntil ?? "",
      rule_json: reminder.rule === null ? "" : JSON.stringify(reminder.rule),
      category_key: reminder.categoryKey,
      enabled: reminder.enabled ? 1 : 0,
      created_at: reminder.createdAt,
      updated_at: reminder.updatedAt,
      version: reminder.version,
      deleted_at: reminder.deletedAt ?? "",
    },
  };
}

async function migrateLegacyReminders(): Promise<DataResult<true>> {
  const legacyResult = await createSqliteEntityDocStore<Reminder>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const reminders = legacyResult.value.map(normalizeReminder);
  if (reminders.some((reminder) => !validReminder(reminder))) {
    return corruptedReminder();
  }

  for (let offset = 0; offset < reminders.length; offset += LEGACY_BATCH_SIZE) {
    const batch = reminders.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const reminder of batch) {
      ops.push(putReminderOp(reminder));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: reminder.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseReminders(rows: readonly unknown[]): DataResult<readonly Reminder[]> {
  const reminders: Reminder[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedReminder();
    }
    const row = value as ReminderRow;
    if (
      typeof row.id !== "string" ||
      typeof row.kind !== "string" ||
      typeof row.route !== "string" ||
      typeof row.title !== "string" ||
      (row.fire_at !== null && typeof row.fire_at !== "string") ||
      (row.snoozed_until !== null && typeof row.snoozed_until !== "string") ||
      (row.rule_json !== null && typeof row.rule_json !== "string") ||
      typeof row.category_key !== "string" ||
      typeof row.enabled !== "number" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number" ||
      (row.deleted_at !== null && typeof row.deleted_at !== "string")
    ) {
      return corruptedReminder();
    }
    let rule: Reminder["rule"] = null;
    if (typeof row.rule_json === "string") {
      if (row.rule_json.length === 0 || row.rule_json.length > 2048) return corruptedReminder();
      let parsedRule: unknown;
      try {
        parsedRule = JSON.parse(row.rule_json) as unknown;
      } catch {
        return corruptedReminder();
      }
      const validatedRule = validateReminderRule(parsedRule);
      if (!validatedRule.ok || validatedRule.value.kind !== row.kind) return corruptedReminder();
      rule = validatedRule.value;
    }
    const reminder: Reminder = {
      id: row.id,
      kind: row.kind as ReminderKind,
      route: row.route,
      title: row.title,
      rule,
      fireAt: row.fire_at,
      snoozedUntil: row.snoozed_until,
      categoryKey: row.category_key,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
      deletedAt: row.deleted_at,
    };
    if ((row.enabled !== 0 && row.enabled !== 1) || !validReminder(reminder)) {
      return corruptedReminder();
    }
    reminders.push(reminder);
  }
  return { ok: true, value: reminders };
}

export function createSqliteReminderStore(): EntityStore<Reminder> {
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyReminders();
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<Reminder> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly Reminder[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "listReminders", params: {} });
      if (!response.ok) return toDataResult(response, () => []);
      return parseReminders(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<Reminder>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({ kind: "query", op: "getReminder", params: { id } });
      if (!response.ok) return toDataResult(response, () => ({}) as Reminder);
      const parsed = parseReminders(response.rows);
      if (!parsed.ok) return parsed;
      const reminder = parsed.value[0];
      return reminder === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: reminder };
    },
    async save(reminder: Reminder): Promise<DataResult<Reminder>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeReminder(reminder);
      if (!validReminder(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.reminder.invalid",
            "Muistutuksen sääntö, tyyppi, reitti, otsikko, kategoria tai metatiedot eivät kelpaa.",
          ),
        };
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putReminderOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async saveWithSyncOperation(
      reminder: Reminder,
      context: SyncWriteContext,
    ): Promise<DataResult<Reminder>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeReminder(reminder);
      if (!validReminder(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.reminder.invalid",
            "Muistutusta ei voi tallentaa näillä tiedoilla.",
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
        writes: [putReminderOp(normalized)],
      });
      return committed.ok ? { ok: true, value: normalized } : committed;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const now = new Date().toISOString();
      const removed = await store.save({
        ...existing.value,
        deletedAt: now,
        updatedAt: now,
        version: existing.value.version + 1,
      });
      return removed.ok ? { ok: true, value: true } : removed;
    },
  };
  return store;
}
