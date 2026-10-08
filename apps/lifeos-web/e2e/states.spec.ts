// T051: ydintilojen E2E-smoke (chromium, preview-build).
// - Probe vain ?e2e=1:llä (tuotannossa piilossa).
// - Empty/Skeleton/Alert renderöityvät; Toast avautuu napista ja
//   sulkeutuu sulkunapilla (teko→palaute-ketju).
// - Ei PII:tä/terveysdataa: synteettiset arvot.
import { expect, test } from "@playwright/test";

test("ydintilat näkyvät ?e2e=1:llä", async ({ page }) => {
  await page.goto("/?e2e=1&probe=tilat");
  const probe = page.getByTestId("state-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Ydintilat" })).toBeVisible();
  await expect(probe.getByText("Ei tehtäviä vielä")).toBeVisible();
  await expect(probe.getByText("Ladataan…")).toBeVisible();
  await expect(probe.getByText("Synkronoitu", { exact: true })).toBeVisible();
  await expect(probe.getByText("Tarkista mittaus", { exact: true })).toBeVisible();
  await expect(probe.getByRole("alert")).toBeVisible();
});

test("toast avautuu napista ja sulkeutuu", async ({ page }) => {
  await page.goto("/?e2e=1&probe=tilat");
  const probe = page.getByTestId("state-probe");
  await probe.getByRole("button", { name: "Näytä ilmoitus" }).click();
  const toast = probe.getByText("Tehtävä tallennettu");
  await expect(toast).toBeVisible();
  await probe.getByRole("button", { name: "Sulje ilmoitus" }).click();
  await expect(toast).toHaveCount(0);
});

test("ydintilat piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("state-probe")).toHaveCount(0);
});
