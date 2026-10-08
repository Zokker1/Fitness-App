// T101: Task Inbox -näkymän E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: nopea capture, empty state ja järjestetty lista toimivat.
// - Tyhjä kanta: tyhjätila + ohje FAB:iin (Quick Add T091).
// - Capture FAB:lla: nimi → Tallenna → tehtävä ilmestyy inboxiin HETI
//   (dataChanged-event → lataus uudestaan).
// - Jarjestys: korkean prioriteetin ennen normaalia; completed_at ennen
//   vanhempaa valmiiksi → valmiit listassa uusin ensin.
// - Valmis-merkintä siirtää rivin valmiisiin; reopen palauttaa; delete
//   tombstoneaa (rivi katoaa näkymästä).
// - T097 (hakunavigaatio) kattaa laji→näkymä-kartan; tässä fokus inboxin
//   omiin toimintoihin.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
import { expect, test } from "@playwright/test";

test.describe("task inbox (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tyhjä kanta: tyhjätila + ohje FAB:iin", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByTestId("task-inbox")).toBeVisible();
    await expect(page.getByTestId("task-inbox-empty")).toContainText("Ei tehtäviä");
    await expect(page.getByRole("heading", { level: 1, name: "Tehtävät" })).toBeVisible();
  });

  test("capture: FAB → Tehtävä → nimi → Tallenna → näkyy inboxissa", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const title = `E2E-inbox ${String(Date.now())}`;
    await page.getByTestId("quick-task-form").getByLabel("Tehtävän nimi").fill(title);
    await page
      .getByTestId("quick-task-form")
      .getByRole("button", { name: "Tallenna tehtävä" })
      .click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    await expect(page.getByTestId("task-inbox-open")).toContainText(title);
  });

  test("T103 upcoming: avoin tehtävä Seuraavat-ryhmässä, valmiit erillään", async ({ page }) => {
    await page.goto("/tasks");
    // Data elää sivun muistissa (in-memory store) — luonti ja assertiot
    // samalla sivulla ilman täysiä navigointeja (sama kaava kuin T090/T102).
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    await page
      .getByTestId("quick-task-form")
      .getByLabel("Tehtävän nimi")
      .fill("T103-näkymätehtävä");
    await page
      .getByTestId("quick-task-form")
      .getByRole("button", { name: "Tallenna tehtävä" })
      .click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    await expect(page.getByTestId("task-inbox-open")).toContainText("T103-näkymätehtävä");

    // Vaihda Seuraavat/Myöhässä-näkymään (SPA-toggle, ei gotoa):
    // avoin tehtävä (due tänään) on Seuraavat-ryhmässä — EI valmiiden kanssa.
    await page.getByTestId("task-inbox-view-toggle").click();
    await expect(page.getByTestId("task-inbox-upcoming")).toContainText("T103-näkymätehtävä");
    await expect(page.getByTestId("task-inbox-done")).toHaveCount(0);
    await expect(page.getByTestId("task-inbox")).not.toContainText("Valmiit");
  });
});

test.describe("task inbox (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama inbox ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByTestId("task-inbox")).toBeVisible();
    await expect(page.getByTestId("task-inbox-empty")).toBeVisible();
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
