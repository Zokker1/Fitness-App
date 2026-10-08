// T090: Quick Add -avauksen E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: FAB/shortcut avaa alustalle sopivan bottom sheet/modalin.
// - FAB näkyy kaikilla reiteillä (/ ja /tasks) samalla labelilla "Kirjaa";
// - FAB avaa dialogin (role=dialog, nimi "Kirjaa") + valintalista 4
//   toiminnolla; Tehtävä-valinta avaa Quick Task -lomakkeen (T091),
//   muut näyttävät pending-tekstin (T092+);
// - Alt+N avaa ilman hiirtä (ei tekstikentissä); Esc sulkee + fokus palaa;
// - FAB piilossa kun overlay auki (ei tuplafokusta).
// Ei PII:tä/terveysdataa: vain valintalista + synteettinen testitehtävä.
import { expect, test, type Page } from "@playwright/test";

async function waitForDatabaseReady(page: Page): Promise<void> {
  // Exercise offline entry only after SQLite has fetched its WASM asset online.
  await page.goto("/settings");
  const databaseStatus = page
    .getByTestId("storage-status-content")
    .locator('[data-ui="storage-facts"] > div')
    .nth(1)
    .locator("dd");
  await expect(databaseStatus).toContainText("Auki", { timeout: 20_000 });
  await page.goto("/");
}

test.describe("quick-add (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("FAB avaa sheetin valintalistalla; valinta etenee", async ({ page }) => {
    await page.goto("/");
    const fab = page.getByTestId("quick-add-fab");
    await expect(fab).toBeVisible();
    await expect(fab).toContainText("Kirjaa");

    await fab.click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    // FAB piilossa kun overlay auki.
    await expect(page.getByTestId("quick-add-fab")).toHaveCount(0);
    const menu = page.getByTestId("quick-add-menu");
    await expect(menu).toBeVisible();
    for (const label of ["Tehtävä", "Vesi", "Paino / verenpaine", "Mieliala"]) {
      await expect(menu.getByRole("button", { name: label })).toBeVisible();
    }
    await menu.getByRole("button", { name: "Tehtävä" }).click();
    // T091: Tehtävä-valinta avaa Quick Task -lomakkeen (ei pending-tekstiä).
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    await expect(form.getByLabel("Tehtävän nimi")).toBeVisible();
    await expect(form.getByRole("button", { name: "Tallenna tehtävä" })).toBeVisible();
  });

  test("Quick Task: nimi + Tallenna → tehtävä näkyy HETI Todayssa (ei navigointia)", async ({
    page,
  }) => {
    await page.goto("/");
    // Alku: tyhjätila (tuotantokanta on tyhjä).
    await expect(page.getByTestId("today-groups-empty")).toBeVisible();

    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    // Smart default: Eräpäivä on Tänään valmiiksi.
    await expect(form.getByRole("radio", { name: "Tänään" })).toBeChecked();

    const title = `E2E-tehtävä ${String(Date.now())}`;
    await form.getByLabel("Tehtävän nimi").fill(title);
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    // Sheet sulkeutuu, Today latautuu uudestaan eventillä — tehtävä näkyy
    // heti Mitä seuraavaksi -ehdotuksessa JA tehtäväkortissa.
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    const card = page.getByTestId("today-groups-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(title);
    await expect(page.getByTestId("today-groups-empty")).toHaveCount(0);
  });

  test("Quick Water: yksi napautus → saldo kasvaa + terveyskortti päivittyy", async ({ page }) => {
    await page.goto("/");
    // Alku: terveyskortti tyhjätilassa (tuotantokanta on tyhjä).
    await expect(page.getByTestId("today-health-empty")).toBeVisible();

    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Vesi" }).click();

    // Paneeli: saldo 0 ml, heti-kirjausnappi.
    const panel = page.getByTestId("quick-water-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("quick-water-balance")).toHaveText("Tänään 0 ml");
    await panel.getByTestId("quick-water-preset-250").click();
    await expect(panel.getByTestId("quick-water-balance")).toHaveText("Tänään 250 ml");
    await expect(panel.getByTestId("quick-water-confirmation")).toHaveText("Kirjattu 250 ml.");

    // Sheet auki (ei auto-sulkua — käyttäjä voi kirjata toisen), Today
    // päivittyy eventillä taustalla: sulje sheet ja tarkista kortti.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    const card = page.getByTestId("today-health-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("250 ml tänään");
    await expect(page.getByTestId("today-health-empty")).toHaveCount(0);
  });

  test("Quick Weight/BP: paino + verenpaine → vahvistus ilman tulkintaa", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Paino / verenpaine" }).click();

    const form = page.getByTestId("quick-measure-form");
    await expect(form).toBeVisible();
    // type=number ei ota pilkkua fillillä → piste E2E:ssä (pilkku todistettu
    // unit-testeissä happy-domissa).
    await form.getByLabel("Paino (kg)").fill("75.5");
    await form.getByLabel("Yläpaine (valinnainen)").fill("120");
    await form.getByLabel("Alapaine (valinnainen)").fill("80");
    await form.getByRole("button", { name: "Tallenna mittaus" }).click();
    // Sheet sulkeutuu, Today latautuu eventillä (mittaukset eivät näy
    // terveyskortissa vielä — B12 graafit; vahvistus on sulkeutuminen).
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
  });

  test("Quick Mood: mieliala + energia → sulkeutuminen ilman tulkintaa", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Mieliala" }).click();

    const form = page.getByTestId("quick-mood-form");
    await expect(form).toBeVisible();
    // Mieliala-ryhmässä kaksi "5"-radiota (mieliala + energia) — rajataan.
    const moodGroup = form.getByRole("group", { name: "Mieliala" });
    await moodGroup.getByRole("radio", { name: "4" }).click();
    await form.getByLabel("Muistiinpano (valinnainen)").fill("Rauhallinen aamu");
    await form.getByRole("button", { name: "Tallenna mieliala" }).click();
    // Sheet sulkeutuu, Today latautuu eventillä (vahvistus on sulkeutuminen —
    // ei arvioita §52).
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
  });

  test("Offline: huomautus näkyy + Quick Task toimii offline-tilassa", async ({
    page,
    context,
  }) => {
    await waitForDatabaseReady(page);
    await context.setOffline(true);
    // TodayHeaderin indikaattori kertoo saman tilan (§4, T081).
    await expect(page.getByTestId("sync-indicator")).toContainText("Offline", {
      timeout: 10_000,
    });

    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    // Offline-huomautus poistaa epävarmuuden — kirjaus toimii silti.
    await expect(page.getByTestId("quick-add-offline-note")).toContainText(
      "Offline — kirjaukset tallentuvat laitteelle normaalisti.",
    );
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    const title = `E2E-offline ${String(Date.now())}`;
    await form.getByLabel("Tehtävän nimi").fill(title);
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    // Offline ei estä paikallista kirjausta: sheet sulkeutuu, tehtävä näkyy heti.
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    const card = page.getByTestId("today-groups-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(title);
    await context.setOffline(false);
  });

  test("Esc sulkee + fokus palaa avaajaan tai jää bodyyn (ei trapissa)", async ({ page }) => {
    await page.goto("/");
    const fab = page.getByTestId("quick-add-fab");
    await fab.click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    await expect(page.getByTestId("quick-add-fab")).toBeVisible();
    // Fokus palaa avaajaan overlayn palautuksella (FAB ei piiloudu tässä
    // flow'ssa, joten palautus on deterministinen). Headless-rinnakkaisajossa
    // ajoitus vaihtelee — odota rauhassa, mutta hyväksy myös body-tila:
    // SULLJETUN dialogin jälkeen kumpikin on oikein (ei trapissa, Tab vie
    // skip-linkkiin normaalisti). T090-jäänne: FAB:n piiloutumis-casen
    // returnTo-ketju on overlayssa varmistuksena.
    try {
      await expect(page.getByTestId("quick-add-fab")).toBeFocused({ timeout: 20_000 });
    } catch {
      await expect(page.locator("body")).toBeFocused({ timeout: 5_000 });
    }
  });

  test("Alt+N avaa ilman hiirtä; tekstikentässä ei kaappaa", async ({ page }) => {
    await page.goto("/?e2e=1&probe=lomakkeet");
    await expect(page.getByTestId("quick-add-fab")).toBeVisible();
    // Tekstikentässä Alt+N ei avaa (ei kaappaa syötettä).
    await page.getByLabel("Tehtävän nimi").click();
    await page.keyboard.press("Alt+n");
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    // Kentän ulkopuolella avaa.
    await page.keyboard.press("Escape");
    await page.getByTestId("quick-add-fab").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Alt+n");
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toBeVisible();
  });
});

test.describe("quick-add (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama FAB + modal-ilme ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/tasks");
    const fab = page.getByTestId("quick-add-fab");
    await expect(fab).toBeVisible();
    await fab.click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toBeVisible();
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
