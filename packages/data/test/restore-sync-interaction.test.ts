// T326: restore transaction invariants and the following sync merge must agree.
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import type {
  Achievement,
  Project,
  SyncOperation,
  Task,
  UserReward,
  VaultReward,
  VaultRewardClaim,
  XPTransaction,
} from "@lifeos/domain";
import {
  configureDatabaseWorker,
  createDataKeySession,
  createMockSyncProvider,
  createSyncCryptoAdapter,
  isDbRequest,
  MIGRATIONS,
  resetDatabaseWorkerForTests,
  syncReplica,
} from "../src/index.ts";
import type { SyncEntityStoreAdapter } from "../src/index.ts";
import { mergeSyncEntityChanges } from "../src/sync-merge.ts";
import { executeRestoreTransaction } from "../src/sqliteWorker.ts";
import type { DbRestoreWrite } from "../src/sqliteProtocol.ts";
import type { SyncPayloadEntity } from "../src/sync-payload.ts";
import { putAchievementOp } from "../src/sqliteAchievementStore.ts";
import { putProjectOp } from "../src/sqliteProjectStore.ts";
import { putClaimOp } from "../src/sqliteVaultRewardClaimStore.ts";
import { putUserRewardOp } from "../src/sqliteUserRewardStore.ts";
import { putRewardOp } from "../src/sqliteVaultRewardStore.ts";
import { putTaskOp } from "../src/sqliteTaskStore.ts";
import { putXpTransactionOp } from "../src/sqliteXpTransactionStore.ts";

type Row = Record<string, unknown>;
type Db = {
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
};

const AT = "2026-10-02T12:00:00.000Z";
const DELETED_AT = "2026-10-02T13:00:00.000Z";

async function openMigrated(): Promise<Db> {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as Db;
  db.exec("PRAGMA foreign_keys=ON;");
  for (const migration of MIGRATIONS) {
    for (const statement of migration.statements) db.exec(statement);
  }
  return db;
}

function runRestore(db: Db, writes: readonly DbRestoreWrite[]) {
  return executeRestoreTransaction(db, writes);
}

function asRestoreWrite(write: {
  readonly op: string;
  readonly params: Record<string, string | number | boolean>;
}): DbRestoreWrite {
  return write as unknown as DbRestoreWrite;
}

function makeProject(id: string): Project {
  return {
    id,
    name: `Project ${id}`,
    colorKey: null,
    archivedAt: null,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    deletedAt: null,
  };
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: "Restore task",
    notes: null,
    status: "open",
    priority: "normal",
    dueAt: null,
    projectId: null,
    tagIds: [],
    completedAt: null,
    reopenedAt: null,
    recurrence: null,
    estimateMinutes: null,
    actualSeconds: 0,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

function seedSyncOperation(db: Db): void {
  db.exec(
    `INSERT INTO sync_operations (
       id, operation_id, installation_id, entity_type, entity_id, operation,
       entity_version, occurred_at, encrypted_payload_ref, integrity_ref,
       created_at, updated_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        "sync-row-1",
        "pending-operation-1",
        "installation-1",
        "task",
        "task-pending",
        "create",
        1,
        AT,
        "eA",
        "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
        AT,
        AT,
        1,
      ],
    },
  );
}

function connectSqliteBackedWorker(db: Db): void {
  let onmessage: ((event: MessageEvent) => void) | null = null;
  const worker = {
    postMessage(message: unknown) {
      const request = message as {
        readonly requestId: string;
        readonly kind: string;
        readonly op?: string;
      };
      queueMicrotask(() => {
        const rows =
          request.kind === "query" && request.op === "listSyncOperations"
            ? readRows(db, "SELECT * FROM sync_operations;")
            : [];
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
  resetDatabaseWorkerForTests();
  configureDatabaseWorker({ create: () => worker as unknown as Worker });
}

function readRows(db: Db, sql: string, bind?: readonly unknown[]): Row[] {
  const rows: Row[] = [];
  db.exec(sql, { ...(bind === undefined ? {} : { bind }), rowMode: "object", resultRows: rows });
  return rows;
}

describe("restore and sync interaction (T326)", () => {
  it("keeps the existing outbox unchanged while restoring referenced domain rows", async () => {
    const db = await openMigrated();
    try {
      seedSyncOperation(db);
      const result = runRestore(db, [
        asRestoreWrite(putProjectOp(makeProject("project-restore"))),
        asRestoreWrite(putTaskOp(makeTask("task-restore", { projectId: "project-restore" }))),
      ]);

      expect(result.ok).toBe(true);
      expect(
        readRows(db, "SELECT id, project_id FROM tasks WHERE id = ?;", ["task-restore"]),
      ).toEqual([{ id: "task-restore", project_id: "project-restore" }]);
      expect(readRows(db, "SELECT operation_id FROM sync_operations;")).toEqual([
        { operation_id: "pending-operation-1" },
      ]);
    } finally {
      db.close();
    }
  });

  it("uploads the pending pre-restore outbox entry on the next sync", async () => {
    const db = await openMigrated();
    const keySession = createDataKeySession(new Uint8Array(32).fill(7));
    if (keySession === null) throw new Error("Test data key is invalid.");
    const entityStore: SyncEntityStoreAdapter = {
      read: () => Promise.resolve({ ok: true, value: null }),
      write: () => Promise.resolve({ ok: true, value: true }),
    };

    try {
      seedSyncOperation(db);
      const restored = runRestore(db, [asRestoreWrite(putTaskOp(makeTask("task-after-restore")))]);
      expect(restored.ok).toBe(true);

      connectSqliteBackedWorker(db);
      const synced = await syncReplica({
        provider: createMockSyncProvider(),
        installationId: "installation-1",
        keySession,
        crypto: createSyncCryptoAdapter(),
        entityStore,
      });

      expect(synced.ok, synced.ok ? "sync succeeded" : synced.error.diagnosticCode).toBe(true);
      if (synced.ok) {
        expect(synced.value.uploadedOperations).toBe(1);
        expect(synced.value.skippedOwnOperations).toBe(1);
      }
      expect(readRows(db, "SELECT operation_id FROM sync_operations;")).toEqual([
        { operation_id: "pending-operation-1" },
      ]);
    } finally {
      resetDatabaseWorkerForTests();
      keySession.lock();
      db.close();
    }
  });

  it("rolls back parent writes when a restored reference fails", async () => {
    const db = await openMigrated();
    try {
      const existing = runRestore(db, [asRestoreWrite(putTaskOp(makeTask("existing-task")))]);
      expect(existing.ok).toBe(true);

      const result = runRestore(db, [
        asRestoreWrite(putProjectOp(makeProject("project-must-rollback"))),
        asRestoreWrite(putTaskOp(makeTask("invalid-task", { projectId: "missing-project" }))),
      ]);

      expect(result.ok).toBe(false);
      expect(
        readRows(db, "SELECT id FROM projects WHERE id = ?;", ["project-must-rollback"]),
      ).toEqual([]);
      expect(readRows(db, "SELECT id, title FROM tasks;")).toEqual([
        { id: "existing-task", title: "Restore task" },
      ]);
    } finally {
      db.close();
    }
  });

  it("retains an existing tombstone when the backup contains an active version", async () => {
    const db = await openMigrated();
    try {
      expect(runRestore(db, [asRestoreWrite(putTaskOp(makeTask("deleted-task")))]).ok).toBe(true);
      db.exec("UPDATE tasks SET deleted_at = ? WHERE id = ?;", {
        bind: [DELETED_AT, "deleted-task"],
      });

      const result = runRestore(db, [
        asRestoreWrite(putTaskOp(makeTask("deleted-task", { title: "From backup" }))),
      ]);

      expect(result.ok).toBe(true);
      expect(
        readRows(db, "SELECT title, deleted_at FROM tasks WHERE id = ?;", ["deleted-task"]),
      ).toEqual([{ title: "From backup", deleted_at: DELETED_AT }]);
    } finally {
      db.close();
    }
  });

  it("can restore an active snapshot into a fresh profile without its later tombstone", async () => {
    const db = await openMigrated();
    try {
      const result = runRestore(db, [
        asRestoreWrite(putTaskOp(makeTask("deleted-after-snapshot"))),
      ]);

      expect(result.ok).toBe(true);
      expect(
        readRows(db, "SELECT title, deleted_at FROM tasks WHERE id = ?;", [
          "deleted-after-snapshot",
        ]),
      ).toEqual([{ title: "Restore task", deleted_at: null }]);
    } finally {
      db.close();
    }
  });

  it("skips identical append-only records and rolls back conflicting IDs", async () => {
    const db = await openMigrated();
    try {
      seedSyncOperation(db);
      const achievement: Achievement = {
        id: "achievement-1",
        key: "first-step",
        title: "First step",
        description: null,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
      };
      const vaultReward: VaultReward = {
        id: "vault-reward-1",
        title: "A break",
        note: null,
        xpThreshold: 100,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
      };
      const userReward: UserReward = {
        id: "user-reward-1",
        achievementId: achievement.id,
        collectibleId: null,
        earnedAt: AT,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
      };
      const claim: VaultRewardClaim = {
        id: "claim-1",
        rewardId: vaultReward.id,
        claimedAt: AT,
        xpDeducted: 0,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
      };
      const xp: XPTransaction = {
        id: "xp-1",
        source: "manual",
        sourceEntityId: null,
        amount: 10,
        earnedAt: AT,
        reason: null,
        createdAt: AT,
        updatedAt: AT,
        version: 1,
      };
      const immutableWrites = [
        asRestoreWrite(putAchievementOp(achievement)),
        asRestoreWrite(putRewardOp(vaultReward)),
        asRestoreWrite(putUserRewardOp(userReward)),
        asRestoreWrite(putClaimOp(claim)),
        asRestoreWrite(putXpTransactionOp(xp)),
      ];

      expect(runRestore(db, immutableWrites).ok).toBe(true);
      expect(runRestore(db, immutableWrites).ok).toBe(true);
      expect(readRows(db, "SELECT id FROM user_rewards;")).toHaveLength(1);
      expect(readRows(db, "SELECT id FROM vault_reward_claims;")).toHaveLength(1);
      expect(readRows(db, "SELECT id FROM xp_transactions;")).toHaveLength(1);

      const conflictResults = [
        asRestoreWrite(putXpTransactionOp({ ...xp, amount: 11 })),
        asRestoreWrite(putUserRewardOp({ ...userReward, earnedAt: "2026-10-02T14:00:00.000Z" })),
        asRestoreWrite(putClaimOp({ ...claim, xpDeducted: 1 })),
      ];
      for (const [index, conflictingWrite] of conflictResults.entries()) {
        const projectId = `conflict-project-${String(index)}`;
        const result = runRestore(db, [
          asRestoreWrite(putProjectOp(makeProject(projectId))),
          conflictingWrite,
        ]);
        expect(result.ok).toBe(false);
        expect(readRows(db, "SELECT id FROM projects WHERE id = ?;", [projectId])).toEqual([]);
      }
      expect(readRows(db, "SELECT operation_id FROM sync_operations;")).toEqual([
        { operation_id: "pending-operation-1" },
      ]);
    } finally {
      db.close();
    }
  });

  it("does not let a remote create revive a locally tombstoned task", () => {
    const current = makeTask("sync-deleted-task", {
      title: "Local tombstone",
      updatedAt: DELETED_AT,
      version: 2,
      deletedAt: DELETED_AT,
    });
    const operation: SyncOperation = {
      id: "remote-operation-row",
      operationId: "remote-create-1",
      installationId: "remote-installation",
      entityType: "task",
      entityId: current.id,
      operation: "create",
      entityVersion: 1,
      occurredAt: AT,
      encryptedPayloadRef: "ciphertext-ref",
      integrityRef: "integrity-ref",
      createdAt: AT,
      updatedAt: AT,
      version: 1,
    };
    const merged = mergeSyncEntityChanges({
      entityType: "task",
      currentEntity: current as unknown as SyncPayloadEntity,
      changes: [
        {
          operation,
          entity: makeTask(current.id) as unknown as SyncPayloadEntity,
          changedFields: ["title", "deletedAt"],
        },
      ],
    });

    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.value.entity.deletedAt).toBe(DELETED_AT);
      expect(merged.value.entity.title).toBe("Local tombstone");
    }
  });

  it("rejects sync-outbox operations at the restore protocol boundary", () => {
    const taskWrite = asRestoreWrite(putTaskOp(makeTask("protocol-task")));
    expect(isDbRequest({ requestId: "restore-valid", kind: "restore", ops: [taskWrite] })).toBe(
      true,
    );
    expect(
      isDbRequest({
        requestId: "restore-invalid",
        kind: "restore",
        ops: [{ op: "putSyncOperation", params: {} }],
      }),
    ).toBe(false);
  });
});
