// T138: Europe/Helsinki-kalenterin selainvarmistus kesä- ja talviajalle.
import { expect, test } from "@playwright/test";

test.describe("kalenterin DST / Europe-Helsinki (T138)", () => {
  test.use({ timezoneId: "Europe/Helsinki", viewport: { width: 1280, height: 800 } });

  test("paikallinen kellonaika säilyy kesä- ja talviajan yli", async ({ page }) => {
    await page.goto("/calendar?date=2026-07-01");
    await expect(page.getByTestId("calendar-day")).toContainText("Päivä:");
    await page.getByLabel("Timeboxin nimi").fill("T138-kesa");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "60 min" });
    await page.getByTestId("calendar-block-create").click();
    await expect(page.getByTestId("calendar-day-grid")).toContainText("10.00–11.00");
    await expect(
      page.locator('[data-ui="calendar-block"]').filter({ hasText: "T138-kesa" }),
    ).toHaveAttribute("data-starts-at", "2026-07-01T07:00:00.000Z");

    await page.goto("/calendar?date=2026-01-15");
    await expect(page.getByTestId("calendar-day")).toContainText("Päivä:");
    await page.getByLabel("Timeboxin nimi").fill("T138-talveksi");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "60 min" });
    await page.getByTestId("calendar-block-create").click();
    await expect(page.getByTestId("calendar-day-grid")).toContainText("10.00–11.00");
    await expect(
      page.locator('[data-ui="calendar-block"]').filter({ hasText: "T138-talveksi" }),
    ).toHaveAttribute("data-starts-at", "2026-01-15T08:00:00.000Z");
  });
});
