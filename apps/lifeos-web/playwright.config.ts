import { defineConfig, devices } from "@playwright/test";

// T033: browser-E2E-runko. T038 ajaa täyden reload/offline-persistence
// smoken tätä vasten; tässä vain runko + smoke-valmius (webServer käynnistää
// preview-buildin deterministisesti).
//
// Huom: .env asuu repo-juuressa (T029) mutta Vite lukee oletuksena app-
// hakemistoa. webServer ajaa buildin ensin jotta preview palvelee juuren
// env-arvoilla leivottua bundlea (E2E ei testaa dev-serveriä).
//
// T035: firefox/webkit eivät ole asennettuna joka koneella (npx playwright
// install puuttuu). Oletus E2E ajaa chromiumin; täysi matriisi
// --project=firefox/webkit -lipuilla siellä missä selaimet on asennettu
// (T039-portti + T053 laajentavat; CI asentaa selaimet erikseen).
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  // T056: visual regression -perusasetukset (baseline-kuvat e2e/**/*-snapshots/).
  // Pieni diff-toleranssi AA-reunoille; animaatiot sammutetaan kutsukohtaisesti.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npm run build:e2e --workspace @lifeos/web && npm run preview --workspace @lifeos/web -- --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173/",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    // Oletus: chromium (aina asennettu CI:ssä `npx playwright install
    // --with-deps chromium`). Firefox/webkit ajetaan eksplisiittisesti
    // --project-lipulla kun selaimet on asennettu.
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
