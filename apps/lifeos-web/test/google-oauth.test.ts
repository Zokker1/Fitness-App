import { afterEach, describe, expect, it, vi } from "vitest";
import { readBrowserEnvironment } from "@lifeos/capabilities";
import { createGoogleOAuthCapability } from "../src/adapters/googleOAuth.ts";

interface GisTokenResponse {
  readonly access_token?: string | undefined;
  readonly expires_in?: number | undefined;
  readonly scope?: string | undefined;
}

interface GisTokenClientConfig {
  readonly client_id: string;
  readonly scope: string;
  readonly include_granted_scopes: false;
  readonly callback: (response: GisTokenResponse) => void;
  readonly error_callback: (error: { readonly type?: string }) => void;
}

const requestedScope = "https://www.googleapis.com/auth/drive.appdata";
const configuredClientId = "test-client.apps.googleusercontent.com";
const validTokenResponse: GisTokenResponse = {
  access_token: "secret-test-access-token",
  expires_in: 3_600,
  scope: requestedScope,
};

function installGisMock(
  onRequest: (config: GisTokenClientConfig) => void,
  onRevoke: (
    accessToken: string,
    callback: (response: { successful?: boolean }) => void,
  ) => void = (_accessToken, callback) => {
    callback({ successful: true });
  },
) {
  const revoke = vi.fn(onRevoke);
  Object.defineProperty(window, "google", {
    configurable: true,
    value: {
      accounts: {
        oauth2: {
          initTokenClient(config: GisTokenClientConfig) {
            return {
              requestAccessToken() {
                onRequest(config);
              },
            };
          },
          revoke,
        },
      },
    },
  });
  return { revoke };
}

function createOAuth(isSecureContext = true) {
  return createGoogleOAuthCapability(
    readBrowserEnvironment({ isSecureContext }),
    configuredClientId,
  );
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, "google");
});

describe("Google OAuth configuration", () => {
  it("treats the example client ID as unconfigured during preparation", async () => {
    const oauth = createGoogleOAuthCapability(
      readBrowserEnvironment({ isSecureContext: true }),
      "dev-placeholder-client-id",
    );

    const result = await oauth.prepareAuthorization();

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnosticCode: "oauth.prepare.client-id-missing",
        userMessage: "Google Drive -synkronointia ei ole vielä määritetty.",
      },
    });
  });

  it("does not start authorization with the example client ID", async () => {
    const oauth = createGoogleOAuthCapability(
      readBrowserEnvironment({ isSecureContext: true }),
      "dev-placeholder-client-id",
    );

    const result = await oauth.beginAuthorization();

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnosticCode: "oauth.begin.client-id-missing",
        userMessage: "Google Drive -synkronointia ei ole vielä määritetty.",
      },
    });
  });

  it("keeps the token inside memory and refuses it after the expiry leeway", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    const accessToken = "secret-test-access-token";
    installGisMock((config) => {
      expect(config.client_id).toBe(configuredClientId);
      expect(config.scope).toBe(requestedScope);
      expect(config.include_granted_scopes).toBe(false);
      config.callback({ ...validTokenResponse, access_token: accessToken });
    });
    const oauth = createOAuth();

    expect(await oauth.prepareAuthorization()).toEqual({ ok: true, value: true });
    const authorized = await oauth.beginAuthorization();
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    expect(JSON.stringify(authorized.value)).not.toContain(accessToken);

    const tokensSeen: string[] = [];
    const validUse = await oauth.withAccessToken(authorized.value, (token) => {
      tokensSeen.push(token);
      return Promise.resolve({ ok: true, value: true });
    });
    expect(validUse).toEqual({ ok: true, value: true });
    expect(tokensSeen).toEqual([accessToken]);

    vi.setSystemTime(now + 3_571_000);
    const expiredUse = await oauth.withAccessToken(authorized.value, (token) => {
      tokensSeen.push(token);
      return Promise.resolve({ ok: true, value: true });
    });
    expect(expiredUse).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.token.expired" },
    });
    expect(tokensSeen).toEqual([accessToken]);
  });

  it("rejects OAuth before loading GIS in an insecure browser context", async () => {
    const oauth = createOAuth(false);

    expect(await oauth.prepareAuthorization()).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.prepare.unsupported" },
    });
    expect(await oauth.beginAuthorization()).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.begin.unsupported" },
    });
    expect(Reflect.get(window, "google")).toBeUndefined();
  });

  it.each([
    {
      name: "an extra scope",
      response: { ...validTokenResponse, scope: `${requestedScope} email` },
    },
    { name: "a different scope", response: { ...validTokenResponse, scope: "openid email" } },
    { name: "a missing scope", response: { ...validTokenResponse, scope: undefined } },
    { name: "a missing token", response: { ...validTokenResponse, access_token: undefined } },
    { name: "a nonpositive expiry", response: { ...validTokenResponse, expires_in: 0 } },
    { name: "a non-finite expiry", response: { ...validTokenResponse, expires_in: Number.NaN } },
  ])("revokes and rejects a response with $name", async ({ response }) => {
    const { revoke } = installGisMock((config) => {
      config.callback(response);
    });
    const result = await createOAuth().beginAuthorization();

    expect(result).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.begin.invalid-response" },
    });
    if (response.access_token !== undefined) {
      expect(revoke).toHaveBeenCalledWith(validTokenResponse.access_token, expect.any(Function));
    } else {
      expect(revoke).not.toHaveBeenCalled();
    }
  });

  it("rejects an expiry outside the Date range and revokes the token", async () => {
    const { revoke } = installGisMock((config) => {
      config.callback({ ...validTokenResponse, expires_in: 9_000_000_000_000 });
    });

    expect(await createOAuth().beginAuthorization()).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.begin.invalid-expiry" },
    });
    expect(revoke).toHaveBeenCalledWith(validTokenResponse.access_token, expect.any(Function));
  });

  it.each([
    { type: "popup_failed_to_open", code: "oauth.begin.popup-failed", errorCode: "unavailable" },
    { type: "popup_closed", code: "oauth.begin.popup-closed", errorCode: "denied" },
    { type: "unknown", code: "oauth.begin.popup-error", errorCode: "transient-failure" },
  ] as const)("maps GIS popup error $type to a safe result", async ({ type, code, errorCode }) => {
    installGisMock((config) => {
      config.error_callback({ type });
    });

    expect(await createOAuth().beginAuthorization()).toMatchObject({
      ok: false,
      error: { code: errorCode, diagnosticCode: code },
    });
  });

  it("drops the memory session before reporting provider revocation failure", async () => {
    installGisMock(
      (config) => {
        config.callback(validTokenResponse);
      },
      (_accessToken, callback) => {
        callback({ successful: false });
      },
    );
    const oauth = createOAuth();
    const authorized = await oauth.beginAuthorization();
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    expect(await oauth.revoke(authorized.value)).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.revoke.provider-failed" },
    });
    expect(
      await oauth.withAccessToken(authorized.value, () =>
        Promise.resolve({ ok: true, value: true }),
      ),
    ).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.token.session-missing" },
    });
  });

  it("revokes a token that arrives after the authorization times out", async () => {
    vi.useFakeTimers();
    let callback: GisTokenClientConfig["callback"] | undefined;
    const { revoke } = installGisMock((config) => {
      callback = config.callback;
    });
    const authorization = createOAuth().beginAuthorization();

    await vi.advanceTimersByTimeAsync(180_000);
    expect(await authorization).toMatchObject({
      ok: false,
      error: { diagnosticCode: "oauth.begin.timeout" },
    });
    callback?.(validTokenResponse);
    expect(revoke).toHaveBeenCalledWith(validTokenResponse.access_token, expect.any(Function));
  });
});
