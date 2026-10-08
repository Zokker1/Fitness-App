// T096: global search -haun E2E (chromium, preview-build, PROBE-näkymä
// ?e2e=1&probe=haku — tuotantokanta on tyhjä, joten ryhmittely todistetaan
// probedatalla; tuotannossa tyhjän kannan käytös + offline + laukaisimet).
// T096-kriteeri: haku toimii keyboardilla ja kosketuksella, ryhmittelee
// tulokset tyypeittäin. T097-kriteeri: tulos avaa oikean näkymän ilman
// raakadatan paljastusta (kohde on vain polku; probe näyttää kohteen).
// Ei PII:tä: synteettiset näytetekstit.
import { expect, test } from "@playwright/test";

test.describe("global search probe (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("dialogi + ryhmittely tyypeittäin probedatalla", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const probe = page.getByTestId("search-probe");
    await expect(probe).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Hakusana").fill("maito");
    const results = page.getByTestId("search-results");
    await expect(results).toBeVisible();
    await expect(page.getByTestId("search-count")).toContainText("osumaa");
    // Ryhmät tyypeittäin (labelit T095:stä).
    await expect(page.getByTestId("search-group-task")).toContainText("Tehtävät");
    await expect(page.getByTestId("search-group-project")).toContainText("Projektit");
    await expect(page.getByTestId("search-group-tag")).toContainText("Tagit");
    await expect(page.getByTestId("search-group-goal")).toContainText("Tavoitteet");
    await expect(page.getByTestId("search-group-routine")).toContainText("Rutiinit");
    await expect(page.getByTestId("search-group-journal")).toContainText("Päiväkirja");
    // Osumarivi näyttää vain otsikon (ei raakadataa — T097 avaa kohteen).
    await expect(page.getByTestId("search-hit-task-sx-t1")).toHaveText("Osta maitoa");
  });

  test("X sulkee haun ja haku voidaan avata uudelleen", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await expect(dialog).toBeVisible();

    await dialog.getByRole("button", { name: "Sulje" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByTestId("search-probe-open").click();
    await expect(page.getByRole("dialog", { name: "Haku" })).toBeVisible();
  });

  test("keyboard: ArrowDown + Enter valitsee toisen osuman", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await expect(dialog).toBeVisible();
    const input = dialog.getByLabel("Hakusana");
    await input.fill("osta");
    await input.press("ArrowDown");
    await input.press("Enter");
    await expect(page.getByTestId("search-probe-selected")).toContainText("task:sx-t2");
  });

  test("kosketus: rivin napautus valitsee (kind+id)", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await dialog.getByLabel("Hakusana").fill("maitoa");
    await page.getByTestId("search-hit-task-sx-t1").click();
    await expect(page.getByTestId("search-probe-selected")).toContainText("task:sx-t1");
  });

  test("T097: valinta näyttää kohdereitin ilman raakadataa", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await dialog.getByLabel("Hakusana").fill("maitoa");
    await page.getByTestId("search-hit-task-sx-t1").click();
    // Kohde on VAIN polku — ei id:tä, ei raakadataa.
    await expect(page.getByTestId("search-probe-navigated")).toHaveText("Kohde: /tasks");
    // Terveyslaji samalla kartalla → /health.
    await dialog.getByLabel("Hakusana").fill("maitopäivä");
    await page.getByTestId("search-hit-journal-sx-j1").click();
    await expect(page.getByTestId("search-probe-navigated")).toHaveText("Kohde: /health");
  });

  test("ei osumia → rehellinen tyhjätila; tyhjä kysely → ohje", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await dialog.getByLabel("Hakusana").fill("avaruusraketti");
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await expect(page.getByTestId("search-results")).toHaveCount(0);
    await dialog.getByLabel("Hakusana").fill("");
    await expect(page.getByTestId("search-hint")).toBeVisible();
  });
});

test.describe("global search probe (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama dialogi ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/?e2e=1&probe=haku");
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Hakusana").fill("maito");
    await expect(page.getByTestId("search-results")).toBeVisible();
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

test.describe("global search tuotanto: laukaisimet + navigointi E2E-seedillä", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("nav-laukaisin avaa dialogin; seedattu osuma navigoi /tasks:iin", async ({ page }) => {
    await page.goto("/?e2e=1&searchSeed=maito");
    const bottomNav = page.getByRole("navigation", { name: "Päänavigaatio (mobiili)" });
    await bottomNav.getByRole("button", { name: "Haku" }).click();
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Hakusana").fill("maito");
    await expect(page.getByTestId("search-hit-task-seed-t1")).toBeVisible();
    await page.getByTestId("search-hit-task-seed-t1").click();
    // T097: valinta navigoi kohdereitille (searchTargetFor) ja sulkee dialogin.
    // E2E-seedin id:t näkyvät vain URLittomassa polussa — ei raakadataa.
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByRole("dialog", { name: "Haku" })).toHaveCount(0);
  });

  test("jokainen laji navigoi loogiseen päänäkymään (kartta E2E-seedillä)", async ({ page }) => {
    const cases = [
      { seed: "projekti", hit: "search-hit-project-seed-p1", url: /\/tasks$/ },
      { seed: "tavoite", hit: "search-hit-goal-seed-g1", url: /\/goals$/ },
      { seed: "rutiini", hit: "search-hit-routine-seed-r1", url: /\/goals$/ },
      { seed: "terveys", hit: "search-hit-journal-seed-j1", url: /\/health$/ },
    ] as const;
    for (const seed of cases) {
      await page.goto(`/?e2e=1&searchSeed=${seed.seed}`);
      await page
        .getByRole("navigation", { name: "Päänavigaatio (mobiili)" })
        .getByRole("button", { name: "Haku" })
        .click();
      const dialog = page.getByRole("dialog", { name: "Haku" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Hakusana").fill(seed.seed);
      await page.getByTestId(seed.hit).click();
      await expect(page).toHaveURL(seed.url);
      await expect(page.getByRole("dialog", { name: "Haku" })).toHaveCount(0);
    }
  });

  test("tyhjä tuotantokanta: ohje + tyhjätila (ei vuotoa)", async ({ page }) => {
    await page.goto("/");
    const bottomNav = page.getByRole("navigation", { name: "Päänavigaatio (mobiili)" });
    await bottomNav.getByRole("button", { name: "Haku" }).click();
    const dialog = page.getByRole("dialog", { name: "Haku" });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("search-hint")).toBeVisible();
    await dialog.getByLabel("Hakusana").fill("maito");
    await expect(page.getByTestId("search-empty")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Haku" })).toHaveCount(0);
  });
});
