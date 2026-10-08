// T025: selain-capabilityjen rajapinnat. Nämä ovat ainoa reitti jolla
// domain/data/UI saa koskea selaimen natiivi-APIeihin (storage,
// notifications, file access, OAuth-alku, service worker).
//
// Säännöt (§32/§35/§45/§54; ADR-001 §4):
// - Domain ei tunne `navigator`/`window`/`Notification`-APIeja eikä
//   Google/Drive-yksityiskohtia. Se kuluttaa vain näitä rajapintoja.
// - Pysyvä domain-data ei koskaan kulje localStorage-adapterin kautta.
// - OAuth-tokenit eivät koskaan kulje persistenttiin tallennukseen.
// - Kaikki epäluotettu input (notification-payloadit, postMessage,
//   SW-viestit, file/import) validoidaan runtime-skeemalla ennen käyttöä.
// - Jokainen capability palauttaa eksplisiittisen tuen/virheen
//   (ei heitä raakaa DOMExceptionia domainiin).

// ---------------------------------------------------------------------------
// Yhteiset virhe- ja tukityypit
// ---------------------------------------------------------------------------

export type CapabilityName = "storage" | "notifications" | "file" | "oauth" | "service-worker";

export type CapabilityErrorCode =
  "unsupported" | "denied" | "unavailable" | "quota-exceeded" | "transient-failure";

export interface CapabilityError {
  readonly capability: CapabilityName;
  readonly code: CapabilityErrorCode;
  /** Käyttäjälle näytettävä, ei-tekninen viesti (fi). Ei terveysdataa. */
  readonly userMessage: string;
  /** Koneellinen diagnostiikkakoodi lokeihin (ei PII:tä, ei tokeneita). */
  readonly diagnosticCode: string;
}

export type CapabilityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CapabilityError };

// ---------------------------------------------------------------------------
// Environment: testattava abstraktio globaalien yllä (ei suoraa
// navigator/window-viittausta domainissa tai adapteriketjun ulkopuolella).
// ---------------------------------------------------------------------------

export interface BrowserEnvironment {
  readonly isSecureContext: boolean;
  readonly userAgent: string;
}

export function readBrowserEnvironment(env?: {
  readonly isSecureContext?: boolean;
  readonly userAgent?: string;
}): BrowserEnvironment {
  return {
    isSecureContext: env?.isSecureContext ?? false,
    userAgent: env?.userAgent ?? "",
  };
}

// ---------------------------------------------------------------------------
// Storage: persist/estimate + OPFS-kelpoisuus. localStorage EI ole mukana:
// domain-data ei kuuluu localStorageen (§32). Pysyvä data kulkee T030+
// OPFS/SQLite-adapterin kautta; tämä rajapinta kertoo vain kelpoisuuden.
// ---------------------------------------------------------------------------

export interface StorageCapabilitySnapshot {
  readonly opfsSupported: boolean;
  readonly persisted: boolean | null;
  readonly quotaBytes: number | null;
  readonly usageBytes: number | null;
}

export interface StorageCapability {
  readonly name: "storage";
  snapshot(): Promise<CapabilityResult<StorageCapabilitySnapshot>>;
  requestPersistence(): Promise<CapabilityResult<boolean>>;
}

// ---------------------------------------------------------------------------
// Notifications: lupa + välitön, käyttäjän sallima näyttö. Ei ajastusta eikä
// suljetun selaimen taustalupausta (§24).
// ---------------------------------------------------------------------------

export type NotificationPermissionState = "default" | "granted" | "denied";

export interface NotificationRequest {
  /** Used to apply category-specific privacy before browser delivery. */
  readonly categoryKey: string;
  /** Vain turvallinen reitti (ei PII:tä, ei terveysarvoja URL:ssa, §24). */
  readonly route: string;
  readonly title: string;
  readonly body: string;
}

export interface NotificationCapability {
  readonly name: "notifications";
  permission(): Promise<CapabilityResult<NotificationPermissionState>>;
  requestPermission(): Promise<CapabilityResult<NotificationPermissionState>>;
  /** Shows now when the app is backgrounded and permission was already granted; never schedules. */
  showIfBackgrounded(request: NotificationRequest): Promise<CapabilityResult<boolean>>;
}

// ---------------------------------------------------------------------------
// File: käyttäjän eksplisiittinen tiedostovalinta (import/backup).
// Palauttaa raa'an tavuvirran; validointi tapahtuu domain-puolella.
// ---------------------------------------------------------------------------

export interface PickedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
}

export interface FileCapability {
  readonly name: "file";
  pickFile(options?: {
    readonly accept?: readonly string[];
  }): Promise<CapabilityResult<PickedFile | null>>;
  downloadFile(file: {
    readonly suggestedName: string;
    readonly mimeType: string;
    readonly bytes: Uint8Array;
  }): Promise<CapabilityResult<boolean>>;
}

// ---------------------------------------------------------------------------
// OAuth: vain valtuutuksen aloitus + muistissa pidettävä sessio (§35).
// EI client secretiä, EI persistenttia token-storea, EI Drive-tuntemusta
// domainissa. Drive-adapteri (B15) kuluttaa tätä rajapintaa.
// ---------------------------------------------------------------------------

export interface OAuthSession {
  /** Opaque-istuntotunniste adapterin sisäiseen muistiin (ei token). */
  readonly sessionId: string;
  readonly expiresAt: string | null;
}

export interface OAuthCapability {
  readonly name: "oauth";
  /** Lataa OAuth-kirjaston ennen käyttäjän valtuutuspainiketta. */
  prepareAuthorization(): Promise<CapabilityResult<boolean>>;
  /** Aloittaa käyttäjän suostumusflow'n sallituissa origineissa. */
  beginAuthorization(): Promise<CapabilityResult<OAuthSession>>;
  /**
   * Antaa voimassa olevan tokenin hetkellisesti operaation callbackille.
   * Callback ei saa säilyttää tokenia operaation jälkeen.
   */
  withAccessToken<T>(
    session: OAuthSession,
    operation: (accessToken: string) => Promise<CapabilityResult<T>>,
  ): Promise<CapabilityResult<T>>;
  /** Päättää muistissa olevan session; ei koske dataa. */
  revoke(session: OAuthSession): Promise<CapabilityResult<boolean>>;
}

// ---------------------------------------------------------------------------
// Service worker: rekisteröinti + hallittu päivitys (prompt-malli, T024).
// SW ei tarjoile käyttäjädataa (§44: versioitu app-shell-cache).
// ---------------------------------------------------------------------------

export type ServiceWorkerCapabilityState =
  "unsupported" | "registered" | "waiting-for-user" | "failed";

export interface ServiceWorkerCapability {
  readonly name: "service-worker";
  state(): Promise<CapabilityResult<ServiceWorkerCapabilityState>>;
  /** Aktivoi odottavan SW:n vasta käyttäjän hyväksynnästä (T024). */
  activateWaiting(): Promise<CapabilityResult<boolean>>;
}
