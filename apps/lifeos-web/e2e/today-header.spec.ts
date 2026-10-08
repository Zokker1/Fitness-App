// T081: Today-headerin E2E (chromium, preview-build, TUOTANTOnäkymä — ei
// ?e2e=1:ää, koska header on oikeaa UI:ta). Todistaa kriteerin:
// - päivä + tervehdys + sync-indikaattori näkyvät /-reitillä mobiilissa ja
//   desktopissa, hierarkia ennallaan (yksi h1);
// - päivämäärä on TÄMÄ päivä selaimen vyöhykkeessä (laskettu testissä samalla
//   Intl-muotoilulla, ei kovakoodattu);
// - offline-tilassa indikaattori vaihtuu Offline-tilaksi (ei synkanka-valheita).
// Ei PII:tä/terveysdataa: vain päivämäärä + tervehdys + tallennustila.
import { expect, test } from "@playwright/test";

function expectedTodayDate(): string {
  return new Intl.DateTimeFormat("fi-FI", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

const GREETINGS = ["Hyvää huomenta", "Hyvää päivää", "Hyvää iltaa", "Yö jatkuu"];

test.describe("today-header (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("päivä + tervehdys + tallennusindikaattori näkyvät", async ({ page }) => {
    await page.goto("/");
    const header = page.getByTestId("today-header");
    await expect(header).toBeVisible();
    await expect(header.getByRole("heading", { level: 1, name: "Tänään" })).toBeVisible();
    await expect(header.getByTestId("today-date")).toHaveText(expectedTodayDate());
    const greeting = await header.getByTestId("today-greeting").textContent();
    expect(GREETINGS).toContain(greeting?.trim() ?? "");
    // Online-previewissä tallennus on pysyvä (pool) tai välimuistissa —
    // kumpikin on rehellinen tila; offline-testi erikseen todistaa vaihdoksen.
    await expect(header.getByTestId("sync-indicator")).toBeVisible();
    const indicatorText = await header.getByTestId("sync-indicator").textContent();
    expect(indicatorText?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

test.describe("today-header (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama header ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/");
    const header = page.getByTestId("today-header");
    await expect(header).toBeVisible();
    await expect(header.getByTestId("today-date")).toHaveText(expectedTodayDate());
    await expect(header.getByTestId("sync-indicator")).toBeVisible();
    // Ei vaakavuotoa headerin takia (§31).
    const overflow = await page.evaluate(() => {
      const element = document.scrollingElement;
      if (element === null) {
        return true;
      }
      return element.scrollWidth > element.clientWidth;
    });
    expect(overflow).toBe(false);
  });
});

test.describe("today-header offline", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("indikaattori vaihtuu Offline-tilaksi (ei synkanka-valheita)", async ({ page, context }) => {
    await page.goto("/");
    const header = page.getByTestId("today-header");
    await expect(header).toBeVisible();
    await context.setOffline(true);
    await expect(header.getByTestId("sync-indicator")).toContainText("Offline", {
      timeout: 10_000,
    });
    await expect(header.getByTestId("sync-indicator")).toHaveAttribute("data-tone", "offline");
  });
});
