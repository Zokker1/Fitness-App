// T057: desktop-selaimen visual-baseline (§31/§58: kompaktin ja leveän
// selainikkunan tallennettu perusta; täydentää T056:n mobiilibaselinea).
// - Leveydet: 800×900 (kompakti: rail näkyy ≥720, sivupalkki piilossa)
//   + 1440×900 (leveä: sivupalkki näkyy ≥1200). dsf=1 determinismiin.
// - Reitit "/" ja "/settings" molemmilla leveyksillä.
// - Sama determinismi kuin T056: banneri piilossa, fontit valmiiksi,
//   animaatiot pois screenshot-optiolla.
// - Baseline luodaan --update-snapshots; tavallinen ajo vertaa (configin
//   maxDiffPixelRatio 0.01).
// Ei PII:tä/terveysdataa: placeholder + asetusvalinnat.
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "compact-800", width: 800, height: 900 },
  { label: "wide-1440", width: 1440, height: 900 },
] as const;

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/settings", name: "settings" },
] as const;

test.describe("desktopin visual-baseline", () => {
  for (const viewport of VIEWPORTS) {
    for (const route of ROUTES) {
      test(`${viewport.label} ${route.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.clock.install({ time: new Date("2026-09-18T15:00:00.000Z") });
        await page.goto(route.path);
        await expect(page.getByRole("main")).toBeVisible();
        // Tilapinta (banneri) piiloon — layout ilman sitä on deterministinen.
        const storageBanner = page.locator('[data-ui="storage-banner"]');
        if ((await storageBanner.count()) > 0) {
          await storageBanner.evaluate((element) => {
            element.remove();
          });
        }
        await page.evaluate(() => document.fonts.ready);
        // Sivupalkki näkyy vain leveällä (≥1200) — rakenteen E2E-vaatimus.
        const aside = page.getByRole("complementary", { name: "Sivupalkki" });
        if (viewport.width >= 1200) {
          await expect(aside).toBeVisible();
        } else {
          await expect(aside).toBeHidden();
        }
        await expect(page).toHaveScreenshot(`${route.name}-${viewport.label}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  }
});
