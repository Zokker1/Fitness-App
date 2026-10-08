// T029: salaisuusportti. Ajetaan Viten config-vaiheessa ENNEN bundlea ja
// buildin jälkeen distille: jos jokin kielletty salaisuusmuuttuja on
// päätynyt ympäristöön/bundleen, build kaatuu selkeään viestiin.
// Kielto (spec §45, T307/T335/T350):
// - GOOGLE_CLIENT_SECRET / CLIENT_SECRET / OAUTH_CLIENT_SECRET: ei koskaan
//   frontend-repoon tai bundleen (SPA:ssa ei client secretiä).
// - *_TOKEN / *_SECRET / *_PRIVATE_KEY / SERVICE_ACCOUNT: ei bundleen.
// - DEK/plaintext-avaimet: eivät koskaan env-mekanismin kautta.
// Sallittu: VITE_GOOGLE_CLIENT_ID (julkinen client-id, ei secret) ja
// VITE_APP_ORIGIN (julkinen origin). Sallitut VITE_*-avaimet on listattu
// eksplisiittisesti — tuntematon VITE_-avain kaataa buildin jotta uusi
// muuttuja joutuu tietoiseen katselmukseen ennen bundlea.

const FORBIDDEN_NAME_PATTERNS: readonly RegExp[] = [
  /CLIENT_SECRET/i,
  /OAUTH.*SECRET/i,
  /_TOKEN$/i,
  /_SECRET$/i,
  /PRIVATE_KEY/i,
  /SERVICE_ACCOUNT/i,
  /^DEK$/i,
  /DATA_ENCRYPTION_KEY/i,
];

const ALLOWED_VITE_KEYS: readonly string[] = ["VITE_APP_ORIGIN", "VITE_GOOGLE_CLIENT_ID"];

export interface SecretScanIssue {
  readonly key: string;
  readonly reason: string;
}

export function scanEnvForSecrets(
  env: Readonly<Record<string, string | undefined>>,
): readonly SecretScanIssue[] {
  const issues: SecretScanIssue[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined || value === "") {
      continue;
    }
    if (FORBIDDEN_NAME_PATTERNS.some((pattern) => pattern.test(key))) {
      issues.push({
        key,
        reason:
          "Kielletty salaisuusmuuttuja frontend-ympäristössä. Poista se .env:stä/CI:stä — SPA:han ei kuulu secretiä/tokenia/yksityisavainta.",
      });
      continue;
    }
    if (key.startsWith("VITE_") && !ALLOWED_VITE_KEYS.includes(key)) {
      issues.push({
        key,
        reason: `Tuntematon ${key} päätyisi sellaisenaan frontend-bundleen. Lisää se ensin tietoiseen katselmukseen ALLOWED_VITE_KEYS-listaan tai poista se.`,
      });
    }
  }
  return issues;
}

export function assertNoSecrets(env: Readonly<Record<string, string | undefined>>): void {
  const issues = scanEnvForSecrets(env);
  if (issues.length > 0) {
    const lines = issues.map((issue) => ` - ${issue.key}: ${issue.reason}`);
    throw new Error(
      `LifeOS salaisuusportti esti buildin (${String(issues.length)} ongelmaa):\n${lines.join("\n")}`,
    );
  }
}

/** Buildinjälkeinen portti: dist-tiedostoissa ei saa esiintyä kiellettyjä avaimia. */
export function scanBundleForSecretKeys(bundleText: string): readonly string[] {
  const hits: string[] = [];
  const needles = ["CLIENT_SECRET", "PRIVATE_KEY", "SERVICE_ACCOUNT", "DATA_ENCRYPTION_KEY"];
  for (const needle of needles) {
    if (bundleText.includes(needle)) {
      hits.push(needle);
    }
  }
  return hits;
}
