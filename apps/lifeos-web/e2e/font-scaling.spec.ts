// T055: font scaling E2E (§31: browser zoom/font scaling ei riko päänäkymiä).
// Skaalataan juurifontin kokoa (125 % + 150 % — vastine selaimen
// tekstin suurennusasetuksille; appin mitat ovat rem-pohjaisia).
// Väitteet reiteillä "/" ja "/settings" molemmilla viewportleveyksillä:
// - ei vaakavuotoa (scrollingElement.scrollWidth ≤ clientWidth);
// - päänavigaatio näkyy (mobiili bottom-nav, desktop rail);
// - näkymän h1 + main saavutetaan;
// - nav-linkin touch-target pysyy ≥ 44px (min-token on px — ei kutistu).
// Kontrastit/reducemotion/touch-baseline omaa spekkiään; ei toistoa tässä.
import { expect, test, type Page } from "@playwright/test";

const SCALES = [
  { label: "125 %", percent: 125, base: 16 },
  { label: "150 %", percent: 150, base: 16 },
] as const;

/** Skaalaa juurifontin koko (sovelletaan JOKAISELLE navigoinnille erikseen). */
async function applyRootFontScale(page: Page, percent: number): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.style.fontSize = `${String(value)}%`;
  }, percent);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const report = await page.evaluate(() => {
    const root = document.scrollingElement;
    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          (rect.right > window.innerWidth + 1 ||
            rect.left < -1 ||
            element.scrollWidth > element.clientWidth + 1)
        );
      })
      .sort((left, right) => {
        const leftExcess = left.scrollWidth - left.clientWidth;
        const rightExcess = right.scrollWidth - right.clientWidth;
        return rightExcess - leftExcess;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const identity = [
          element.tagName.toLowerCase(),
          typeof element.className === "string" ? element.className : "",
          element.getAttribute("data-ui") ?? "",
        ]
          .filter(Boolean)
          .join(".");
        const text = element.textContent.replace(/\s+/g, " ").trim().slice(0, 80);
        return `${identity}: left=${String(Math.round(rect.left))} right=${String(Math.round(rect.right))} scroll=${String(element.scrollWidth)}/${String(element.clientWidth)} text=${text}`;
      });
    return {
      scrollWidth: root?.scrollWidth ?? 0,
      clientWidth: root?.clientWidth ?? window.innerWidth,
      offenders,
    };
  });
  expect(
    report.scrollWidth <= report.clientWidth,
    `Horizontal overflow: ${JSON.stringify(report)}`,
  ).toBe(true);
}

test.describe("font scaling mobiili (390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const scale of SCALES) {
    test(`${scale.label}: ei vaakavuotoa + nav + sisältö`, async ({ page }) => {
      for (const route of ["/", "/settings"]) {
        await page.goto(route);
        await applyRootFontScale(page, scale.percent);
        await expect(page.getByRole("main")).toBeVisible();

        const fontSize = await page.evaluate(() =>
          parseFloat(getComputedStyle(document.documentElement).fontSize),
        );
        expect(fontSize).toBeCloseTo((scale.base * scale.percent) / 100, 1);

        await expectNoHorizontalOverflow(page);

        await expect(
          page.getByRole("navigation", { name: "Päänavigaatio (mobiili)" }),
        ).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

        // T096: bottom-navin 5. sarake on Haku (ei linkki); touch-target
        // tarkistetaan Tänään-linkistä kuten ennenkin.
        const todayLink = page
          .getByRole("navigation", { name: "Päänavigaatio (mobiili)" })
          .getByRole("link", { name: "Tänään" });
        const box = await todayLink.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe("font scaling desktop (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const scale of SCALES) {
    test(`${scale.label}: ei vaakavuotoa + rail + sisältö`, async ({ page }) => {
      for (const route of ["/", "/settings"]) {
        await page.goto(route);
        await applyRootFontScale(page, scale.percent);
        await expect(page.getByRole("main")).toBeVisible();

        await expectNoHorizontalOverflow(page);

        await expect(page.getByRole("navigation", { name: "Päänavigaatio" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      }
    });
  }
});
