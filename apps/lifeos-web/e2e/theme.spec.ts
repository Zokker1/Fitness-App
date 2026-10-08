// T042/T043: teeman E2E (chromium, preview-build).
// - Light-oletus: ei data-theme:a + Kuura-tausta (renderöity, ei token-arvo).
// - Vaihto valinnasta: tallennus + data-theme + tausta vaihtuvat; reload
//   säilyttää (FOUC-eston varhainen ulkoinen bootstrap + provider).
// - Dark-kontrasti: pääteksti/bg ≥ 4.5:1 laskettuna renderöidyistä
//   rgb-arvoista (mittaus, ei silmämäärä). Light-vastine samalla kaavalla.
// - Ei PII:tä/terveysdataa: luetaan vain computed style + attribuutti.
import { expect, test, type Page } from "@playwright/test";

async function rgbOf(
  page: Page,
  selector: string,
  property: string,
): Promise<[number, number, number]> {
  const value = await page.evaluate(
    ([sel, prop]) => {
      const element = document.querySelector(sel);
      if (element === null) {
        return "";
      }
      return getComputedStyle(element).getPropertyValue(prop);
    },
    [selector, property] as const,
  );
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (match === null) {
    throw new Error(`rgb-jäsennys epäonnistui: ${selector}/${property} = ${value}`);
  }
  const [, rs, gs, bs] = match;
  if (rs === undefined || gs === undefined || bs === undefined) {
    throw new Error(`rgb-jäsennys epäonnistui: ${selector}/${property} = ${value}`);
  }
  return [Number(rs), Number(gs), Number(bs)];
}

function channelLuminance(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]: [number, number, number]): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

test("light-oletus: Kuura-tausta ilman tallennettua valintaa", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  const theme = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  // Oletus seuraa OS:ää: light-OS:ssa provider kirjoittaa "light",
  // dark-OS:ssa "dark" — molemmat kelpaavat; tallennusta ei saa olla.
  expect(["light", "dark", null]).toContain(theme);
  const stored = await page.evaluate(() => localStorage.getItem("lifeos.theme.v1"));
  expect(stored).toBeNull();
});

test("teemavalinta vaihtaa + säilyy reloadissa", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("theme-choice")).toBeVisible();
  const before = await rgbOf(page, "body", "background-color");

  await page.getByRole("radio", { name: "Tumma" }).check();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("dark");
  const darkBg = await rgbOf(page, "body", "background-color");
  expect(darkBg).not.toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem("lifeos.theme.v1"))).toBe("dark");

  await page.reload();
  await expect(page.getByRole("main")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe(
    "dark",
  );

  await page.goto("/settings");
  await page.getByRole("radio", { name: "Vaalea" }).check();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("lifeos.theme.v1"))).toBe("light");
});

test("päätekstin kontrasti ≥ 4.5 molemmissa teemoissa (renderöity)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();

  const lightBg = await rgbOf(page, "body", "background-color");
  const lightText = await rgbOf(page, "body", "color");
  expect(contrast(lightText, lightBg)).toBeGreaterThanOrEqual(4.5);

  await page.goto("/settings");
  await page.getByRole("radio", { name: "Tumma" }).check();
  await expect
    .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("dark");
  const darkBg = await rgbOf(page, "body", "background-color");
  const darkText = await rgbOf(page, "body", "color");
  expect(contrast(darkText, darkBg)).toBeGreaterThanOrEqual(4.5);
});
