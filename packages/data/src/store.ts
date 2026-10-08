// T027: geneerinen data-access-rajapinta. Yksi sopimus jonka jokainen
// tallennustoteutus (muisti nyt, SQLite/OPFS T030+) täyttää jokaiselle
// entiteetille. Toteutus ei tunne UI:ta, selainta eikä Drivea.
//
// Sopimus:
// - list() palauttaa luomisjärjestyksessä ellei toisin dokumentoida;
// - save() on upsert id:llä; version kasvaa jokaisella kirjoituksella;
// - remove() on soft delete missä entiteetti tukee deletedAt:a, muuten kova
//   poisto; tuntematon id → not-found (idempotentti retry erikseen sopimalla);
// - getById(tuntematon) → not-found-virhe, ei poikkeusta;
// - Kaikki palauttaa DataResultin, ei heitä (paitsi ohjelmointivirhe).

import type { EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import type { DataKeySession } from "./key-material.ts";
import type { SyncCryptoAdapter } from "./sync-crypto.ts";

export type SyncWriteOperation = "create" | "update" | "delete";

/** In-memory key and installation context for a single atomic local write. */
export interface ActiveSyncWriteContext {
  readonly installationId: string;
  readonly keySession: DataKeySession;
  readonly crypto: SyncCryptoAdapter;
}

export interface SyncWriteContext extends ActiveSyncWriteContext {
  readonly operationId: string;
  readonly operation: SyncWriteOperation;
  readonly occurredAt: string;
  readonly changedFields: readonly string[];
}

export interface EntityStore<T extends { readonly id: EntityId }> {
  readonly entityType: string;
  list(): Promise<DataResult<readonly T[]>>;
  getById(id: EntityId): Promise<DataResult<T>>;
  save(entity: T): Promise<DataResult<T>>;
  /** Persist a local mutation and encrypted outbox operation in one transaction. */
  saveWithSyncOperation?(entity: T, context: SyncWriteContext): Promise<DataResult<T>>;
  remove(id: EntityId): Promise<DataResult<boolean>>;
}

export interface UnitOfWork {
  /**
   * Ajaa kirjoitukset atomisesti: kaikki tai ei mikään (§32
   * write-transaktiot). Muistissa snapshot-rollback; SQLite:ssa BEGIN/
   * COMMIT/ROLLBACK (T030+). Lukemat fn:n ulkopuolelta eivät näe
   * puolivalmista tilaa.
   */
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;
}
