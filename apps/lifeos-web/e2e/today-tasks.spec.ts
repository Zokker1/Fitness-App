// T083+T084+T085+T102: Tänään-korttien E2E Tänään-probeosiosta (chromium,
// preview-build). Tuotantokanta on tyhjä, joten korttien aidon datan tilat
// todistetaan probeosiosta (?e2e=1&probe=tanaan): NextUp-ehdotus,
// ryhmitelty tehtäväkortti (Myöhässä/Tänään/Tulevat/Valmiit — T102),
// rutiinikortti (rakenne, progress, seuraava askel, player-linkki) ja tavoitekortit
// (tilat, vaihto). Tuotantonäkymän tyhjätila todistetaan myös.
// Ei PII:tä/terveysdataa: synteettiset näytetekstit.
import { expect, test } from "@playwright/test";

test.describe("today-cards probe (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("ehdotus + tehtäväkortti aidosta probedatasta", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    // NextUp: myöhässä-voittaja + syy + linkki.
    const nextUp = probe.getByTestId("next-up-card");
    await expect(nextUp).toBeVisible();
    await expect(nextUp).toContainText("Myöhässä");
    await expect(nextUp.getByTestId("next-up-link")).toHaveAttribute("href", "/tasks");

    // T102-ryhmäkortti: Myöhässä (nx-over) + Tänään (3 due) alla
    // (nx-nodue ei Deadlinea → ei ryhmissä). Valmiita ei ole.
    // Testid: `groups-task-<id>` (TaskRow-sopimus).
    const card = probe.getByTestId("today-groups-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Päivän tehtävät" })).toBeVisible();
    await expect(card.getByRole("progressbar")).toBeVisible();
    await expect(card).toContainText("myöhässä");
    await expect(card.getByTestId("groups-task-nx-over")).toBeVisible();
    // Checkbox on toimiva (ei disabled tyhjässä tilassa).
    await expect(card.getByTestId("groups-task-nx-over")).toBeEnabled();
    await expect(probe.getByTestId("today-cards-sentinel")).toBeVisible();
  });

  test("rutiinikortti datalla: rakenne + askeleet + oikea rutiini -linkki", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    const card = probe.getByTestId("today-routines-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Päivän rutiinit" })).toBeVisible();
    // T153: oikean päivän suoritus näyttää etenemisen ja seuraavan vaiheen.
    await expect(card.getByRole("progressbar")).toBeVisible();
    await expect(card).toContainText("1 / 2 vaihetta käsitelty");
    await expect(card).toContainText("Seuraavaksi: Vesi");
    await expect(card).toContainText("Aamurutiini");
    await expect(card).toContainText("Venyttele");
    await expect(card).toContainText("Vesi");
    const open = card.getByTestId("routine-open-nx-routine");
    await expect(open).toHaveAttribute("href", "/goals?routine=nx-routine");
    await expect(open).toHaveAttribute("aria-label", "Jatka rutiinia Aamurutiini");
  });

  test("tavoitekortit: tilat näkyvät, vaihto toimii probessa", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    const card = probe.getByTestId("today-goals-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Päivän tavoitteet" })).toBeVisible();
    // 1/2 tehty (nx-goal-a completed, nx-goal-b pending).
    await expect(card).toContainText("1/2");
    await expect(card).toContainText("1 tekemättä tänään");
    const done = card.getByTestId("goal-checkbox-nx-goal-a");
    const pending = card.getByTestId("goal-checkbox-nx-goal-b");
    await expect(done).toBeChecked();
    await expect(pending).not.toBeChecked();
    await expect(card).toContainText("tehty");
    await expect(card).toContainText("tekemättä");
    // onToggle on probessa no-op — klikkaus ei kaada eikä muuta tilaa.
    await pending.click();
    await expect(pending).not.toBeChecked();
  });

  test("terveyskortti: neutraalit rivit datalla, ei diagnooseja", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    const card = probe.getByTestId("today-health-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Terveys tänään" })).toBeVisible();
    await expect(card).toContainText("7 h 30 min, laatu 4/5");
    await expect(card).toContainText("4/5, energia 3/5");
    await expect(card).toContainText("Ei kirjattu: Magnesium");
    await expect(card).toContainText("250 ml tänään");
    await expect(card.getByRole("link", { name: "Avaa terveys" })).toHaveAttribute(
      "href",
      "/health",
    );
  });

  test("fokus-kortti: minuutit + jatka-linkki käynnissä olevaan", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    const card = probe.getByTestId("today-focus-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Päivän fokus" })).toBeVisible();
    // 25 min valmiina + 1 istunto; käynnissä 15 min (08:45→09:00).
    await expect(card).toContainText("25 min");
    await expect(card).toContainText("1 istunto tänään");
    const resume = card.getByTestId("today-focus-resume");
    await expect(resume).toHaveAttribute("href", "/focus");
    await expect(resume).toContainText("15 min kulunut");
  });

  test("gamification-kortti: XP + taso + momentum + seuraava reward", async ({ page }) => {
    await page.goto("/?e2e=1&probe=tanaan");
    const probe = page.getByTestId("today-cards-probe");
    await expect(probe).toBeVisible();

    const card = page
      .getByTestId("today-cards-probe")
      .getByTestId("today-gamification-card")
      .first();
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2, name: "Edistyminen" })).toBeVisible();
    // 10 XP tänään, taso 3, 2/7 aktiivista, 1 palkinto ansaittu.
    await expect(card).toContainText("10 XP");
    await expect(card).toContainText("Taso 3");
    await expect(card).toContainText("2/7 päivää");
    await expect(card).toContainText("1 palkinto ansaittu");
    await expect(card).toContainText("Seuraava: Viikon putki");
    await expect(card.getByRole("link", { name: "Avaa insights" })).toHaveAttribute(
      "href",
      "/insights",
    );
  });
});

test.describe("today production (mobiili 390px)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tyhjätila ilman dataa; yksi h1", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("today-header")).toBeVisible();
    await expect(page.getByTestId("next-up-empty")).toBeVisible();
    await expect(page.getByTestId("today-groups-empty")).toBeVisible();
    await expect(page.getByTestId("today-routines-empty")).toBeVisible();
    await expect(page.getByTestId("today-goals-empty")).toBeVisible();
    await expect(page.getByTestId("today-health-empty")).toBeVisible();
    await expect(page.getByTestId("today-focus-empty")).toBeVisible();
    await expect(page.getByTestId("today-gamification-empty")).toBeVisible();
    await expect(page.getByTestId("next-up-card")).toHaveCount(0);
    await expect(page.getByTestId("today-groups-card")).toHaveCount(0);
    await expect(page.getByTestId("today-routines-card")).toHaveCount(0);
    await expect(page.getByTestId("today-goals-card")).toHaveCount(0);
    await expect(page.getByTestId("today-health-card")).toHaveCount(0);
    await expect(page.getByTestId("today-focus-card")).toHaveCount(0);
    await expect(page.getByTestId("today-gamification-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});

test.describe("today production (desktop 1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sama tyhjätila ilman layout-rikkoa", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("today-groups-empty")).toBeVisible();
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
