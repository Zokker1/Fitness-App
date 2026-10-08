/** Provider-neutraali kuljetusrajapinta salatuille synkka-artefakteille.
 *
 * Tämä sopimus ei tunne domain-entiteettejä, tietokantaskeemaa tai pilvipalvelun
 * SDK:ta. Provider käsittelee payloadia opaakkina tavujonona. Sync-kerros vastaa
 * salauksesta, validoinnista, cursorin pysyvyydestä ja operaation soveltamisesta.
 */

export type SyncProviderErrorCode =
  | "unsupported"
  | "unauthorized"
  | "forbidden"
  | "offline"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "quota-exceeded"
  | "invalid-input"
  | "transient-failure";

export interface SyncProviderError {
  readonly code: SyncProviderErrorCode;
  /** Käyttäjälle sopiva viesti ilman providerin raakaa virherakennetta. */
  readonly userMessage: string;
  /** Turvallinen diagnostiikkakoodi; ei tokeneita, payloadia tai käyttäjätietoja. */
  readonly diagnosticCode: string;
  /** Minimum suggested delay before retrying a transient or quota-limited operation. */
  readonly retryAfterSeconds?: number;
}

export type SyncProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SyncProviderError };

/** Providerin opaakki objektiviite. Tunniste ja versio eivät sisällä domain-dataa. */
export interface SyncProviderObjectRef {
  readonly objectId: string;
  readonly revision: string;
}

/**
 * Opaque jatkocursor. Providerin on palautettava sivut vakaassa järjestyksessä;
 * sama cursor ja sama etätila tuottavat samat tulokset.
 */
export interface SyncProviderChangePage {
  readonly objects: readonly SyncProviderObjectRef[];
  /** Opaque checkpoint to pass into the next listChanges call. */
  readonly cursor: string;
  /** True when another page is immediately available from this checkpoint. */
  readonly hasMore: boolean;
}

/** `limit` is in the inclusive range 1..500. */
export interface SyncProviderListChanges {
  readonly cursor: string | null;
  readonly limit: number;
}

export interface SyncProviderUpload {
  /** Vakaa retry-avain, jonka provider käsittelee opaakkina tunnisteena. */
  readonly idempotencyKey: string;
  /** Web Crypto -kerroksen salatut tavut; virhe ei kuluta niitä tai retry-avainta. */
  readonly ciphertext: Uint8Array;
}

export interface SyncProviderDownload {
  readonly object: SyncProviderObjectRef;
  readonly ciphertext: Uint8Array;
}

export interface SyncProvider {
  readonly providerId: string;
  readonly displayName: string;
  /**
   * Repeating the same key and bytes returns the same reference. Reusing a key
   * for different bytes returns `conflict`; uploaded objects are immutable.
   * A failed call leaves the caller-owned outbox operation available to retry.
   */
  upload(input: SyncProviderUpload): Promise<SyncProviderResult<SyncProviderObjectRef>>;
  listChanges(input: SyncProviderListChanges): Promise<SyncProviderResult<SyncProviderChangePage>>;
  /** Downloads exactly the referenced immutable revision. */
  download(object: SyncProviderObjectRef): Promise<SyncProviderResult<SyncProviderDownload>>;
}
