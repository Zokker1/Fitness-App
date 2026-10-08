// T101: inbox-toiminnot E2E (chromium, preview-build, TUOTANTOnäkymä).
// Kriteeri: nopea capture (FAB → Tehtävä → Tallenna → heti), complete
// (checkbox → rivi siirtyy valmiisiin + reopen palauttaa), delete
// (tombstone → rivi katoaa näkymästä, historian säilytys T100:ssa).
// Jarjestys todistettu: korkea prioriteetti ennen normaalia.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
import { expect, test, type Page } from "@playwright/test";

/** Luo tehtävän Quick Add -lomakkeella (saman sivun sisällä, ei navigointeja). */
async function createQuickTask(
  page: Page,
  options: {
    readonly title: string;
    readonly priority?: "Matala" | "Normaali" | "Korkea";
    readonly due?: "Tänään" | "Huomenna" | "Ei päivää";
    readonly recurrence?: "Päivittäin" | "Viikoittain" | "Kuukausittain";
    readonly estimate?: "10 min" | "25 min" | "45 min" | "90 min";
  },
): Promise<void> {
  await page.getByTestId("quick-add-fab").click();
  const dialog = page.getByRole("dialog", { name: "Kirjaa" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Tehtävä" }).click();
  const form = page.getByTestId("quick-task-form");
  await expect(form).toBeVisible();
  await form.getByLabel("Tehtävän nimi").fill(options.title);
  if (options.due !== undefined) {
    await form.getByRole("radio", { name: options.due }).click();
  }
  if (options.recurrence !== undefined) {
    await form.getByLabel("Toisto").selectOption({ label: options.recurrence });
  }
  if (options.estimate !== undefined) {
    await form.getByLabel("Arvio (valinnainen)").selectOption({ label: options.estimate });
  }
  if (options.priority !== undefined) {
    await form
      .getByRole("group", { name: "Prioriteetti" })
      .getByRole("radio", { name: options.priority })
      .click();
  }
  await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
  await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
}

test.describe("task inbox toiminnot (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("complete → valmiisiin; reopen palauttaa; delete poistaa", async ({ page }) => {
    await page.goto("/tasks");
    // Luo kaksi tehtävää FAB:lla SAMALLA sivulla (data elää sivun muistissa —
    // tuotantokanta on tyhjä joka ajossa, ei täysiä navigointeja kesken).
    for (const title of ["E2E-tehtävä A", "E2E-tehtävä B"]) {
      await page.getByTestId("quick-add-fab").click();
      const dialog = page.getByRole("dialog", { name: "Kirjaa" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Tehtävä" }).click();
      const form = page.getByTestId("quick-task-form");
      await expect(form).toBeVisible();
      await form.getByLabel("Tehtävän nimi").fill(title);
      await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
      await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    }
    await expect(page.getByTestId("task-inbox-open")).toContainText("E2E-tehtävä A");
    await expect(page.getByTestId("task-inbox-open")).toContainText("E2E-tehtävä B");

    // Complete ensimmäinen (checkbox) → siirtyy valmiisiin.
    const idA = page.getByTestId("task-inbox-open").getByRole("checkbox").first();
    await idA.click();
    await expect(page.getByTestId("task-inbox-done")).toContainText("E2E-tehtävä");
    // Reopen samasta rivistä (valmiiden checkbox checked → klikkaus = reopen).
    const doneBox = page.getByTestId("task-inbox-done").getByRole("checkbox").first();
    await doneBox.click();
    await expect(page.getByTestId("task-inbox-open")).toContainText("E2E-tehtävä");
    await expect(page.getByTestId("task-inbox-done")).toHaveCount(0);

    // Complete uudelleen → Poista: tombstone → rivi katoaa näkymästä.
    await page.getByTestId("task-inbox-open").getByRole("checkbox").first().click();
    const deleteButtons = page
      .getByTestId("task-inbox-done")
      .getByRole("button", { name: "Poista" });
    await expect(deleteButtons).toHaveCount(1);
    await deleteButtons.first().click();
    await expect(deleteButtons).toHaveCount(0);
    // Jäljellä oleva avoin tehtävä näkyy yhä.
    await expect(page.getByTestId("task-inbox-open")).toContainText("E2E-tehtävä");
  });

  test("T108 muistilista: alitehtävät järjestettävissä ja kuidittavissa", async ({ page }) => {
    await page.goto("/tasks");
    await createQuickTask(page, { title: "T108-päätehtävä" });
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T108-päätehtävä");

    // Muistilista on tehtävärivin sisällä (testidit käyttävät entiteetti-id:tä,
    // joten rajataan kaikki hasText:llä tehtävän riviin).
    const row = open.locator("li", { hasText: "T108-päätehtävä" });
    await row.getByRole("button", { name: "Muistilista (0/0)" }).click();

    const add = async (title: string): Promise<void> => {
      await row.getByLabel("Uusi alitehtävä").fill(title);
      await row.getByRole("button", { name: "Lisää" }).click();
      await expect(row).toContainText(title);
    };
    await add("Osta harja");
    await add("Imuroi");
    await expect(row.getByRole("button", { name: "Muistilista (0/2)" })).toBeVisible();

    // Järjestys: Imuroi lisättiin viimeisenä → siirrä ylös.
    const itemRows = row.locator("li");
    await expect(itemRows).toHaveCount(2);
    await itemRows.nth(1).getByRole("button", { name: "Siirrä ylös: Imuroi" }).click();
    await expect(itemRows.first()).toContainText("Imuroi");

    // Completion: checkbox → progress 1/2.
    await row.getByLabel("Merkitse alitehtävä valmiiksi: Imuroi").click();
    await expect(row.getByRole("button", { name: "Muistilista (1/2)" })).toBeVisible({
      timeout: 15_000,
    });

    // Poisto: tombstone → rivi katoaa, progress 1/1.
    await row.getByRole("button", { name: "Poista alitehtävä: Osta harja" }).click();
    await expect(itemRows).toHaveCount(1);
    await expect(row.getByRole("button", { name: "Muistilista (1/1)" })).toBeVisible();
  });

  test("T109 mukautettu eräpäivä: päivä + kellonaika (aikavyöhyke + locale)", async ({ page }) => {
    await page.goto("/tasks");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Tehtävän nimi").fill("T109-deadline");
    // Valitse päivä → DatePicker + TimePicker (natiivit ISO-syötteet).
    await form.getByRole("radio", { name: "Valitse päivä" }).click();
    const plus3 = new Date();
    plus3.setDate(plus3.getDate() + 3);
    const iso = `${String(plus3.getFullYear())}-${String(plus3.getMonth() + 1).padStart(2, "0")}-${String(plus3.getDate()).padStart(2, "0")}`;
    await form.getByLabel("Eräpäivä").fill(iso);
    await form.getByLabel("Kellonaika").fill("09:30");
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);

    // Rivi näyttää fi-FI-muotoilun: "d.m. klo 09.30" (UTC = paikallinen −180).
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T109-deadline");
    const expectedDate = `${String(plus3.getDate())}.${String(plus3.getMonth() + 1)}.`;
    await expect(open).toContainText(expectedDate);
    await expect(open).toContainText("Eräpäivä");
    await expect(open).toContainText("09.30");
    // Tuleva eräpäivä ei ole myöhässä.
    await expect(open).not.toContainText("T109-deadline — myöhässä");
  });

  test("T110 toistuva tehtävä: valmistuminen luo seuraavan instanssin", async ({ page }) => {
    await page.goto("/tasks");
    await createQuickTask(page, { title: "T110-toistuva", recurrence: "Päivittäin" });
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T110-toistuva");
    await expect(open).toContainText("Toistuu: päivittäin");

    // Valmistuminen → valmis + uusi instanssi avoimena (sama nimi, toistuu).
    await open.getByRole("checkbox").first().click();
    await expect(page.getByTestId("task-inbox-done")).toContainText("T110-toistuva");
    await expect(page.getByTestId("task-inbox-open")).toContainText("T110-toistuva");
    await expect(page.getByTestId("task-inbox-open")).toContainText("Toistuu: päivittäin");
  });

  test("T111 arvioitu kesto: timebox-ehdotus ja suunnittelun yhteisarvio", async ({ page }) => {
    await page.goto("/tasks");
    // Arvio 90 min → ehdotus 4 × 25 min (>45 min jaetaan pomodoro-paloiksi).
    await createQuickTask(page, { title: "T111-suuri", estimate: "90 min" });
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T111-suuri");
    await expect(open).toContainText("Arvio 1 t 30 min");
    await expect(open).toContainText("timebox-ehdotus 4 × 25 min");

    // Toinen tehtävä arviolla → upcoming-näkymän yhteisarvio kasvaa.
    await createQuickTask(page, { title: "T111-pieni", estimate: "25 min" });
    await page.getByTestId("task-inbox-view-toggle").click();
    await expect(page.getByTestId("task-planning-total")).toContainText("arvio yht. 1 t 55 min");
  });

  test("T113 raahaus: hiiri järjestää, näppäimistö toimii, järjestys säilyy", async ({ page }) => {
    await page.goto("/tasks");
    await createQuickTask(page, { title: "T113-raahaus" });
    const row = page.getByTestId("task-inbox-open").locator("li", { hasText: "T113-raahaus" });
    await row.getByRole("button", { name: "Muistilista (0/0)" }).click();
    for (const title of ["A-ensimmäinen", "B-toinen"]) {
      await row.getByLabel("Uusi alitehtävä").fill(title);
      await row.getByRole("button", { name: "Lisää" }).click();
      await expect(row).toContainText(title);
    }
    const itemRows = row.locator("li");
    await expect(itemRows).toHaveCount(2);
    await expect(itemRows.first()).toContainText("A-ensimmäinen");

    // NÄPPÄIMISTÖ ensin: A alas → B kärkeen (ylös/alas-painikkeet,
    // saavutettava reitti — T108).
    await expect(async () => {
      await itemRows.first().getByRole("button", { name: "Siirrä alas: A-ensimmäinen" }).click();
      await expect(itemRows.first()).toContainText("B-toinen");
    }).toPass({ timeout: 15_000 });

    // HIIRI: raahaa B A:n alle kahvasta (Pointer Events — sama polku
    // touchille). Pudotuskohde = rivin A keskipiste.
    await expect(async () => {
      const handleB = row.getByRole("button", { name: "Raahaa järjestyksessä: B-toinen" });
      const rowAUp = row.getByRole("button", { name: "Siirrä ylös: A-ensimmäinen" });
      const fromBox = await handleB.boundingBox();
      const toBox = await rowAUp.boundingBox();
      if (fromBox === null || toBox === null) {
        throw new Error("Raahauskoordinaatteja ei saatu");
      }
      await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2, { steps: 8 });
      await page.mouse.up();
      await expect(itemRows.first()).toContainText("A-ensimmäinen");
      await expect(itemRows.nth(1)).toContainText("B-toinen");
    }).toPass({ timeout: 15_000 });

    // JÄRJESTYS SÄILYY: editorin uudelleenavaus lukee järjestyksen storesta.
    await row.getByRole("button", { name: "Muistilista (0/2)" }).click();
    await row.getByRole("button", { name: "Muistilista (0/2)" }).click();
    await expect(async () => {
      await expect(itemRows.first()).toContainText("A-ensimmäinen");
      await expect(itemRows.nth(1)).toContainText("B-toinen");
    }).toPass({ timeout: 15_000 });
  });

  test("T115 aloita 5 min: tehtävästä käynnistyy lyhyt focus-session", async ({ page }) => {
    await page.goto("/tasks");
    await createQuickTask(page, { title: "T115-aloitus" });
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T115-aloitus");

    // "5 min" -painike käynnistää session ja näyttää vahvistuksen rivillä.
    await page.getByRole("button", { name: "Aloita 5 minuutin fokus: T115-aloitus" }).click();
    await expect(
      page.getByTestId("task-inbox-open").locator("li", { hasText: "T115-aloitus" }),
    ).toContainText("5 min -fokus käynnissä");
  });

  test("T114 massapoisto: valinta, vahvistus ja peruutus", async ({ page }) => {
    await page.goto("/tasks");
    for (const title of ["T114-yksi", "T114-kaksi", "T114-kolme"]) {
      await createQuickTask(page, { title });
    }
    // Valmistele kaikki kolme (checkbox = complete).
    const open = page.getByTestId("task-inbox-open");
    const done = page.getByTestId("task-inbox-done");
    for (const title of ["T114-yksi", "T114-kaksi", "T114-kolme"]) {
      await open.locator("li", { hasText: title }).getByRole("checkbox").click();
      await expect(done).toContainText(title);
    }
    await expect(done).toContainText("T114-yksi");
    await expect(done).toContainText("T114-kaksi");
    await expect(done).toContainText("T114-kolme");

    // Valitse kaksi (T114-yksi, T114-kaksi) → massapalkki ilmestyy.
    const selectOne = page.getByTestId("task-inbox-done").locator("li", { hasText: "T114-yksi" });
    const selectTwo = page.getByTestId("task-inbox-done").locator("li", { hasText: "T114-kaksi" });
    await selectOne.getByTestId(/bulk-select-/).check();
    await selectTwo.getByTestId(/bulk-select-/).check();
    const bar = page.getByTestId("bulk-bar");
    await expect(bar).toContainText("Valittu: 2");
    await expect(bar).toContainText("Poista valitut (2)");

    // POISTO vaatii vahvistuksen: avaa dialogi, peruuta ensin (ei poistoa).
    await bar.getByTestId("bulk-delete").click();
    const confirmSheet = page.getByRole("dialog", { name: "Vahvista poisto" });
    await expect(confirmSheet).toBeVisible();
    await expect(confirmSheet).toContainText("Poistetaan");
    await expect(confirmSheet).toContainText("2 valittua tehtävää?");
    await confirmSheet.getByTestId("bulk-cancel-delete").click();
    await expect(confirmSheet).toHaveCount(0);
    await expect(done).toContainText("T114-yksi");
    await expect(done).toContainText("T114-kaksi");

    // Uudelleen → vahvista: kaksi poistuu, yksi jää, valinta tyhjenee.
    await bar.getByTestId("bulk-delete").click();
    await expect(page.getByRole("dialog", { name: "Vahvista poisto" })).toBeVisible();
    await page.getByTestId("bulk-confirm-delete").click();
    await expect(page.getByRole("dialog", { name: "Vahvista poisto" })).toHaveCount(0);
    await expect(page.getByTestId("task-inbox-done")).toContainText("T114-kolme");
    await expect(page.getByTestId("task-inbox-done")).not.toContainText("T114-yksi");
    await expect(page.getByTestId("task-inbox-done")).not.toContainText("T114-kaksi");
    await expect(page.getByTestId("bulk-bar")).toHaveCount(0);
  });

  test("T116 pilkkominen: ison tehtävän vaiheet kerralla", async ({ page }) => {
    await page.goto("/tasks");
    await createQuickTask(page, { title: "T116-iso tehtävä" });
    const row = page.getByTestId("task-inbox-open").locator("li", { hasText: "T116-iso tehtävä" });
    await row.getByRole("button", { name: "Muistilista (0/0)" }).click();

    // Avaa pilkkominen ja lisää kolme vaihetta yhdellä syötteellä (pilkku =
    // erotin; dedupe poimii "ASIA"/"asia" parista yhden).
    await row.getByRole("button", { name: "Pilko ison tehtävän vaiheiksi" }).click();
    await row.getByLabel("Ison tehtävän vaiheet").fill("Mittaa alkio, Tilaa laastari, ASIA, asia");
    await row.getByRole("button", { name: "Lisää vaiheet" }).click();

    // Kolme unikkia vaihetta (dedupe case-insensitiivisesti), progress 0/3.
    // (Editorin testid käyttää entiteetti-id:tä — rivit haetaan hasText-scopella.)
    const itemRows = row.locator("li");
    await expect(itemRows).toHaveCount(3);
    await expect(row.getByRole("button", { name: "Muistilista (0/3)" })).toBeVisible();
    await expect(row).toContainText("Mittaa alkio");
    await expect(row).toContainText("Tilaa laastari");
    await expect(row).toContainText("ASIA");
    // Syötealue sulkeutuu onnistuneen pilkkomisen jälkeen.
    await expect(row.getByLabel("Ison tehtävän vaiheet")).toHaveCount(0);
  });

  test("T105 prioriteetti järjestää mutta ei piilota deadlineja", async ({ page }) => {
    await page.goto("/tasks");
    // A: korkea prioriteetti, ei eräpäivää (luodaan ensin).
    await createQuickTask(page, {
      title: "T105-korkea",
      priority: "Korkea",
      due: "Ei päivää",
    });
    // B: normaali, ei eräpäivää.
    await createQuickTask(page, { title: "T105-normaali", due: "Ei päivää" });

    // Ei-deadline-ryhmä: korkea ennen normaalia (prioriteetti järjestää),
    // vaikka normaali... luotiin toisena — prioriteetti voittaa createdAtin.
    const rows = page.getByTestId("task-inbox-open").locator("li");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("T105-korkea");
    await expect(rows.nth(1)).toContainText("T105-normaali");

    // C: matala prioriteetti, eräpäivä TÄNÄÄN → deadline nousee kärkeen
    // korkean ei-deadlinen yli (prioriteetti ei piilota deadlineja).
    await createQuickTask(page, { title: "T105-matala", priority: "Matala", due: "Tänään" });
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("T105-matala");
    await expect(rows.nth(1)).toContainText("T105-korkea");
    await expect(rows.nth(2)).toContainText("T105-normaali");
  });
});

test.describe("task inbox upcoming-näkymä (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Seuraavat/Myöhässä: valmiit eivät sekoitu kumpaankaan ryhmään", async ({ page }) => {
    await page.goto("/tasks");
    // Luo kaksi avointa tehtävää FAB:lla samalla sivulla (data elää sivun
    // muistissa — tuotantokanta on tyhjä joka ajossa).
    for (const title of ["E2E-seuraava A", "E2E-seuraava B"]) {
      await page.getByTestId("quick-add-fab").click();
      const dialog = page.getByRole("dialog", { name: "Kirjaa" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Tehtävä" }).click();
      const form = page.getByTestId("quick-task-form");
      await expect(form).toBeVisible();
      await form.getByLabel("Tehtävän nimi").fill(title);
      await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
      await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    }
    // Merkitse toinen valmiiksi INBOXIN omasta checkboxista (idempotentti,
    // luotettava kohde — Tänään-kortti vaihtelee projektion mukaan).
    const inboxOpen = page.getByTestId("task-inbox-open");
    await expect(inboxOpen).toContainText("E2E-seuraava A");
    await inboxOpen.getByRole("checkbox").nth(1).click();
    await expect(page.getByTestId("task-inbox-done")).toContainText("E2E-seuraava B");

    // SPA-toggle upcoming-näkymään (ei gotoa — data säilyy sivun muistissa).
    await page.getByTestId("task-inbox-view-toggle").click();
    const overdue = page.getByTestId("task-inbox-overdue");
    const upcoming = page.getByTestId("task-inbox-upcoming");
    // Kumpikaan ryhmä ei sisällä valmiita rivejä (ei donesekoitusta kriteerin
    // mukaan); avoin rivi on Seuraavat-ryhmässä.
    await expect(upcoming).toContainText("E2E-seuraava A");
    await expect(page.getByTestId("task-inbox-done")).toHaveCount(0);
    await expect(overdue.or(upcoming)).not.toContainText("Valmiit");

    // Toggle pois: oletusnäkymä palaa, valmiit näkyvät omana ryhmänään.
    await page.getByTestId("task-inbox-view-toggle").click();
    await expect(page.getByTestId("task-inbox-open")).toContainText("E2E-seuraava A");
    await expect(page.getByTestId("task-inbox-done")).toContainText("E2E-seuraava B");
  });

  test("tyhjä upcoming: rehellinen tyhjätila ilman valmistuneita", async ({ page }) => {
    await page.goto("/tasks?upcoming=1");
    await expect(page.getByTestId("task-inbox-upcoming-empty")).toContainText("Ei myöhässä");
  });

  test("T104 ajanjaksot: päivä/viikko/kuukausi rajaa ja kuittaa jaksolla", async ({ page }) => {
    await page.goto("/tasks");
    // Luonti samalla sivulla (data elää sivun muistissa); Quick Task due = tänään.
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    await page.getByTestId("quick-task-form").getByLabel("Tehtävän nimi").fill("T104-jaksotehtävä");
    await page
      .getByTestId("quick-task-form")
      .getByRole("button", { name: "Tallenna tehtävä" })
      .click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);

    // Upcoming-tila, oletus "Kaikki" (T103-käyttäytyminen säilyy).
    await page.getByTestId("task-inbox-view-toggle").click();
    await expect(page.getByTestId("task-inbox-upcoming")).toContainText("T104-jaksotehtävä");

    // Päivä: tehtävä due tänään näkyy jaksolistassa + alemmallaMetalla.
    await page.getByTestId("task-period-select").getByRole("radio", { name: "Päivä" }).click();
    await expect(page.getByTestId("task-period-list")).toContainText("T104-jaksotehtävä");
    await expect(page.getByTestId("task-period-range")).toContainText("Ajalla");
    await expect(page.getByTestId("task-inbox-upcoming")).toHaveCount(0);

    // Viikko ja kuukausi: tänään kuuluu molempiin.
    await page.getByTestId("task-period-select").getByRole("radio", { name: "Viikko" }).click();
    await expect(page.getByTestId("task-period-list")).toContainText("T104-jaksotehtävä");
    await page.getByTestId("task-period-select").getByRole("radio", { name: "Kuukausi" }).click();
    await expect(page.getByTestId("task-period-list")).toContainText("T104-jaksotehtävä");

    // Kuiditus jaksossa → Valmiit ajalla (completedAt tänään = jakson sisällä).
    await page.getByTestId("task-period-list").getByRole("checkbox").first().click();
    await expect(page.getByTestId("task-period-done")).toContainText("T104-jaksotehtävä");
    await expect(page.getByTestId("task-period-list")).toHaveCount(0);

    // Takaisin "Kaikki": valmis ei sekoitu Seuraavat-ryhmään (T103-kriteeri).
    await page.getByTestId("task-period-select").getByRole("radio", { name: "Kaikki" }).click();
    await expect(page.getByTestId("task-inbox-upcoming")).toHaveCount(0);
    await expect(page.getByTestId("task-period-list")).toHaveCount(0);
  });

  test("T104 tyhjä jakso (syvälinkki): rehellinen tyhjätila", async ({ page }) => {
    await page.goto("/tasks?upcoming=1&period=viikko");
    await expect(page.getByTestId("task-inbox-upcoming-empty")).toContainText("ajalla viikko");
  });
});

test.describe("task inbox tagit (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("T106 tagit: luonti lomakkeella, suodatus ja yhtenäinen esitys", async ({ page }) => {
    await page.goto("/tasks");
    // Luonti tageilla — puuttuvat tagit syntyvät tallennuksen yhteydessä.
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    const form = page.getByTestId("quick-task-form");
    await expect(form).toBeVisible();
    await form.getByLabel("Tehtävän nimi").fill("T106-välitunti");
    await form.getByLabel("Tagit (valinnainen)").fill("työ, asia");
    await form.getByRole("button", { name: "Tallenna tehtävä" }).click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);

    // Yhtenäinen chip-esitys: rivillä ja suodatinrivillä samat nimet.
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T106-välitunti");
    await expect(open).toContainText("#työ");
    await expect(open).toContainText("#asia");
    const filter = page.getByTestId("task-tag-filter");
    await expect(filter).toBeVisible();
    await expect(filter).toContainText("#työ");
    await expect(filter).toContainText("#asia");

    // Toinen tehtävä ilman tageja.
    await createQuickTask(page, { title: "T106-toinen" });
    await expect(open).toContainText("T106-toinen");

    // Suodatus #työ → vain tagitetty tehtävä näkyy.
    await filter.getByTestId("tag-filter-työ").click();
    await expect(open).toContainText("T106-välitunti");
    await expect(open).not.toContainText("T106-toinen");

    // "Kaikki" poistaa suodatuksen.
    await page.getByTestId("tag-filter-all").click();
    await expect(open).toContainText("T106-välitunti");
    await expect(open).toContainText("T106-toinen");
  });
});
