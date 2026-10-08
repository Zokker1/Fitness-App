import { expect, test } from "@playwright/test";
import { unlockPersistentLocalContent } from "./helpers/local-content.ts";

test("fokus: käyttäjä voi avata ja käynnistää fullscreen-työjakson", async ({ page }) => {
  await page.goto("/focus");

  await expect(page.getByRole("heading", { level: 1, name: "Fokus" })).toBeVisible();
  await page.getByRole("button", { name: "Aloita fokus" }).click();

  const fullscreen = page.getByTestId("focus-fullscreen");
  await expect(fullscreen).toBeVisible();
  await expect(fullscreen.getByRole("timer")).toHaveText(/\d{2}:\d{2}/);
  await expect(
    fullscreen.getByRole("progressbar", { name: "Fokusjakson eteneminen" }),
  ).toHaveAttribute("aria-valuenow", "0");
  await expect(fullscreen.getByRole("button", { name: "Tauko" })).toBeVisible();
  await expect(fullscreen.getByRole("button", { name: "Valmis" })).toBeVisible();

  const feedback = fullscreen.getByTestId("focus-feedback-settings");
  await feedback.locator("summary").click();
  await expect(
    feedback.getByRole("checkbox", { name: "Värinä, jos selain tukee sitä" }),
  ).toBeVisible();
});

test("fokus: taustalta paluu ja reload palauttavat saman aikaleimaistunnon", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-23T10:00:00.000Z") });
  await page.goto("/focus?storage=pysyva");
  await unlockPersistentLocalContent(page);
  const pausedTime = await page.evaluate(() => Date.now() + 5_000);
  await page.clock.pauseAt(pausedTime);

  await page.getByRole("button", { name: "Aloita fokus" }).click();
  const timer = page.getByTestId("focus-fullscreen").getByRole("timer");
  await expect(timer).toHaveText("25:00");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByText("Ajastin päivittyy, kun palaat tähän näkymään.")).toBeVisible();

  await page.clock.fastForward("01:00");
  await expect(timer).toHaveText("25:00");

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(timer).toHaveText("24:00");

  await page.reload();
  await unlockPersistentLocalContent(page);
  const resumedTimer = page.getByTestId("focus-fullscreen").getByRole("timer");
  await expect(resumedTimer).toHaveText("24:00");
});
