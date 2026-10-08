// T308-T310: move opaque encrypted sync batches through Google's appDataFolder.
// The access token and resumable-upload URI exist only in the active call.

import type { OAuthCapability, OAuthSession } from "@lifeos/capabilities";
import type {
  SyncProvider,
  SyncProviderChangePage,
  SyncProviderDownload,
  SyncProviderError,
  SyncProviderListChanges,
  SyncProviderObjectRef,
  SyncProviderResult,
  SyncProviderUpload,
} from "@lifeos/data";

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_APP_DATA_SPACE = "appDataFolder";
const BATCH_MIME_TYPE = "application/octet-stream";
const REQUEST_TIMEOUT_MS = 60_000;
const LOOKUP_TIMEOUT_MS = 30_000;
const MAX_AUTOMATIC_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 1_000;
const RETRY_JITTER_MS = 1_000;
const MAX_AUTOMATIC_RETRY_DELAY_MS = 5_000;
const MAX_REPORTED_RETRY_AFTER_SECONDS = 86_400;
export const GOOGLE_DRIVE_SYNC_BATCH_MAX_BYTES = 16 * 1024 * 1024;
const MAX_SYNC_BATCH_BYTES = GOOGLE_DRIVE_SYNC_BATCH_MAX_BYTES;
const DRIVE_LIST_PAGE_SIZE = 1_000;
const MAX_CURSOR_BOUNDARY_IDS = 10_000;
const MAX_CURSOR_BYTES = 1_000_000;
const DRIVE_OBJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const APP_PROPERTY_IDEMPOTENCY = "lifeosIdempotency";
const APP_PROPERTY_PAYLOAD = "lifeosPayload";
const APP_PROPERTY_TYPE = "lifeosType";
const APP_PROPERTY_VERSION = "lifeosVersion";
const BATCH_TYPE = "sync-batch";
const BATCH_VERSION = "1";

interface UploadDigests {
  readonly idempotency: string;
  readonly payload: string;
}

interface InFlightUpload {
  readonly payloadDigest: string;
  readonly promise: Promise<SyncProviderResult<SyncProviderObjectRef>>;
}

interface DriveSyncCursor {
  readonly version: 1;
  readonly createdTime: string | null;
  readonly seenObjectIdsAtTime: readonly string[];
}

interface DriveSyncBatchFile {
  readonly object: SyncProviderObjectRef;
  readonly createdTime: string;
  readonly payloadDigest: string;
}

interface DriveListPage {
  readonly files: readonly unknown[];
  readonly nextPageToken: string | null;
  readonly incompleteSearch: boolean;
}

type DriveApiOperation = "lookup" | "create" | "upload" | "list" | "download";

const inFlightUploads = new Map<string, InFlightUpload>();

export interface GoogleDriveSyncProviderOptions {
  readonly oauth: OAuthCapability;
  /** Returns the current OAuth session; the access token remains inside OAuth. */
  readonly getSession: () => OAuthSession | null;
}

function providerError(
  code: SyncProviderError["code"],
  diagnosticCode: string,
  userMessage: string,
  retryAfterSeconds?: number,
): SyncProviderError {
  return {
    code,
    diagnosticCode,
    userMessage,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };
}

function failure<T>(error: SyncProviderError): SyncProviderResult<T> {
  return { ok: false, error };
}

function invalidUpload<T>(): SyncProviderResult<T> {
  return failure(
    providerError(
      "invalid-input",
      "sync.drive.upload.invalid-input",
      "Salattu synkronointierä ei kelpaa lähetettäväksi.",
    ),
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function digestHex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", copyToArrayBuffer(value));
  return bytesToHex(new Uint8Array(digest));
}

async function computeDigests(input: SyncProviderUpload): Promise<UploadDigests | null> {
  if (typeof crypto === "undefined" || typeof TextEncoder === "undefined") {
    return null;
  }
  try {
    const idempotencyBytes = new TextEncoder().encode(JSON.stringify(input.idempotencyKey));
    return {
      idempotency: await digestHex(idempotencyBytes),
      payload: await digestHex(input.ciphertext),
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDriveObjectRef(value: unknown): SyncProviderObjectRef | null {
  if (!isRecord(value)) return null;
  const objectId = value.id;
  const version = value.version;
  const revision =
    typeof version === "string" && /^[1-9]\d{0,29}$/u.test(version)
      ? version
      : typeof version === "number" && Number.isSafeInteger(version) && version > 0
        ? String(version)
        : null;
  if (
    typeof objectId !== "string" ||
    !DRIVE_OBJECT_ID_PATTERN.test(objectId) ||
    revision === null
  ) {
    return null;
  }
  return { objectId, revision };
}

function parseAppProperties(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const properties: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return null;
    properties[key] = entry;
  }
  return properties;
}

function normalizeDriveTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const epochMs = Date.parse(value);
  return Number.isFinite(epochMs) ? new Date(epochMs).toISOString() : null;
}

function hasSupportedBatchProperties(properties: Record<string, string>): boolean {
  return (
    properties[APP_PROPERTY_TYPE] === BATCH_TYPE &&
    properties[APP_PROPERTY_VERSION] === BATCH_VERSION &&
    SHA256_HEX_PATTERN.test(properties[APP_PROPERTY_IDEMPOTENCY] ?? "") &&
    SHA256_HEX_PATTERN.test(properties[APP_PROPERTY_PAYLOAD] ?? "")
  );
}

function parseDriveSyncBatchFile(value: unknown): DriveSyncBatchFile | null {
  if (!isRecord(value)) return null;
  const object = parseDriveObjectRef(value);
  const createdTime = normalizeDriveTimestamp(value.createdTime);
  const mimeType = value.mimeType;
  const properties = parseAppProperties(value.appProperties);
  if (
    object === null ||
    createdTime === null ||
    mimeType !== BATCH_MIME_TYPE ||
    properties === null ||
    !hasSupportedBatchProperties(properties)
  ) {
    return null;
  }
  const payloadDigest = properties[APP_PROPERTY_PAYLOAD];
  if (payloadDigest === undefined) return null;
  return { object, createdTime, payloadDigest };
}

function encodeDriveCursor(cursor: DriveSyncCursor): string | null {
  if (typeof btoa !== "function" || typeof TextEncoder === "undefined") return null;
  try {
    const objectIds = [...new Set(cursor.seenObjectIdsAtTime)].sort();
    if (objectIds.length > MAX_CURSOR_BOUNDARY_IDS) return null;
    const json = JSON.stringify({
      version: 1,
      createdTime: cursor.createdTime,
      seenObjectIdsAtTime: objectIds,
    });
    const bytes = new TextEncoder().encode(json);
    if (bytes.byteLength > MAX_CURSOR_BYTES) return null;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
  } catch {
    return null;
  }
}

function decodeDriveCursor(value: string | null): DriveSyncCursor | null {
  if (value === null) {
    return { version: 1, createdTime: null, seenObjectIdsAtTime: [] };
  }
  if (
    value.length === 0 ||
    value.length > Math.ceil((MAX_CURSOR_BYTES * 4) / 3) + 4 ||
    !/^[A-Za-z0-9_-]+$/u.test(value) ||
    typeof atob !== "function" ||
    typeof TextDecoder === "undefined"
  ) {
    return null;
  }
  try {
    const base64 = value.replace(/-/gu, "+").replace(/_/gu, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    if (binary.length > MAX_CURSOR_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!isRecord(parsed)) return null;
    const keys = Object.keys(parsed);
    if (
      keys.length !== 3 ||
      !keys.includes("version") ||
      !keys.includes("createdTime") ||
      !keys.includes("seenObjectIdsAtTime") ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.seenObjectIdsAtTime) ||
      parsed.seenObjectIdsAtTime.length > MAX_CURSOR_BOUNDARY_IDS
    ) {
      return null;
    }
    let createdTime: string | null = null;
    if (parsed.createdTime !== null) {
      createdTime = normalizeDriveTimestamp(parsed.createdTime);
      if (createdTime === null) return null;
    }
    const objectIds = parsed.seenObjectIdsAtTime;
    if (
      !objectIds.every(
        (objectId): objectId is string =>
          typeof objectId === "string" && DRIVE_OBJECT_ID_PATTERN.test(objectId),
      ) ||
      new Set(objectIds).size !== objectIds.length ||
      (createdTime === null && objectIds.length > 0)
    ) {
      return null;
    }
    return { version: 1, createdTime, seenObjectIdsAtTime: objectIds };
  } catch {
    return null;
  }
}

function safeRetryAfter(response: Response): number | undefined {
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter === null) return undefined;
  if (/^\d+$/u.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (!Number.isSafeInteger(seconds)) return MAX_REPORTED_RETRY_AFTER_SECONDS;
    return Math.min(seconds, MAX_REPORTED_RETRY_AFTER_SECONDS);
  }
  const retryAt = Date.parse(retryAfter);
  if (!Number.isFinite(retryAt)) return undefined;
  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1_000));
  return Math.min(seconds, MAX_REPORTED_RETRY_AFTER_SECONDS);
}

async function readDriveErrorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as unknown;
    if (!isRecord(body) || !isRecord(body.error) || !Array.isArray(body.error.errors)) {
      return null;
    }
    const errors = body.error.errors as unknown[];
    for (const entry of errors) {
      if (isRecord(entry) && typeof entry.reason === "string") return entry.reason;
    }
    return null;
  } catch {
    return null;
  }
}

async function errorFromResponse(
  response: Response,
  operation: DriveApiOperation,
): Promise<SyncProviderError> {
  if (response.status !== 403) {
    try {
      await response.body?.cancel();
    } catch {
      // Status mapping uses only the HTTP code and safe headers.
    }
  }
  const diagnosticPrefix = `sync.drive.${operation}`;
  if (response.status === 401) {
    return providerError(
      "unauthorized",
      `${diagnosticPrefix}.unauthorized`,
      "Google Drive -valtuutus on vanhentunut. Kirjaudu uudelleen.",
    );
  }
  if (response.status === 403) {
    const reason = await readDriveErrorReason(response);
    if (
      reason === "storageQuotaExceeded" ||
      reason === "quotaExceeded" ||
      reason === "appDataFolderQuotaExceeded"
    ) {
      return providerError(
        "quota-exceeded",
        `${diagnosticPrefix}.quota-exceeded`,
        "Google Driven tila ei riitä synkronointierän tallentamiseen.",
        safeRetryAfter(response),
      );
    }
    if (
      reason === "rateLimitExceeded" ||
      reason === "userRateLimitExceeded" ||
      reason === "dailyLimitExceeded"
    ) {
      return providerError(
        "rate-limited",
        `${diagnosticPrefix}.rate-limited`,
        "Google Drive rajoitti pyyntöjen määrää. Yritä hetken kuluttua uudelleen.",
        safeRetryAfter(response),
      );
    }
    return providerError(
      "forbidden",
      `${diagnosticPrefix}.forbidden`,
      "Google Drive ei sallinut synkronointierän tallentamista.",
    );
  }
  if (response.status === 404) {
    return providerError(
      "not-found",
      `${diagnosticPrefix}.not-found`,
      "Google Drive -synkronointikohdetta ei löytynyt.",
    );
  }
  if (response.status === 409) {
    return providerError(
      "conflict",
      `${diagnosticPrefix}.conflict`,
      "Sama synkronointitunniste on jo käytössä eri sisällölle.",
    );
  }
  if (response.status === 413) {
    return providerError(
      "quota-exceeded",
      `${diagnosticPrefix}.too-large`,
      "Synkronointierää ei voitu tallentaa sen koon vuoksi.",
    );
  }
  if (response.status === 429) {
    return providerError(
      "rate-limited",
      `${diagnosticPrefix}.rate-limited`,
      "Google Drive rajoitti pyyntöjen määrää. Yritä hetken kuluttua uudelleen.",
      safeRetryAfter(response),
    );
  }
  if (response.status === 400) {
    return providerError(
      "invalid-input",
      `${diagnosticPrefix}.request-rejected`,
      "Google Drive hylkäsi synkronointipyynnön.",
    );
  }
  return providerError(
    response.status >= 500 || response.status === 408 ? "transient-failure" : "forbidden",
    `${diagnosticPrefix}.http-${String(response.status)}`,
    response.status >= 500 || response.status === 408
      ? "Google Drive ei vastannut. Yritä uudelleen."
      : "Google Drive ei sallinut synkronointipyyntöä.",
    safeRetryAfter(response),
  );
}

function networkError(operation: DriveApiOperation, timedOut: boolean): SyncProviderError {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (offline) {
    return providerError("offline", `sync.drive.${operation}.offline`, "Verkkoyhteyttä ei ole.");
  }
  return providerError(
    "transient-failure",
    `sync.drive.${operation}.${timedOut ? "timeout" : "network-failed"}`,
    "Google Drive -pyyntö epäonnistui. Yritä uudelleen.",
  );
}

function retryDelayMs(error: SyncProviderError, retryIndex: number): number | null {
  if (error.code !== "transient-failure" && error.code !== "rate-limited") return null;
  if (error.retryAfterSeconds !== undefined) {
    const serverDelayMs = error.retryAfterSeconds * 1_000;
    return serverDelayMs <= MAX_AUTOMATIC_RETRY_DELAY_MS ? serverDelayMs : null;
  }
  const exponentialDelay = INITIAL_RETRY_DELAY_MS * 2 ** retryIndex;
  return Math.min(
    MAX_AUTOMATIC_RETRY_DELAY_MS,
    exponentialDelay + Math.floor(Math.random() * RETRY_JITTER_MS),
  );
}

async function withRetry<T>(
  run: () => Promise<SyncProviderResult<T>>,
  retryIndex = 0,
): Promise<SyncProviderResult<T>> {
  const result = await run();
  if (result.ok || retryIndex >= MAX_AUTOMATIC_RETRIES) return result;
  const delayMs = retryDelayMs(result.error, retryIndex);
  if (delayMs === null) return result;
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  return withRetry(run, retryIndex + 1);
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  operation: DriveApiOperation,
): Promise<SyncProviderResult<Response>> {
  if (typeof AbortController === "undefined" || typeof fetch !== "function") {
    return failure(
      providerError(
        "unsupported",
        `sync.drive.${operation}.fetch-unsupported`,
        "Selain ei tue Google Drive -synkronointia.",
      ),
    );
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { ok: true, value: response };
  } catch {
    return failure(networkError(operation, timedOut));
  } finally {
    clearTimeout(timer);
  }
}

function isTrustedDriveContentUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443") &&
      (host === "googleapis.com" ||
        host.endsWith(".googleapis.com") ||
        host === "drive.google.com" ||
        host === "drive.usercontent.google.com" ||
        host === "googleusercontent.com" ||
        host.endsWith(".googleusercontent.com"))
    );
  } catch {
    return false;
  }
}

async function fetchCiphertextWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<SyncProviderResult<Uint8Array>> {
  if (typeof AbortController === "undefined" || typeof fetch !== "function") {
    return failure(
      providerError(
        "unsupported",
        "sync.drive.download.fetch-unsupported",
        "Selain ei tue Google Drive -synkronointia.",
      ),
    );
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (!response.ok) return failure(await errorFromResponse(response, "download"));
    if (!isTrustedDriveContentUrl(response.url)) {
      try {
        await response.body?.cancel();
      } catch {
        // The content origin is rejected without exposing its URL.
      }
      return failure(
        providerError(
          "forbidden",
          "sync.drive.download.untrusted-content-origin",
          "Google Drive palautti synkronointitiedoston tuntemattomasta lähteestä.",
        ),
      );
    }
    const contentLengthHeader = response.headers.get("Content-Length");
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
        try {
          await response.body?.cancel();
        } catch {
          // Malformed content metadata is rejected without buffering the body.
        }
        return failure(
          providerError(
            "transient-failure",
            "sync.drive.download.invalid-content-length",
            "Google Drive palautti virheellisen synkronointitiedoston.",
          ),
        );
      }
      if (contentLength > MAX_SYNC_BATCH_BYTES) {
        try {
          await response.body?.cancel();
        } catch {
          // Oversized content is rejected and never buffered.
        }
        return failure(
          providerError(
            "invalid-input",
            "sync.drive.download.too-large",
            "Google Driven synkronointierä ylittää sallitun kokorajan.",
          ),
        );
      }
    }

    const reader = response.body?.getReader();
    if (reader === undefined) {
      return failure(
        providerError(
          "transient-failure",
          "sync.drive.download.missing-body",
          "Google Drive ei palauttanut synkronointitiedoston sisältöä.",
        ),
      );
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    let done = false;
    try {
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) {
          done = true;
          continue;
        }
        totalBytes += chunk.value.byteLength;
        if (totalBytes > MAX_SYNC_BATCH_BYTES) {
          await reader.cancel();
          return failure(
            providerError(
              "invalid-input",
              "sync.drive.download.too-large",
              "Google Driven synkronointierä ylittää sallitun kokorajan.",
            ),
          );
        }
        chunks.push(chunk.value);
      }
    } finally {
      reader.releaseLock();
    }
    if (totalBytes === 0) {
      return failure(
        providerError(
          "invalid-input",
          "sync.drive.download.empty-content",
          "Google Driven synkronointierä on tyhjä.",
        ),
      );
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: bytes };
  } catch {
    return failure(networkError("download", timedOut));
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function makeLookupQuery(idempotencyDigest: string): string {
  return `appProperties has { key='${APP_PROPERTY_IDEMPOTENCY}' and value='${idempotencyDigest}' } and trashed = false`;
}

function makeBatchListQuery(createdTime: string | null): string {
  const terms = [
    "trashed = false",
    `appProperties has { key='${APP_PROPERTY_TYPE}' and value='${BATCH_TYPE}' }`,
  ];
  if (createdTime !== null) terms.push(`createdTime >= '${createdTime}'`);
  return terms.join(" and ");
}

async function listDrivePage(
  accessToken: string,
  createdTime: string | null,
  pageToken: string | null,
): Promise<SyncProviderResult<DriveListPage>> {
  const url = new URL(DRIVE_FILES_URL);
  url.searchParams.set("spaces", DRIVE_APP_DATA_SPACE);
  url.searchParams.set("q", makeBatchListQuery(createdTime));
  url.searchParams.set("pageSize", String(DRIVE_LIST_PAGE_SIZE));
  url.searchParams.set("orderBy", "createdTime");
  url.searchParams.set(
    "fields",
    "nextPageToken,incompleteSearch,files(id,version,createdTime,mimeType,appProperties)",
  );
  if (pageToken !== null) url.searchParams.set("pageToken", pageToken);

  const responseResult = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    LOOKUP_TIMEOUT_MS,
    "list",
  );
  if (!responseResult.ok) return responseResult;
  const response = responseResult.value;
  if (!response.ok) return failure(await errorFromResponse(response, "list"));
  const body = await readJson(response);
  if (!isRecord(body) || !Array.isArray(body.files)) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.list.invalid-response",
        "Google Drive palautti virheellisen synkronointiluettelon.",
      ),
    );
  }
  if (body.incompleteSearch !== undefined && typeof body.incompleteSearch !== "boolean") {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.list.invalid-incomplete-search",
        "Google Drive palautti virheellisen synkronointiluettelon.",
      ),
    );
  }
  if (body.incompleteSearch === true) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.list.incomplete-search",
        "Google Drive ei saanut synkronointiluetteloa kokonaan valmiiksi. Yritä uudelleen.",
      ),
    );
  }
  const nextPageToken = body.nextPageToken;
  if (
    nextPageToken !== undefined &&
    (typeof nextPageToken !== "string" || nextPageToken.length === 0)
  ) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.list.invalid-page-token",
        "Google Drive palautti virheellisen synkronointiluettelon.",
      ),
    );
  }
  return {
    ok: true,
    value: {
      files: body.files,
      nextPageToken: typeof nextPageToken === "string" ? nextPageToken : null,
      incompleteSearch: false,
    },
  };
}

async function listBatchChanges(
  accessToken: string,
  input: SyncProviderListChanges,
): Promise<SyncProviderResult<SyncProviderChangePage>> {
  if (
    !isRecord(input) ||
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 500 ||
    (input.cursor !== null && typeof input.cursor !== "string")
  ) {
    return failure(
      providerError(
        "invalid-input",
        "sync.drive.list.invalid-input",
        "Synkronointiluettelon pyyntö ei kelpaa.",
      ),
    );
  }
  const cursor = decodeDriveCursor(input.cursor);
  if (cursor === null) {
    return failure(
      providerError(
        "invalid-input",
        "sync.drive.list.invalid-cursor",
        "Synkronointiluettelon jatkokohta ei kelpaa. Aloita synkronointi uudelleen.",
      ),
    );
  }

  const candidates: DriveSyncBatchFile[] = [];
  const seenDuringCall = new Set(cursor.seenObjectIdsAtTime);
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  let pagesRemaining = true;
  while (pagesRemaining && candidates.length <= input.limit) {
    const pageResult = await listDrivePage(accessToken, cursor.createdTime, pageToken);
    if (!pageResult.ok) return pageResult;
    const page = pageResult.value;
    for (const file of page.files) {
      if (!isRecord(file)) {
        return failure(
          providerError(
            "transient-failure",
            "sync.drive.list.invalid-file",
            "Google Drive palautti virheellisen synkronointitiedoston.",
          ),
        );
      }
      const properties = parseAppProperties(file.appProperties);
      if (properties === null) {
        return failure(
          providerError(
            "transient-failure",
            "sync.drive.list.missing-app-properties",
            "Google Drive palautti virheellisen synkronointitiedoston metatiedon.",
          ),
        );
      }
      if (properties[APP_PROPERTY_TYPE] !== BATCH_TYPE) continue;
      if (properties[APP_PROPERTY_VERSION] !== BATCH_VERSION) {
        return failure(
          providerError(
            "unsupported",
            "sync.drive.list.unsupported-version",
            "Google Drivessa on synkronointierä, jonka versiota tämä sovellus ei tue.",
          ),
        );
      }
      const entry = parseDriveSyncBatchFile(file);
      if (entry === null) {
        return failure(
          providerError(
            "transient-failure",
            "sync.drive.list.invalid-metadata",
            "Google Drive palautti virheellisen synkronointitiedoston metatiedon.",
          ),
        );
      }
      if (cursor.createdTime !== null) {
        const timeComparison = Date.parse(entry.createdTime) - Date.parse(cursor.createdTime);
        if (timeComparison < 0) continue;
        if (timeComparison === 0 && seenDuringCall.has(entry.object.objectId)) continue;
      }
      if (seenDuringCall.has(entry.object.objectId)) continue;
      seenDuringCall.add(entry.object.objectId);
      candidates.push(entry);
      if (candidates.length > input.limit) break;
    }
    if (candidates.length > input.limit) break;
    const nextPageToken = page.nextPageToken;
    if (nextPageToken !== null && seenPageTokens.has(nextPageToken)) {
      return failure(
        providerError(
          "transient-failure",
          "sync.drive.list.repeated-page-token",
          "Google Drive palautti virheellisen sivutusviitteen. Yritä uudelleen.",
        ),
      );
    }
    if (nextPageToken !== null) seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
    pagesRemaining = pageToken !== null;
  }

  candidates.sort((first, second) => {
    const timeDifference = Date.parse(first.createdTime) - Date.parse(second.createdTime);
    return timeDifference === 0
      ? first.object.objectId.localeCompare(second.object.objectId)
      : timeDifference;
  });
  const selected = candidates.slice(0, input.limit);
  const hasMore = candidates.length > input.limit;
  let boundaryTime = cursor.createdTime;
  const boundaryIds = new Set(cursor.seenObjectIdsAtTime);
  for (const entry of selected) {
    if (boundaryTime === null || Date.parse(entry.createdTime) > Date.parse(boundaryTime)) {
      boundaryTime = entry.createdTime;
      boundaryIds.clear();
    }
    if (entry.createdTime === boundaryTime) boundaryIds.add(entry.object.objectId);
  }
  if (boundaryIds.size > MAX_CURSOR_BOUNDARY_IDS) {
    return failure(
      providerError(
        "quota-exceeded",
        "sync.drive.list.cursor-boundary-too-large",
        "Samanaikaisia synkronointieriä on liikaa yhdessä sivussa. Yritä uudelleen.",
      ),
    );
  }
  const nextCursor = encodeDriveCursor({
    version: 1,
    createdTime: boundaryTime,
    seenObjectIdsAtTime: [...boundaryIds],
  });
  if (nextCursor === null) {
    return failure(
      providerError(
        "quota-exceeded",
        "sync.drive.list.cursor-too-large",
        "Synkronointiluettelon jatkokohta kasvoi liian suureksi.",
      ),
    );
  }
  return {
    ok: true,
    value: {
      objects: selected.map((entry) => entry.object),
      cursor: nextCursor,
      hasMore,
    },
  };
}

async function getBatchMetadata(
  accessToken: string,
  object: SyncProviderObjectRef,
): Promise<SyncProviderResult<DriveSyncBatchFile>> {
  const url = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(object.objectId)}`);
  url.searchParams.set("fields", "id,version,createdTime,mimeType,appProperties");
  const responseResult = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    LOOKUP_TIMEOUT_MS,
    "download",
  );
  if (!responseResult.ok) return responseResult;
  const response = responseResult.value;
  if (!response.ok) return failure(await errorFromResponse(response, "download"));
  const body = await readJson(response);
  if (!isRecord(body)) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.download.invalid-metadata-response",
        "Google Drive palautti virheellisen tiedostoviitteen.",
      ),
    );
  }
  const properties = parseAppProperties(body.appProperties);
  if (properties === null || properties[APP_PROPERTY_TYPE] !== BATCH_TYPE) {
    return failure(
      providerError(
        "not-found",
        "sync.drive.download.not-sync-batch",
        "Google Driven synkronointitiedostoa ei löytynyt.",
      ),
    );
  }
  if (properties[APP_PROPERTY_VERSION] !== BATCH_VERSION) {
    return failure(
      providerError(
        "unsupported",
        "sync.drive.download.unsupported-version",
        "Google Driven synkronointierän versiota ei tueta tässä sovellusversiossa.",
      ),
    );
  }
  const entry = parseDriveSyncBatchFile(body);
  if (entry === null || entry.object.objectId !== object.objectId) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.download.invalid-metadata",
        "Google Drive palautti virheellisen tiedostoviitteen.",
      ),
    );
  }
  return { ok: true, value: entry };
}

async function downloadBatchWithToken(
  accessToken: string,
  object: SyncProviderObjectRef,
): Promise<SyncProviderResult<SyncProviderDownload>> {
  const validRef = parseDriveObjectRef({ id: object.objectId, version: object.revision });
  if (validRef === null) {
    return failure(
      providerError(
        "invalid-input",
        "sync.drive.download.invalid-reference",
        "Synkronointitiedoston viite ei kelpaa.",
      ),
    );
  }
  const before = await getBatchMetadata(accessToken, validRef);
  if (!before.ok) return before;
  if (before.value.object.revision !== validRef.revision) {
    return failure(
      providerError(
        "conflict",
        "sync.drive.download.revision-changed",
        "Synkronointitiedoston versio on muuttunut. Päivitä synkronointiluettelo.",
      ),
    );
  }

  const mediaUrl = new URL(`${DRIVE_FILES_URL}/${encodeURIComponent(validRef.objectId)}`);
  mediaUrl.searchParams.set("alt", "media");
  const content = await fetchCiphertextWithTimeout(mediaUrl, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    credentials: "omit",
    redirect: "follow",
    referrerPolicy: "no-referrer",
  });
  if (!content.ok) return content;

  let payloadDigest: string;
  try {
    payloadDigest = await digestHex(content.value);
  } catch {
    content.value.fill(0);
    return failure(
      providerError(
        "unsupported",
        "sync.drive.download.webcrypto-unavailable",
        "Selain ei tue turvallista synkronointitiedoston tarkistusta.",
      ),
    );
  }
  if (payloadDigest !== before.value.payloadDigest) {
    content.value.fill(0);
    return failure(
      providerError(
        "conflict",
        "sync.drive.download.content-mismatch",
        "Google Driven synkronointitiedosto ei vastaa sen metatietoa.",
      ),
    );
  }

  const after = await getBatchMetadata(accessToken, validRef);
  if (!after.ok) {
    content.value.fill(0);
    return after;
  }
  if (
    after.value.object.objectId !== validRef.objectId ||
    after.value.object.revision !== validRef.revision ||
    after.value.payloadDigest !== before.value.payloadDigest
  ) {
    content.value.fill(0);
    return failure(
      providerError(
        "conflict",
        "sync.drive.download.concurrent-modification",
        "Synkronointitiedosto muuttui latauksen aikana. Hae se uudelleen.",
      ),
    );
  }
  return {
    ok: true,
    value: {
      object: { objectId: validRef.objectId, revision: validRef.revision },
      ciphertext: content.value,
    },
  };
}

async function findExistingUpload(
  accessToken: string,
  digests: UploadDigests,
): Promise<SyncProviderResult<SyncProviderObjectRef | null>> {
  const url = new URL(DRIVE_FILES_URL);
  url.searchParams.set("spaces", DRIVE_APP_DATA_SPACE);
  url.searchParams.set("q", makeLookupQuery(digests.idempotency));
  url.searchParams.set("pageSize", "2");
  url.searchParams.set("fields", "files(id,version,appProperties)");
  const responseResult = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    LOOKUP_TIMEOUT_MS,
    "lookup",
  );
  if (!responseResult.ok) return responseResult;
  const response = responseResult.value;
  if (!response.ok) return failure(await errorFromResponse(response, "lookup"));
  const body = await readJson(response);
  if (!isRecord(body) || !Array.isArray(body.files)) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.lookup.invalid-response",
        "Google Drive palautti virheellisen vastauksen.",
      ),
    );
  }
  const files = body.files as unknown[];
  if (files.length === 0) return { ok: true, value: null };
  if (files.length > 1) {
    return failure(
      providerError(
        "conflict",
        "sync.drive.lookup.duplicate-idempotency-key",
        "Synkronointierällä on useampi samaan tunnisteeseen liittyvä Drive-tiedosto.",
      ),
    );
  }
  const file = files[0];
  if (!isRecord(file)) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.lookup.invalid-file",
        "Google Drive palautti virheellisen vastauksen.",
      ),
    );
  }
  const properties = parseAppProperties(file.appProperties);
  const reference = parseDriveObjectRef(file);
  if (properties === null || reference === null) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.lookup.invalid-file-metadata",
        "Google Drive palautti virheellisen tiedostoviitteen.",
      ),
    );
  }
  if (
    properties[APP_PROPERTY_TYPE] !== BATCH_TYPE ||
    properties[APP_PROPERTY_VERSION] !== BATCH_VERSION
  ) {
    return failure(
      providerError(
        "unsupported",
        "sync.drive.lookup.unsupported-file-format",
        "Google Drivessa on synkronointitiedosto, jonka muotoa tämä sovellusversio ei tue.",
      ),
    );
  }
  if (
    !hasSupportedBatchProperties(properties) ||
    properties[APP_PROPERTY_IDEMPOTENCY] !== digests.idempotency
  ) {
    return failure(
      providerError(
        "unsupported",
        "sync.drive.lookup.unsupported-file-format",
        "Google Drivessa on synkronointitiedosto, jonka muotoa tämä sovellusversio ei tue.",
      ),
    );
  }
  if (properties[APP_PROPERTY_PAYLOAD] !== digests.payload) {
    return failure(
      providerError(
        "conflict",
        "sync.drive.upload.idempotency-conflict",
        "Sama synkronointitunniste on jo käytössä eri sisällölle.",
      ),
    );
  }
  return { ok: true, value: reference };
}

function makeUploadMetadata(digests: UploadDigests): Record<string, unknown> {
  return {
    name: "lifeos-sync-batch-v1.bin",
    mimeType: BATCH_MIME_TYPE,
    parents: [DRIVE_APP_DATA_SPACE],
    appProperties: {
      [APP_PROPERTY_TYPE]: BATCH_TYPE,
      [APP_PROPERTY_VERSION]: BATCH_VERSION,
      [APP_PROPERTY_IDEMPOTENCY]: digests.idempotency,
      [APP_PROPERTY_PAYLOAD]: digests.payload,
    },
  };
}

function isTrustedUploadLocation(value: string): boolean {
  try {
    const location = new URL(value);
    const allowedOrigins = new Set([
      "https://www.googleapis.com",
      "https://content.googleapis.com",
    ]);
    return (
      allowedOrigins.has(location.origin) &&
      location.pathname === "/upload/drive/v3/files" &&
      location.search.length > 1
    );
  } catch {
    return false;
  }
}

async function createResumableSession(
  accessToken: string,
  metadata: Record<string, unknown>,
  ciphertext: Uint8Array,
): Promise<SyncProviderResult<string>> {
  const initiationUrl = new URL(DRIVE_UPLOAD_URL);
  initiationUrl.searchParams.set("uploadType", "resumable");
  initiationUrl.searchParams.set("fields", "id,version,appProperties");
  const initiationResult = await fetchWithTimeout(
    initiationUrl,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": BATCH_MIME_TYPE,
        "X-Upload-Content-Length": String(ciphertext.byteLength),
      },
      body: JSON.stringify(metadata),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    REQUEST_TIMEOUT_MS,
    "create",
  );
  if (!initiationResult.ok) return initiationResult;
  const initiationResponse = initiationResult.value;
  if (!initiationResponse.ok) {
    return failure(await errorFromResponse(initiationResponse, "create"));
  }
  const location = initiationResponse.headers.get("Location");
  if (location === null || !isTrustedUploadLocation(location)) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.create.invalid-upload-location",
        "Google Drive ei palauttanut turvallista upload-yhteyttä.",
      ),
    );
  }
  return { ok: true, value: location };
}

async function uploadCiphertext(
  uploadUrl: string,
  ciphertext: Uint8Array,
): Promise<SyncProviderResult<SyncProviderObjectRef>> {
  const body = new Blob([copyToArrayBuffer(ciphertext)], { type: BATCH_MIME_TYPE });
  const responseResult = await fetchWithTimeout(
    uploadUrl,
    {
      method: "PUT",
      headers: { "Content-Type": BATCH_MIME_TYPE },
      body,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
    },
    REQUEST_TIMEOUT_MS,
    "upload",
  );
  if (!responseResult.ok) return responseResult;
  const response = responseResult.value;
  if (!response.ok) return failure(await errorFromResponse(response, "upload"));
  const bodyJson = await readJson(response);
  const reference = parseDriveObjectRef(bodyJson);
  if (reference === null) {
    return failure(
      providerError(
        "transient-failure",
        "sync.drive.upload.invalid-response",
        "Google Drive ei palauttanut tallennetun tiedoston viitettä.",
      ),
    );
  }
  return { ok: true, value: reference };
}

async function uploadWithToken(
  accessToken: string,
  digests: UploadDigests,
  ciphertext: Uint8Array,
): Promise<SyncProviderResult<SyncProviderObjectRef>> {
  const existing = await findExistingUpload(accessToken, digests);
  if (!existing.ok) return existing;
  if (existing.value !== null) return { ok: true, value: existing.value };

  const uploadSession = await createResumableSession(
    accessToken,
    makeUploadMetadata(digests),
    ciphertext,
  );
  if (!uploadSession.ok) return uploadSession;
  return uploadCiphertext(uploadSession.value, ciphertext);
}

function mapOAuthError(error: {
  readonly code: string;
  readonly diagnosticCode: string;
}): SyncProviderError {
  if (error.code === "unsupported") {
    return providerError(
      "unsupported",
      "sync.drive.oauth.unsupported",
      "Google Drive -synkronointi ei ole käytössä tässä selaimessa.",
    );
  }
  if (error.code === "transient-failure") {
    return providerError(
      "transient-failure",
      "sync.drive.oauth.transient-failure",
      "Google Drive -valtuutusta ei voitu käyttää. Yritä uudelleen.",
    );
  }
  return providerError(
    "unauthorized",
    error.diagnosticCode === "oauth.token.expired"
      ? "sync.drive.oauth.expired"
      : "sync.drive.oauth.session-missing",
    "Google Drive -valtuutus on vanhentunut. Kirjaudu uudelleen.",
  );
}

async function withCurrentDriveAccess<T>(
  options: GoogleDriveSyncProviderOptions,
  operation: "list" | "download",
  run: (accessToken: string) => Promise<SyncProviderResult<T>>,
): Promise<SyncProviderResult<T>> {
  let session: OAuthSession | null;
  try {
    session = options.getSession();
  } catch {
    session = null;
  }
  if (session === null) {
    return failure(
      providerError(
        "unauthorized",
        "sync.drive.oauth.session-missing",
        "Yhdistä Google Drive ennen synkronointia.",
      ),
    );
  }
  try {
    const authorized = await options.oauth.withAccessToken(session, async (accessToken) => ({
      ok: true as const,
      value: await withRetry(() => run(accessToken)),
    }));
    return authorized.ok ? authorized.value : failure(mapOAuthError(authorized.error));
  } catch {
    return failure(
      providerError(
        "transient-failure",
        `sync.drive.${operation}.unexpected-failure`,
        "Google Drive -synkronointipyyntö epäonnistui. Yritä uudelleen.",
      ),
    );
  }
}

export function createGoogleDriveSyncProvider(
  options: GoogleDriveSyncProviderOptions,
): SyncProvider {
  return {
    providerId: "google-drive-appdata",
    displayName: "Google Drive",

    async upload(input: SyncProviderUpload): Promise<SyncProviderResult<SyncProviderObjectRef>> {
      if (
        !isRecord(input) ||
        typeof input.idempotencyKey !== "string" ||
        input.idempotencyKey.length === 0 ||
        input.idempotencyKey.length > 256 ||
        !(input.ciphertext instanceof Uint8Array) ||
        input.ciphertext.length === 0
      ) {
        return invalidUpload();
      }
      if (input.ciphertext.byteLength > MAX_SYNC_BATCH_BYTES) {
        return failure(
          providerError(
            "invalid-input",
            "sync.drive.upload.too-large",
            "Synkronointierä ylittää sallitun 16 MiB:n kokorajan.",
          ),
        );
      }
      const ciphertext = new Uint8Array(input.ciphertext);
      const digests = await computeDigests({ ...input, ciphertext });
      if (digests === null) {
        return failure(
          providerError(
            "unsupported",
            "sync.drive.upload.webcrypto-unavailable",
            "Selain ei tue turvallista Google Drive -synkronointia.",
          ),
        );
      }

      let session: OAuthSession | null;
      try {
        session = options.getSession();
      } catch {
        session = null;
      }
      if (session === null) {
        return failure(
          providerError(
            "unauthorized",
            "sync.drive.oauth.session-missing",
            "Yhdistä Google Drive ennen synkronointia.",
          ),
        );
      }

      const flightKey = `${session.sessionId}:${digests.idempotency}`;
      const currentFlight = inFlightUploads.get(flightKey);
      if (currentFlight !== undefined) {
        if (currentFlight.payloadDigest !== digests.payload) {
          return failure(
            providerError(
              "conflict",
              "sync.drive.upload.idempotency-conflict",
              "Sama synkronointitunniste on jo käytössä eri sisällölle.",
            ),
          );
        }
        return currentFlight.promise;
      }

      const promise = (async (): Promise<SyncProviderResult<SyncProviderObjectRef>> => {
        try {
          const authorized = await options.oauth.withAccessToken(session, async (accessToken) => ({
            ok: true as const,
            value: await withRetry(() => uploadWithToken(accessToken, digests, ciphertext)),
          }));
          return authorized.ok ? authorized.value : failure(mapOAuthError(authorized.error));
        } catch {
          return failure(
            providerError(
              "transient-failure",
              "sync.drive.upload.unexpected-failure",
              "Synkronointierän lähetys epäonnistui. Yritä uudelleen.",
            ),
          );
        }
      })();
      inFlightUploads.set(flightKey, { payloadDigest: digests.payload, promise });
      try {
        return await promise;
      } finally {
        if (inFlightUploads.get(flightKey)?.promise === promise) inFlightUploads.delete(flightKey);
      }
    },

    listChanges(
      input: SyncProviderListChanges,
    ): Promise<SyncProviderResult<SyncProviderChangePage>> {
      return withCurrentDriveAccess(options, "list", (accessToken) =>
        listBatchChanges(accessToken, input),
      );
    },

    download(object: SyncProviderObjectRef): Promise<SyncProviderResult<SyncProviderDownload>> {
      if (!isRecord(object)) {
        return Promise.resolve(
          failure(
            providerError(
              "invalid-input",
              "sync.drive.download.invalid-reference",
              "Synkronointitiedoston viite ei kelpaa.",
            ),
          ),
        );
      }
      return withCurrentDriveAccess(options, "download", (accessToken) =>
        downloadBatchWithToken(accessToken, object),
      );
    },
  };
}
