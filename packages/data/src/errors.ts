// T027: data-kerroksen virhemalli. SQLite/OPFS/Drive-virheet käännetään
// näiksi T030+/B15:ssä — domain/UI eivät käsittele alustavirheitä suoraan.
// Koodit ovat koneellisia; userMessage on suomenkielinen, ei-tekninen, ilman
// PII:tä/terveysdataa (vrt. T025 CapabilityError).

export type DataErrorCode =
  | "not-found"
  | "already-exists"
  | "invalid-input"
  | "storage-unavailable"
  | "quota-exceeded"
  | "transient-failure"
  | "data-corrupted";

export interface DataError {
  readonly code: DataErrorCode;
  readonly userMessage: string;
  /** Koneellinen diagnostiikkakoodi (operaatio + kohde, ei sisältöä). */
  readonly diagnosticCode: string;
}

export type DataResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DataError };

export function notFound(entityType: string): DataError {
  return {
    code: "not-found",
    userMessage: "Kohdetta ei löytynyt. Se on voitu poistaa toisessa näkymässä.",
    diagnosticCode: `data.${entityType}.not-found`,
  };
}

export function invalidInput(diagnosticCode: string, userMessage: string): DataError {
  return { code: "invalid-input", userMessage, diagnosticCode };
}

export function alreadyExists(entityType: string): DataError {
  return {
    code: "already-exists",
    userMessage: "Kohde on jo olemassa.",
    diagnosticCode: `data.${entityType}.already-exists`,
  };
}
