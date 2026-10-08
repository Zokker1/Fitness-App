// T027: muistitoteutus store-sopimuksesta. Käyttö:
// - Sopimustestien referenssi (jokainen tuleva toteutus läpäisee samat testit).
// - UI-kehitys/dev-seed ennen T030:aa ilman SQLitea.
// - Yksikkötestien nopea fake.
// Ei selain-/SQLite-/Drive-riippuvuutta; tila elää vain tässä instanssissa.

import type { EntityId, UtcTimestamp } from "@lifeos/domain";
import { type DataResult, notFound } from "./errors.ts";
import type { EntityStore, UnitOfWork } from "./store.ts";

type SoftDeletableLike = { readonly deletedAt?: UtcTimestamp | null };

function hasDeletedAt(entity: unknown): entity is SoftDeletableLike {
  return typeof entity === "object" && entity !== null && "deletedAt" in entity;
}

export class InMemoryStore<T extends { readonly id: EntityId }> implements EntityStore<T> {
  readonly entityType: string;
  /**
   * Kello soft-deleten aikaleimalle. Oletus: kiinteä nollahetki jotta
   * muististore pysyy deterministisenä ilman injektoitua kelloa;
   * tuotantototeutus (T030+) käyttää injektoitua Clockia.
   */
  private readonly nowIso: () => UtcTimestamp;
  private readonly rows = new Map<EntityId, T>();
  private inTransaction = false;
  private snapshot: Map<EntityId, T> | null = null;

  constructor(
    entityType: string,
    seed: readonly T[] = [],
    nowIso: () => UtcTimestamp = () => "1970-01-01T00:00:00.000Z",
  ) {
    this.entityType = entityType;
    this.nowIso = nowIso;
    for (const entity of seed) {
      this.rows.set(entity.id, entity);
    }
  }

  list(): Promise<DataResult<readonly T[]>> {
    return Promise.resolve({ ok: true as const, value: [...this.rows.values()] });
  }

  getById(id: EntityId): Promise<DataResult<T>> {
    const row = this.rows.get(id);
    if (row === undefined) {
      return Promise.resolve({ ok: false, error: notFound(this.entityType) });
    }
    return Promise.resolve({ ok: true as const, value: row });
  }

  save(entity: T): Promise<DataResult<T>> {
    if (entity.id.trim().length === 0) {
      return Promise.resolve({
        ok: false,
        error: {
          code: "invalid-input",
          userMessage: "Kohdetta ei voitu tallentaa puuttuvan tunnisteen vuoksi.",
          diagnosticCode: `data.${this.entityType}.save.empty-id`,
        },
      });
    }
    this.rows.set(entity.id, entity);
    return Promise.resolve({ ok: true as const, value: entity });
  }

  remove(id: EntityId): Promise<DataResult<boolean>> {
    const row = this.rows.get(id);
    if (row === undefined) {
      return Promise.resolve({ ok: false, error: notFound(this.entityType) });
    }
    if (hasDeletedAt(row)) {
      this.rows.set(id, { ...row, deletedAt: this.nowIso() });
    } else {
      this.rows.delete(id);
    }
    return Promise.resolve({ ok: true as const, value: true });
  }

  /** Testiapu: transaktion snapshot-hallinta ilman julkista pintaa. */
  beginTestTransaction(): void {
    if (this.inTransaction) {
      throw new Error("Sisäkkäiset transaktiot eivät ole tuettuja muististoressa.");
    }
    this.inTransaction = true;
    this.snapshot = new Map(this.rows);
  }

  rollbackTestTransaction(): void {
    if (!this.inTransaction || this.snapshot === null) {
      throw new Error("Ei avointa transaktiota.");
    }
    this.rows.clear();
    for (const [key, value] of this.snapshot) {
      this.rows.set(key, value);
    }
    this.snapshot = null;
    this.inTransaction = false;
  }

  commitTestTransaction(): void {
    if (!this.inTransaction) {
      throw new Error("Ei avointa transaktiota.");
    }
    this.snapshot = null;
    this.inTransaction = false;
  }
}

export class InMemoryUnitOfWork implements UnitOfWork {
  private readonly stores: readonly InMemoryStore<{ readonly id: EntityId }>[];

  constructor(stores: readonly InMemoryStore<{ readonly id: EntityId }>[]) {
    this.stores = stores;
  }

  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    for (const store of this.stores) {
      store.beginTestTransaction();
    }
    try {
      const result = await fn();
      for (const store of this.stores) {
        store.commitTestTransaction();
      }
      return result;
    } catch (error) {
      for (const store of this.stores) {
        store.rollbackTestTransaction();
      }
      throw error;
    }
  }
}
