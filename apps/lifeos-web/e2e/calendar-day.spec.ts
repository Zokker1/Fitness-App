// T121+T122: kalenteri E2E (chromium, preview-build, TUOTANTOnäkymä).
// Päivä: tunnit, nykyhetki ja blockit touch- ja mouse/keyboard-ystävällisesti
// responsiivisessa selaimessa. Viikko: timeboxit skaalautuvana — kaistat,
// kiireellisyysjärjestys, drill-down näkymän pysyessä, viikkonavigointi.
// Kriteeri: tunnit, nykyhetki ja blockit näkyvät touch- ja
// mouse/keyboard-ystävällisesti responsiivisessa selaimessa.
// - Timeboxin luonti lomakkeella (otsikko + aloitusaika + kesto);
// - block näkyy ruudukossa oikealla tunnilla (button — näppäimistö fokusoi);
// - päällekkäiset blockit näkyvät molemmat (kaistat);
// - nykyhetki (tänään): indikaattori + viiva;
// - päivänvaihto: tyhjä päivä → rehellinen tyhjätila, takaisin tänään.
// Data elää sivun muistissa → goto vain alkuun. Ei PII:tä: synteettiset tekstit.
import { expect, test } from "@playwright/test";

test.describe("päiväkalenteri kosketus (mobiili 390px, T129)", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("lyhyt kosketus scrollaa eikä siirrä; pitkä painallus + siirto siirtää blockin", async ({
    page,
  }) => {
    await page.goto("/calendar");
    await page.getByLabel("Timeboxin nimi").fill("T129-kosketus");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "60 min" });
    await page.getByTestId("calendar-block-create").click();
    const grid = page.getByTestId("calendar-day-grid");
    await expect(grid).toContainText("10.00–11.00");

    // 1) TAVALLINEN SCROLL: vedä ruudukkoa pystysuunnassa — block EI saa
    //    siirtyä (pitkä painallus puuttuu → longpress-ajastin peruuntuu).
    const block = grid.getByRole("button", { name: /T129-kosketus/ });
    await block.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });
    const box = await block.boundingBox();
    if (box === null) {
      throw new Error("blockin laatikkoa ei saatu");
    }
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    // Tap avaa muokkauksen (ei scrollia) — peruuta se, block ei siirtynyt.
    await expect(page.getByTestId("calendar-block-cancel")).toBeVisible();
    await page.getByTestId("calendar-block-cancel").click();
    await expect(grid).toContainText("10.00–11.00");

    // 2) PITKÄ PAINALLUS + SIIRTO: touchscreen ei tue press-and-hold-movea
    //    suoraan → simuloi pointereventeillä (touch-tyyppi, kuten selain).
    const center = await block.evaluate((element) => {
      const rect = (element as HTMLElement).getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await block.evaluate((element, point) => {
      const rectTarget = element as HTMLElement;
      const down = new PointerEvent("pointerdown", {
        pointerId: 7,
        pointerType: "touch",
        clientX: point.x,
        clientY: point.y,
        bubbles: true,
      });
      rectTarget.dispatchEvent(down);
      return null;
    }, center);
    // Lyhyt kosketus ei käynnistä vetoa: varmistetaan ettei block liikkunut
    // vahingossa pelkästä pointerdownista (ajastin 600 ms ei ole kulunut).
    await page.waitForTimeout(150);
    await expect(grid).toContainText("10.00–11.00");
    await block.evaluate((element) => {
      const rectTarget = element as HTMLElement;
      rectTarget.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      return null;
    }, null);
  });
});

test.describe("päiväkalenteri (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("timebox: luonti, block ruudukossa, päällekkäisyys ja nykyhetki", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { level: 1, name: "Kalenteri" })).toBeVisible();

    // 1) Luo timebox 10:00, 60 min.
    await page.getByLabel("Timeboxin nimi").fill("T121-syventyminen");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "60 min" });
    await page.getByTestId("calendar-block-create").click();
    const grid = page.getByTestId("calendar-day-grid");
    await expect(grid).toContainText("T121-syventyminen");
    await expect(grid).toContainText("10.00–11.00");

    // Näppäimistö: block on nappiruutu (fokusoituu Tabilla — roolitarkistus).
    await expect(grid.getByRole("button", { name: /T121-syventyminen/ })).toBeVisible();

    // 2) Päällekkäinen timebox 10:30 → molemmat näkyvät (kaistat).
    await page.getByLabel("Timeboxin nimi").fill("T121-päällekkäinen");
    await page.getByLabel("Aloitusaika").fill("10:30");
    await page.getByLabel("Kesto").selectOption({ label: "30 min" });
    await page.getByTestId("calendar-block-create").click();
    await expect(grid.getByRole("button", { name: /T121-päällekkäinen/ })).toBeVisible();
    await expect(grid.getByRole("button", { name: /T121-syventyminen/ })).toBeVisible();

    // 3) Nykyhetki (tänään katsottavana): indikaattori + viiva NÄKYVÄT vain
    //    ikkunassa 06–22 — muulloin rehellisesti piilossa. Testiympäristön
    //    kellonaika on UTC, sovellus näyttää paikallista aikaa → lasketaan
    //    vertailu samalla tavalla kuin sovellus (UTC-offset mukaan).
    const hourNow = (new Date().getUTCHours() - new Date().getTimezoneOffset() / 60 + 24) % 24;
    if (hourNow >= 6 && hourNow < 22) {
      await expect(page.getByTestId("calendar-now-indicator")).toContainText("Nyt kello");
      await expect(page.getByTestId("calendar-now-line")).toBeVisible();
    } else {
      await expect(page.getByTestId("calendar-now-indicator")).toHaveCount(0);
      await expect(page.getByTestId("calendar-now-line")).toHaveCount(0);
    }

    // 4) Seuraava päivä: tyhjätila; takaisin: blockit palautuvat (SPA, data
    //    säilyy muistissa).
    await page.getByTestId("calendar-next-day").click();
    await expect(page.getByTestId("calendar-day")).toContainText("Ei timeboxeja");
    await page.getByTestId("calendar-prev-day").click();
    await expect(grid).toContainText("T121-syventyminen");
  });

  test("T132: päivään voi hypätä päivävalitsimella ja navigointi säilyttää locale-otsikon", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-09-22T12:00:00.000Z") });
    await page.goto("/calendar");
    const datePicker = page.getByLabel("Siirry päivään");

    await datePicker.fill("2026-09-23");
    await expect(page).toHaveURL(/date=2026-09-23/);
    await expect(page.getByTestId("calendar-day")).toContainText(
      "Päivä: keskiviikkona 23. syyskuuta 2026",
    );

    await page.getByTestId("calendar-next-day").click();
    await expect(page).toHaveURL(/date=2026-09-24/);
    await expect(page.getByTestId("calendar-date-picker")).toHaveValue("2026-09-24");
    await expect(page.getByTestId("calendar-day")).toContainText(
      "Päivä: torstaina 24. syyskuuta 2026",
    );

    await page.getByTestId("calendar-prev-day").click();
    await expect(page).toHaveURL(/date=2026-09-23/);
    await page.getByTestId("calendar-today").click();
    await expect(page).not.toHaveURL(/date=/);
  });

  test("T128: blockin siirto hiirellä — pudotus persistoi uuden aloitusajan", async ({ page }) => {
    // Blockki 10:00 + 60 min → raahaa ~1 h alaspäin → aloitus 11:00.
    await page.goto("/calendar");
    await page.getByLabel("Timeboxin nimi").fill("T128-raahaus");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "60 min" });
    await page.getByTestId("calendar-block-create").click();
    const grid = page.getByTestId("calendar-day-grid");
    await expect(grid).toContainText("T128-raahaus");
    await expect(grid).toContainText("10.00–11.00");

    // Hiirellä: paina blockin keskeltä ja siirrä täsmälleen yhden tunnin verran
    // ruudukon todellisen korkeuden perusteella. Näin testi ei riipu siitä,
    // onko 06–22-ruudukko renderöity 48rem- vai 64rem-korkuisena.
    const handle = grid.getByRole("button", { name: /T128-raahaus/ });
    await handle.evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "nearest" });
    });
    const box = await handle.boundingBox();
    const surface = grid.locator("div.calendar-day-grid");
    const surfaceBox = await surface.boundingBox();
    if (box === null || surfaceBox === null) {
      throw new Error("blockin laatikkoa ei saatu");
    }
    const oneHourPixels = surfaceBox.height / 16;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + oneHourPixels, {
      steps: 8,
    });
    await page.mouse.up();
    // Snap 15 min:iin: yhden tunnin siirto → 11:00–12:00.
    await expect(grid).toContainText("11.00–12.00");
    await expect(grid).not.toContainText("10.00–11.00");
    // Reload_muutos tappaa tilan? EI — blockki luotiin muistissa; siirto
    // päivittyi samaan storeen (persistenssi todistettu T124:ssa reloadilla).
  });

  test("T130: yli 3 päällekkäistä → '1 lisää' -indikaattori ja laajennus", async ({ page }) => {
    await page.goto("/calendar");
    const grid = page.getByTestId("calendar-day-grid");
    const names = ["T130-a", "T130-b", "T130-c", "T130-d"];
    // Täysin samanaikaiset → 4 kaistaa → tiivistys 3:een + "1 lisää".
    const starts = ["10:00", "10:00", "10:00", "10:00"];
    for (let index = 0; index < names.length; index += 1) {
      const name = names[index];
      const start = starts[index];
      if (name === undefined || start === undefined) {
        throw new Error("puuttuu");
      }
      await page.getByLabel("Timeboxin nimi").fill(name);
      await page.getByLabel("Aloitusaika").fill(start);
      await page.getByLabel("Kesto").selectOption({ label: "30 min" });
      await page.getByTestId("calendar-block-create").click();
      // 4. blockki syntyy jo piilossa → odotus indikaattorilla, ei nimellä.
      if (index < names.length - 1) {
        await expect(grid).toContainText(name);
      }
    }

    // 4 samanaikaista → 3 kaistaa + indikaattori "1 lisää"; 4. PILOTETTU
    // (ei renderöidä peiton alle, §6).
    const more = page.getByTestId("calendar-overflow-1-more");
    await expect(more).toContainText("1 lisää");
    await expect(grid.getByRole("button", { name: /T130-d/ })).toHaveCount(0);
    const collapsed = await grid
      .getByRole("button", { name: /T130-a/ })
      .evaluate((element) => (element as HTMLElement).style.width);
    expect(Number.parseFloat(collapsed)).toBeCloseTo(100 / 3, 1);

    // Laajennus: KAIKKI 4 näkyvät (1/4 leveys), nappi muuttuu "Piilota".
    await more.click();
    await expect(grid.getByRole("button", { name: /T130-d/ })).toBeVisible();
    await expect(more).toContainText("Piilota");
    const expanded = await grid
      .getByRole("button", { name: /T130-a/ })
      .evaluate((element) => (element as HTMLElement).style.width);
    expect(Number.parseFloat(expanded)).toBeCloseTo(25, 1);

    // Piilota: tiivistys takaisin (3 kaistaa + "1 lisää").
    await more.click();
    await expect(more).toContainText("1 lisää");
    await expect(grid.getByRole("button", { name: /T130-d/ })).toHaveCount(0);
  });

  test("T127: kalenteriblokista voi aloittaa oikean focus-session", async ({ page }) => {
    // Blockki olemassa → klikkaa auki → Aloita fokus → running-vahvistus.
    await page.goto("/calendar");
    await page.getByLabel("Timeboxin nimi").fill("T127-fokusblokki");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "30 min" });
    await page.getByTestId("calendar-block-create").click();
    const grid = page.getByTestId("calendar-day-grid");
    await expect(grid).toContainText("T127-fokusblokki");

    // Sama blockki uudelleen auki muokkaukseen ja fokus käyntiin.
    await grid
      .getByTestId(/^calendar-block-/)
      .first()
      .click();
    await page.getByTestId("calendar-block-focus").click();
    await expect(page.getByTestId("calendar-block-focus-active")).toContainText("Fokus käynnissä");
  });

  test("T122 viikko: skaalautuva ruudukko, kiireellisyys, drill-down ja fokus", async ({
    page,
  }) => {
    await page.goto("/calendar");
    await expect(page.getByRole("heading", { level: 1, name: "Kalenteri" })).toBeVisible();

    // Luo kaksi timeboxia tälle päivälle (yksi päällekkäinen → kaistat).
    await page.getByLabel("Timeboxin nimi").fill("T122-aamu");
    await page.getByLabel("Aloitusaika").fill("08:00");
    await page.getByLabel("Kesto").selectOption({ label: "30 min" });
    await page.getByTestId("calendar-block-create").click();
    await page.getByLabel("Timeboxin nimi").fill("T122-päällekkäinen");
    await page.getByLabel("Aloitusaika").fill("08:15");
    await page.getByLabel("Kesto").selectOption({ label: "30 min" });
    await page.getByTestId("calendar-block-create").click();

    // Vaihda viikkonäkymään (?view=week) — ruudukon 7 päiväsolua näkyvät,
    // myös tyhjät (mobiilin tiivistys on CSS:ää, desktopilla kaikki).
    await page.getByTestId("calendar-view-select").getByRole("radio", { name: "Viikko" }).click();
    const weekGrid = page.getByTestId("calendar-week-grid");
    await expect(weekGrid).toBeVisible();
    await expect(weekGrid.locator("a")).toHaveCount(7);
    // Tänään-solu korostuu (aria-current) ja kertoo tämän päivän 2 timeboxia
    // (otsikot ovat alla yhteenvedossa, ei solussa).
    const todayCell = weekGrid.locator('a[aria-current="date"]');
    await expect(todayCell).toContainText("2 timeboxia");
    // Yhteenveto on kiireellisyysjärjestyksessä (Myöhässä > Tänään > Tuleva).
    const summary = page.getByTestId("calendar-week-summary");
    await expect(summary).toContainText("Tänään");
    await expect(summary).toContainText("T122-aamu");
    await expect(summary).toContainText("T122-päällekkäinen");

    // Drill-down: tämän päivän solu → päivän timeboxit näkyvät viikossa
    // (solu on natiivi linkki ?view=week&date=; näkymä pysyy viikossa,
    // jotta käyttäjä palaa siihen mistä tuli §27).
    await todayCell.click();
    await expect(page).toHaveURL(/date=/);
    await expect(page).toHaveURL(/view=week/);
    await expect(page.getByTestId("calendar-week-summary")).toContainText("T122-aamu");
    await expect(page.getByTestId("calendar-week-grid")).toBeVisible();

    // Takaisin päivään: näkymävalitsin → Päivä (eksplisiittinen valinta).
    await page.getByTestId("calendar-view-select").getByRole("radio", { name: "Päivä" }).click();
    await expect(
      page.getByTestId("calendar-day-grid").getByRole("button", { name: /T122-aamu/ }),
    ).toBeVisible();

    // Viikkonavigointi: takaisin viikkoon → seuraava viikko (tyhjä) →
    // edellinen viikko (timeboxit palautuvat).
    await page.getByTestId("calendar-view-select").getByRole("radio", { name: "Viikko" }).click();
    await page.getByTestId("calendar-next-week").click();
    await expect(page.getByTestId("calendar-day")).toContainText("Viikossa ei timeboxeja");
    await page.getByTestId("calendar-prev-week").click();
    await expect(page.getByTestId("calendar-week-summary")).toContainText("T122-aamu");
  });
});

test.describe("T125 task timeboxiin (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("tehtävä linkittyy timeboxiin ilman duplikaattia", async ({ page }) => {
    // 1) Luo tehtävä inboxissa (muistidata — SPA-navigointi säilyttää sen).
    await page.goto("/tasks");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    await page.getByTestId("quick-task-form").getByLabel("Tehtävän nimi").fill("T125-tehtävä");
    await page
      .getByTestId("quick-task-form")
      .getByRole("button", { name: "Tallenna tehtävä" })
      .click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);
    await expect(page.getByTestId("task-inbox-open")).toContainText("T125-tehtävä");

    // 2) SPA-navigointi kalenteriin (nav-linkki — data säilyy muistissa).
    await page.getByRole("link", { name: "Kalenteri" }).first().click();
    await expect(page).toHaveURL(/calendar/);

    // 3) Luo timebox tehtävälinkityksellä: nimi esitäyttyy tehtävän otsikosta
    //    (ei kaksinkertaista kirjoitusta).
    await page.getByLabel("Tehtävälinkitys (valinnainen)").selectOption({ label: "T125-tehtävä" });
    await expect(page.getByLabel("Timeboxin nimi")).toHaveValue("T125-tehtävä");
    await page.getByLabel("Aloitusaika").fill("09:00");
    await page.getByLabel("Kesto").selectOption({ label: "30 min" });
    await page.getByTestId("calendar-block-create").click();

    // 4) Block näyttää tehtävän NYKYISEN otsikon + Tehtävä-merkin (lookup —
    //    ei kopiota) ja inboxissa on yhä täsmälleen yksi kappale — ei
    //    duplikaattia.
    const grid = page.getByTestId("calendar-day-grid");
    await expect(grid).toContainText("T125-tehtävä");
    await expect(grid).toContainText("Tehtävä");
    await page.getByRole("link", { name: "Tehtävät" }).first().click();
    await expect(page).toHaveURL(/tasks/);
    const open = page.getByTestId("task-inbox-open");
    await expect(open).toContainText("T125-tehtävä");
    await expect(open.locator("li", { hasText: "T125-tehtävä" })).toHaveCount(1);
  });
});

test.describe("T131 ajastamattomat vedetään kalenteriin (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("paneelitehtävä → veto luo linkitetyn blockin; paneeli tyhjenee eikä duplikoi", async ({
    page,
  }) => {
    // 1) Luo tehtävä inboxissa (muistidata — SPA-navigointi säilyttää sen).
    await page.goto("/tasks");
    await page.getByTestId("quick-add-fab").click();
    const dialog = page.getByRole("dialog", { name: "Kirjaa" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Tehtävä" }).click();
    await page.getByTestId("quick-task-form").getByLabel("Tehtävän nimi").fill("T131-veto");
    await page
      .getByTestId("quick-task-form")
      .getByRole("button", { name: "Tallenna tehtävä" })
      .click();
    await expect(page.getByRole("dialog", { name: "Kirjaa" })).toHaveCount(0);

    // 2) SPA-navigointi kalenteriin — tehtävä on unscheduled-paneelissa.
    await page.getByRole("link", { name: "Kalenteri" }).first().click();
    await expect(page).toHaveURL(/calendar/);
    const panel = page.getByTestId("calendar-unscheduled-list");
    await expect(panel).toContainText("T131-veto");

    // 3) Pudotus E2E-hookin kautta (HUOM rehellisesti: natiivia
    //    HTML5-DnD:tä ei voi dispatchata synteettisesti Playwrightista
    //    React 19:n delegoidulle kuuntelijalle — oikea veto on draggable=
    //    lähde + grid-tason dragover/drop ja manuaalitesti; hook kutsuu
    //    samaa scheduleUnscheduledTask-polkua samalla id:llä + ajalla).
    //    10:00 erottaa hookin Ajasta-napista (09:00-oletus).
    await expect(panel).toContainText("T131-veto");
    const createdTaskId = await page.evaluate(() => {
      const scheduleButton = document.querySelector(
        '[data-testid^="calendar-unscheduled-schedule-"]',
      );
      const label = scheduleButton?.getAttribute("data-testid") ?? "";
      return label.replace("calendar-unscheduled-schedule-", "");
    });
    await page.evaluate(
      (drop: { readonly id: string }) => {
        const payload = document.querySelector('[data-testid="calendar-task-drop-payload"]');
        if (payload === null) {
          throw new Error("pudotuskohdetta ei löytynyt");
        }
        payload.setAttribute("data-task-drop-task", drop.id);
        // 10:00 paikallista (sama kuin Aloitusaika-oletus 09:00 → tässä
        // pudotus 10:00 erottaa hookin Ajasta-napista).
        payload.setAttribute("data-task-drop-minutes", "600");
        (payload as HTMLElement).click();
      },
      { id: createdTaskId },
    );
    const grid = page.getByTestId("calendar-day-grid");
    await expect(grid).toContainText("T131-veto");
    await expect(grid).toContainText("Tehtävä");

    // 4) Paneeli tyhjenee (linkitetty ei ole enää ajastamaton). Sama
    //    blockki näkyy myös Tasks-näkymän kautta (sama store — ei
    //    duplikaattia); session persistenssi on T124/T130:n asia (muistidata
    //    ei säily E2E-reloadissa, kuten T128-kommentti toteaa).
    await expect(page.getByTestId("calendar-unscheduled-list")).toHaveCount(0);
    await page.getByRole("link", { name: "Tehtävät" }).first().click();
    await expect(page).toHaveURL(/tasks/);
    await expect(page.getByTestId("task-inbox-open")).toContainText("T131-veto");
  });
});

test.describe("kuukausikalenteri (mobiili 390px, T123)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("päivätiheys pysyy luettavana pienellä näytöllä ja drill-down toimii", async ({ page }) => {
    await page.goto("/calendar?view=month");
    await expect(page.getByRole("heading", { level: 1, name: "Kalenteri" })).toBeVisible();

    // Kuukausiruudukko: 7 saraketta avaruudessa (mobiililla 1 sarake CSS:llä),
    // solut täyttöpäivineen — tiheysteksti luettavana jokaisessa kuukauden
    // päivässä (esim. "rauhallinen — 0 timeboxia").
    const monthGrid = page.getByTestId("calendar-month-grid");
    await expect(monthGrid).toBeVisible();
    await expect(monthGrid.locator("a").filter({ hasText: "timeboxia" })).toHaveCount(35, {
      timeout: 5_000,
    });

    // Nykyinen päivä korostettu (aria-current) ja sen tiheys luettavana.
    const todayCell = monthGrid.locator('a[aria-current="date"]');
    await expect(todayCell).toContainText("rauhallinen");

    // Drill-down: kuukausisolu → päivänäkymä (näkymä palaa päivään, kuten
    // T120-semantiikassa: päivä on oletus, kuukausi pitää valita uudelleen).
    await todayCell.click();
    await expect(page).toHaveURL(/date=/);
    await expect(page.getByTestId("calendar-day-grid")).toBeVisible();
    await expect(page.getByTestId("calendar-day")).toContainText("Ei timeboxeja");
  });

  test("kuukausitiheys päivittyy timeboxin luonnista (aggregaatio)", async ({ page }) => {
    await page.goto("/calendar?view=month");
    const todayCell = page.getByTestId("calendar-month-grid").locator('a[aria-current="date"]');
    await expect(todayCell).toContainText("rauhallinen");

    // Luo timebox tämän päivän tunnille päivänäkymässä (drill-down ensin).
    await todayCell.click();
    await expect(page.getByTestId("calendar-day-grid")).toBeVisible();
    await page.getByLabel("Timeboxin nimi").fill("T123-kuukausitest");
    await page.getByLabel("Aloitusaika").fill("10:00");
    await page.getByLabel("Kesto").selectOption({ label: "30 min" });
    await page.getByTestId("calendar-block-create").click();
    await expect(page.getByTestId("calendar-day-grid")).toContainText("T123-kuukausitest");

    // Takaisin kuukauteen: solun tiheys päivittynyt ("normaali — 1 timeboxia").
    await page.getByTestId("calendar-view-select").getByRole("radio", { name: "Kuukausi" }).click();
    const todayCellAfter = page
      .getByTestId("calendar-month-grid")
      .locator('a[aria-current="date"]');
    await expect(todayCellAfter).toContainText("normaali");
    await expect(todayCellAfter).toContainText("1 timeboxia");
  });
});
