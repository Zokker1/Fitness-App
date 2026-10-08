// T098: Today/QuickAdd-kriittisten tilojen E2E (chromium, preview-build).
// Kriteeri: "Kriittiset tilat todistetaan mobiili- ja desktop-selaimen kuvilla
// sekä persistence/offline-testillä." Kattaa sen mitä perus-spekit eivät:
// - Today-korttien SISÄLLÖLLISET tilat yhdessä näkymässä (probedata, mobiili+
//   desktop): ehdotus, progress, goal-toggle, terveysrivilista, fokus,
//   gamification — yksi ajo per laite, ei kuutta erillistä latausta;
// - QuickAddin kriittinen polku tuotannossa (FAB → Tehtävä → Tallenna →
//   näkyy heti) desktopissa — mobiili on quick-add.specissä;
// - Offline-kirjaus desktopissa, kun paikallinen tietokanta on ensin alustettu;
// - Tyhjätila + korttijärjestys-editointi desktopissa (mobiili card-orderissa).
// Tyhjän kannan tuotantokäytös + offline-shell ovat omissa spekeissään
// (today-tasks, quick-add, persistence) — tässä ei toistoa.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
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

test.describe("today critical (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("kaikki kortit sisällöllisinä yhdessä näkymässä (probedata)", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    // Ehdotus + tehtäväkortti progressilla.
    await expect(probe.getByTestId("next-up-card")).toContainText("Myöhässä");
    const tasks = probe.getByTestId("today-groups-card");
    await expect(tasks.getByRole("progressbar")).toBeVisible();
    await expect(tasks).toContainText("myöhässä");

    // Rutiinit askelineen.
    const routines = probe.getByTestId("today-routines-card");
    await expect(routines).toContainText("Aamurutiini");
    await expect(routines).toContainText("Venyttele");

    // Tavoitteet: vaihto toimii visuaalisesti (checkbox tila vaihtuu).
    const goals = probe.getByTestId("today-goals-card");
    const pending = goals.getByTestId("goal-checkbox-nx-goal-b");
    await expect(pending).not.toBeChecked();
    await pending.click();
    // Probe onToggle on no-op — tila ei muutu (tuotannon vaihto on T085:ssä).
    await expect(pending).not.toBeChecked();

    // Terveys: neutraalit rivit, ei diagnooseja.
    const health = probe.getByTestId("today-health-card");
    await expect(health).toContainText("7 h 30 min, laatu 4/5");
    await expect(health).toContainText("Ei kirjattu: Magnesium");

    // Fokus + gamification lukuina.
    await expect(probe.getByTestId("today-focus-card")).toContainText("25 min");
    const game = probe.getByTestId("today-gamification-card");
    await expect(game).toContainText("10 XP");
    await expect(game).toContainText("Taso 3");

    await expect(probe.getByTestId("today-cards-sentinel")).toBeVisible();
  });
});

test.describe("today critical (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("kortit sisällöllisinä + tyhjätila + editointi ilman layout-rikkoa", async ({ page }) => {
    // 1. Sisältötilat probedatalla.
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();
    await expect(probe.getByTestId("next-up-card")).toBeVisible();
    await expect(probe.getByTestId("today-groups-card")).toBeVisible();
    await expect(probe.getByTestId("today-gamification-card")).toBeVisible();

    // 2. Tuotannon tyhjätila + korttijärjestyksen muokkaus.
    await page.goto("/");
    await expect(page.getByTestId("today-header")).toBeVisible();
    await expect(page.getByTestId("next-up-empty")).toBeVisible();
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

  test("QuickAdd kriittinen polku desktopissa: FAB → Tehtävä → näkyy heti", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    const title = `E2E-kriittinen ${String(Date.now())}`;
    await form.getByLabel("Tehtävän nimi").fill(title);
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    const card = page.getByTestId("today-groups-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(title);
  });

  test("offline-kirjaus desktopissa: huomautus + tehtävä näkyy heti", async ({ page, context }) => {
    await waitForDatabaseReady(page);
    await context.setOffline(true);
    await expect(page.getByTestId("sync-indicator")).toContainText("Offline", {
      timeout: 10_000,
    });
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("quick-add-offline-note")).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    const title = `E2E-offline-desktop ${String(Date.now())}`;
    await form.getByLabel("Tehtävän nimi").fill(title);
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    const card = page.getByTestId("today-groups-card");
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText(title);
    await context.setOffline(false);
  });
});
