// T138: kalenterin visuaalinen tarkistus desktop- ja mobiilileveydellä.
import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { label: "desktop-1280", width: 1280, height: 800 },
  { label: "mobile-390", width: 390, height: 844 },
] as const;

test.describe("kalenterin visual-baseline (T138)", () => {
  for (const viewport of VIEWPORTS) {
    test(viewport.label, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/calendar?date=2026-07-01");
      await expect(page.getByTestId("calendar-day-grid")).toBeVisible();
      await page.getByLabel("Timeboxin nimi").fill("T138-visual");
      await page.getByLabel("Aloitusaika").fill("10:00");
      await page.getByLabel("Kesto").selectOption({ label: "60 min" });
      await page.getByTestId("calendar-block-create").click();
      await expect(page.getByTestId("calendar-day-grid")).toContainText("10.00–11.00");
      const storageBanner = page.locator('[data-ui="storage-banner"]');
      if ((await storageBanner.count()) > 0) {
        await storageBanner.evaluate((element) => {
          element.remove();
        });
      }
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`calendar-${viewport.label}.png`, {
        fullPage: true,
        animations: "disabled",
      });
    });
  }
});
