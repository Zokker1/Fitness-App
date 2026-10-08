// T322: durable-in-this-browser storage for already encrypted rotation snapshots.
import {
  backupRotationBuckets,
  isEncryptedBackup,
  retainBackupRotationRecords,
} from "@lifeos/data";
import type { BackupRotationRecord, EncryptedBackup } from "@lifeos/data";

const DATABASE_NAME = "lifeos-encrypted-backups";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "records";
const BACKUP_ID_PATTERN = /^[0-9a-f]{32}$/;
const PERIOD_PATTERNS = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/,
} as const;

export const BACKUP_ROTATION_STATE_EVENT = "lifeos:backup-rotation-state";

export interface EncryptedBackupRotationEntry extends BackupRotationRecord {
  readonly backup: EncryptedBackup;
}

export interface EncryptedBackupRotationStore {
  list(): Promise<readonly EncryptedBackupRotationEntry[]>;
  saveAndRotate(entry: EncryptedBackupRotationEntry): Promise<{
    readonly entries: readonly EncryptedBackupRotationEntry[];
    readonly removedCount: number;
  }>;
  prune(): Promise<{
    readonly entries: readonly EncryptedBackupRotationEntry[];
    readonly removedCount: number;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function normalizeEntry(value: unknown): EncryptedBackupRotationEntry | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["id", "createdAt", "daily", "weekly", "monthly", "backup"]) ||
    typeof value.id !== "string" ||
    !BACKUP_ID_PATTERN.test(value.id) ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(Date.parse(value.createdAt)).toISOString() !== value.createdAt ||
    !isEncryptedBackup(value.backup) ||
    value.backup.manifest.id !== value.id ||
    value.backup.manifest.createdAt !== value.createdAt
  ) {
    return null;
  }

  const expected = backupRotationBuckets(new Date(value.createdAt));
  for (const tier of ["daily", "weekly", "monthly"] as const) {
    const period = value[tier];
    if (
      period !== null &&
      (typeof period !== "string" ||
        !PERIOD_PATTERNS[tier].test(period) ||
        period !== expected[tier])
    ) {
      return null;
    }
  }
  if (value.daily === null && value.weekly === null && value.monthly === null) return null;

  return {
    id: value.id,
    createdAt: value.createdAt,
    daily: value.daily as string | null,
    weekly: value.weekly as string | null,
    monthly: value.monthly as string | null,
    backup: value.backup,
  };
}

function storageError(operation: "open" | "read" | "write"): Error {
  return new Error(`Salatun varmuuskopion selaintallennus epäonnistui (${operation}).`);
}

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(storageError("open"));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let blocked = false;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      reject(storageError("open"));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        database.createObjectStore(OBJECT_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => {
      reject(storageError("open"));
    };
    request.onblocked = () => {
      blocked = true;
      reject(storageError("open"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (blocked) {
        database.close();
        return;
      }
      database.onversionchange = () => {
        database.close();
      };
      resolve(database);
    };
  });
}

function listRecords(
  factory: IDBFactory | undefined,
): Promise<readonly EncryptedBackupRotationEntry[]> {
  return openDatabase(factory).then(
    (database) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const transaction = database.transaction(OBJECT_STORE_NAME, "readonly");
        const request = transaction.objectStore(OBJECT_STORE_NAME).getAll();
        let result: readonly EncryptedBackupRotationEntry[] = [];
        const fail = (): void => {
          if (settled) return;
          settled = true;
          database.close();
          reject(storageError("read"));
        };
        request.onsuccess = () => {
          result = (request.result as unknown[])
            .map(normalizeEntry)
            .filter((entry): entry is EncryptedBackupRotationEntry => entry !== null)
            .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        };
        request.onerror = fail;
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          database.close();
          resolve(result);
        };
        transaction.onerror = fail;
        transaction.onabort = fail;
      }),
  );
}

function writeRotationRecords(
  factory: IDBFactory | undefined,
  proposed: EncryptedBackupRotationEntry | null,
): Promise<{
  readonly entries: readonly EncryptedBackupRotationEntry[];
  readonly removedCount: number;
}> {
  const normalizedProposed = proposed === null ? null : normalizeEntry(proposed);
  if (proposed !== null && normalizedProposed === null) {
    return Promise.reject(storageError("write"));
  }
  return openDatabase(factory).then(
    (database) =>
      new Promise((resolve, reject) => {
        let settled = false;
        let retained: readonly EncryptedBackupRotationEntry[] = [];
        let removedCount = 0;
        let transaction: IDBTransaction;
        try {
          transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
        } catch {
          database.close();
          reject(storageError("write"));
          return;
        }
        const store = transaction.objectStore(OBJECT_STORE_NAME);
        const request = store.getAll();
        const fail = (): void => {
          if (settled) return;
          settled = true;
          database.close();
          reject(storageError("write"));
        };
        request.onsuccess = () => {
          const existing = (request.result as unknown[])
            .map(normalizeEntry)
            .filter((entry): entry is EncryptedBackupRotationEntry => entry !== null);
          const combined = [
            ...existing.filter((entry) => entry.id !== normalizedProposed?.id),
            ...(normalizedProposed === null ? [] : [normalizedProposed]),
          ];
          retained = retainBackupRotationRecords(combined);
          const retainedIds = new Set(retained.map((entry) => entry.id));
          const removedIds = combined
            .filter((entry) => !retainedIds.has(entry.id))
            .map((entry) => entry.id);
          removedCount = removedIds.length;
          if (normalizedProposed !== null) store.put(normalizedProposed);
          for (const id of removedIds) store.delete(id);
        };
        request.onerror = fail;
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          database.close();
          resolve({
            entries: [...retained].sort((left, right) =>
              right.createdAt.localeCompare(left.createdAt),
            ),
            removedCount,
          });
        };
        transaction.onerror = fail;
        transaction.onabort = fail;
      }),
  );
}

/** The browser archive stores ciphertext only; insert and retention pruning share one IDB transaction. */
export function createBrowserEncryptedBackupRotationStore(
  factory?: IDBFactory,
): EncryptedBackupRotationStore {
  const indexedDb = factory ?? globalThis.indexedDB;
  return {
    list: () => listRecords(indexedDb),
    saveAndRotate: (entry) => writeRotationRecords(indexedDb, entry),
    prune: () => writeRotationRecords(indexedDb, null),
  };
}
