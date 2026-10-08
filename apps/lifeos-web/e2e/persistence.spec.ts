// T039: B01-portin persistence-smoke. Mitattu pysyvyys sahpool-backendillä
// ("opfs-sahpool", ei COOP/COEP-vaatimusta — sahpool EI käytä SAB:a; sync on
// suora file.sah.flush()):
// write -> reload -> readback SAMALLA arvolla.
//
// Kaksi reload-polkua (molemmat mitattu vihreiksi T039:ssä):
// 1. Suljettu kanta: eksplisiittinen close ennen sivun sulkemista (vapauttaa
//    SAHit deterministisesti; uusi sivu samaan contextiin).
// 2. Suora reload: goto/reload ilman sulkua (workerin pagehide-kuuntelija
//    sulkee DB:n navigoinnin yhteydessä ja vapauttaa SAHit).
// Molemmat vaativat pool-backendin; memory-fallback SKIPataan rehellisesti
// (lukkokilpa kahden elävän sivun välillä TAI ei OPFS-tukea — kumpikaan ei
// ole sovelluskoodin vika; diagnostiikka pool-tiedoissa).
//
// Offline-uudelleenavaus: SW palvelee shellin ja SQLite/WASM-assetit
// precachesta. Testi varmistaa myös, että OPFS-backend avautuu offline ja
// ennen offline-tilaa kirjoitettu arvo luetaan samasta kannasta.
// - Probe käyttää virallista data-kerrosta (openDatabase/writeMeta/readMeta),
//   joten testi todistaa oikean OPFS/WASM-polun, ei mockia.
// - Ei terveysdataa/PII:tä: arvo on synteettinen t038-tunniste.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { unlockPersistentLocalContent } from "./helpers/local-content.ts";

const PROBE_URL = "/?e2e=1&probe=persistenssi&storage=pysyva";

async function waitForProbe(page: Page): Promise<void> {
  await page.goto(PROBE_URL);
  await unlockPersistentLocalContent(page);
  await expect(page.getByTestId("persistence-probe")).toBeVisible();
  await expect(page.getByTestId("persistence-status")).not.toHaveText("avataan…", {
    timeout: 20_000,
  });
}

async function writeProbe(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Kirjoita testientiteetti" }).click();
  const value = page.getByTestId("persistence-value");
  await expect(value).not.toHaveText("—", { timeout: 20_000 });
  const text = (await value.textContent()) ?? "";
  expect(text).toMatch(/^t038-\d+$/);
  return text;
}

async function readProbe(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Lue testientiteetti" }).click();
  const value = page.getByTestId("persistence-value");
  await expect(value).not.toHaveText("—", { timeout: 20_000 });
  return (await value.textContent()) ?? "";
}

async function backendOf(page: Page): Promise<string> {
  const text = (await page.getByTestId("persistence-backend").textContent()) ?? "";
  return text.replace("backend:", "").trim();
}

async function poolInfoOf(page: Page): Promise<string> {
  return ((await page.getByTestId("persistence-pool").textContent()) ?? "").trim();
}

function requirePoolBackend(backend: string, poolInfo: string): void {
  if (backend !== "opfs-sahpool") {
    test.skip(true, `Pysyvyys vaatii pool-backendin (nyt backend=${backend} ${poolInfo}).`);
  }
}

async function closeProbe(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sulje tietokanta" }).click();
  await expect(page.getByTestId("persistence-closed")).toHaveText("suljettu", {
    timeout: 20_000,
  });
}

test("testientiteetti säilyy reloadissa", async ({ page }) => {
  await waitForProbe(page);
  requirePoolBackend(await backendOf(page), await poolInfoOf(page));
  const written = await writeProbe(page);
  // Suora reload ilman eksplisiittistä sulkua: workerin pagehide-kuuntelija
  // sulkee DB:n navigoinnin yhteydessä ja vapauttaa SAHit.
  await page.reload();
  await waitForProbe(page);
  requirePoolBackend(await backendOf(page), await poolInfoOf(page));
  const readBack = await readProbe(page);
  expect(readBack).toBe(written);
});

test("testientiteetti säilyy sulkemisen/avaamisen jälkeen", async ({ browser }) => {
  const context: BrowserContext = await browser.newContext();
  try {
    const first = await context.newPage();
    await waitForProbe(first);
    requirePoolBackend(await backendOf(first), await poolInfoOf(first));
    const written = await writeProbe(first);
    // Eksplisiittinen sulku vapauttaa poolin lukot deterministisesti
    // (ei nojata pagehide-ajoitukseen).
    await closeProbe(first);
    await first.close();
    const second = await context.newPage();
    await waitForProbe(second);
    requirePoolBackend(await backendOf(second), await poolInfoOf(second));
    const readBack = await readProbe(second);
    expect(readBack).toBe(written);
  } finally {
    await context.close();
  }
});

test("T130: tehtävä säilyy reloadissa (app, pysyvä tila)", async ({ page }) => {
  // App-tason persistenssi (T130): DataProvider ?storage=pysyva →
  // relaatiostore Worker/SQLite-tallennuksessa. Vaatii pool-backendin kuten
  // T039-smoke.
  await page.goto("/?e2e=1&probe=persistenssi&storage=pysyva");
  await waitForProbe(page);
  requirePoolBackend(await backendOf(page), await poolInfoOf(page));

  await page.goto("/tasks?storage=pysyva");
  await unlockPersistentLocalContent(page);
  await page.getByTestId("quick-add-fab").click();
  const dialog = page.getByRole("dialog", { name: "Kirjaa" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tehtävä" }).click();
  const form = page.getByTestId("quick-task-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Tehtävän nimi").fill("T130-pysyvä");
  await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
  await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
  await expect(page.getByTestId("task-inbox-open")).toContainText("T130-pysyvä");

  // Reload: relaatiostore lataa tehtävän tasks-taulusta.
  await page.reload();
  await unlockPersistentLocalContent(page);
  await expect(page.getByTestId("task-inbox-open")).toContainText("T130-pysyvä", {
    timeout: 20_000,
  });
});

test("T124: kalenteriblockki säilyy reloadissa ja muutos/poisto pysyy", async ({ page }) => {
  // CalendarBlock CRUD persistenssinäyttö (?storage=pysyva → relaatiostore).
  // Vaatii pool-backendin kuten muutkin pysyvyystestit; skip muuten.
  await page.goto("/?e2e=1&probe=persistenssi&storage=pysyva");
  await waitForProbe(page);
  requirePoolBackend(await backendOf(page), await poolInfoOf(page));

  // 1) LUONTI: blockki päiväkalenteriin.
  await page.goto("/calendar?storage=pysyva");
  await unlockPersistentLocalContent(page);
  await expect(page.getByTestId("calendar-day-grid")).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Timeboxin nimi").fill("T124-blockki");
  await page.getByLabel("Aloitusaika").fill("10:00");
  await page.getByLabel("Kesto").selectOption({ label: "60 min" });
  await page.getByTestId("calendar-block-create").click();
  const grid = page.getByTestId("calendar-day-grid");
  await expect(grid).toContainText("T124-blockki");

  // 2) Reload: blockki säilyy calendar_blocks-taulussa.
  await page.reload();
  await unlockPersistentLocalContent(page);
  await expect(grid).toContainText("T124-blockki", { timeout: 20_000 });

  // 3) MUUTOS: klikkaa blockkiä → esitäytetty lomake → vaihda nimi ja aika
  //    → tallenna.
  await grid
    .getByTestId(/^calendar-block-/)
    .first()
    .click();
  await page.getByLabel("Timeboxin nimi").fill("T124-muokattu");
  await page.getByLabel("Aloitusaika").fill("11:00");
  await page.getByTestId("calendar-block-save").click();
  await expect(grid).toContainText("T124-muokattu");
  await expect(grid).toContainText("11.00–12.00");
  await expect(grid).not.toContainText("T124-blockki");

  // 4) Reload: muutos säilyy.
  await page.reload();
  await unlockPersistentLocalContent(page);
  await expect(grid).toContainText("T124-muokattu", { timeout: 20_000 });
  await expect(grid).toContainText("11.00–12.00");

  // 5) POISTO: avaa muokkaus → Poista → blockki katoaa.
  await grid
    .getByTestId(/^calendar-block-/)
    .first()
    .click();
  await page.getByTestId("calendar-block-delete").click();
  await expect(page.getByTestId("calendar-day")).toContainText("Ei timeboxeja");

  // 6) Reload: poisto säilyy.
  await page.reload();
  await unlockPersistentLocalContent(page);
  await expect(page.getByTestId("calendar-day")).toContainText("Ei timeboxeja", {
    timeout: 20_000,
  });
});

test("offline-uudelleenavaus säilyttää tietokannan", async ({ browser }) => {
  const context: BrowserContext = await browser.newContext();
  try {
    const page = await context.newPage();
    await waitForProbe(page);
    requirePoolBackend(await backendOf(page), await poolInfoOf(page));
    const written = await writeProbe(page);
    // Odota SW aktiiviseksi (offline-shell vaatii asennetun SW:n).
    await page
      .waitForFunction(
        async () =>
          (await navigator.serviceWorker
            .getRegistration()
            .then((r) => r?.active?.state)
            .catch(() => null)) === "activated",
        { timeout: 20_000 },
      )
      .catch(() => undefined);
    // Toinen lataus jotta uusi SW-versio on varmasti aktiivinen ennen
    // offline-kokeilua (uusi worker ottaa ohjat vasta reloadissa).
    await page.reload();
    await unlockPersistentLocalContent(page);
    await waitForProbe(page);
    requirePoolBackend(await backendOf(page), await poolInfoOf(page));
    const onlineReadBack = await readProbe(page);
    expect(onlineReadBack).toBe(written);
    await page.waitForTimeout(2000);
    const previousTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    await context.setOffline(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 15_000 });
    } catch {
      // SW voi palvella offline-uudelleenavauksen, vaikka Playwrightin
      // navigointipromise hylkääntyisi. Uusi timeOrigin varmistaa reloadin.
    }
    await page.waitForFunction((previous) => performance.timeOrigin > previous, previousTimeOrigin);
    await unlockPersistentLocalContent(page);
    await expect(page.getByTestId("persistence-probe")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("persistence-status")).not.toHaveText("avataan…", {
      timeout: 20_000,
    });
    expect(await backendOf(page)).toBe("opfs-sahpool");
    const offlineReadBack = await readProbe(page);
    expect(offlineReadBack).toBe(written);
  } finally {
    await context.close();
  }
});
