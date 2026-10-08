// T049: korttiperheiden E2E-smoke (chromium, preview-build).
// - Probe vain ?e2e=1:llä (tuotannossa piilossa).
// - 4 perhettä + Status-sävyt renderöityvät; progress on natiivi elementti.
// - Ei PII:tä/terveysdataa: synteettiset arvot.
import { expect, test } from "@playwright/test";

test("korttiperheet näkyvät ?e2e=1:llä", async ({ page }) => {
  await page.goto("/?e2e=1&probe=kortit");
  const probe = page.getByTestId("card-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Mitä seuraavaksi" })).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Viikon fokus" })).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Päivän virta" })).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Huomio" })).toBeVisible();
  await expect(probe.getByText("Ei merkintöjä vielä — suunniteltu tyhjä tila")).toBeVisible();
  const progress = probe.locator("progress");
  await expect(progress).toHaveAttribute("value", "62");
  await expect(probe.getByText(/enemmän kuin viime viikolla/)).toBeVisible();
});

test("korttiperheet piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("card-probe")).toHaveCount(0);
});
