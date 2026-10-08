import { isKeyEnvelope, type KeyEnvelope, type KeyEnvelopeStore } from "@lifeos/data";

const DATABASE_NAME = "lifeos-key-envelopes";
const DATABASE_VERSION = 1;
const OBJECT_STORE_NAME = "envelopes";
const ENVELOPE_ID_PATTERN = /^[0-9a-f]{32}$/;
export const KEY_ENVELOPE_STORE_CHANGED_EVENT = "lifeos:key-envelopes-changed";

function notifyKeyEnvelopeStoreChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(KEY_ENVELOPE_STORE_CHANGED_EVENT));
  }
}

interface BrowserKeyEnvelopeStore extends KeyEnvelopeStore {
  putMany(envelopes: readonly KeyEnvelope[]): Promise<void>;
}

function storageError(operation: "open" | "read" | "write" | "delete"): Error {
  return new Error(`Suojatun avainkuoren selaintallennus epäonnistui (${operation}).`);
}

function sanitizeEnvelope(value: unknown): KeyEnvelope {
  if (!isKeyEnvelope(value)) throw storageError("read");
  const wrapping: KeyEnvelope["wrapping"] =
    value.wrapping.kind === "passphrase"
      ? {
          kind: "passphrase",
          kdf: "scrypt",
          saltHex: value.wrapping.saltHex,
          params: {
            n: value.wrapping.params.n,
            r: value.wrapping.params.r,
            p: value.wrapping.params.p,
            dkLen: value.wrapping.params.dkLen,
          },
        }
      : { kind: "recovery", kdf: "direct-256" };

  // Copy only the allow-listed envelope fields; runtime extras must never be persisted.
  return {
    format: value.format,
    version: value.version,
    envelopeId: value.envelopeId,
    keyId: value.keyId,
    cipher: value.cipher,
    wrapping,
    wrappedKeyHex: value.wrappedKeyHex,
  };
}

function openDatabase(factory: IDBFactory | undefined): Promise<IDBDatabase> {
  if (!factory) return Promise.reject(storageError("open"));
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let wasBlocked = false;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      reject(storageError("open"));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        database.createObjectStore(OBJECT_STORE_NAME, { keyPath: "envelopeId" });
      }
    };
    request.onerror = () => {
      reject(storageError("open"));
    };
    request.onblocked = () => {
      wasBlocked = true;
      reject(storageError("open"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (wasBlocked) {
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

function runRequest<T>(
  factory: IDBFactory | undefined,
  mode: IDBTransactionMode,
  operation: "read" | "write" | "delete",
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDatabase(factory).then(
    (database) =>
      new Promise((resolve, reject) => {
        let transaction: IDBTransaction;
        let request: IDBRequest<T>;
        let result: T;
        let requestCompleted = false;
        let settled = false;
        const rejectOnce = (): void => {
          if (settled) return;
          settled = true;
          database.close();
          reject(storageError(operation));
        };

        try {
          transaction = database.transaction(OBJECT_STORE_NAME, mode);
          request = createRequest(transaction.objectStore(OBJECT_STORE_NAME));
        } catch {
          rejectOnce();
          return;
        }

        request.onsuccess = () => {
          result = request.result;
          requestCompleted = true;
        };
        request.onerror = () => {
          rejectOnce();
        };
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          database.close();
          if (requestCompleted) resolve(result);
          else reject(storageError(operation));
        };
        transaction.onerror = () => {
          rejectOnce();
        };
        transaction.onabort = () => {
          rejectOnce();
        };
      }),
  );
}

/** Store already-wrapped DEKs in IndexedDB; credentials and clear key bytes never enter this adapter. */
export function createBrowserKeyEnvelopeStore(factory?: IDBFactory): BrowserKeyEnvelopeStore {
  const indexedDb = factory ?? globalThis.indexedDB;
  const putMany = async (envelopes: readonly KeyEnvelope[]): Promise<void> => {
    let safeEnvelopes: KeyEnvelope[];
    try {
      safeEnvelopes = envelopes.map(sanitizeEnvelope);
    } catch {
      throw storageError("write");
    }
    const database = await openDatabase(indexedDb);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const fail = (): void => {
        if (settled) return;
        settled = true;
        database.close();
        reject(storageError("write"));
      };
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction(OBJECT_STORE_NAME, "readwrite");
        const store = transaction.objectStore(OBJECT_STORE_NAME);
        for (const envelope of safeEnvelopes) store.put(envelope);
      } catch {
        fail();
        return;
      }
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        database.close();
        notifyKeyEnvelopeStoreChanged();
        resolve();
      };
      transaction.onerror = fail;
      transaction.onabort = fail;
    });
  };

  return {
    async list(): Promise<readonly KeyEnvelope[]> {
      const records = await runRequest<unknown[]>(indexedDb, "readonly", "read", (store) =>
        store.getAll(),
      );
      return records.map(sanitizeEnvelope);
    },
    async put(envelope): Promise<void> {
      let safeEnvelope: KeyEnvelope;
      try {
        safeEnvelope = sanitizeEnvelope(envelope);
      } catch {
        throw storageError("write");
      }
      await runRequest<IDBValidKey>(indexedDb, "readwrite", "write", (store) =>
        store.put(safeEnvelope),
      );
      notifyKeyEnvelopeStoreChanged();
    },
    putMany,
    async delete(envelopeId): Promise<void> {
      if (!ENVELOPE_ID_PATTERN.test(envelopeId)) throw storageError("delete");
      await runRequest<undefined>(indexedDb, "readwrite", "delete", (store) =>
        store.delete(envelopeId),
      );
      notifyKeyEnvelopeStoreChanged();
    },
  };
}
