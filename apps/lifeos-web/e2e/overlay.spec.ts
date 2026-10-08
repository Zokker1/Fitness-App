// T050: overlay-perheen E2E-smoke (chromium, preview-build).
// - Probe vain ?e2e=1:llä (tuotannossa piilossa).
// - Modal: aukeaa, Esc sulkee + fokus palautuu avaajaan.
// - BottomSheet mobiilissa: dialogi alareunassa (bottom ≥ viewport/2);
//   desktopissa keskellä.
// - Scrim-klikki sulkee; back-navigointi suljetun overlayn jälkeen toimii
//   (ei history-kaappausta: back vie edelliselle reitille, ei jumiin).
// - Ei PII:tä/terveysdataa: synteettinen sisältö.
import { expect, test } from "@playwright/test";

test("modal: aukeaa + Esc sulkee + fokus palautuu", async ({ page }) => {
  await page.goto("/?e2e=1&probe=overlayt");
  const probe = page.getByTestId("overlay-probe");
  await expect(probe).toBeVisible();
  await probe.getByRole("button", { name: "Avaa modal" }).click();
  const dialog = page.getByRole("dialog", { name: "Esimerkki-modal" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(probe.getByRole("button", { name: "Avaa modal" })).toBeFocused();
});

test("bottom-sheet mobiilissa alareunassa, desktopissa keskellä", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=1&probe=overlayt");
  const probe = page.getByTestId("overlay-probe");
  await probe.getByRole("button", { name: "Avaa bottom-sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Esimerkki-sheet" });
  await expect(dialog).toBeVisible();
  const mobileBox = await dialog.boundingBox();
  expect(mobileBox, "sheet näkyy").not.toBeNull();
  expect(mobileBox?.y ?? 0, "sheet alareunassa").toBeGreaterThan(844 / 2);
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 800 });
  await probe.getByRole("button", { name: "Avaa bottom-sheet" }).click();
  const dialogDesktop = page.getByRole("dialog", { name: "Esimerkki-sheet" });
  await expect(dialogDesktop).toBeVisible();
  const desktopBox = await dialogDesktop.boundingBox();
  expect(desktopBox, "desktop-sheet näkyy").not.toBeNull();
  expect(desktopBox?.y ?? 0, "desktop-sheet keskellä").toBeGreaterThan(50);
  expect((desktopBox?.y ?? 0) + (desktopBox?.height ?? 0), "ei alareunassa").toBeLessThan(800);
});

test("scrim-klikki sulkee + back toimii sulkemisen jälkeen", async ({ page }) => {
  await page.goto("/?e2e=1&probe=overlayt");
  const probe = page.getByTestId("overlay-probe");
  await probe.getByRole("button", { name: "Avaa drawer" }).click();
  const dialog = page.getByRole("dialog", { name: "Esimerkki-drawer" });
  await expect(dialog).toBeVisible();
  // Scrim on dialogin sisar (fixed inset-0, dialogi päällä) — klikkaa
  // vasenta reunaa jossa scrim on vapaa (drawer on oikeassa reunassa).
  await page.mouse.click(20, 400);
  await expect(dialog).toBeHidden();
  // Back ei jää jumiin overlay-tilaan (ei history-kaappausta).
  await page.goto("/settings");
  await expect(page.getByRole("main")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("main")).toBeVisible();
});

test("overlayt piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("overlay-probe")).toHaveCount(0);
});
