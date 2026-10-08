// T030: worker-client. Ainoa pääsäikeen reitti db-workeriin.
// Pääsäikeen selainrajat (Worker/MessageEvent/ajastimet) on eristetty
// tämän moduulin sisään: data-eristysskanni sallii ne vain tässä tiedostossa
// (vrt. T027-tarkistus). Muu data-koodi pysyy alustariippumattomana.
// DOM+WebWorker-lib tsconfigissa palvelee vain tätä + sqliteWorkeria.
// - Worker luodaan laiskasti ensimmäisellä kutsulla (ei hidasta app-starttia).
// - Jokainen request saa requestId:n; vastaukset täsmäytetään Mapilla.
// - Timeout katkaisee jumiutuneen workerin odotuksen hallittuun
//   transient-failureen (ei ikuista lupausta UI:lle).
// - Capability failure (ei Worker-tukea / postMessage rikki) -> selkeä
//   storage-unavailable-virhe diagnostiikalle, ei poikkeusta ulos (T030).

import type { EntityId } from "@lifeos/domain";
import { type DataResult } from "./errors.ts";
import type {
  DbBackend,
  DbFailureResponse,
  DbRequest,
  DbRequestNoId,
  DbResponse,
} from "./sqliteProtocol.ts";
import { isDbResponse } from "./sqliteProtocol.ts";

export interface DatabaseHealth {
  readonly backend: DbBackend;
  readonly persisted: boolean;
  readonly open: boolean;
  readonly integrity: string;
  readonly schemaVersion: number;
  /** T038: poolin diagnostiikka (null kun ei pool-backend). */
  readonly poolCapacity?: number | null;
  readonly poolFileCount?: number | null;
  readonly poolHasDb?: boolean;
}

type PendingEntry = {
  readonly resolve: (response: DbResponse) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT_MS = 15_000;
const RESTORE_REQUEST_TIMEOUT_MS = 300_000;

let worker: Worker | null = null;
let workerFailed = false;
let workerFailedCode: DbFailureResponse["code"] = "storage-unavailable";
let workerFailedDiagnostic = "db.worker.unsupported";
let sequence = 0;
const pending = new Map<string, PendingEntry>();

export interface WorkerFactory {
  create(): Worker;
}

let factory: WorkerFactory | null = null;

/** App rekisteröi Vite-?worker-tehtaan käynnistyksessä (database.ts). */
export function configureDatabaseWorker(next: WorkerFactory): void {
  factory = next;
  workerFailed = false;
}

/** Testeille: nollaa worker-tila. Nollaa myös tehdas jotta
 * capability-failure (ei tehdasta) on testattavissa eristyksissä. */
export function resetDatabaseWorkerForTests(): void {
  if (worker !== null) {
    try {
      worker.terminate();
    } catch {
      // Best-effort: vanha worker ei saa jäädä roikkumaan testeissä.
    }
  }
  worker = null;
  factory = null;
  workerFailed = false;
  workerFailedCode = "storage-unavailable";
  workerFailedDiagnostic = "db.worker.unsupported";
  for (const [id, entry] of pending) {
    pending.delete(id);
    clearTimeout(entry.timer);
  }
  sequence = 0;
}

function nextRequestId(): EntityId {
  sequence += 1;
  return `dbreq-${String(sequence).padStart(6, "0")}`;
}

function ensureWorker(): Worker | null {
  if (worker !== null || workerFailed || factory === null) {
    if (factory === null && !workerFailed) {
      workerFailed = true;
      workerFailedCode = "storage-unavailable";
      workerFailedDiagnostic = "db.worker.no-factory";
    }
    return worker;
  }
  try {
    const created = factory.create();
    created.onmessage = (event: MessageEvent) => {
      if (!isDbResponse(event.data)) {
        return;
      }
      const entry = pending.get(event.data.requestId);
      if (entry === undefined) {
        return;
      }
      pending.delete(event.data.requestId);
      clearTimeout(entry.timer);
      entry.resolve(event.data);
    };
    created.onerror = () => {
      workerFailed = true;
      workerFailedCode = "transient-failure";
      workerFailedDiagnostic = "db.worker.error";
      for (const [id, entry] of pending) {
        pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve({
          requestId: id,
          ok: false,
          code: workerFailedCode,
          diagnosticCode: workerFailedDiagnostic,
        });
      }
    };
    worker = created;
    return worker;
  } catch {
    workerFailed = true;
    workerFailedCode = "storage-unavailable";
    workerFailedDiagnostic = "db.worker.create-failed";
    return null;
  }
}

function workerFailure<T>(): DataResult<T> {
  return {
    ok: false,
    error: {
      code:
        workerFailedCode === "storage-unavailable" ? "storage-unavailable" : "transient-failure",
      userMessage:
        workerFailedCode === "storage-unavailable"
          ? "Paikallinen tietokanta ei ole käytössä tässä selaimessa."
          : "Tietokantaoperaatio epäonnistui. Yritä uudelleen.",
      diagnosticCode: workerFailedDiagnostic,
    },
  };
}

export function sendDbRequest(request: DbRequestNoId): Promise<DbResponse> {
  const active = ensureWorker();
  const timeoutMs = request.kind === "restore" ? RESTORE_REQUEST_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
  const requestId = nextRequestId();
  if (active === null) {
    const code = workerFailedCode;
    const diagnosticCode = workerFailedDiagnostic;
    return Promise.resolve({ requestId, ok: false as const, code, diagnosticCode });
  }
  const full = { ...request, requestId } as DbRequest;
  return new Promise<DbResponse>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({
        requestId,
        ok: false as const,
        code: "transient-failure" as const,
        diagnosticCode: "db.request.timeout",
      });
    }, timeoutMs);
    pending.set(requestId, { resolve, timer });
    try {
      active.postMessage(full);
    } catch {
      pending.delete(requestId);
      clearTimeout(timer);
      resolve({
        requestId,
        ok: false as const,
        code: "transient-failure" as const,
        diagnosticCode: "db.request.post-failed",
      });
    }
  });
}

export function toDataResult<T>(
  response: DbResponse,
  map: (rows: readonly unknown[]) => T,
): DataResult<T> {
  if (!response.ok) {
    const code =
      response.code === "invalid-input"
        ? "invalid-input"
        : response.code === "quota-exceeded"
          ? "quota-exceeded"
          : response.code === "storage-unavailable"
            ? "storage-unavailable"
            : "transient-failure";
    return {
      ok: false,
      error: {
        code,
        userMessage:
          code === "storage-unavailable"
            ? response.diagnosticCode === "db.open.opfs-locked"
              ? "Paikallinen tietokanta on käytössä toisessa välilehdessä. Sulje toinen välilehti ja yritä uudelleen."
              : "Paikallinen tietokanta ei ole käytössä tässä selaimessa."
            : code === "quota-exceeded"
              ? "Tallennustila loppui. Vapauta tilaa tai tee varmuuskopio."
              : code === "invalid-input"
                ? "Tietokantapyyntö oli virheellinen."
                : "Tietokantaoperaatio epäonnistui. Yritä uudelleen.",
        diagnosticCode: response.diagnosticCode,
      },
    };
  }
  return { ok: true, value: map(response.rows) };
}

export function describeWorkerFailure(): {
  readonly code: string;
  readonly diagnosticCode: string;
} {
  return { code: workerFailedCode, diagnosticCode: workerFailedDiagnostic };
}

export function peekWorkerFailureForTests(): DataResult<never> {
  return workerFailure<never>();
}
