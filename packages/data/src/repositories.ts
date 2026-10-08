// T032: repository-kerros. Ainoa paikka joka hallitsee tekniset
// tallennusinvariantit (id/timestamps/version) EntityStore-toteutusten
// päällä. Sovelluskomponentit eivät koske storeihin suoraan; ne kuluttavat
// service-kerrosta (services.ts) joka käyttää näitä repositoryja.
//
// Invariantit (§32):
// - create: id generaattorista, createdAt=updatedAt=now, version=1.
// - update: id/createdAt/version suojattu; updatedAt=now, version+1.
// - remove/getById/list delegoituvat storelle (soft/hard-delete T027).
// - Tyhjä/virheellinen id -> invalid-input; tuntematon -> not-found.
// - Ei Reactia/selainta/SQL:ää/Drivea — vain domain-tyypit + store-sopimus.

import type { BaseEntity, EntityId } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { alreadyExists, type DataResult, invalidInput } from "./errors.ts";
import { type IdGenerator, isValidEntityId } from "./ids.ts";
import type { ActiveSyncWriteContext, EntityStore, SyncWriteOperation } from "./store.ts";

export interface RepositoryDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly getSyncContext?: () => ActiveSyncWriteContext | null;
  readonly onSyncWrite?: () => void;
}

export interface EntityRepository<T extends BaseEntity> {
  readonly entityType: string;
  list(): Promise<DataResult<readonly T[]>>;
  getById(id: EntityId): Promise<DataResult<T>>;
  /** Directly applies an authenticated remote snapshot without local version metadata changes. */
  writeSyncSnapshot?(entity: T): Promise<DataResult<T>>;
  create(input: Omit<T, "id" | "createdAt" | "updatedAt" | "version">): Promise<DataResult<T>>;
  /** T181: create with a caller-chosen id (deterministic award keys). Idempotent
      wrt the id: an occupied id yields already-exists instead of overwriting. */
  createWithId(
    id: EntityId,
    input: Omit<T, "id" | "createdAt" | "updatedAt" | "version">,
  ): Promise<DataResult<T>>;
  update(
    id: EntityId,
    patch: Partial<Omit<T, "id" | "createdAt" | "version">>,
  ): Promise<DataResult<T>>;
  remove(id: EntityId): Promise<DataResult<boolean>>;
}

export function createEntityRepository<T extends BaseEntity>(
  store: EntityStore<T>,
  deps: RepositoryDeps,
): EntityRepository<T> {
  const saveEntity = async (
    entity: T,
    operation: SyncWriteOperation,
    changedFields: readonly string[],
    activeContext = deps.getSyncContext?.() ?? null,
  ): Promise<DataResult<T>> => {
    if (
      activeContext !== null &&
      activeContext.keySession.isUnlocked &&
      store.saveWithSyncOperation !== undefined &&
      changedFields.length > 0
    ) {
      const result = await store.saveWithSyncOperation(entity, {
        ...activeContext,
        operationId: `${activeContext.installationId}:${deps.ids.next()}`,
        operation,
        occurredAt: entity.updatedAt,
        changedFields,
      });
      if (result.ok) deps.onSyncWrite?.();
      return result;
    }
    return store.save(entity);
  };

  return {
    entityType: store.entityType,
    list: () => store.list(),
    getById: (id) => store.getById(id),
    writeSyncSnapshot: (entity) => store.save(entity),
    async create(input) {
      const id = deps.ids.next();
      if (!isValidEntityId(id)) {
        return {
          ok: false,
          error: invalidInput(
            `data.${store.entityType}.create.bad-id`,
            "Kohdetta ei voitu luoda tunnistevirheen vuoksi.",
          ),
        };
      }
      const now = deps.clock.nowIso();
      const entity = {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      const created = entity as T;
      const changedFields = Object.keys(created).filter(
        (field) => !["id", "createdAt", "updatedAt", "version"].includes(field),
      );
      return saveEntity(created, "create", changedFields);
    },
    async createWithId(id, input) {
      if (!isValidEntityId(id)) {
        return {
          ok: false,
          error: invalidInput(
            `data.${store.entityType}.create.bad-id`,
            "Kohdetta ei voitu luoda tunnistevirheen vuoksi.",
          ),
        };
      }
      const occupied = await store.getById(id);
      if (occupied.ok) {
        return { ok: false, error: alreadyExists(store.entityType) };
      }
      if (occupied.error.code !== "not-found") {
        return occupied;
      }
      const now = deps.clock.nowIso();
      const entity = {
        ...input,
        id,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };
      const created = entity as T;
      const changedFields = Object.keys(created).filter(
        (field) => !["id", "createdAt", "updatedAt", "version"].includes(field),
      );
      return saveEntity(created, "create", changedFields);
    },
    async update(id, patch) {
      const existing = await store.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const now = deps.clock.nowIso();
      const patchRecord: Record<string, unknown> = {
        ...(patch as unknown as Record<string, unknown>),
      };
      const merged: Record<string, unknown> = {
        ...(existing.value as unknown as Record<string, unknown>),
        ...patchRecord,
        id: existing.value.id,
        createdAt: existing.value.createdAt,
        version: existing.value.version + 1,
        updatedAt: now,
      };
      const changedFields = Object.keys(patchRecord).filter(
        (field) => !["id", "createdAt", "updatedAt", "version"].includes(field),
      );
      const operation: SyncWriteOperation =
        changedFields.length === 1 &&
        changedFields[0] === "deletedAt" &&
        typeof merged.deletedAt === "string"
          ? "delete"
          : "update";
      return saveEntity(merged as unknown as T, operation, changedFields);
    },
    async remove(id) {
      const activeContext = deps.getSyncContext?.() ?? null;
      if (
        activeContext === null ||
        !activeContext.keySession.isUnlocked ||
        store.saveWithSyncOperation === undefined
      ) {
        return store.remove(id);
      }
      const existing = await store.getById(id);
      if (!existing.ok) return existing;
      if (!("deletedAt" in existing.value)) {
        return store.remove(id);
      }
      const now = deps.clock.nowIso();
      const tombstone = {
        ...existing.value,
        deletedAt: now,
        updatedAt: now,
        version: existing.value.version + 1,
      } as T;
      const removed = await saveEntity(tombstone, "delete", ["deletedAt"], activeContext);
      return removed.ok ? { ok: true, value: true } : removed;
    },
  };
}
