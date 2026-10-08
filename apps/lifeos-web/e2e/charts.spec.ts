// T053: chart-framen E2E-smoke (chromium, preview-build).
// - Probe vain ?e2e=1:llä (tuotannossa piilossa).
// - Datallinen frame: otsikko + range-vaihto + tekstivastine; tyhjä +
//   lataava renderöityvät omilla tiloillaan.
// - Ei PII:tä/terveysdataa: synteettiset arvot.
import { expect, test } from "@playwright/test";

test("chart frame näkyy ?e2e=1:llä (data + tyhjä + lataus)", async ({ page }) => {
  await page.goto("/?e2e=1&probe=graafit");
  const probe = page.getByTestId("chart-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Graafikehys" })).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Viikon fokus" })).toBeVisible();
  await expect(probe.getByText("Yksikkö: min").first()).toBeVisible();
  // Range-vaihto: toinen vaihtoehto valittavissa radioryhmässä.
  await probe.getByRole("radio", { name: "30 pv" }).first().click();
  await expect(probe.getByRole("radio", { name: "30 pv" }).first()).toBeChecked();
  // Tekstivastine aukeaa ja näyttää datarivit (summary-elementti).
  const summary = probe.getByText("Tekstivastine taulukkona").first();
  await summary.scrollIntoViewIfNeeded();
  await summary.click();
  await expect(probe.getByRole("rowheader", { name: "10.9." })).toBeVisible();
  // Tyhjä + lataava tila.
  await expect(probe.getByText("Ei mittauksia vielä").first()).toBeVisible();
  await expect(probe.getByText("Ladataan…")).toBeVisible();
});

test("chart frame piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("chart-probe")).toHaveCount(0);
});
