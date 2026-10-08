// T179: B08-portti. Fokus tukee rajattua työjaksoa ja lempeää paluuta.
import { expect, test, type Page } from "@playwright/test";
import { unlockPersistentLocalContent } from "./helpers/local-content.ts";

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const element = document.scrollingElement;
    return element !== null && element.scrollWidth > element.clientWidth;
  });
  expect(overflow).toBe(false);
}

async function runB08Port(page: Page): Promise<void> {
  await page.goto("/focus?storage=pysyva");
  await unlockPersistentLocalContent(page);
  await expect(page.getByRole("heading", { level: 1, name: "Fokus" })).toBeVisible();
  await expect(page.getByTestId("focus-view-empty")).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "Aloita fokus" }).click();
  const fullscreen = page.getByTestId("focus-fullscreen");
  const timer = fullscreen.getByRole("timer");
  await expect(timer).toHaveText("25:00");
  await expect(
    fullscreen.getByRole("progressbar", { name: "Fokusjakson eteneminen" }),
  ).toBeVisible();
  await expect(fullscreen.getByRole("button", { name: "Pidä tauko" })).toBeVisible();
  await expect(fullscreen.getByRole("button", { name: "Kirjaa keskeytys" })).toBeVisible();

  const secondaryInfo = page.locator("details[data-ui='focus-secondary-info']");
  await expect(secondaryInfo).toBeVisible();
  await expect(secondaryInfo).not.toHaveAttribute("open", "");

  await fullscreen.getByRole("button", { name: "Kirjaa ajatus" }).click();
  const parkingLot = fullscreen.getByTestId("focus-distraction");
  await parkingLot.getByLabel("Ajatus").fill("T179 parkkeerattu ajatus");
  await parkingLot.getByRole("button", { name: "Tallenna ajatus" }).click();
  await expect(parkingLot.getByRole("status")).toContainText("Ajatus kirjattu");
  await expect(parkingLot).toContainText("T179 parkkeerattu ajatus");
  await expect(timer).toHaveText("25:00");

  await fullscreen.getByRole("button", { name: "Kirjaa keskeytys" }).click();
  await expect(fullscreen).toContainText("Itse kirjattuja keskeytyksiä: 1");
  await fullscreen.getByRole("button", { name: "Pidä tauko" }).click();
  await expect(fullscreen.getByText("Tauolla", { exact: true })).toBeVisible();
  await expect(fullscreen.getByRole("button", { name: "Jatka", exact: true })).toBeVisible();
  await fullscreen.getByRole("button", { name: "Jatka", exact: true }).click();
  await expect(fullscreen.getByRole("button", { name: "Pidä tauko" })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await fullscreen.getByRole("button", { name: "Peruuta istunto" }).click();
  await expect(page.getByTestId("focus-view-empty")).toContainText(
    "Keskeytys tallentui historiaan. Voit palata koska tahansa",
  );
  await expect(page.getByTestId("focus-view-empty")).not.toContainText(
    /epäonnistuit|epäonnistuminen/i,
  );
  await expectNoHorizontalOverflow(page);
}

test.describe("B08-portti — mobiili 390px", () => {
  test.use({ viewport: MOBILE });

  test("fokus, ajatusparkki ja lempeä paluu toimivat mobiilissa", async ({ page }) => {
    await runB08Port(page);
  });
});

test.describe("B08-portti — desktop 1280px", () => {
  test.use({ viewport: DESKTOP });

  test("fokus, ajatusparkki ja lempeä paluu toimivat desktopissa", async ({ page }) => {
    await runB08Port(page);
  });
});
