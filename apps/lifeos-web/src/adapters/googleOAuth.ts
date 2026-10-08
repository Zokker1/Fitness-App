// T307: Google Identity Services OAuth-token adapter.
// The access token exists only in this adapter's in-memory session map and is
// exposed briefly to an operation callback. It is never returned as a session
// field, logged, or sent to persistent browser storage.

import type {
  BrowserEnvironment,
  CapabilityError,
  CapabilityResult,
  OAuthCapability,
  OAuthSession,
} from "@lifeos/capabilities";

const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;
const AUTHORIZATION_TIMEOUT_MS = 180_000;
const TOKEN_EXPIRY_LEEWAY_MS = 30_000;
const UNCONFIGURED_CLIENT_ID = "dev-placeholder-client-id";

interface GisTokenResponse {
  readonly access_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly error?: string;
}

interface GisPopupError {
  readonly type?: "popup_failed_to_open" | "popup_closed" | "unknown";
}

interface GisRevokeResponse {
  readonly successful?: boolean;
}

interface GisTokenClient {
  requestAccessToken(): void;
}

interface GisOAuth2 {
  initTokenClient(config: {
    readonly client_id: string;
    readonly scope: string;
    readonly include_granted_scopes: false;
    readonly callback: (response: GisTokenResponse) => void;
    readonly error_callback: (error: GisPopupError) => void;
  }): GisTokenClient;
  revoke(accessToken: string, callback: (response: GisRevokeResponse) => void): void;
}

interface GisWindow extends Window {
  readonly google?: {
    readonly accounts?: {
      readonly oauth2?: GisOAuth2;
    };
  };
}

interface MemoryOAuthSession {
  readonly accessToken: string;
  readonly expiresAtEpochMs: number;
}

let gisScriptPromise: Promise<GisOAuth2> | null = null;

function oauthError(
  code: CapabilityError["code"],
  userMessage: string,
  diagnosticCode: string,
): CapabilityError {
  return { capability: "oauth", code, userMessage, diagnosticCode };
}

function hasConfiguredClientId(clientId: string): boolean {
  const normalized = clientId.trim();
  return normalized.length > 0 && normalized !== UNCONFIGURED_CLIENT_ID;
}

function oauth2FromWindow(): GisOAuth2 | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const candidate = (window as GisWindow).google?.accounts?.oauth2;
    return candidate !== undefined && typeof candidate.initTokenClient === "function"
      ? candidate
      : null;
  } catch {
    return null;
  }
}

function loadGoogleIdentityServices(): Promise<GisOAuth2> {
  const loadedApi = oauth2FromWindow();
  if (loadedApi !== null) {
    return Promise.resolve(loadedApi);
  }
  if (gisScriptPromise !== null) {
    return gisScriptPromise;
  }
  if (typeof document === "undefined") {
    return Promise.reject(new Error("oauth.document-unavailable"));
  }

  gisScriptPromise = new Promise<GisOAuth2>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("oauth.script-load-timeout"));
    }, SCRIPT_LOAD_TIMEOUT_MS);
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_URL}"]`);
    const onLoad = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const api = oauth2FromWindow();
      if (api === null) {
        reject(new Error("oauth.script-api-unavailable"));
        return;
      }
      resolve(api);
    };
    const onError = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("oauth.script-load-failed"));
    };

    if (script === null) {
      script = document.createElement("script");
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = "strict-origin-when-cross-origin";
    }
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!script.isConnected) {
      document.head.appendChild(script);
    }
  }).catch((error: unknown) => {
    gisScriptPromise = null;
    throw error;
  });

  return gisScriptPromise;
}

function createSessionId(): string | null {
  try {
    if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
      return null;
    }
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function responseHasOnlyRequestedScope(scope: string | undefined): boolean {
  if (scope === undefined) return false;
  const grantedScopes = scope.split(/\s+/u).filter((value) => value.length > 0);
  return grantedScopes.length === 1 && grantedScopes[0] === DRIVE_APPDATA_SCOPE;
}

function revokeProviderToken(oauth2: GisOAuth2, accessToken: string): void {
  try {
    oauth2.revoke(accessToken, () => undefined);
  } catch {
    // Do not retain or report provider error detail. The local token is dropped.
  }
}

export function createGoogleOAuthCapability(
  env: BrowserEnvironment,
  clientId: string,
): OAuthCapability {
  const sessions = new Map<string, MemoryOAuthSession>();
  let authorizationPending = false;

  const canUseBrowser = (): boolean =>
    env.isSecureContext && typeof window !== "undefined" && typeof document !== "undefined";

  return {
    name: "oauth",

    async prepareAuthorization(): Promise<CapabilityResult<boolean>> {
      if (!canUseBrowser()) {
        return {
          ok: false,
          error: oauthError(
            "unsupported",
            "Google-kirjautuminen vaatii tuetun suojatun selainyhteyden.",
            "oauth.prepare.unsupported",
          ),
        };
      }
      if (!hasConfiguredClientId(clientId)) {
        return {
          ok: false,
          error: oauthError(
            "unavailable",
            "Google Drive -synkronointia ei ole vielä määritetty.",
            "oauth.prepare.client-id-missing",
          ),
        };
      }
      try {
        await loadGoogleIdentityServices();
        return { ok: true, value: true };
      } catch {
        return {
          ok: false,
          error: oauthError(
            "unavailable",
            "Google-kirjautumisen valmistelu epäonnistui. Yritä uudelleen.",
            "oauth.prepare.failed",
          ),
        };
      }
    },

    beginAuthorization(): Promise<CapabilityResult<OAuthSession>> {
      if (!canUseBrowser()) {
        return Promise.resolve({
          ok: false,
          error: oauthError(
            "unsupported",
            "Google-kirjautuminen vaatii tuetun suojatun selainyhteyden.",
            "oauth.begin.unsupported",
          ),
        });
      }
      if (!hasConfiguredClientId(clientId)) {
        return Promise.resolve({
          ok: false,
          error: oauthError(
            "unavailable",
            "Google Drive -synkronointia ei ole vielä määritetty.",
            "oauth.begin.client-id-missing",
          ),
        });
      }
      const oauth2 = oauth2FromWindow();
      if (oauth2 === null) {
        return Promise.resolve({
          ok: false,
          error: oauthError(
            "unavailable",
            "Valmistele Google-kirjautuminen ennen valtuutuspainikkeen painamista.",
            "oauth.begin.not-prepared",
          ),
        });
      }
      if (authorizationPending) {
        return Promise.resolve({
          ok: false,
          error: oauthError(
            "unavailable",
            "Google-kirjautumispyyntö on jo käynnissä.",
            "oauth.begin.already-pending",
          ),
        });
      }

      const sessionId = createSessionId();
      if (sessionId === null) {
        return Promise.resolve({
          ok: false,
          error: oauthError(
            "unsupported",
            "Selain ei tue turvallista kirjautumissessiota.",
            "oauth.begin.randomness-unavailable",
          ),
        });
      }

      authorizationPending = true;
      return new Promise<CapabilityResult<OAuthSession>>((resolve) => {
        let settled = false;
        const finish = (result: CapabilityResult<OAuthSession>): void => {
          if (settled) return;
          settled = true;
          authorizationPending = false;
          clearTimeout(timer);
          resolve(result);
        };
        const timer = setTimeout(() => {
          finish({
            ok: false,
            error: oauthError(
              "unavailable",
              "Google-kirjautuminen ei valmistunut. Yritä uudelleen.",
              "oauth.begin.timeout",
            ),
          });
        }, AUTHORIZATION_TIMEOUT_MS);

        const dropLateToken = (response: GisTokenResponse): void => {
          if (response.access_token !== undefined && response.access_token.length > 0) {
            revokeProviderToken(oauth2, response.access_token);
          }
        };

        try {
          const client = oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_APPDATA_SCOPE,
            include_granted_scopes: false,
            callback: (response) => {
              if (settled) {
                dropLateToken(response);
                return;
              }
              if (response.error !== undefined) {
                dropLateToken(response);
                const denied = response.error === "access_denied";
                finish({
                  ok: false,
                  error: oauthError(
                    denied ? "denied" : "unavailable",
                    denied
                      ? "Google Drive -valtuutusta ei myönnetty."
                      : "Google-kirjautuminen epäonnistui. Yritä uudelleen.",
                    denied ? "oauth.begin.denied" : "oauth.begin.provider-error",
                  ),
                });
                return;
              }

              const expiresIn = response.expires_in;
              const accessToken = response.access_token;
              const now = Date.now();
              if (
                accessToken === undefined ||
                accessToken.length === 0 ||
                expiresIn === undefined ||
                !Number.isFinite(expiresIn) ||
                expiresIn <= 0 ||
                !responseHasOnlyRequestedScope(response.scope)
              ) {
                dropLateToken(response);
                finish({
                  ok: false,
                  error: oauthError(
                    "unavailable",
                    "Google ei myöntänyt synkronointiin tarvittavaa rajattua käyttöoikeutta.",
                    "oauth.begin.invalid-response",
                  ),
                });
                return;
              }

              const expiresAtEpochMs = now + expiresIn * 1000;
              if (!Number.isFinite(expiresAtEpochMs) || expiresAtEpochMs > 8_640_000_000_000_000) {
                dropLateToken(response);
                finish({
                  ok: false,
                  error: oauthError(
                    "unavailable",
                    "Google-kirjautuminen palautti virheellisen voimassaoloajan.",
                    "oauth.begin.invalid-expiry",
                  ),
                });
                return;
              }
              sessions.set(sessionId, { accessToken, expiresAtEpochMs });
              finish({
                ok: true,
                value: { sessionId, expiresAt: new Date(expiresAtEpochMs).toISOString() },
              });
            },
            error_callback: (error) => {
              const popupFailed = error.type === "popup_failed_to_open";
              const popupClosed = error.type === "popup_closed";
              finish({
                ok: false,
                error: oauthError(
                  popupFailed ? "unavailable" : popupClosed ? "denied" : "transient-failure",
                  popupFailed
                    ? "Google-kirjautumisikkunaa ei voitu avata. Tarkista selaimen ponnahdusikkuna-asetus."
                    : popupClosed
                      ? "Google-kirjautuminen keskeytyi."
                      : "Google-kirjautumista ei voitu viimeistellä. Yritä uudelleen.",
                  popupFailed
                    ? "oauth.begin.popup-failed"
                    : popupClosed
                      ? "oauth.begin.popup-closed"
                      : "oauth.begin.popup-error",
                ),
              });
            },
          });
          // Keep requestAccessToken in the initiating call stack so GIS can
          // associate it with the user's click and open its popup.
          client.requestAccessToken();
        } catch {
          finish({
            ok: false,
            error: oauthError(
              "unavailable",
              "Google-kirjautumista ei voitu aloittaa. Yritä uudelleen.",
              "oauth.begin.failed",
            ),
          });
        }
      });
    },

    async withAccessToken<T>(
      session: OAuthSession,
      operation: (accessToken: string) => Promise<CapabilityResult<T>>,
    ): Promise<CapabilityResult<T>> {
      const memorySession = sessions.get(session.sessionId);
      if (memorySession === undefined) {
        return {
          ok: false,
          error: oauthError(
            "unavailable",
            "Google Drive -istunto ei ole enää voimassa. Kirjaudu uudelleen.",
            "oauth.token.session-missing",
          ),
        };
      }
      if (memorySession.expiresAtEpochMs - Date.now() <= TOKEN_EXPIRY_LEEWAY_MS) {
        sessions.delete(session.sessionId);
        return {
          ok: false,
          error: oauthError(
            "unavailable",
            "Google Drive -valtuutus on vanhentunut. Kirjaudu uudelleen.",
            "oauth.token.expired",
          ),
        };
      }
      try {
        return await operation(memorySession.accessToken);
      } catch {
        return {
          ok: false,
          error: oauthError(
            "transient-failure",
            "Google Drive -pyyntö epäonnistui. Yritä uudelleen.",
            "oauth.token.operation-failed",
          ),
        };
      }
    },

    revoke(session: OAuthSession): Promise<CapabilityResult<boolean>> {
      const memorySession = sessions.get(session.sessionId);
      // Delete locally before making any provider call, even if revocation
      // subsequently fails or the provider is offline.
      sessions.delete(session.sessionId);
      if (memorySession === undefined) {
        return Promise.resolve({ ok: true, value: true });
      }
      const oauth2 = oauth2FromWindow();
      if (oauth2 === null) {
        return Promise.resolve({ ok: true, value: true });
      }
      return new Promise<CapabilityResult<boolean>>((resolve) => {
        let settled = false;
        const finish = (value: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (value) {
            resolve({ ok: true, value: true });
          } else {
            resolve({
              ok: false,
              error: oauthError(
                "transient-failure",
                "Google-valtuutusta ei voitu poistaa palvelusta. Istunto poistettiin tästä selaimesta.",
                "oauth.revoke.provider-failed",
              ),
            });
          }
        };
        const timer = setTimeout(() => {
          finish(false);
        }, 10_000);
        try {
          oauth2.revoke(memorySession.accessToken, (response) => {
            finish(response.successful === true);
          });
        } catch {
          finish(false);
        }
      });
    },
  };
}
