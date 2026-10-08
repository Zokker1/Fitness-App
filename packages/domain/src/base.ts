// T026: yhteiset domain-perustyypit (§32–§33).
// - Kaikki ID:t globaalisti uniikkeja merkkijonoja (UUID/ULID tuotetaan
//   data-kerroksessa; domain ei ota kantaa generaattoriin).
// - Aikaleimat UTC ISO-8601 -merkkijonoja; näyttömuotoilu UI-kerroksessa.
// - Soft delete synkkaa varten siellä missä §32/§36 sitä vaatii.
// - Ei Date-olioita rajapinnoissa (serialisoituva data kulkee sellaisenaan
//   SQLite/OPFS/Drive/backup-kerrosten läpi ilman muunnosylläreitä).

/** Globaalisti uniikki entiteettitunniste (UUID/ULID, §32). */
export type EntityId = string;

/** UTC-aikaleima ISO-8601-muodossa, esim. "2026-09-15T14:20:00.000Z". */
export type UtcTimestamp = string;

/** Looginen versiolaskuri synkkaa/konflikteja varten (§34/§36). */
export type EntityVersion = number;

export interface BaseEntity {
  readonly id: EntityId;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly version: EntityVersion;
}

export interface SoftDeletable {
  readonly deletedAt: UtcTimestamp | null;
}

/**
 * T062: yhdistetty metadata-malli. Jokaisen kestodomainin entiteetin
 * metadata on täsmälleen tämä muoto (globaali id + UTC-aikaleimat +
 * looginen versio + soft-delete-lippu missä §32/§36 vaatii). Skeemassa
 * samoja sarakkeita peilaa data/migrations.ts:n entityMetadataColumns.
 */
export type EntityMetadata = BaseEntity & SoftDeletable;

/** Rajattu metadata synkka-outboxille ilman Drive-tuntemusta (§34). */
export interface SyncMetadata {
  readonly installationId: string;
  readonly operationId: string;
  readonly entityVersion: EntityVersion;
}
