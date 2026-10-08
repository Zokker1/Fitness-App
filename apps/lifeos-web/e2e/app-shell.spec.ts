// T033-runko + T044: responsiivinen AppShell todellisilla viewporteilla
// (§27: ei puristettu desktop-sivu — layout vaihtuu hallitusti).
// - Mobiili (390px): bottom-nav näkyy (ikonit+labelit), rail piilossa,
//   Lisää avaa drawer-dialogin (focus-trap: Esc sulkee + palauttaa fokuksen).
// - Desktop (1280px): rail näkyy täydellä listalla, bottom-nav piilossa,
//   drawer ei kuulu näkyviin. Navigaatio toimii (historia/back = Linkkejä).
// - Wide (1440px): sivupalkki tulee näkyviin (vain hyödyllä, brief §4).
// - Ei PII:tä/terveysdataa: vain navin rakenne + näkyvyys.
import { expect, test, type Page } from "@playwright/test";

async function gotoHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
}

test.describe("responsiivinen AppShell", () => {
  test("mobiili: bottom-nav + Haku-laukaisin + Lisää-drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoHome(page);
    // Tarkka nimi ("Päänavigaatio", exact) = desktop-rail; ilman exactia
    // mobiilin "(mobiili)"-labeli täsmäisi prefixinä ja testi valehtelisi.
    await expect(page.getByRole("navigation", { name: "Päänavigaatio (mobiili)" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Päänavigaatio", exact: true })).toBeHidden();
    // Ikonit + labelit yhdessä (ei pelkkää ikonia). T045: data-ui="icon"
    // (nav-icon oli T044-alias, poistettu Icon-refactorissa).
    const bottomNav = page.getByRole("navigation", { name: "Päänavigaatio (mobiili)" });
    expect(await bottomNav.locator('[data-ui="icon"]').count()).toBeGreaterThanOrEqual(5);
    await expect(bottomNav.getByRole("link", { name: "Tehtävät" })).toBeVisible();

    // T096: 5. sarake = Haku-laukaisin (täyttää a-em:n paikan; T044-rakenne).
    // Se avaa saman hakudialogin kuin desktopin rail-nappi.
    const searchButton = bottomNav.getByRole("button", { name: "Haku" });
    await expect(searchButton).toBeVisible();
    await searchButton.click();
    await expect(page.getByRole("dialog", { name: "Haku" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Haku" })).toHaveCount(0);

    const more = bottomNav.getByRole("button", { name: "Lisää" });
    await more.click();
    const dialog = page.getByRole("dialog", { name: "Lisää" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Terveys" })).toBeVisible();
    // Navigointi drawerista toimii (historia = Linkki, ei tilakaappaus).
    await dialog.getByRole("link", { name: "Terveys" }).click();
    await expect(page).toHaveURL(/\/health$/);

    // Esc sulkee + palauttaa fokuksen avaajaan (§31).
    await bottomNav.getByRole("button", { name: "Lisää" }).click();
    await expect(page.getByRole("dialog", { name: "Lisää" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Lisää" })).toBeHidden();
    await expect(bottomNav.getByRole("button", { name: "Lisää" })).toBeFocused();
  });

  test("desktop: rail + hakunappi + navigaatio, ilman bottom-navia/draweria", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHome(page);
    const rail = page.getByRole("navigation", { name: "Päänavigaatio" });
    await expect(rail).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Päänavigaatio (mobiili)" })).toBeHidden();
    // Täysi lista railissa (myös secondary-reitit).
    await expect(rail.getByRole("link", { name: "Terveys" })).toBeVisible();
    await expect(rail.getByRole("link", { name: "Asetukset" })).toBeVisible();
    expect(await rail.locator('[data-ui="icon"]').count()).toBeGreaterThanOrEqual(8);
    // T096: railin hakunappi brändin alla avaa saman dialogin kuin mobiili.
    const railSearch = rail.getByRole("button", { name: "Hae…" });
    await expect(railSearch).toBeVisible();
    await railSearch.click();
    await expect(page.getByRole("dialog", { name: "Haku" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Haku" })).toHaveCount(0);
    // Navigaatio toimii + aria-current seuraa.
    await rail.getByRole("link", { name: "Tehtävät" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(rail.getByRole("link", { name: "Tehtävät" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("wide: sivupalkki näkyy vain ≥1200px", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHome(page);
    await expect(page.getByRole("complementary", { name: "Sivupalkki" })).toBeVisible();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(page.getByRole("complementary", { name: "Sivupalkki" })).toBeHidden();
  });
});
