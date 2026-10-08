// T054: motion systemin E2E (chromium, preview-build).
// - Probe vain ?e2e=1:llä (tuotannossa piilossa).
// - Täysi liike: pop-elementin animation-name on lifeos-pop ja statusline
//   kertoo "täysi"; Toista-nappi remounttaa demot (liike vastaa tekoa).
// - Reduced-motion (emuloitu): preset täyttyy opacity-only-vastineeseen
//   (animation-name → lifeos-fade-in) ja statusline kertoo "hillitty".
// Ei PII:tä: vain computed style + omat testitekstit.
import { expect, test } from "@playwright/test";

test("motion-presets näkyvät ?e2e=1:llä (täysi liike + toisto)", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/?e2e=1&probe=liike");
  const probe = page.getByTestId("motion-probe");
  await expect(probe).toBeVisible();
  await expect(probe.getByRole("heading", { name: "Liike" })).toBeVisible();

  const pop = probe.getByTestId("motion-pop");
  await expect(pop).toBeVisible();
  await expect(pop).toHaveCSS("animation-name", "lifeos-pop");
  await expect(probe.getByTestId("motion-rise-in")).toHaveCSS("animation-name", "lifeos-rise-in");
  await expect(probe.getByTestId("motion-mode")).toContainText("täysi");

  // Toista-nappi remounttaa demot: liike toistuu käyttäjän teon vastauksena.
  await probe.getByRole("button", { name: "Toista liikkeet" }).click();
  await expect(probe.getByTestId("motion-demos")).toBeVisible();
  await expect(probe.getByTestId("motion-slide-up")).toBeVisible();
});

test("reduced-motion: liike täyttyy opacity-only-vastineeseen", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?e2e=1&probe=liike");
  const probe = page.getByTestId("motion-probe");
  await expect(probe).toBeVisible();

  const pop = probe.getByTestId("motion-pop");
  await expect(pop).toBeVisible();
  await expect(pop).toHaveCSS("animation-name", "lifeos-fade-in");
  await expect(probe.getByTestId("motion-rise-in")).toHaveCSS("animation-name", "lifeos-fade-in");
  await expect(probe.getByTestId("motion-mode")).toContainText("hillitty");
});

test("motion probe piilossa tuotannossa (ilman ?e2e=1)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("motion-probe")).toHaveCount(0);
});
