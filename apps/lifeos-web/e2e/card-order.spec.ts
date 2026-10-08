// T089: korttijärjestyksen E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: järjestys/piilotus on KÄYTTÄJÄN valinta ja PYSYY (localStorage,
// reloadin yli). Ei drag-and-dropia — napit per kortti (§31).
// - Oletus: kaikki 7 korttityyppiä näkyvät (tyhjätila-kortit lasketaan);
// - piilota → kortti katoaa DOM:ista; reload → yhä piilossa;
// - näytä → palaa; siirrä ylös → järjestys muuttuu DOM:ssa + säilyy reloadissa.
// Ei PII:tä/terveysdataa: korttien nimet + tyhjätilat.
import { expect, test } from "@playwright/test";

const CARD_TESTIDS = [
  "next-up-empty",
  "today-groups-empty",
  "today-routines-empty",
  "today-goals-empty",
  "today-health-empty",
  "today-focus-empty",
  "today-gamification-empty",
] as const;

test.describe("card order (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("oletuksena kaikki kortit näkyvät; muokkaus aukeaa", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("today-header")).toBeVisible();
    for (const testId of CARD_TESTIDS) {
      await expect(page.getByTestId(testId)).toBeVisible();
    }
    const toggle = page.getByTestId("card-order-toggle");
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(page.getByTestId("card-order-editor")).toBeVisible();
    await expect(page.getByTestId("card-order-editor")).toContainText("Muokkaa kortteja");
  });

  test("piilota → katoaa DOM:ista → säilyy reloadissa → näytä palauttaa", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("today-focus-empty")).toBeVisible();
    await page.getByTestId("card-order-toggle").click();
    const editor = page.getByTestId("card-order-editor");
    await expect(editor).toBeVisible();

    await editor.getByRole("button", { name: "Piilota Päivän fokus" }).click();
    await expect(page.getByTestId("today-focus-empty")).toHaveCount(0);
    await expect(page.getByTestId("today-focus-card")).toHaveCount(0);
    await expect(editor.getByTestId("card-order-hidden-focus")).toBeVisible();
    // Muut kortit ennallaan.
    await expect(page.getByTestId("today-groups-empty")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("today-header")).toBeVisible();
    await expect(page.getByTestId("today-focus-empty")).toHaveCount(0);
    await expect(page.getByTestId("today-groups-empty")).toBeVisible();

    await page.getByTestId("card-order-toggle").click();
    await page
      .getByTestId("card-order-editor")
      .getByRole("button", { name: "Näytä Päivän fokus" })
      .click();
    await expect(page.getByTestId("today-focus-empty")).toBeVisible();
  });

  test("siirrä ylös muuttaa DOM-järjestystä + säilyy reloadissa", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("today-groups-empty")).toBeVisible();
    await page.getByTestId("card-order-toggle").click();
    const editor = page.getByTestId("card-order-editor");
    await expect(editor).toBeVisible();

    // Tehtävät oletuksena toisena (Mitä seuraavaksi ensin) → ylös = ensimmäiseksi.
    // (Editori on itse mainin sisällä — rajataan varsinaisiin kortteihin
    // testid-päätteellä, ei section-h2:lla.)
    await editor.getByRole("button", { name: "Siirrä Päivän tehtävät ylös" }).click();
    const firstCard = page
      .locator("main [data-testid$='-empty'], main [data-testid$='-card']")
      .first();
    await expect(firstCard).toHaveAttribute("data-testid", "today-groups-empty");

    await page.reload();
    await expect(page.getByTestId("today-header")).toBeVisible();
    const firstAfter = page
      .locator("main [data-testid$='-empty'], main [data-testid$='-card']")
      .first();
    await expect(firstAfter).toHaveAttribute("data-testid", "today-groups-empty");
  });
});

test.describe("card order (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama muokkaus ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("card-order-toggle").click();
    await expect(page.getByTestId("card-order-editor")).toBeVisible();
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
