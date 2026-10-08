// T112: task detail E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: kaikki kentät, historia ja linkitykset selkeästi muokattavissa.
// - Inbox "Muokkaa" → /tasks/:id; otsikko + arvio muokataan ja tallennetaan;
// - historia näyttää version + päivitysleiman; muutokset näkyvät inboxissa;
// - tuntematon id → rehellinen ei-löytynyt -tila.
// Data elää sivun muistissa → goto vain alkuun, loput SPA:lla.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
import { expect, test } from "@playwright/test";

test.describe("task detail (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("muokkaus: kentät, tallennus, historia ja paluu inboxiin", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Tehtävän nimi").fill("T112-alku");
    await form.getByLabel("Arvio (valinnainen)").selectOption({ label: "25 min" });
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);

    // Avaa detail inboxin Muokkaa-painikkeesta (?task=<id>, SPA).
    const row = page.getByTestId("task-inbox-open").locator("li", { hasText: "T112-alku" });
    await row.getByRole("button", { name: "Muokkaa" }).click();
    await expect(page).toHaveURL(/\/tasks\?task=/);
    await expect(page.getByRole("heading", { level: 1, name: "Tehtävän tiedot" })).toBeVisible();

    // Muokkaa otsikko + arvio: timebox-hint päivittyy heti.
    await page.getByLabel("Otsikko").fill("T112-muokattu");
    await page.getByLabel("Arvio").selectOption({ label: "90 min" });
    await expect(page.getByText("Timebox-ehdotus: 4 × 25 min")).toBeVisible();
    await page.getByTestId("task-detail-save").click();
    await expect(page.getByTestId("task-detail-saved")).toContainText("tallennettu");
    await expect(page.getByTestId("task-detail")).toContainText("Historia");
    await expect(page.getByTestId("task-detail")).toContainText("versio 2");

    // Paluu inboxiin: muutokset näkyvät (otsikko + arviometa).
    await page.getByTestId("task-detail-back").click();
    await expect(page).toHaveURL(/\/tasks$/);
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T112-muokattu");
    await expect(open).toContainText("Arvio 1 t 30 min");
    await expect(open).toContainText("timebox-ehdotus 4 × 25 min");
  });

  test("tuntematon tehtävä: rehellinen ei-löytynyt -tila", async ({ page }) => {
    await page.goto("/tasks?task=ei-loydy");
    await expect(page.getByTestId("task-detail")).toContainText("Tehtävää ei löytynyt.");
  });
});
