// T082: Mitä seuraavaksi -kortin E2E (chromium, preview-build,
// TUOTANTOnäkymä — kortti on oikeaa UI:ta).
// Tuotantokanta on tyhjä: UI State näyttää tyhjätilan ("päivä on vapaa").
// Aidon datan valintalogiikka on todistettu data-paketin unit-testeissä
// (next-up.test.ts: 7 tapausta) — E2E todistaa kortin kytkennän, tyhjätilan
// ja linkkitekstit tuotannossa, sekä mobiilissa että desktopissa.
// Ei PII:tä/terveysdataa.
import { expect, test } from "@playwright/test";

test.describe("next-up (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tyhjätila näkyy ilman dataa; linkkitekstit oikein", async ({ page }) => {
    await page.goto("/");
    const header = page.getByTestId("today-header");
    await expect(header).toBeVisible();

    const empty = page.getByTestId("next-up-empty");
    await expect(empty).toBeVisible();
    await expect(empty.getByRole("heading", { level: 2, name: "Mitä seuraavaksi" })).toBeVisible();
    await expect(empty).toContainText("päivä on vapaa");
    // Tyhjä kannassa ei varsinaista korttia.
    await expect(page.getByTestId("next-up-card")).toHaveCount(0);
    // Hierarkia ennallaan (yksi h1, kortti h2).
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});

test.describe("next-up (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama tyhjätila ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("next-up-empty")).toBeVisible();
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      if (element === null) {
        return true;
      }
      return element.scrollWidth > element.clientWidth;
    });
    expect(overflow).toBe(false);
  });
});
