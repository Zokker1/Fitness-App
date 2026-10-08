// T029: appin ajonaikainen config. Lataa VITE_*-ympäristön, validoi sen
// @lifeos/config-säännöillä ja epäonnistuu nopeasti jos kriittinen asetus
// puuttuu. Ei salaisuuksia: tämä moduuli käsittelee vain julkista
// selainconfigia; salaisuusportti (vite.config.ts) on jo kaatanut buildin
// jos kielletty muuttuja yritti bundleen.
import { validatePublicWebConfig } from "@lifeos/config";
import type { ValidatedWebConfig } from "@lifeos/config";

let cached: ValidatedWebConfig | null = null;

export function loadWebConfig(): ValidatedWebConfig {
  if (cached !== null) {
    return cached;
  }
  const result = validatePublicWebConfig(
    {
      appOrigin: import.meta.env.VITE_APP_ORIGIN,
      googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID,
    },
    {
      isDev: import.meta.env.DEV,
      runtimeOrigin: typeof window === "undefined" ? "" : window.location.origin,
    },
  );
  if (!result.ok) {
    throw new Error(`LifeOS config virheellinen: ${result.error.message}`);
  }
  cached = result.value;
  return cached;
}

/** Testeille: tyhjentää moduulivälimuistin. */
export function resetWebConfigForTests(): void {
  cached = null;
}
