// T037: turvallinen virhekerros — puhdas moduuli (ei IO:ta, ei Reactia,
// ei selainta). Keskittää kaikki virhekäännökset yhteen paikkaan:
// - DataError (T027) / CapabilityError (T025) / DomainError (T026) /
//   ConfigError (T029) -> AppError (title/body/action/diagnosticCode).
// - fromUnknown/fromBootstrapError redaktoivat tuntemattomat (ei koskaan
//   raakaa error.message/stackia käyttäjälle eikä lokeihin).
// - Redaktiorajapinta (isSafeDiagnosticCode/containsSensitiveData/
//   sanitizeForDisplay) varmistaa §48/§41/§42: ei terveysdataa, PII:tä,
//   tokeneita tai avaimia diagnostiikkaan. Kääntäjät eivät koskaan
//   interpoloi entiteettikenttiä viesteihin — vain staattinen fi-copy +
//   koneellinen koodi.
//
// SKILL.md-copy-sääntö: ei pahoitteluja, ei epämääräisyyttä; kerro mitä
// tapahtui ja miten korjaat, käyttöliittymän äänellä.
//
// HUOM (ESLint-poikkeus): tämä tiedosto on AINOA joka saa importoida raa'at
// virhetyypit ja lukea error.messagea — se on käännösten määritelmäpaikka
// (T037-raja files-listassa). Redaktio tapahtuu tässä, ei kutsujissa.

import type { CapabilityError } from "@lifeos/capabilities";
import type { ConfigError } from "@lifeos/config";
import type { DataError } from "@lifeos/data";
import type { DomainError } from "@lifeos/domain";

export type AppErrorLevel = "error" | "warning";

export interface AppError {
  readonly title: string;
  readonly body: string;
  /** Napin teksti; null = ei toimintoa. Renderöidään vain kun onRetry annettu. */
  readonly actionLabel: string | null;
  /** Koneellinen koodi tukeen (aina isSafeDiagnosticCode). Ei PII:tä. */
  readonly diagnosticCode: string;
  readonly level: AppErrorLevel;
}

// ---------------------------------------------------------------------------
// Redaktio
// ---------------------------------------------------------------------------

const SAFE_DIAGNOSTIC_RE = /^[a-z][a-z0-9._-]{0,127}$/;

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
  /bearer\s+[A-Za-z0-9\-._~+/=]{8,}/i,
  /(token|secret|password|passwd|api[_-]?key)\s*[:=]\s*\S+/i,
  /BEGIN .*PRIVATE KEY/,
  /[A-Za-z0-9+/=]{48,}/,
];

/** Konekoodi on turvallinen: pieni, piste/viiva/muotoinen, ei PII:tä. */
export function isSafeDiagnosticCode(code: string): boolean {
  return SAFE_DIAGNOSTIC_RE.test(code) && !containsSensitiveData(code);
}

/** Tunnistaa sähköpostit, bearer-tokenit, secret-osoitukset ja avainlohkot. */
export function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

/** Palauttaa koodin jos turvallinen, muuten fallbackin (aina turvallinen). */
export function toSafeDiagnosticCode(code: string, fallback = "app.unknown"): string {
  if (isSafeDiagnosticCode(code)) {
    return code;
  }
  return isSafeDiagnosticCode(fallback) ? fallback : "app.unknown";
}

/** Korvaa sähköpostit/tunnisteet näytettävässä tekstissä (puolustuksellinen). */
export function sanitizeForDisplay(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[sähköposti]")
    .replace(/bearer\s+[A-Za-z0-9\-._~+/=]{8,}/gi, "Bearer [redaktoitu]")
    .replace(/((?:token|secret|password|passwd|api[_-]?key)\s*[:=]\s*)\S+/gi, "$1[redaktoitu]");
}

// ---------------------------------------------------------------------------
// Raportointi: DEVissä vain vakioitu merkintä console.warn:iin; tuotannossa
// ei lokitulostusta (§48). Dynaamisia otsikoita, koodeja, bodya, virheitä tai
// käyttäjän sisältöä ei koskaan tulosteta consoleen.
// ---------------------------------------------------------------------------

export function reportError(_error: AppError): void {
  // Säilytä parametrin käyttöliittymäraja; loki on tarkoituksella vakioitu.
  if (import.meta.env.DEV) {
    console.warn("[lifeos] Render error");
  }
}

// ---------------------------------------------------------------------------
// Kääntäjät
// ---------------------------------------------------------------------------

export function fromDataError(error: DataError): AppError {
  const diagnosticCode = toSafeDiagnosticCode(error.diagnosticCode, "data.error");
  if (error.code === "not-found") {
    return {
      title: "Kohdetta ei löytynyt",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    };
  }
  if (error.code === "invalid-input") {
    return {
      title: "Tarkista syöte",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    };
  }
  if (error.code === "already-exists") {
    return {
      title: "Kohde on jo olemassa",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    };
  }
  if (error.code === "quota-exceeded") {
    return {
      title: "Tallennustila loppui",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "error",
    };
  }
  if (error.code === "storage-unavailable") {
    return {
      title: "Tallennus ei ole käytössä",
      body: error.userMessage,
      actionLabel: "Yritä uudelleen",
      diagnosticCode,
      level: "error",
    };
  }
  if (error.code === "data-corrupted") {
    return {
      title: "Tallennetun tiedon lukeminen epäonnistui",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "error",
    };
  }
  return {
    title: "Jokin epäonnistui",
    body: error.userMessage,
    actionLabel: "Yritä uudelleen",
    diagnosticCode,
    level: "error",
  };
}

export function fromCapabilityError(error: CapabilityError): AppError {
  const diagnosticCode = toSafeDiagnosticCode(
    error.diagnosticCode,
    `capability.${error.capability}.error`,
  );
  if (error.code === "unsupported") {
    return {
      title: "Selain ei tue toimintoa",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    };
  }
  if (error.code === "denied") {
    return {
      title: "Lupaa ei myönnetty",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    };
  }
  if (error.code === "unavailable") {
    return {
      title: "Toiminto ei ole käytössä nyt",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    };
  }
  if (error.code === "quota-exceeded") {
    return {
      title: "Tallennustila loppui",
      body: error.userMessage,
      actionLabel: null,
      diagnosticCode,
      level: "error",
    };
  }
  return {
    title: "Jokin epäonnistui",
    body: error.userMessage,
    actionLabel: "Yritä uudelleen",
    diagnosticCode,
    level: "error",
  };
}

export function fromDomainError(error: DomainError): AppError {
  if (error.code === "conflict-open") {
    return {
      title: "Ristiriita vaatii ratkaisun",
      body: error.message,
      actionLabel: null,
      diagnosticCode: "domain.conflict-open",
      level: "warning",
    };
  }
  if (error.code === "invalid-transition") {
    return {
      title: "Toiminto ei ole mahdollinen nyt",
      body: error.message,
      actionLabel: null,
      diagnosticCode: "domain.invalid-transition",
      level: "warning",
    };
  }
  return {
    title: "Tarkista syöte",
    body: error.message,
    actionLabel: null,
    diagnosticCode: "domain.invalid-input",
    level: "warning",
  };
}

export function fromConfigError(error: ConfigError): AppError {
  return {
    title: "Asetus puuttuu tai on virheellinen",
    body: error.message,
    actionLabel: null,
    diagnosticCode: toSafeDiagnosticCode(`config.${error.code}`, "app.config.invalid"),
    level: "error",
  };
}

function extractSafeCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "diagnosticCode" in error) {
    const code = (error as { readonly diagnosticCode?: unknown }).diagnosticCode;
    if (typeof code === "string" && isSafeDiagnosticCode(code)) {
      return code;
    }
  }
  return "app.unknown";
}

/** Tuntematon virhe -> geneerinen, redaktoitu AppError (ei vuotoa). */
export function fromUnknown(error: unknown): AppError {
  return {
    title: "Jokin epäonnistui",
    body: "Yritä uudelleen. Jos virhe toistuu, kirjoita muistiin tekninen koodi ja kerro siitä tuessa.",
    actionLabel: "Yritä uudelleen",
    diagnosticCode: extractSafeCode(error),
    level: "error",
  };
}

const BOOTSTRAP_CONFIG_PREFIX = "LifeOS config virheellinen:";

/** Käynnistysvirhe ennen React-puuta (config/root). Redaktoitu kuten muut. */
export function fromBootstrapError(error: unknown): AppError {
  if (error instanceof Error && error.message.startsWith(BOOTSTRAP_CONFIG_PREFIX)) {
    const detail = error.message.slice(BOOTSTRAP_CONFIG_PREFIX.length).trim();
    return {
      title: "Asetus puuttuu tai on virheellinen",
      body: detail.length > 0 ? sanitizeForDisplay(detail) : "Tarkista .env-asetukset.",
      actionLabel: null,
      diagnosticCode: "app.config.invalid",
      level: "error",
    };
  }
  return fromUnknown(error);
}
