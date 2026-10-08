// T130: entity-doc -clientit (nimetyt worker-opit; §32 — ei raakaa SQL:ää).
import type { EntityId } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

export async function putEntityDoc(
  entityType: string,
  id: EntityId,
  docVersion: number,
  doc: string,
  createdAt: string,
  updatedAt: string,
): Promise<DataResult<boolean>> {
  const response = await sendDbRequest({
    kind: "exec",
    op: "putEntity",
    params: {
      entity_type: entityType,
      id,
      doc_version: docVersion,
      doc,
      created_at: createdAt,
      updated_at: updatedAt,
    },
  });
  return toDataResult<boolean>(response, () => true);
}

export async function getEntityDoc(
  entityType: string,
  id: EntityId,
): Promise<DataResult<readonly unknown[]>> {
  const response = await sendDbRequest({
    kind: "query",
    op: "getEntity",
    params: { entity_type: entityType, id },
  });
  return toDataResult<readonly unknown[]>(response, (rows) => rows);
}

export async function listEntityDocs(entityType: string): Promise<DataResult<readonly unknown[]>> {
  const response = await sendDbRequest({
    kind: "query",
    op: "listEntities",
    params: { entity_type: entityType },
  });
  return toDataResult<readonly unknown[]>(response, (rows) => rows);
}

export async function deleteEntityDoc(
  entityType: string,
  id: EntityId,
): Promise<DataResult<boolean>> {
  const response = await sendDbRequest({
    kind: "exec",
    op: "deleteEntity",
    params: { entity_type: entityType, id },
  });
  return toDataResult<boolean>(response, () => true);
}
