import { expect, test } from "@playwright/test";
import { unlockPersistentLocalContent } from "./helpers/local-content.ts";

test("production preview enforces CSP and Trusted Types without breaking app assets", async ({
  page,
}) => {
  const response = await page.goto("/?storage=pysyva");
  const csp = response?.headers()["content-security-policy"];
  expect(csp).toContain("require-trusted-types-for 'script'");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("object-src 'none'");

  await unlockPersistentLocalContent(page);

  const icon = page.locator('[data-ui="icon"]').first();
  await expect(icon).toBeVisible();
  const maskImage = await icon.evaluate(
    (element) => getComputedStyle(element, "::before").maskImage,
  );
  expect(maskImage).toContain(".svg");
  const localFontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some(
      (font) => font.family === "Hanken Grotesk Variable" && font.status === "loaded",
    );
  });
  expect(localFontLoaded).toBe(true);

  const scriptUrlPolicy = await page.evaluate(() => {
    const accepted = document.createElement("script");
    const rejected = document.createElement("script");
    try {
      accepted.src = "https://accounts.google.com/gsi/client";
      let externalBlocked = false;
      try {
        rejected.src = "https://evil.example/attack.js";
      } catch {
        externalBlocked = true;
      }
      return (
        accepted.src.endsWith("/gsi/client") &&
        (externalBlocked || rejected.getAttribute("src") === null)
      );
    } catch {
      return false;
    }
  });
  expect(scriptUrlPolicy).toBe(true);

  const assignmentBlocked = await page.evaluate(() => {
    const target = document.createElement("div");
    try {
      target.innerHTML = "<img src=x onerror=alert(1)>";
      return false;
    } catch {
      return true;
    }
  });
  expect(assignmentBlocked).toBe(true);

  await page.goto("/settings?storage=pysyva");
  await unlockPersistentLocalContent(page);
  await expect(page.getByTestId("storage-status-content")).toBeVisible();

  const databaseStatus = page
    .getByTestId("storage-status-content")
    .locator('[data-ui="storage-facts"] > div')
    .nth(1)
    .locator("dd");
  await expect(databaseStatus).toContainText("Auki", { timeout: 20_000 });

  await expect
    .poll(() =>
      page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state),
    )
    .toBe("activated");
});
