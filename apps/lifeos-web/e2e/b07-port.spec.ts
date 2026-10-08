// T159: B07-portti. Tavoitteet, habit-kalenteri ja rutiinit muodostavat
// yhden lempeän seurannan ilman nollautuvaa tai rankaisevaa streak-logiikkaa.
import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function createDailyGoal(page: Page): Promise<void> {
  const goals = page.getByTestId("goals-overview");
  await goals.getByTestId("goal-create-open").click();
  const wizard = page.getByTestId("goal-create-wizard");
  await wizard.getByLabel("Joka päivä").check();
  await wizard.getByRole("button", { name: "Jatka" }).click();
  await wizard.getByRole("button", { name: "Jatka" }).click();
  await wizard.getByLabel("Tavoitteen nimi").fill("T159 lempeä päivätavoite");
  await wizard.getByRole("button", { name: "Tallenna tavoite" }).click();
  await expect(page.getByTestId("goal-list")).toContainText("T159 lempeä päivätavoite");
}

async function runB07Port(page: Page): Promise<void> {
  await page.goto("/goals");
  await expect(page.getByTestId("goals-overview")).toBeVisible();
  await createDailyGoal(page);

  // Habit-kalenteri: tulevat ja kirjaamattomat päivät ovat neutraaleja;
  // matriisi ei luo streak-mittaria eikä fail-tiloja.
  const habits = page.getByTestId("habit-tracker");
  await expect(habits).toBeVisible();
  await expect(habits).toContainText("14 päivän ikkuna");
  const habitRow = page.locator('[data-testid^="habit-row-"]');
  await expect(habitRow).toHaveCount(1);
  await expect(habitRow.locator('td[data-state="future"]')).not.toHaveCount(0);
  await expect(habitRow.locator('td[data-state="fail"]')).toHaveCount(0);
  await expect(habits).not.toContainText(/streak|putki/i);

  // Goal detail: tavoite alkaa tänään, joten tyhjä eteneminen ei esitä
  // tulevia päiviä epäonnistuneina.
  await page.getByTestId("goal-list").getByRole("link", { name: "Avaa tavoite" }).click();
  const goalDetail = page.getByTestId("goal-detail");
  await expect(goalDetail.getByTestId("goal-detail-progress")).toContainText("0 / 14");
  await expect(goalDetail.locator('[data-ui="goal-detail-grid"] [data-state="fail"]')).toHaveCount(
    0,
  );
  await expect(goalDetail).toContainText("tulevaa ei merkitä epäonnistuneeksi");
  await goalDetail.getByRole("button", { name: "Palaa tavoitteiden listaan" }).click();

  // Recovery/minimum day: kevyt rutiinipäivä säilyttää historian, mutta ei
  // muutu epäonnistumiseksi eikä vaadi kaikkien vaiheiden suorittamista.
  const routineOverview = page.getByTestId("routine-overview");
  await expect(routineOverview).toBeVisible();
  await routineOverview.getByTestId("routine-template-create-morning").click();
  await expect(routineOverview).toContainText("Aamun rauhallinen alku");
  await routineOverview.getByRole("link", { name: "Aamun rauhallinen alku" }).click();
  const player = page.getByTestId("routine-player");
  await player.getByRole("button", { name: "Tee minimipäivä" }).click();
  await expect(player.locator('[data-state="skipped"]')).toHaveCount(2);
  await player.getByRole("button", { name: "Merkitse vaihe tehdyksi" }).click();
  await expect(player.getByRole("status")).toContainText("minimipäivä on valmis");
  await expect(player).toContainText("Ei kuulu minimipäivään");
  await expect(player).toContainText("päivä ei muutu epäonnistuneeksi");
  await expect(player).not.toContainText(/streak|putki/i);

  const overflow = await page.evaluate(() => {
    const element = document.scrollingElement;
    return element === null || element.scrollWidth > element.clientWidth;
  });
  expect(overflow).toBe(false);
}

test.describe("B07-portti — mobiili 390px", () => {
  test.use({ viewport: MOBILE });

  test("tavoite, habit-kalenteri ja minimipäivä ilman streak-rangaistusta", async ({ page }) => {
    await runB07Port(page);
  });
});

test.describe("B07-portti — desktop 1280px", () => {
  test.use({ viewport: DESKTOP });

  test("tavoite, habit-kalenteri ja minimipäivä ilman streak-rangaistusta", async ({ page }) => {
    await runB07Port(page);
  });
});
