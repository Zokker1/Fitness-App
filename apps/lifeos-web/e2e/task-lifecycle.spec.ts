// T118: task-elinkaaren E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: create → plan → complete → reopen → history toimii mobiili- ja
// desktop-selaimessa (§57.7: sama toiminto molemmilla viewporteilla).
// - CREATE: FAB → Quick Task (nimi + arvio);
// - PLAN: rivi avoimissa arviometalla + upcoming-yhteisarvio;
// - COMPLETE: checkbox → Valmiit; XP kirjaantuu palvelupuolella (T117,
//   ei suoraa UI-assertiota tässä — TodayView-metri kuluttaa saman repun);
// - REOPEN: valmiin rivin checkbox → takaisin Avoimiin;
// - HISTORY: task detail (Muokkaa → ?task=<id>) näyttää Luotu / Valmistui /
//   Avattu uudelleen ja version kasvun (v1 luonti, v2 valmistus, v3 avaus).
// Data elää sivun muistissa → goto vain alkuun, loput SPA:lla.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function runLifecycle(page: Page): Promise<void> {
  await page.goto("/tasks");
  await page.getByTestId("quick-add-fab").click();
  const dialog = page.getByRole("dialog", { name: "Kirjaa" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tehtävä" }).click();
  const form = page.getByTestId("quick-task-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Tehtävän nimi").fill("T118-kiertotehtävä");
  await form.getByLabel("Arvio (valinnainen)").selectOption({ label: "25 min" });
  await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
  await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);

  // PLAN: rivi avoimissa arviometalla; upcoming-yhteisarvio näkyy.
  const open = page.getByTestId("task-inbox-open");
  await expect(open).toContainText("T118-kiertotehtävä");
  await expect(open).toContainText("Arvio 25 min — timebox-ehdotus 1 × 25 min");
  await page.getByTestId("task-inbox-view-toggle").click();
  await expect(page.getByTestId("task-planning-total")).toContainText("arvio yht. 25 min");
  await page.getByTestId("task-inbox-view-toggle").click();

  // COMPLETE: checkbox → Valmiit.
  await open.getByRole("checkbox").first().click();
  const done = page.getByTestId("task-inbox-done");
  await expect(done).toContainText("T118-kiertotehtävä");

  // REOPEN: valmiin rivin checkbox → takaisin Avoimiin.
  await done.getByRole("checkbox").first().click();
  await expect(page.getByTestId("task-inbox-open")).toContainText("T118-kiertotehtävä");
  await expect(page.getByTestId("task-inbox-done")).toHaveCount(0);

  // HISTORY: detail-näkymä — Luotu, Valmistui, Avattu uudelleen, versio 3.
  const row = page.getByTestId("task-inbox-open").locator("li", { hasText: "T118-kiertotehtävä" });
  await row.getByRole("button", { name: "Muokkaa" }).click();
  await expect(page).toHaveURL(/task=/);
  const detail = page.getByTestId("task-detail");
  await expect(detail).toContainText("Historia");
  await expect(detail).toContainText("Luotu");
  await expect(detail).toContainText("Valmistui");
  await expect(detail).toContainText("Avattu uudelleen");
  await expect(detail).toContainText("versio 3");
  // Kentät säilyneet: arvio edelleen 25 min.
  await expect(page.getByLabel("Arvio")).toHaveValue("25");

  // Paluu inboxiin — rivi yhä avoinna.
  await page.getByTestId("task-detail-back").click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByTestId("task-inbox-open")).toContainText("T118-kiertotehtävä");
}

test.describe("task elinkaari — mobiili 390px", () => {
  test.use({ viewport: MOBILE });

  test("create → plan → complete → reopen → history", async ({ page }) => {
    await runLifecycle(page);
  });
});

test.describe("task elinkaari — desktop 1280px", () => {
  test.use({ viewport: DESKTOP });

  test("create → plan → complete → reopen → history", async ({ page }) => {
    await runLifecycle(page);
  });
});
