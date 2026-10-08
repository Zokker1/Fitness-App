// T026: hakuindeksi (§33: SearchIndexRecord). Kevyt paikallinen indeksi;
// täysi hakukone B04:ssä. Ei raakasisältöä lokeihin — indeksi rakentuu
// data-kerroksessa, tämä on vain muoto.

import type { BaseEntity, EntityId } from "./base.ts";

export interface SearchIndexRecord extends BaseEntity {
  readonly entityType: string;
  readonly entityId: EntityId;
  /** Normalisoitu hakuteksti (pienet kirjaimet, ei diakriittejä — B04). */
  readonly normalizedText: string;
}
