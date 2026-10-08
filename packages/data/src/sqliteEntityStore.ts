// T130: geneerinen doc-tallenne EntityStore-sopimukseen (SQLite/OPFS-worker).
// - Yksi rivi per entiteetti (entity_docs, migraatio M017): koko entity
//   JSON-docina; repos hallitsevat domain-version/updatedAt-invariantit ja
//   store entity-JSONin formaattiversiot.
// - list() palauttaa creation-järjestyksessä (created_at, id — kuten
//   InMemoryStore).
// - remove(): soft-delete jos entityssä deletedAt-kenttä (kuten
//   InMemoryStore), muuten kova poisto.
// - Kaikki palauttaa DataResultin, ei heitä (paitsi ohjelmointivirhe).
// - Ei Reactia/selain-API:ita — vain EntityStore-sopimus + worker-client.
import type { EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import type { EntityStore } from "./store.ts";
import {
  deleteEntityDoc as sendDeleteEntity,
  getEntityDoc as sendGetEntity,
  listEntityDocs as sendListEntities,
  putEntityDoc as sendPutEntity,
} from "./sqliteEntityClient.ts";

interface StoredDoc {
  readonly id: EntityId;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly version: number;
  readonly deletedAt?: string | null;
  readonly [key: string]: unknown;
}

interface StoredRow {
  readonly id?: unknown;
  readonly created_at?: unknown;
  readonly updated_at?: unknown;
  readonly doc_version?: unknown;
  readonly value?: unknown;
}

interface ParsedStoredDoc {
  readonly doc: StoredDoc;
  readonly docVersion: number;
}

const ENTITY_DOC_VERSIONS: Readonly<Record<string, number>> = {
  goal: 1,
  "nutrition-entry": 1,
  "supplement-log": 1,
  task: 1,
  "routine-step": 1,
};

function currentDocVersion(entityType: string): number {
  return ENTITY_DOC_VERSIONS[entityType] ?? 0;
}

function parseStoredRow(row: unknown): ParsedStoredDoc | null {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    return null;
  }
  const storedRow = row as StoredRow;
  const value = storedRow.value;
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { createdAt?: unknown }).createdAt !== "string" ||
      typeof (parsed as { updatedAt?: unknown }).updatedAt !== "string" ||
      !Number.isInteger((parsed as { version?: unknown }).version) ||
      (parsed as { version: number }).version < 1 ||
      typeof storedRow.doc_version !== "number" ||
      !Number.isInteger(storedRow.doc_version) ||
      storedRow.doc_version < 0 ||
      storedRow.id !== (parsed as { id: string }).id ||
      storedRow.created_at !== (parsed as { createdAt: string }).createdAt ||
      storedRow.updated_at !== (parsed as { updatedAt: string }).updatedAt
    ) {
      return null;
    }
    return { doc: parsed as StoredDoc, docVersion: storedRow.doc_version };
  } catch {
    return null;
  }
}

function migrateStoredDoc(entityType: string, stored: ParsedStoredDoc): ParsedStoredDoc | null {
  if (stored.docVersion === currentDocVersion(entityType)) {
    return stored;
  }

  // T069: legacy nutrition entries may have no food link or gram amount.
  // Missing food/slot/nutrient details mean unknown or unassigned, represented
  // by null in newly created entries.
  if (entityType === "nutrition-entry" && stored.docVersion === 0) {
    const foodId = stored.doc.foodId;
    const amountG = stored.doc.amountG;
    const mealSlotId = stored.doc.mealSlotId;
    const fiberG = stored.doc.fiberG;
    if (
      (foodId !== undefined && foodId !== null && typeof foodId !== "string") ||
      (amountG !== undefined && amountG !== null && typeof amountG !== "number") ||
      (mealSlotId !== undefined && mealSlotId !== null && typeof mealSlotId !== "string") ||
      (fiberG !== undefined && fiberG !== null && typeof fiberG !== "number")
    ) {
      return null;
    }
    return {
      doc: {
        ...stored.doc,
        foodId: foodId ?? null,
        amountG: amountG ?? null,
        mealSlotId: mealSlotId ?? null,
        fiberG: fiberG ?? null,
      },
      docVersion: 1,
    };
  }

  // T140: tavoitteiden puuttuvat rajapäivät tarkoittavat avointa aikaväliä.
  if (entityType === "goal" && stored.docVersion === 0) {
    const activeFrom = stored.doc.activeFrom;
    const activeUntil = stored.doc.activeUntil;
    if (
      (activeFrom !== undefined && activeFrom !== null && typeof activeFrom !== "string") ||
      (activeUntil !== undefined && activeUntil !== null && typeof activeUntil !== "string")
    ) {
      return null;
    }
    return {
      doc: { ...stored.doc, activeFrom: activeFrom ?? null, activeUntil: activeUntil ?? null },
      docVersion: 1,
    };
  }

  // Vanhoissa lisäravinelokeissa tila päätellään toteutuneesta ottoajasta:
  // null = odottaa, aikaleima = otettu. Nykymuotoinen eksplisiittinen tila
  // säilytetään sellaisenaan.
  if (entityType === "supplement-log" && stored.docVersion === 0) {
    const status = stored.doc.status;
    const takenAt = stored.doc.takenAt;
    if (takenAt !== null && typeof takenAt !== "string") {
      return null;
    }
    if (
      status !== undefined &&
      status !== "taken" &&
      status !== "skipped" &&
      status !== "pending"
    ) {
      return null;
    }
    return {
      doc: {
        ...stored.doc,
        status: status ?? (takenAt === null ? "pending" : "taken"),
      },
      docVersion: 1,
    };
  }

  // T168: ennen task-dokumentin formaattiversiointia actualSeconds puuttui
  // vanhoista tehtävistä. Nykyinen luonti ja UI käsittelevät sen nollana.
  if (entityType === "task" && stored.docVersion === 0) {
    const actualSeconds = stored.doc.actualSeconds;
    if (
      actualSeconds !== undefined &&
      (typeof actualSeconds !== "number" || !Number.isFinite(actualSeconds) || actualSeconds < 0)
    ) {
      return null;
    }
    return {
      doc: { ...stored.doc, actualSeconds: actualSeconds ?? 0 },
      docVersion: 1,
    };
  }

  // M017:n entity-docit eivät sisältäneet formaattiversiota. M018 lisäsi
  // RoutineStep.optional-kentän: vanha puuttuva arvo tarkoittaa pakollista,
  // mutta olemassa oleva true/false säilytetään.
  if (entityType === "routine-step" && stored.docVersion === 0) {
    const optional = stored.doc.optional;
    if (optional !== undefined && typeof optional !== "boolean") {
      return null;
    }
    return {
      doc: { ...stored.doc, optional: optional ?? false },
      docVersion: 1,
    };
  }

  return null;
}

function invalidStoredDoc(entityType: string): DataResult<never> {
  return {
    ok: false,
    error: {
      code: "data-corrupted",
      userMessage: "Tallennettua tietoa ei voitu lukea. Tietoja ei muutettu.",
      diagnosticCode: `data.${entityType}.doc.invalid`,
    },
  };
}

async function readAndMigrateStoredDoc(
  entityType: string,
  row: unknown,
): Promise<DataResult<StoredDoc>> {
  const parsed = parseStoredRow(row);
  if (parsed === null) {
    return invalidStoredDoc(entityType);
  }
  const migrated = migrateStoredDoc(entityType, parsed);
  if (migrated === null) {
    return invalidStoredDoc(entityType);
  }
  if (migrated.docVersion !== parsed.docVersion) {
    const saved = await sendPutEntity(
      entityType,
      migrated.doc.id,
      migrated.docVersion,
      JSON.stringify(migrated.doc),
      migrated.doc.createdAt,
      migrated.doc.updatedAt,
    );
    if (!saved.ok) {
      return saved;
    }
  }
  return { ok: true, value: migrated.doc };
}

export function createSqliteEntityDocStore<T extends { readonly id: EntityId }>(
  entityType: string,
): EntityStore<T> {
  return {
    entityType,
    async list(): Promise<DataResult<readonly T[]>> {
      const response = await sendListEntities(entityType);
      if (!response.ok) {
        return response;
      }
      const items: T[] = [];
      for (const row of response.value) {
        const result = await readAndMigrateStoredDoc(entityType, row);
        if (!result.ok) {
          return result;
        }
        items.push(result.value as unknown as T);
      }
      return { ok: true as const, value: items };
    },
    async getById(id: EntityId): Promise<DataResult<T>> {
      const response = await sendGetEntity(entityType, id);
      if (!response.ok) {
        return response;
      }
      const row = response.value[0];
      if (row === undefined) {
        return {
          ok: false as const,
          error: {
            code: "not-found" as const,
            userMessage: "Kohteetta ei löytynyt.",
            diagnosticCode: `data.${entityType}.get.not-found`,
          },
        };
      }
      const result = await readAndMigrateStoredDoc(entityType, row);
      if (!result.ok) {
        return result;
      }
      if (result.value.id !== id) {
        return invalidStoredDoc(entityType);
      }
      return { ok: true as const, value: result.value as unknown as T };
    },
    async save(entity: T): Promise<DataResult<T>> {
      const record = entity as unknown as Record<string, unknown>;
      const createdAt =
        typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString();
      const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;
      const response = await sendPutEntity(
        entityType,
        entity.id,
        currentDocVersion(entityType),
        JSON.stringify(entity),
        createdAt,
        updatedAt,
      );
      if (!response.ok) {
        return response;
      }
      return { ok: true as const, value: entity };
    },
    async remove(id: EntityId): Promise<DataResult<boolean>> {
      const existing = await this.getById(id);
      if (!existing.ok) {
        return existing;
      }
      const record = existing.value as unknown as Record<string, unknown>;
      if ("deletedAt" in record) {
        // Soft delete (T100-vakio): tombstone säilyttää historian.
        const now = new Date().toISOString();
        const tombstoned = { ...record, deletedAt: now, updatedAt: now } as unknown as T;
        const saved = await this.save(tombstoned);
        if (!saved.ok) {
          return saved;
        }
        return { ok: true as const, value: true };
      }
      const response = await sendDeleteEntity(entityType, id);
      if (!response.ok) {
        return response;
      }
      return { ok: true as const, value: true };
    },
  };
}
