// T026: sync- ja backup-domain (§33–§36, §38).
// - SyncOperation on salattava operaatiokuori; payload on läpinäkymätön
//   tavujono domainille (salaus B15:ssä, ei täällä).
// - ConflictRecord säilyttää molemmat versiot merkittävissä konflikteissa;
//   ratkaisu tuottaa uuden operaation (§36).
// - BackupManifest kuvaa salatun backupin (manifest + schema + kryptoversio,
//   §38). Ei tokeneita/avaimia manifestiin.

import type { BaseEntity, EntityId, UtcTimestamp } from "./base.ts";

export type SyncEntityType = string;

export type SyncOperationKind = "create" | "update" | "delete" | "resolve";

export interface SyncOperation extends BaseEntity {
  readonly operationId: string;
  readonly installationId: string;
  readonly entityType: SyncEntityType;
  readonly entityId: EntityId;
  readonly operation: SyncOperationKind;
  readonly entityVersion: number;
  readonly occurredAt: UtcTimestamp;
  /** Base64url-koodattu ciphertext-viite; plaintext ei kuulu sync operationiin. */
  readonly encryptedPayloadRef: string;
  readonly integrityRef: string;
}

export interface SyncCursor extends BaseEntity {
  readonly installationId: string;
  readonly providerId: string;
  /** Opaque provider checkpoint, persisted only after the received page set is merged. */
  readonly providerCursor: string | null;
  readonly lastSeenOperationId: string | null;
  readonly updatedThrough: UtcTimestamp;
}

export type ConflictStatus = "open" | "resolved";

export interface ConflictRecord extends BaseEntity {
  readonly entityType: SyncEntityType;
  readonly entityId: EntityId;
  readonly status: ConflictStatus;
  /** Viitteet säilytettyihin versioihin (molempi säilyy, §36). */
  readonly localVersionRef: string;
  readonly remoteVersionRef: string;
  readonly resolvedAt: UtcTimestamp | null;
  readonly resolutionOperationId: string | null;
}

export interface BackupManifest extends BaseEntity {
  readonly backupVersion: number;
  readonly schemaVersion: number;
  readonly cryptoVersion: string;
  readonly createdAt: UtcTimestamp;
  /** Sisältöluettelo (entiteettityyppi → lukumäärä); ei itse dataa. */
  readonly contents: Readonly<Record<string, number>>;
}
