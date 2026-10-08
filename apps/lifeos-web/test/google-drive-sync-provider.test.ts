import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthCapability, OAuthSession } from "@lifeos/capabilities";
import { createGoogleDriveSyncProvider } from "../src/adapters/googleDriveSyncProvider.ts";

const SESSION: OAuthSession = {
  sessionId: "test-session",
  expiresAt: "2026-10-03T16:00:00.000Z",
};

function oauthWithToken(token = "test-access-token"): OAuthCapability {
  return {
    name: "oauth",
    prepareAuthorization: () => Promise.resolve({ ok: true, value: true }),
    beginAuthorization: () => Promise.resolve({ ok: true, value: SESSION }),
    withAccessToken: (_session, operation) => Promise.resolve().then(() => operation(token)),
    revoke: () => Promise.resolve({ ok: true, value: true }),
  };
}

function expiredOAuth(): OAuthCapability {
  return {
    ...oauthWithToken(),
    withAccessToken: () =>
      Promise.resolve({
        ok: false,
        error: {
          capability: "oauth",
          code: "unavailable",
          userMessage: "Google Drive -valtuutus on vanhentunut.",
          diagnosticCode: "oauth.token.expired",
        },
      }),
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof URL) return input.href;
  if (typeof input === "string") return input;
  return input.url;
}

function driveUploadResponse(): Response {
  return new Response(JSON.stringify({ id: "drive-file-1", version: "1" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Google Drive sync provider", () => {
  it("uploads opaque ciphertext to appDataFolder without putting the token on the media request", async () => {
    const calls: { readonly url: string; readonly init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const request = init ?? {};
        calls.push({ url, init: request });
        if (request.method === "GET") {
          return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
        }
        if (request.method === "POST") {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: {
                Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=upload-1",
              },
            }),
          );
        }
        return Promise.resolve(driveUploadResponse());
      }),
    );
    const ciphertext = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const provider = createGoogleDriveSyncProvider({
      oauth: oauthWithToken(),
      getSession: () => SESSION,
    });

    const result = await provider.upload({ idempotencyKey: "batch-1", ciphertext });

    expect(result).toEqual({
      ok: true,
      value: { objectId: "drive-file-1", revision: "1" },
    });
    expect(calls).toHaveLength(3);
    expect(new URL(calls[0]!.url).searchParams.get("spaces")).toBe("appDataFolder");
    expect(new Headers(calls[0]!.init.headers).get("Authorization")).toBe(
      "Bearer test-access-token",
    );
    const metadataBody = calls[1]!.init.body;
    expect(typeof metadataBody).toBe("string");
    const metadata = JSON.parse(metadataBody as string) as {
      readonly parents: readonly string[];
      readonly appProperties: Readonly<Record<string, string>>;
    };
    expect(metadata.parents).toEqual(["appDataFolder"]);
    expect(metadata.appProperties.lifeosType).toBe("sync-batch");
    expect(metadata.appProperties.lifeosIdempotency).not.toBe("batch-1");
    expect(new Headers(calls[1]!.init.headers).get("Authorization")).toBe(
      "Bearer test-access-token",
    );
    expect(new Headers(calls[2]!.init.headers).get("Authorization")).toBeNull();
    expect(new Uint8Array(await (calls[2]!.init.body as Blob).arrayBuffer())).toEqual(ciphertext);
    expect(ciphertext).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
  });

  it("retries a transient lookup and succeeds with the same upload input", async () => {
    let lookupAttempts = 0;
    const methods: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        methods.push(method);
        if (method === "GET" && lookupAttempts++ === 0) {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        if (method === "GET") {
          return Promise.resolve(new Response(JSON.stringify({ files: [] }), { status: 200 }));
        }
        if (method === "POST") {
          return Promise.resolve(
            new Response(null, {
              status: 200,
              headers: {
                Location: "https://www.googleapis.com/upload/drive/v3/files?upload_id=retry-1",
              },
            }),
          );
        }
        return Promise.resolve(driveUploadResponse());
      }),
    );
    const ciphertext = new Uint8Array([1, 2, 3]);
    const provider = createGoogleDriveSyncProvider({
      oauth: oauthWithToken(),
      getSession: () => SESSION,
    });

    const result = await provider.upload({ idempotencyKey: "retry-batch", ciphertext });

    expect(result.ok).toBe(true);
    expect(methods).toEqual(["GET", "GET", "POST", "PUT"]);
    expect(ciphertext).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns an auth-expiry error without changing ciphertext or consuming the request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ciphertext = new Uint8Array([10, 20, 30]);
    const provider = createGoogleDriveSyncProvider({
      oauth: expiredOAuth(),
      getSession: () => SESSION,
    });

    const result = await provider.upload({ idempotencyKey: "retry-after-auth", ciphertext });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "unauthorized", diagnosticCode: "sync.drive.oauth.expired" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ciphertext).toEqual(new Uint8Array([10, 20, 30]));
  });
});
