import type { EntityId, NotificationDelivery, NotificationState, Reminder } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { invalidInput, notFound } from "./errors.ts";
import type { DbTransactionOp } from "./sqliteProtocol.ts";
import type { EntityStore } from "./store.ts";
import { createSqliteEntityDocStore } from "./sqliteEntityStore.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";
import { createSqliteReminderStore } from "./sqliteReminderStore.ts";

const ENTITY_TYPE = "notification-state";
const LEGACY_BATCH_SIZE = 32;
const DELIVERIES: readonly NotificationDelivery[] = [
  "pending",
  "shown",
  "dismissed",
  "missed",
  "snoozed",
];

interface NotificationStateRow {
  readonly id?: unknown;
  readonly reminder_id?: unknown;
  readonly category_key?: unknown;
  readonly delivery?: unknown;
  readonly last_evaluated_at?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly version?: unknown;
}

function corruptedNotificationState(): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua ilmoitustilaa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: "data.notification-state.invalid",
    },
  };
}

function normalizeNotificationState(state: NotificationState): NotificationState {
  return { ...state, reminderId: state.reminderId ?? null };
}

export function validNotificationState(state: NotificationState): boolean {
  return (
    typeof state.id === "string" &&
    state.id.length > 0 &&
    (state.reminderId === null ||
      (typeof state.reminderId === "string" && state.reminderId.length > 0)) &&
    typeof state.categoryKey === "string" &&
    state.categoryKey.trim().length > 0 &&
    state.categoryKey.length <= 60 &&
    DELIVERIES.includes(state.delivery) &&
    typeof state.lastEvaluatedAt === "string" &&
    state.lastEvaluatedAt.length > 0 &&
    typeof state.createdAt === "string" &&
    typeof state.updatedAt === "string" &&
    Number.isInteger(state.version) &&
    state.version >= 1
  );
}

export function putNotificationStateOp(state: NotificationState): DbTransactionOp {
  return {
    op: "putNotificationState",
    params: {
      id: state.id,
      reminder_id: state.reminderId ?? "",
      category_key: state.categoryKey,
      delivery: state.delivery,
      last_evaluated_at: state.lastEvaluatedAt,
      created_at: state.createdAt,
      updated_at: state.updatedAt,
      version: state.version,
    },
  };
}

async function migrateLegacyNotificationStates(
  reminderStore: EntityStore<Reminder>,
): Promise<DataResult<true>> {
  // M013:n FK edellyttää, että muistutusdokumentit siirtyvät ensin relaatiotauluun.
  const remindersResult = await reminderStore.list();
  if (!remindersResult.ok) {
    return remindersResult;
  }
  const reminderIds = new Set(remindersResult.value.map((reminder) => reminder.id));

  const legacyResult = await createSqliteEntityDocStore<NotificationState>(ENTITY_TYPE).list();
  if (!legacyResult.ok) {
    return legacyResult;
  }
  const states = legacyResult.value.map(normalizeNotificationState);
  if (
    states.some(
      (state) =>
        !validNotificationState(state) ||
        (state.reminderId !== null && !reminderIds.has(state.reminderId)),
    )
  ) {
    return corruptedNotificationState();
  }

  for (let offset = 0; offset < states.length; offset += LEGACY_BATCH_SIZE) {
    const batch = states.slice(offset, offset + LEGACY_BATCH_SIZE);
    const ops: DbTransactionOp[] = [];
    for (const state of batch) {
      ops.push(putNotificationStateOp(state));
      ops.push({ op: "deleteEntity", params: { entity_type: ENTITY_TYPE, id: state.id } });
    }
    const response = await sendDbRequest({ kind: "transaction", ops });
    const result = toDataResult(response, () => true as const);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: true };
}

function parseNotificationStates(
  rows: readonly unknown[],
): DataResult<readonly NotificationState[]> {
  const states: NotificationState[] = [];
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return corruptedNotificationState();
    }
    const row = value as NotificationStateRow;
    if (
      typeof row.id !== "string" ||
      (row.reminder_id !== null && typeof row.reminder_id !== "string") ||
      typeof row.category_key !== "string" ||
      typeof row.delivery !== "string" ||
      typeof row.last_evaluated_at !== "string" ||
      typeof row.created_at !== "string" ||
      typeof row.updated_at !== "string" ||
      typeof row.version !== "number"
    ) {
      return corruptedNotificationState();
    }
    const state: NotificationState = {
      id: row.id,
      reminderId: row.reminder_id,
      categoryKey: row.category_key,
      delivery: row.delivery as NotificationDelivery,
      lastEvaluatedAt: row.last_evaluated_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    };
    if (!validNotificationState(state)) {
      return corruptedNotificationState();
    }
    states.push(state);
  }
  return { ok: true, value: states };
}

export function createSqliteNotificationStateStore(): EntityStore<NotificationState> {
  const reminderStore = createSqliteReminderStore();
  let migrationPromise: Promise<DataResult<true>> | null = null;
  const ensureMigrated = (): Promise<DataResult<true>> => {
    if (migrationPromise === null) {
      const attempt = migrateLegacyNotificationStates(reminderStore);
      migrationPromise = attempt;
      void attempt.then((result) => {
        if (!result.ok && migrationPromise === attempt) {
          migrationPromise = null;
        }
      });
    }
    return migrationPromise;
  };

  const store: EntityStore<NotificationState> = {
    entityType: ENTITY_TYPE,
    async list(): Promise<DataResult<readonly NotificationState[]>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "listNotificationStates",
        params: {},
      });
      if (!response.ok) return toDataResult(response, () => []);
      return parseNotificationStates(response.rows);
    },
    async getById(id: EntityId): Promise<DataResult<NotificationState>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const response = await sendDbRequest({
        kind: "query",
        op: "getNotificationState",
        params: { id },
      });
      if (!response.ok) return toDataResult(response, () => ({}) as NotificationState);
      const parsed = parseNotificationStates(response.rows);
      if (!parsed.ok) return parsed;
      const state = parsed.value[0];
      return state === undefined
        ? { ok: false, error: notFound(ENTITY_TYPE) }
        : { ok: true, value: state };
    },
    async save(state: NotificationState): Promise<DataResult<NotificationState>> {
      const migrated = await ensureMigrated();
      if (!migrated.ok) return migrated;
      const normalized = normalizeNotificationState(state);
      if (!validNotificationState(normalized)) {
        return {
          ok: false,
          error: invalidInput(
            "data.notification-state.invalid",
            "Ilmoituksen toimitustilan tiedot tai metatiedot eivät kelpaa.",
          ),
        };
      }
      if (normalized.reminderId !== null) {
        const reminder = await reminderStore.getById(normalized.reminderId);
        if (!reminder.ok) return reminder;
      }
      const response = await sendDbRequest({
        kind: "transaction",
        ops: [putNotificationStateOp(normalized)],
      });
      const result = toDataResult(response, () => true as const);
      return result.ok ? { ok: true, value: normalized } : result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      const response = await sendDbRequest({
        kind: "exec",
        op: "deleteNotificationState",
        params: { id },
      });
      return toDataResult(response, () => true);
    },
  };
  return store;
}
