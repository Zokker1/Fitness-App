// T061: BrowserInstallation-persistenssin E2E (chromium, preview-build).
// Todistaa kriteerin selaimessa end-to-end:
// - ensure palauttaa pysyvän satunnaisen installationId:n ja aktiivisen tilan;
// - RELOAD: sama id-lyhenne palaa kannasta (pysyvä, ei uutta satunnaista);
// - revokaatio asettaa tilan ja sekin säilyy reloadissa (eksplisiittinen tila).
// Piilossa tuotannossa (ilman ?e2e=1&probe=persistenssi).
import { expect, test } from "@playwright/test";
import { unlockPersistentLocalContent } from "./helpers/local-content.ts";

test("installationId on pysyvä ja tila säilyy reloadissa", async ({ page }) => {
  await page.goto("/?e2e=1&probe=persistenssi&storage=pysyva");
  await unlockPersistentLocalContent(page);
  const probe = page.getByTestId("installation-probe");
  await expect(probe).toBeVisible();
  // ready:<backend>:<skeemaversio> — kannan on oltava avattu ja migroitu.
  await expect(page.getByTestId("persistence-status")).toHaveText(/ready:.+:[1-9]\d*/, {
    timeout: 15_000,
  });
  const status = probe.getByTestId("installation-status");

  await probe.getByRole("button", { name: "Varmista asennus" }).click();
  await expect(status).toHaveText(/v\d+ [A-Za-z0-9-]{8} aktiivinen/, { timeout: 15_000 });
  const initialStatus = (await status.textContent()) ?? "";
  const version = Number(initialStatus.match(/^v(\d+)/u)?.[1]);
  const prefix = initialStatus.split(" ")[1] ?? "";
  expect(Number.isInteger(version)).toBe(true);
  expect(prefix.length).toBe(8);

  // Reload: sama installationId (ei uutta satunnaista), versio säilyy.
  await page.reload();
  await unlockPersistentLocalContent(page);
  const reloaded = page.getByTestId("installation-probe");
  await expect(reloaded).toBeVisible();
  await reloaded.getByRole("button", { name: "Varmista asennus" }).click();
  await expect(reloaded.getByTestId("installation-status")).toHaveText(initialStatus, {
    timeout: 15_000,
  });

  // Revokaatio: eksplisiittinen tila + säilyy reloadin yli.
  await reloaded.getByRole("button", { name: "Revokoi asennus" }).click();
  await expect(reloaded.getByTestId("installation-status")).toHaveText(
    `v${String(version + 1)} ${prefix} revoked`,
    {
      timeout: 15_000,
    },
  );
  await page.reload();
  await unlockPersistentLocalContent(page);
  const revokedPage = page.getByTestId("installation-probe");
  await expect(revokedPage).toBeVisible();
  await revokedPage.getByRole("button", { name: "Varmista asennus" }).click();
  await expect(revokedPage.getByTestId("installation-status")).toHaveText(
    `v${String(version + 1)} ${prefix} revoked`,
    { timeout: 15_000 },
  );
});

test("installation-probe piilossa tuotannossa", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("installation-probe")).toHaveCount(0);
});
