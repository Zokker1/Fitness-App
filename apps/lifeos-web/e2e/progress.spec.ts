// T052: progress-komponenttien E2E-smoke (chromium, preview-build).
// - Probe vain ?e2e=1:llä (tuotannossa piilossa).
// - Palkki + rengas + pisteet + tavoitekooste renderöityvät; ruudunlukija-
//   nimet löytyvät (progressbar/img/list-roolit).
// - Ei PII:tä/terveysdataa: synteettiset arvot.
import { expect, test } from "@playwright/test";

test("progress-komponentit näkyvät ?e2e=1:llä", async ({ page }) => {
  await page.goto("/?e2e=1&probe=edistyminen");
  const probe = page.getByTestId("progress-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Edistyminen" })).toBeVisible();
  await expect(
    probe.getByRole("progressbar", { name: "Viikon fokus 62 prosenttia" }),
  ).toBeVisible();
  await expect(probe.getByRole("img", { name: "Viikon fokus 62 prosenttia" })).toBeVisible();
  await expect(probe.getByRole("list", { name: "4/7 päivää tehty" })).toBeVisible();
  await expect(probe.getByText("Jatkuu — 2 päivää jäljellä")).toBeVisible();
});

test("progress-komponentit piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("progress-probe")).toHaveCount(0);
});
