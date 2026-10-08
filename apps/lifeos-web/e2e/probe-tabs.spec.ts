// T056-tukimuutos + T058: näyteikkunan osiovalinnan E2E (chromium,
// preview-build).
// - Probe-tabs näkyy vain ?e2e=1:llä; oletusosio "Näkymä" = varsinainen
//   sovellusnäkymä ilman probepinoa (ei loputonta syötettä).
// - Osio linkki tuo proben esiin + aria-current merkitsee valinnan;
//   osio-parametri säilyy sovelluksen omassa navigoinnissa.
// - T058-kriteeri: JOKAINEN osio tuo oman proben esiin (kaikki komponentti-
//   perheet tarkastettavissa samasta kehitysnäkymästä).
// - Tuotannossa (ilman ?e2e=1) valintaa ei ole.
import { expect, test } from "@playwright/test";

const SECTION_PROBES = [
  { label: "Tavoite", testId: "goal-detail" },
  { label: "Rutiini", testId: "routine-player" },
  { label: "Typografia", testId: "typography-probe" },
  { label: "Napit", testId: "button-probe" },
  { label: "Lomakkeet", testId: "form-probe" },
  { label: "Kortit", testId: "card-probe" },
  { label: "Overlayt", testId: "overlay-probe" },
  { label: "Tilat", testId: "state-probe" },
  { label: "Edistyminen", testId: "progress-probe" },
  { label: "Graafit", testId: "chart-probe" },
  { label: "Liike", testId: "motion-probe" },
  { label: "Persistenssi", testId: "persistence-probe" },
] as const;

test("osiovalinta: oletus Näkymä ilman probeja, osiolinkki tuo proben", async ({ page }) => {
  await page.goto("/?e2e=1");
  const tabs = page.getByTestId("probe-tabs");
  await expect(tabs).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Näkymä" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByRole("heading", { level: 1, name: "Tänään" })).toBeVisible();
  await expect(page.getByTestId("chart-probe")).toHaveCount(0);
  await expect(page.getByTestId("motion-probe")).toHaveCount(0);

  await tabs.getByRole("link", { name: "Graafit" }).click();
  await expect(page).toHaveURL(/probe=graafit/);
  await expect(page.getByTestId("chart-probe")).toBeVisible();
  await expect(tabs.getByRole("link", { name: "Graafit" })).toHaveAttribute("aria-current", "true");

  // Osio säilyy sovelluksen omassa navigoinnissa (rail-linkki).
  await page.getByRole("link", { name: "Tehtävät" }).first().click();
  await expect(page).toHaveURL(/probe=graafit/);
  await expect(page.getByTestId("probe-tabs")).toBeVisible();
});

test("probe-tabs nuolet siirtyvät edelliseen ja seuraavaan osioon", async ({ page }) => {
  await page.goto("/?e2e=1&probe=tavoite");

  await expect(page.getByTestId("probe-tab-arrow-previous")).toHaveAttribute(
    "aria-label",
    "Edellinen osio: Näkymä",
  );
  await expect(page.getByTestId("probe-tab-arrow-next")).toHaveAttribute(
    "aria-label",
    "Seuraava osio: Rutiini",
  );

  await page.getByTestId("probe-tab-arrow-next").click();
  await expect(page).toHaveURL(/probe=rutiini/);
  await page.getByTestId("probe-tab-arrow-previous").click();
  await expect(page).toHaveURL(/probe=tavoite/);
});

test("T058: jokainen osio tuo oman proben esiin", async ({ page }) => {
  await page.goto("/?e2e=1");
  for (const section of SECTION_PROBES) {
    await page
      .getByTestId("probe-tabs")
      .getByRole("link", { name: section.label, exact: true })
      .click();
    await expect(page.getByTestId(section.testId)).toBeVisible();
  }
});

test("probe-tabs piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("probe-tabs")).toHaveCount(0);
});
