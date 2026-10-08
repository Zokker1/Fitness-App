import type {
  SyncProvider,
  SyncProviderDownload,
  SyncProviderError,
  SyncProviderChangePage,
  SyncProviderListChanges,
  SyncProviderObjectRef,
  SyncProviderResult,
  SyncProviderUpload,
} from "./sync-provider.ts";

export interface MockSyncProviderSeed {
  readonly idempotencyKey: string;
  readonly ciphertext: Uint8Array;
}

export interface MockSyncProviderOptions {
  readonly initialObjects?: readonly MockSyncProviderSeed[];
}

interface StoredObject {
  readonly sequence: number;
  readonly reference: SyncProviderObjectRef;
  readonly ciphertext: Uint8Array;
}

const MOCK_PROVIDER_ERROR: SyncProviderError = {
  code: "invalid-input",
  userMessage: "Synkronointipalvelun pyyntö ei kelvannut.",
  diagnosticCode: "sync-provider.mock.invalid-input",
};

function invalidInput<T>(): SyncProviderResult<T> {
  return { ok: false, error: { ...MOCK_PROVIDER_ERROR } };
}

function sameBytes(first: Uint8Array, second: Uint8Array): boolean {
  return first.length === second.length && first.every((byte, index) => byte === second[index]);
}

function copyReference(reference: SyncProviderObjectRef): SyncProviderObjectRef {
  return { objectId: reference.objectId, revision: reference.revision };
}

function validUpload(input: SyncProviderUpload): boolean {
  return (
    typeof input.idempotencyKey === "string" &&
    input.idempotencyKey.length > 0 &&
    input.idempotencyKey.length <= 256 &&
    input.ciphertext instanceof Uint8Array &&
    input.ciphertext.length > 0
  );
}

function uploadConflict(): SyncProviderResult<never> {
  return {
    ok: false,
    error: {
      code: "conflict",
      userMessage: "Sama synkronointitunniste on jo käytössä eri sisällölle.",
      diagnosticCode: "sync-provider.mock.idempotency-conflict",
    },
  };
}

/**
 * Deterministinen muistissa toimiva provider testikäyttöön.
 *
 * Objektit saavat lisäysjärjestyksen mukaiset tunnisteet ja cursorit kuvaavat
 * sekvenssinumeroa. Kelloa, verkkoa tai satunnaisuutta ei käytetä.
 */
export function createMockSyncProvider(options: MockSyncProviderOptions = {}): SyncProvider {
  const objects: StoredObject[] = [];
  const objectsByKey = new Map<string, StoredObject>();
  const objectsById = new Map<string, StoredObject>();
  let nextSequence = 1;

  const put = (input: SyncProviderUpload): SyncProviderResult<SyncProviderObjectRef> => {
    if (!validUpload(input)) return invalidInput();

    const existing = objectsByKey.get(input.idempotencyKey);
    if (existing !== undefined) {
      return sameBytes(existing.ciphertext, input.ciphertext)
        ? { ok: true, value: copyReference(existing.reference) }
        : uploadConflict();
    }

    const sequence = nextSequence;
    nextSequence += 1;
    const objectId = `mock-object-${String(sequence).padStart(8, "0")}`;
    const reference: SyncProviderObjectRef = { objectId, revision: "1" };
    const stored: StoredObject = {
      sequence,
      reference,
      ciphertext: new Uint8Array(input.ciphertext),
    };
    objects.push(stored);
    objectsByKey.set(input.idempotencyKey, stored);
    objectsById.set(objectId, stored);
    return { ok: true, value: copyReference(reference) };
  };

  for (const seed of options.initialObjects ?? []) {
    const seeded = put(seed);
    if (!seeded.ok) {
      throw new Error("MockSyncProvider initialObjects contains an invalid or conflicting object.");
    }
  }

  const listChanges = ({
    cursor,
    limit,
  }: SyncProviderListChanges): SyncProviderResult<SyncProviderChangePage> => {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) return invalidInput();

    let afterSequence = 0;
    if (cursor !== null) {
      if (!/^(0|[1-9]\d*)$/.test(cursor)) return invalidInput();
      afterSequence = Number(cursor);
      if (!Number.isSafeInteger(afterSequence) || afterSequence >= nextSequence) {
        return invalidInput();
      }
    }

    const pending = objects.filter((object) => object.sequence > afterSequence);
    const selected = pending.slice(0, limit);
    const hasMore = pending.length > selected.length;
    const selectedLast = selected.at(-1)?.sequence;
    const highWaterMark = nextSequence - 1;
    const nextCursor = hasMore
      ? (selectedLast ?? afterSequence)
      : Math.max(afterSequence, highWaterMark);

    return {
      ok: true,
      value: {
        objects: selected.map((object) => copyReference(object.reference)),
        cursor: String(nextCursor),
        hasMore,
      },
    };
  };

  const download = (reference: SyncProviderObjectRef): SyncProviderResult<SyncProviderDownload> => {
    if (
      typeof reference.objectId !== "string" ||
      typeof reference.revision !== "string" ||
      reference.objectId.length === 0 ||
      reference.revision.length === 0
    ) {
      return invalidInput();
    }

    const stored = objectsById.get(reference.objectId);
    if (stored === undefined) {
      return {
        ok: false,
        error: {
          code: "not-found",
          userMessage: "Synkronointitietoa ei löytynyt.",
          diagnosticCode: "sync-provider.mock.object-not-found",
        },
      };
    }
    if (stored.reference.revision !== reference.revision) {
      return {
        ok: false,
        error: {
          code: "conflict",
          userMessage: "Synkronointitiedon versio on muuttunut.",
          diagnosticCode: "sync-provider.mock.revision-conflict",
        },
      };
    }

    return {
      ok: true,
      value: {
        object: copyReference(stored.reference),
        ciphertext: new Uint8Array(stored.ciphertext),
      },
    };
  };

  return {
    providerId: "mock",
    displayName: "Deterministinen mock",
    upload: (input) => Promise.resolve(put(input)),
    listChanges: (input) => Promise.resolve(listChanges(input)),
    download: (reference) => Promise.resolve(download(reference)),
  };
}
