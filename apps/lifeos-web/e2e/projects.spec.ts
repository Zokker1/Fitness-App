// T107: Projektit E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: tehtäväryhmällä on progress, status ja historia.
// - Luonti /projects:issa (nimi → Luo projekti);
// - tehtävä linkitetään projektiin Quick Taskin Projekti-valinnalla;
// - progress (done/total), johdettu status (Käynnissä → Valmis) ja historia
//   (valmistuminen listautuu) päivittyvät näkymässä.
// Data elää sivun muistissa → luonnin jälkeen VAIN SPA-navigointia (nav-
// linkit), ei page.gotoa kesken testin.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
import { expect, test } from "@playwright/test";

test.describe("projektit (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("projekti: luonti, linkitys, progress, status ja historia", async ({ page }) => {
    await page.goto("/projects");
    await expect(page.getByRole("heading", { level: 1, name: "Projektit" })).toBeVisible();
    await expect(page.getByTestId("project-view")).toContainText("Ei projekteja.");

    // 1) Luo projekti.
    await page.getByLabel("Projektin nimi").fill("T107-siivous");
    await page.getByTestId("project-create").click();
    await expect(page.getByTestId("project-list")).toContainText("T107-siivous");
    await expect(page.getByTestId("project-list")).toContainText("Käynnissä");
    await expect(page.getByTestId("project-list")).toContainText("0/0");

    // 2) SPA-navigointi /tasks:iin (nav-linkki — data säilyy muistissa) ja
    //    tehtävän luonti projektiin Quick Taskin Projekti-valinnalla.
    const nav = page.getByRole("navigation", { name: "Päänavigaatio" });
    await nav.getByRole("link", { name: "Tehtävät" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Tehtävän nimi").fill("T107-imbuss");
    await form.getByLabel("Projekti (valinnainen)").selectOption({ label: "T107-siivous" });
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    await expect(page.getByTestId("task-inbox-open")).toContainText("T107-imbuss");

    // 3) Takaisin projekteihin: progress 0/1, status Käynnissä.
    await nav.getByRole("link", { name: "Projektit" }).click();
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByTestId("project-list")).toContainText("T107-siivous");
    await expect(page.getByTestId("project-list")).toContainText("0/1");
    await expect(page.getByTestId("project-list")).toContainText("Käynnissä");

    // 4) Merkitse tehtävä valmiiksi /tasks:issa.
    await nav.getByRole("link", { name: "Tehtävät" }).click();
    await expect(page).toHaveURL(/\/tasks$/);
    await page.getByTestId("task-inbox-open").getByRole("checkbox").first().click();
    await expect(page.getByTestId("task-inbox-done")).toContainText("T107-imbuss");

    // 5) Projekti: progress 1/1, status Valmis + valmistumishistoria.
    await nav.getByRole("link", { name: "Projektit" }).click();
    await expect(page.getByTestId("project-list")).toContainText("1/1");
    await expect(page.getByTestId("project-list")).toContainText("Valmis");
    await expect(page.getByTestId("project-list")).toContainText("Historia");
    await expect(page.getByTestId("project-list")).toContainText("T107-imbuss");
    await expect(page.getByTestId("project-list")).toContainText("Valmistui");
  });
});
