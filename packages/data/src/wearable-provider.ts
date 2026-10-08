// T246: provider-neutraali lukuportti tulevalle terveysdatan tuonnille.
// Sopimus ei tunne domain-entiteettejä, selaimen API:a eikä providerin SDK:ta.

export type WearableProviderErrorCode =
  | "unsupported"
  | "permission-required"
  | "permission-denied"
  | "invalid-input"
  | "transient-failure";

export interface WearableProviderError {
  readonly code: WearableProviderErrorCode;
  /** Käyttäjälle sopiva viesti ilman providerin raakaa virherakennetta. */
  readonly userMessage: string;
  /** Turvallinen diagnostiikkatunniste; ei terveystietoja, tunnisteita tai tokeneita. */
  readonly diagnosticCode: string;
}

export type WearableProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: WearableProviderError };

export type WearableReadAccess = "not-requested" | "granted" | "denied";

export type WearableProviderAvailability =
  | { readonly state: "unsupported" }
  | { readonly state: "available"; readonly readAccess: WearableReadAccess };

/** Providerin lähdejärjestelmässä vakaa, opaakki tunniste. Ei henkilötunniste. */
interface WearableRecordIdentity {
  readonly providerRecordId: string;
}

/** UTC-aika RFC 3339 -muodossa, esimerkiksi 2026-10-01T09:30:00.000Z. */
interface WearableRecordInterval extends WearableRecordIdentity {
  readonly startsAtUtc: string;
  readonly endsAtUtc: string;
}

export type WearableProviderRecord =
  | (WearableRecordInterval & {
      readonly kind: "step-count";
      readonly steps: number;
    })
  | (WearableRecordInterval & {
      readonly kind: "sleep-period";
    })
  | (WearableRecordInterval & {
      readonly kind: "activity";
      readonly activityType: string;
    })
  | (WearableRecordIdentity & {
      readonly kind: "measurement";
      readonly recordedAtUtc: string;
      readonly metricName: string;
      readonly value: number;
      readonly unit: string;
    });

/** Puoliksi avoin UTC-aikaväli [fromUtc, toUtc). Cursor on adapterin opaakki. */
export interface WearableProviderRecordRange {
  readonly fromUtc: string;
  readonly toUtc: string;
  readonly cursor?: string | null;
}

export interface WearableProviderRecordPage {
  readonly records: readonly WearableProviderRecord[];
  /** Opaakki jatkocursor; null tarkoittaa, ettei sivuja ole lisää. */
  readonly nextCursor: string | null;
}

/**
 * Tulevan laite-/Health Connect -adapterin lukuraja.
 *
 * `requestReadAccess` voi näyttää käyttöjärjestelmän luvanäkymän, joten sitä
 * kutsutaan vain käyttäjän eksplisiittisestä toimesta. Adapteri normalisoi
 * palautetut havainnot. Tuonnin deduplikointi, paikalliseen domainiin
 * muuntaminen, pysyvä cursor ja tietokantakirjoitukset kuuluvat erilliselle
 * orchestration-kerrokselle.
 */
export interface WearableProvider {
  readonly providerId: string;
  readonly displayName: string;
  getAvailability(): Promise<WearableProviderResult<WearableProviderAvailability>>;
  requestReadAccess(): Promise<WearableProviderResult<void>>;
  listRecords(
    range: WearableProviderRecordRange,
  ): Promise<WearableProviderResult<WearableProviderRecordPage>>;
}
