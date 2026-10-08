import type { DataResult, SyncEntityStoreAdapter, SyncPayloadEntity } from "@lifeos/data";
import {
  BROWSER_INSTALLATION_ENTITY_TYPE,
  invalidInput,
  readInstallationSyncSnapshot,
  writeInstallationSyncSnapshot,
} from "@lifeos/data";
import type { LifeosDataServices } from "../dataContext.tsx";

interface SyncSnapshotRepository {
  readonly entityType: string;
  getById(id: string): Promise<DataResult<SyncPayloadEntity>>;
  writeSyncSnapshot?: (entity: SyncPayloadEntity) => Promise<DataResult<SyncPayloadEntity>>;
}

function repositoryFor(
  data: LifeosDataServices,
  entityType: string,
): SyncSnapshotRepository | null {
  const repositories = Object.values(data) as unknown as readonly SyncSnapshotRepository[];
  return repositories.find((repository) => repository.entityType === entityType) ?? null;
}

function unsupportedEntityType() {
  return invalidInput(
    "data.sync.entity-type.unsupported",
    "Tämän synkronoitavan tietuetyypin tallennus ei ole käytössä.",
  );
}

export function createAppSyncEntityStoreAdapter(data: LifeosDataServices): SyncEntityStoreAdapter {
  return {
    async read(entityType, entityId) {
      if (entityType === BROWSER_INSTALLATION_ENTITY_TYPE) {
        return readInstallationSyncSnapshot(entityId);
      }
      const repository = repositoryFor(data, entityType);
      if (repository === null) {
        return { ok: false, error: unsupportedEntityType() };
      }
      const result = await repository.getById(entityId);
      if (!result.ok && result.error.code === "not-found") {
        return { ok: true, value: null };
      }
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    },

    async write(entityType, entityId, entity) {
      if (entity.id !== entityId) {
        return {
          ok: false,
          error: invalidInput(
            "data.sync.entity-id.mismatch",
            "Synkronoitavan tietueen tunniste ei vastaa tallennuskohdetta.",
          ),
        };
      }
      if (entityType === BROWSER_INSTALLATION_ENTITY_TYPE) {
        return writeInstallationSyncSnapshot(entityId, entity);
      }
      const repository = repositoryFor(data, entityType);
      if (repository === null || repository.writeSyncSnapshot === undefined) {
        return { ok: false, error: unsupportedEntityType() };
      }
      const result = await repository.writeSyncSnapshot(entity);
      return result.ok ? { ok: true, value: true } : { ok: false, error: result.error };
    },
  };
}
