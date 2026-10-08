import type { EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { alreadyExists, invalidInput } from "./errors.ts";
import type { EntityStore } from "./store.ts";

/** Adds insert-only semantics to a store whose EntityStore contract is upsert based. */
export function createAppendOnlyEntityStore<T extends { readonly id: EntityId }>(
  backingStore: EntityStore<T>,
): EntityStore<T> {
  let saveQueue: Promise<void> = Promise.resolve();
  return {
    entityType: backingStore.entityType,
    list: () => backingStore.list(),
    getById: (id) => backingStore.getById(id),
    save(entity: T): Promise<DataResult<T>> {
      const result = saveQueue.then(async (): Promise<DataResult<T>> => {
        const existing = await backingStore.getById(entity.id);
        if (existing.ok) return { ok: false, error: alreadyExists(backingStore.entityType) };
        if (existing.error.code !== "not-found") return existing;
        return backingStore.save(entity);
      });
      saveQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await backingStore.getById(id);
      if (!existing.ok) return existing;
      return {
        ok: false,
        error: invalidInput(
          `data.${backingStore.entityType}.append-only`,
          "Historiatietoa ei voi muuttaa tai poistaa.",
        ),
      };
    },
  };
}
