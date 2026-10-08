// T158: goal/routine E2E + visual. Todistaa 14 päivän tavoitejakson,
// yhden päivän kirjauksen, monivaiheisen rutiinin ja historian kertymisen.
import { expect, test, type Page } from "@playwright/test";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function goToGoals(page: Page): Promise<void> {
  const navigation = page.getByRole("navigation", { name: "Päänavigaatio" });
  const directLink = navigation.getByRole("link", { name: "Tavoitteet ja rutiinit" });
  if (await directLink.isVisible()) {
    await directLink.click();
    return;
  }
  await navigation.getByRole("button", { name: "Lisää" }).click();
  const more = page.getByRole("dialog", { name: "Lisää" });
  await more.getByRole("link", { name: "Tavoitteet ja rutiinit" }).click();
  await page.keyboard.press("Escape");
}

async function runGoalRoutineJourney(page: Page, viewportLabel: "mobile" | "desktop") {
  await page.goto("/goals");
  const goals = page.getByTestId("goals-overview");
  await expect(goals).toBeVisible();

  // CREATE: oletusjakso on 14 paikallista kalenteripäivää.
  await goals.getByTestId("goal-create-open").click();
  const wizard = page.getByTestId("goal-create-wizard");
  await wizard.getByLabel("Joka päivä").check();
  await wizard.getByRole("button", { name: "Jatka" }).click();
  await expect(wizard.getByLabel("Alkaa")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await expect(wizard.getByLabel("Päättyy")).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await wizard.getByRole("button", { name: "Jatka" }).click();
  await wizard.getByLabel("Tavoitteen nimi").fill("T158 14 päivän tavoite");
  await wizard.getByRole("button", { name: "Tallenna tavoite" }).click();

  await expect(page.getByTestId("goal-list")).toContainText("T158 14 päivän tavoite");
  await page.getByTestId("goal-list").getByRole("link", { name: "Avaa tavoite" }).click();
  const goalDetail = page.getByTestId("goal-detail");
  await expect(goalDetail).toBeVisible();
  await expect(goalDetail.getByRole("gridcell")).toHaveCount(14);
  await expect(goalDetail.getByTestId("goal-detail-progress")).toContainText("0 / 14");
  await expect(
    goalDetail
      .locator('[data-ui="goal-detail-grid"]')
      .locator('[data-state="future"], [data-state="pending"], [data-state="open"]'),
  ).toHaveCount(14);
  await expect(page).toHaveScreenshot(`goal-routine-goal-${viewportLabel}.png`, {
    animations: "disabled",
    fullPage: true,
    mask: [
      goalDetail.getByTestId("goal-detail-calendar"),
      goalDetail.locator('[data-ui="goal-detail-facts"]'),
    ],
  });

  // ADVANCE ONE DAY: Today-kirjaus muuttaa vain tämän päivän tilan.
  const navigation = page.getByRole("navigation", { name: "Päänavigaatio" });
  await navigation.getByRole("link", { name: "Tänään" }).click();
  const todayGoals = page.getByTestId("today-goals-card");
  await expect(todayGoals).toBeVisible();
  await todayGoals.getByRole("checkbox").click();
  await expect(todayGoals).toContainText("1/1", { timeout: 15_000 });

  await goToGoals(page);
  await page.getByTestId("goal-list").getByRole("link", { name: "Avaa tavoite" }).click();
  const progressedGoal = page.getByTestId("goal-detail");
  await expect(progressedGoal.getByTestId("goal-detail-progress")).toContainText("1 / 14");
  await expect(
    progressedGoal.locator('[data-ui="goal-detail-grid"] [data-state="success"]'),
  ).toHaveCount(1);
  await expect(progressedGoal.getByRole("gridcell")).toHaveCount(14);

  // CREATE + COMPLETE: mallin kolme vaihetta etenevät yksi kerrallaan.
  await goToGoals(page);
  const routineOverview = page.getByTestId("routine-overview");
  await expect(routineOverview).toBeVisible();
  await routineOverview.getByTestId("routine-template-create-morning").click();
  await expect(routineOverview).toContainText("Aamun rauhallinen alku");
  await routineOverview.getByRole("link", { name: "Aamun rauhallinen alku" }).click();

  const player = page.getByTestId("routine-player");
  await expect(player).toBeVisible();
  await expect(player.locator('[data-testid^="routine-step-"]')).toHaveCount(3);
  await player.getByRole("button", { name: "Aloita tämän päivän rutiini" }).click();
  for (let index = 0; index < 3; index += 1) {
    await expect(player.getByTestId("routine-complete-step")).toBeVisible();
    await player.getByTestId("routine-complete-step").click();
  }
  await expect(player.getByRole("status")).toContainText("rutiini on valmis");
  await expect(player.locator('[data-testid^="routine-step-"][data-state="done"]')).toHaveCount(3);
  // Full-page-kaappauksessa fixed-ohjaimet siirtyvät dokumentin pituuden
  // mukana. Piilotetaan ne vain kaappauksen ajaksi; niiden omat E2E-testit
  // kattavat näkyvyyden ja DOM-puun muuttumattomuus säilyttää reitityksen.
  const transientControls = page.locator(
    '[data-ui="toast-viewport"], [data-ui="fab"], [data-ui="bottom-nav"]',
  );
  await transientControls.evaluateAll((elements) => {
    for (const element of elements) {
      element.setAttribute("hidden", "");
    }
  });
  try {
    await expect(player).toHaveScreenshot(`goal-routine-player-${viewportLabel}.png`, {
      animations: "disabled",
      mask: [player.getByTestId("routine-player-history")],
    });
  } finally {
    await transientControls.evaluateAll((elements) => {
      for (const element of elements) {
        element.removeAttribute("hidden");
      }
    });
  }

  // HISTORY: kummankin päivän kirjaus näkyy yhteisellä aikajanalla.
  await player.getByRole("button", { name: "Palaa tavoitteiden listaan" }).click();
  await page.getByTestId("goal-history-link").click();
  const history = page.getByTestId("goal-routine-history");
  await expect(history).toBeVisible();
  await expect(history.getByTestId("history-list-card")).toContainText("T158 14 päivän tavoite");
  await expect(history.getByTestId("history-list-card")).toContainText("Aamun rauhallinen alku");
  await expect(history).toContainText("Näytetään 2 / 2 merkintää.");

  const overflow = await page.evaluate(() => {
    const element = document.scrollingElement;
    return element === null || element.scrollWidth > element.clientWidth;
  });
  expect(overflow).toBe(false);
}

test.describe("goal + routine elinkaari — mobiili 390px", () => {
  test.use({ viewport: MOBILE });

  test("14 päivän tavoite ja monivaiheinen rutiini", async ({ page }) => {
    await runGoalRoutineJourney(page, "mobile");
  });
});

test.describe("goal + routine elinkaari — desktop 1280px", () => {
  test.use({ viewport: DESKTOP });

  test("14 päivän tavoite ja monivaiheinen rutiini", async ({ page }) => {
    await runGoalRoutineJourney(page, "desktop");
  });
});
