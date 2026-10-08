// T060: UserPreferences-persistenssin E2E (chromium, preview-build).
// Todistaa kriteerin selaimessa end-to-end:
// - avaus tai ensure luo oletusrivin (system, t8);
// - päivitys kasvattaa version ja siirtää päivän rajaa;
// - RELOAD: arvot ja versionumero säilyvät (OPFS/SAH-pool — sama backend kuin T038-smokessa).
// Piilossa tuotannossa (ilman ?e2e=1&probe=persistenssi).
import { expect, test } from "@playwright/test";
import { unlockPersistentLocalContent } from "./helpers/local-content.ts";

test("asetukset tallentuvat paikallisesti ja ovat versionoitavia", async ({ page }) => {
  await page.goto("/?e2e=1&probe=persistenssi&storage=pysyva");
  await unlockPersistentLocalContent(page);
  const probe = page.getByTestId("preferences-probe");
  await expect(probe).toBeVisible();
  // Odota että persistence-luotain on avannut+migroinut kannan (deterministinen
  // järjestys: klikit vain avoimen kannan kimppuun).
  // ready:<backend>:<skeemaversio> — kannan on oltava avattu ja migroitu
  // (versio >= 1; tarkka versio ei kirjoita testiä joka migraatiolla).
  await expect(page.getByTestId("persistence-status")).toHaveText(/ready:.+:[1-9]\d*/, {
    timeout: 15_000,
  });
  const status = probe.getByTestId("preferences-status");

  await probe.getByRole("button", { name: "Varmista asetukset" }).click();
  await expect(status).toHaveText(/v\d+ system t8/u, { timeout: 15_000 });
  const initialStatus = (await status.textContent()) ?? "";
  const version = Number(initialStatus.match(/^v(\d+)/u)?.[1]);
  expect(Number.isInteger(version)).toBe(true);

  await probe.getByRole("button", { name: "Siirrä päivän rajaa" }).click();
  const updatedStatus = `v${String(version + 1)} system t9`;
  await expect(status).toHaveText(updatedStatus, { timeout: 15_000 });

  // Reload: asetusrivi palaa kannasta samalla versiolla ja arvoilla.
  await page.reload();
  await unlockPersistentLocalContent(page);
  const reloaded = page.getByTestId("preferences-probe");
  await expect(reloaded).toBeVisible();
  await reloaded.getByRole("button", { name: "Varmista asetukset" }).click();
  await expect(reloaded.getByTestId("preferences-status")).toHaveText(updatedStatus, {
    timeout: 15_000,
  });
});

test("preferences-probe piilossa tuotannossa", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("preferences-probe")).toHaveCount(0);
});
