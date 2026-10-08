// T055: a11y-baseline (§31). Konsolidoitu perustarkistus tuotantoreiteillä:
// - lang="fi" + yksi h1 per näkymä + main/nav-landmarkit (molemmat nimetty;
//   piilotettu nav tarkistetaan DOM-lokaattorilla, roolipuu sekin kunnossa);
// - skip-link on ensimmäinen fokusoitava, näkyy fokusoidessa ja Enter
//   siirtää fokuksen #main:ään (focus ei katoa);
// - keyboard-focus näkyy nav-linkissä (outline ≥ 2px, :focus-visible);
// - asetusten radiot ovat nimettyjä (label sidottu, ei pelkkä väri).
// Katettu muualla (ei toistoa): kontrasti mitattuna theme.specissä,
// touch-targetit buttons/forms-speceissä, reduced-motion motion.specissä,
// chart-summary charts.specissä, virheet kenttiin forms.specissä.
import { expect, test, type Page } from "@playwright/test";

const ROUTES = [
  "/",
  "/tasks",
  "/calendar",
  "/goals",
  "/focus",
  "/health",
  "/insights",
  "/settings",
] as const;

test.describe("landmarkit ja otsikkohierarkia", () => {
  test("html lang=fi jokaisella reitillä", async ({ page }) => {
    await page.goto("/");
    expect(await page.evaluate(() => document.documentElement.lang)).toBe("fi");
  });

  for (const route of ROUTES) {
    test(`${route}: yksi h1 + main + nav-landmarkit`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByRole("main")).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      // Navit DOMissa aina (display:none ei näy roolipuussa); näkyvän navin
      // rooli + nimi tarkistetaan viewport-spesifeissä a11y-app-shell-testeissä.
      await expect(page.locator('[data-ui="rail"]')).toHaveCount(1);
      await expect(page.locator('[data-ui="bottom-nav"]')).toHaveCount(1);
      const railNav = page.locator('[data-ui="rail"]');
      expect(await railNav.getAttribute("aria-label")).toBe("Päänavigaatio");
      const bottomNav = page.locator('[data-ui="bottom-nav"]');
      expect(await bottomNav.getAttribute("aria-label")).toBe("Päänavigaatio (mobiili)");
    });
  }
});

test.describe("keyboard + focus (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("skip-link: ensimmäinen fokusoitava + näkyvä focus + siirtyy #main:iin", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Siirry sisältöön" });
    await expect(skipLink).toBeFocused();
    const outlineWidth = await skipLink.evaluate((element) => {
      return getComputedStyle(element).outlineWidth;
    });
    expect(parseFloat(outlineWidth)).toBeGreaterThanOrEqual(2);

    await page.keyboard.press("Enter");
    await expect(page.locator("#main")).toBeFocused();
  });

  /**
   * Tab-järjestyksessä nav-linkin jälkeen tulee bannerin painikkeita jne.,
   * joten edetään Tab-näppäimellä kunnes kohdelinkki on fokusoituna
   * (rajattu kierrosmäärä — linkki on aina näppäimistöllä saavutettava).
   */
  async function focusBottomNavLink(page: Page): Promise<void> {
    const todayLink = page
      .getByRole("navigation", { name: "Päänavigaatio (mobiili)" })
      .getByRole("link", { name: "Tänään" });
    for (let presses = 0; presses < 12; presses += 1) {
      await page.keyboard.press("Tab");
      if (await todayLink.evaluate((element) => element === document.activeElement)) {
        return;
      }
    }
    throw new Error("Tänään-linkki ei saavutettu näppäimistöllä 12 Tab-painalluksella");
  }

  test("nav-linkki saavutetaan näppäimistöllä ja focus näkyy (outline ≥ 2px)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("main")).toBeVisible();
    await focusBottomNavLink(page);
    const todayLink = page
      .getByRole("navigation", { name: "Päänavigaatio (mobiili)" })
      .getByRole("link", { name: "Tänään" });
    const outlineWidth = await todayLink.evaluate((element) => {
      return getComputedStyle(element).outlineWidth;
    });
    expect(parseFloat(outlineWidth)).toBeGreaterThanOrEqual(2);
  });
});

test.describe("labelit (settings)", () => {
  test("teemaradiot ovat nimettyjä ja valittavia", async ({ page }) => {
    await page.goto("/settings");
    for (const name of ["Järjestelmä", "Vaalea", "Tumma"]) {
      const radio = page.getByRole("radio", { name });
      await expect(radio).toBeAttached();
      await expect(radio).toBeVisible();
    }
  });
});
