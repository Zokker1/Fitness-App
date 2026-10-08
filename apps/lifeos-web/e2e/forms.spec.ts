// T047: lomakekenttien E2E-smoke (chromium, preview-build).
// T048: + date/time/segmented.
// - Probe renderöityy vain ?e2e=1:llä (tuotannossa piilossa).
// - Label-sidonta: joka kenttä löytyy nimellään (ei placeholder-labelia).
// - Touch-targetit ≥44px korkeus (mitattu, ei silmämäärä).
// - Kirjoitus + select-valinta + date/time-fill + segmented-klikkaus toimivat;
//   virhetilat näkyvät (role=alert).
// - Ei PII:tä/terveysdataa: synteettiset arvot.
import { expect, test } from "@playwright/test";

test("lomakekentät: labelit + kirjoitus + valinta ?e2e=1:llä", async ({ page }) => {
  await page.goto("/?e2e=1&probe=lomakkeet");
  const probe = page.getByTestId("form-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByLabel("Tehtävän nimi", { exact: true })).toBeVisible();
  await expect(probe.getByLabel("Kappalemäärä", { exact: true })).toBeVisible();
  await expect(probe.getByLabel("Prioriteetti", { exact: true })).toBeVisible();
  await expect(probe.getByLabel("Tagi", { exact: true })).toBeVisible();
  await expect(probe.getByLabel("Päivämäärä", { exact: true })).toBeVisible();
  await expect(probe.getByLabel("Kellonaika", { exact: true })).toBeVisible();
  await expect(probe.getByRole("group", { name: "Näkymä" })).toBeVisible();

  // exact: "Määrä" on "Päivämäärä"-labelin alimerkkijono — ilman exactia
  // Playwright täsmäisi molempiin (strict-mode-virhe).
  await probe.getByLabel("Tehtävän nimi", { exact: true }).fill("Osta maitoa");
  await expect(probe.getByLabel("Tehtävän nimi", { exact: true })).toHaveValue("Osta maitoa");
  await probe.getByLabel("Prioriteetti", { exact: true }).selectOption("high");
  await expect(probe.getByLabel("Prioriteetti", { exact: true })).toHaveValue("high");
  await probe.getByLabel("Päivämäärä", { exact: true }).fill("2026-09-16");
  await expect(probe.getByLabel("Päivämäärä", { exact: true })).toHaveValue("2026-09-16");
  await probe.getByLabel("Kellonaika", { exact: true }).fill("08:30");
  await expect(probe.getByLabel("Kellonaika", { exact: true })).toHaveValue("08:30");
  await probe.getByRole("radio", { name: "Viikko" }).check();
  await expect(probe.getByRole("radio", { name: "Viikko" })).toBeChecked();

  await expect(probe.getByRole("alert").first()).toContainText("Sähköposti puuttuu");
});

test("lomakekentät: korkeus ≥44px + focus näkyy", async ({ page }) => {
  await page.goto("/?e2e=1&probe=lomakkeet");
  const probe = page.getByTestId("form-probe");
  await expect(probe).toBeVisible();
  for (const name of ["Tehtävän nimi", "Kappalemäärä", "Prioriteetti", "Tagi", "Päivämäärä"]) {
    const box = await probe.getByLabel(name, { exact: true }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box?.height ?? 0, `${name} korkeus`).toBeGreaterThanOrEqual(44);
  }
  // Segmentoidun option touch-target (label, 44px). getByText palauttaa
  // sisemmän spanin — mitataan sen label-vanhempi (koko klikattava alue).
  const segmentLabel = probe.locator("[data-ui='segmented-option']", {
    hasText: "Viikko",
  });
  const segmentBox = await segmentLabel.boundingBox();
  expect(segmentBox?.height ?? 0, "segmentti korkeus").toBeGreaterThanOrEqual(44);
  await probe.getByLabel("Tehtävän nimi", { exact: true }).focus();
  const outline = await page.evaluate(
    () => getComputedStyle(document.activeElement ?? document.body).outlineStyle,
  );
  expect(["solid", "auto"]).toContain(outline);
});

test("lomakekentät piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("form-probe")).toHaveCount(0);
});
