// T056: mobiiliselaimen visual-baseline (§31/§58: pienen ja normaalin
// puhelinleveyden tallennettu perusta; T057 tekee desktop-vastineen).
// - Leveydet: 320 px (pieni puhelin) + 390 px (normaali puhelin), dsf=1
//   (deterministinen PNG, ei DPR-eroja koneiden välillä).
// - Reitit "/" (Tänään) + "/settings" molemmilla leveyksillä.
// - Determinismi: storage-banner piilotetaan (tilapinta vaihtelee
//   tallennustilan mukaan — sen tilat kattavat states/E2E:t erikseen),
//   fontit odotetaan valmiiksi (bundlettu Hanken Grotesk), animaatiot
//   pois screenshot-optiolla (T054 sisääntulot ei häiritse).
// - Baseline luodaan `npm run test:e2e -- e2e/visual-baseline-mobile.spec.ts
//   --update-snapshots`; tavallinen ajo vertaa (diff-toleranssi configissa).
// Ei PII:tä/terveysdataa: placeholder + asetusvalinnat.
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "small-320", width: 320, height: 568 },
  { label: "normal-390", width: 390, height: 844 },
] as const;

const ROUTES = [
  { path: "/", name: "home" },
  { path: "/settings", name: "settings" },
] as const;

test.describe("mobiilin visual-baseline", () => {
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
        await expect(page).toHaveScreenshot(`${route.name}-${viewport.label}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      });
    }
  }
});
