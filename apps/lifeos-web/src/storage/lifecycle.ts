import { getIntlLocale } from "../language.tsx";
// T036: puhdas storage-lifecycle (ei IO:ta, ei selainta, ei Reactia).
// - Laskee käyttöasteen, luokittelee varoituksen (§2/§32/§48/§59) ja muotoilee
//   tavut suomeksi. Kaikki sivuvaikutukset (snapshot/persist-pyyntö/avaus)
//   elävät hookissa (useStorageStatus.ts); tämä on deterministisesti testattava.
// - Backend käsitellään geneerisenä merkkijonona: "memory" tarkoittaa
//   välimuistifallbackia (ei säily), muu arvo pysyvää laitetallennusta.
//   Taustajärjestelmien tuotenimiä ei kovakoodata tähän (rajaskanni).
// - Käyttäjäteksteissä ei PII:tä/terveysdataa; ohjeet ohjaavat backup/synkkaan
//   ja kertovat sivustodatan tyhjennyksen riskistä (§2 kohta 9).

export const STORAGE_ATTENTION_RATIO = 0.7;
export const STORAGE_CRITICAL_RATIO = 0.9;

export const MEMORY_BACKEND_KEY = "memory";

export interface StorageSnapshotInput {
  readonly opfsSupported: boolean;
  readonly persisted: boolean | null;
  readonly quotaBytes: number | null;
  readonly usageBytes: number | null;
}

export interface DatabaseHealthInput {
  readonly backend: string;
  readonly persisted: boolean;
  readonly open: boolean;
  readonly integrity: string;
  readonly schemaVersion: number;
}

export type StorageWarning =
  | "none"
  | "best-effort"
  | "quota-huomio"
  | "quota-kriittinen"
  | "muisti-fallback"
  | "ei-tuettu"
  | "tuntematon";

export type StorageLevel = "ok" | "huomio" | "kriittinen" | "tuntematon";

export interface StorageStatus {
  readonly usageRatio: number | null;
  readonly quotaBytes: number | null;
  readonly usageBytes: number | null;
  readonly persisted: boolean | null;
  readonly opfsSupported: boolean;
  readonly backend: string;
  readonly dbOpen: boolean;
  readonly warning: StorageWarning;
  readonly level: StorageLevel;
  /** true kun käyttäjälle pitää näyttää backup/synkka-ohje (§2/§59). */
  readonly needsBackupGuidance: boolean;
  /** true kun pysyvän tallennuksen pyyntö on järkevä (persisted === false). */
  readonly canRequestPersistence: boolean;
}

export interface StorageGuidance {
  readonly title: string;
  readonly body: string;
  readonly primaryAction: string | null;
}

/** Käyttöaste 0..1 tai null kun lukemia ei ole (tuntematon). */
export function computeUsageRatio(
  quotaBytes: number | null,
  usageBytes: number | null,
): number | null {
  if (
    quotaBytes === null ||
    usageBytes === null ||
    !Number.isFinite(quotaBytes) ||
    !Number.isFinite(usageBytes) ||
    quotaBytes <= 0 ||
    usageBytes < 0
  ) {
    return null;
  }
  const ratio = usageBytes / quotaBytes;
  if (!Number.isFinite(ratio) || ratio < 0) {
    return null;
  }
  return Math.min(ratio, 1);
}

/** Tavut suomeksi: null/virheellinen -> "—". Ei koskaan salaisuuksia. */
export function formatBytesFi(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
    return "—";
  }
  const units = ["t", "Kt", "Mt", "Gt", "Tt"] as const;
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const unit = units[unitIndex] ?? "t";
  const formatted = new Intl.NumberFormat(getIntlLocale(), {
    maximumFractionDigits: value >= 100 || unitIndex === 0 ? 0 : 1,
  }).format(value);
  return `${formatted} ${unit}`;
}

/** Prosentti suomeksi: null -> "—". */
export function formatRatioFi(ratio: number | null): string {
  if (ratio === null || !Number.isFinite(ratio) || ratio < 0) {
    return "—";
  }
  return new Intl.NumberFormat(getIntlLocale(), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(Math.min(ratio, 1));
}

export function shouldRequestPersistence(snapshot: StorageSnapshotInput): boolean {
  return snapshot.persisted === false;
}

export function classifyStorageWarning(
  snapshot: StorageSnapshotInput | null,
  db: DatabaseHealthInput | null,
): StorageWarning {
  const backend = db?.backend ?? "";
  // Välimuistifallback on aina kriittinen: data ei säily sulkemisen yli.
  if (backend === MEMORY_BACKEND_KEY) {
    return "muisti-fallback";
  }
  if (snapshot === null) {
    return "tuntematon";
  }
  if (!snapshot.opfsSupported && snapshot.persisted === null && snapshot.quotaBytes === null) {
    return "ei-tuettu";
  }
  const ratio = computeUsageRatio(snapshot.quotaBytes, snapshot.usageBytes);
  if (ratio !== null && ratio >= STORAGE_CRITICAL_RATIO) {
    return "quota-kriittinen";
  }
  if (snapshot.persisted === false && ratio !== null && ratio >= STORAGE_ATTENTION_RATIO) {
    return "quota-huomio";
  }
  if (ratio !== null && ratio >= STORAGE_ATTENTION_RATIO && snapshot.persisted !== true) {
    return "quota-huomio";
  }
  if (snapshot.persisted === false) {
    return "best-effort";
  }
  if (snapshot.persisted === true && ratio !== null && ratio >= STORAGE_ATTENTION_RATIO) {
    return "quota-huomio";
  }
  if (snapshot.persisted === null && ratio === null) {
    return "tuntematon";
  }
  return "none";
}

export function warningToLevel(warning: StorageWarning): StorageLevel {
  if (warning === "none") {
    return "ok";
  }
  if (warning === "tuntematon" || warning === "ei-tuettu") {
    return "tuntematon";
  }
  if (warning === "quota-kriittinen" || warning === "muisti-fallback") {
    return "kriittinen";
  }
  return "huomio";
}

export function buildStorageStatus(
  snapshot: StorageSnapshotInput | null,
  db: DatabaseHealthInput | null,
): StorageStatus {
  const warning = classifyStorageWarning(snapshot, db);
  const level = warningToLevel(warning);
  const usageRatio =
    snapshot === null ? null : computeUsageRatio(snapshot.quotaBytes, snapshot.usageBytes);
  return {
    usageRatio,
    quotaBytes: snapshot?.quotaBytes ?? null,
    usageBytes: snapshot?.usageBytes ?? null,
    persisted: snapshot?.persisted ?? null,
    opfsSupported: snapshot?.opfsSupported ?? false,
    backend: db?.backend ?? "",
    dbOpen: db?.open ?? false,
    warning,
    level,
    needsBackupGuidance: warning !== "none",
    canRequestPersistence:
      snapshot !== null && snapshot.persisted === false && warning !== "muisti-fallback",
  };
}

export function getStorageGuidance(warning: StorageWarning): StorageGuidance {
  if (warning === "best-effort") {
    return {
      title: "Tallennus on best-effort-tilassa",
      body: "Selain voi poistaa paikallisen datan tilan vapauttamiseksi. Pyydä pysyvä tallennus alta ja pidä salattu varmuuskopio ajan tasalla. Selaimen sivustodatan tyhjennys poistaa paikallisen kopion.",
      primaryAction: "Pyydä pysyvää tallennusta",
    };
  }
  if (warning === "quota-huomio") {
    return {
      title: "Tallennustila täyttyy",
      body: "Käytössä on suuri osa varatusta tilasta. Tee salattu varmuuskopio ja vapauta tilaa – täysi tila estää uudet kirjaukset.",
      primaryAction: null,
    };
  }
  if (warning === "quota-kriittinen") {
    return {
      title: "Tallennustila lähes täynnä",
      body: "Tee heti salattu varmuuskopio ja vapauta tilaa. Kirjaukset voivat epäonnistua kun tila loppuu.",
      primaryAction: null,
    };
  }
  if (warning === "muisti-fallback") {
    return {
      title: "Tietokanta toimii välimuistissa",
      body: "Pysyvä laitetallennus ei ole käytössä, joten data ei säily selaimen sulkemisen yli. Käytä ajantasaista selainta ja ota varmuuskopio käyttöön heti.",
      primaryAction: null,
    };
  }
  if (warning === "ei-tuettu") {
    return {
      title: "Tallennustilan kysely ei onnistu",
      body: "Selain ei kerro tallennustilaa. Käytä ajantasaista selainta ja pidä salattu varmuuskopio ajan tasalla.",
      primaryAction: null,
    };
  }
  if (warning === "tuntematon") {
    return {
      title: "Tallennustilaa ei voitu varmistaa",
      body: "Tila tarkistetaan uudelleen automaattisesti. Pidä salattu varmuuskopio ajan tasalla kunnes tila varmistuu.",
      primaryAction: null,
    };
  }
  return {
    title: "Tallennus on pysyvässä tilassa",
    body: "Selain säilyttää paikallisen tietokannan. Pidä silti salattu varmuuskopio ajan tasalla – selaimen sivustodatan tyhjennys poistaa paikallisen kopion.",
    primaryAction: null,
  };
}
