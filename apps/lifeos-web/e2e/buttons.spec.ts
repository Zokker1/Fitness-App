// T046: Button-perheen E2E-smoke (chromium, preview-build).
// - Probe renderöityy vain ?e2e=1:llä (tuotannossa piilossa).
// - Kaikki variantit näkyvät + touch-targetit ≥44px (mitattu, ei silmämäärä).
// - Focus näkyy keyboardilla (Tab → focus-visible-rengas).
// - Ei PII:tä/terveysdataa: vain nappien rakenne + mitat.
import { expect, test } from "@playwright/test";

test("button-perhe: variantit + states näkyvät ?e2e=1:llä", async ({ page }) => {
  await page.goto("/?e2e=1&probe=napit");
  const probe = page.getByTestId("button-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByRole("button", { name: "Ensisijainen" })).toBeVisible();
  await expect(probe.getByRole("button", { name: "Toissijainen" })).toBeVisible();
  await expect(probe.getByRole("button", { name: "Poista" })).toBeVisible();
  await expect(probe.getByRole("button", { name: "Peruuta" })).toBeVisible();
  await expect(probe.getByRole("button", { name: "Ladataan…" })).toBeDisabled();
  await expect(probe.getByRole("button", { name: "Estetty" })).toBeDisabled();
  await expect(probe.getByRole("button", { name: "Sulje valikko" })).toBeVisible();
  await expect(probe.getByRole("button", { name: /Kirjaa/ })).toBeVisible();
});

test("button-perhe: touch-targetit ≥44px + focus näkyy", async ({ page }) => {
  await page.goto("/?e2e=1&probe=napit");
  const probe = page.getByTestId("button-probe");
  await expect(probe).toBeVisible();
  for (const name of ["Ensisijainen", "Sulje valikko"]) {
    const box = await probe.getByRole("button", { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect(box?.height ?? 0, `${name} korkeus`).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0, `${name} leveys`).toBeGreaterThanOrEqual(44);
  }
  // Keyboard-focus: Tabilla ensimmäiseen nappiin → focus-visible-rengas.
  await page.keyboard.press("Tab");
  const outline = await page.evaluate(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) {
      return "no-focus";
    }
    return getComputedStyle(active).outlineStyle;
  });
  expect(["solid", "auto"]).toContain(outline);
});

test("button-perhe piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("button-probe")).toHaveCount(0);
});
