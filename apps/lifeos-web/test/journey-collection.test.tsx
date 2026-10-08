// T191: Journey/Constellation -keräilyn unit-testit (happy-dom).
// - Tähtikartta visualisoi etenemisen omana maailmanaan: polkuvalo ansaituista
//   yhteyksistä, muoto koodaa lajin (ympyrä = tähti, vinoneliö = alue §31);
// - avausehto odottavalle on tietoa ei rankaisua (§51/§57.14);
// - yhteenveto "N / M avattu"; tyhjä suunniteltu tila.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Achievement, Collectible, UserReward } from "@lifeos/domain";
import { InMemoryStore, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { JourneyCollection } from "../src/views/insights/JourneyCollection.tsx";

const AT = "2026-09-18T09:00:00.000Z";

function collectible(id: string, key: string, title: string): Collectible {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key,
    title,
    unlocksThemeKey: key.startsWith("region-") ? "aurora" : null,
  };
}

function reward(id: string, collectibleId: string, earnedAt: string): UserReward {
  return {
    id,
    createdAt: earnedAt,
    updatedAt: earnedAt,
    version: 1,
    achievementId: null,
    collectibleId,
    earnedAt,
  };
}

function renderJourney(
  collectibles: readonly Collectible[],
  rewards: readonly UserReward[],
  achievements: readonly Achievement[] = [],
): void {
  document.body.innerHTML = "";
  render(
    <DataProvider
      ids={sequentialIdGenerator("jcoll")}
      achievementStore={new InMemoryStore<Achievement>("achievement", [...achievements])}
      collectibleStore={new InMemoryStore<Collectible>("collectible", [...collectibles])}
      userRewardStore={new InMemoryStore<UserReward>("user-reward", [...rewards])}
    >
      <JourneyCollection />
    </DataProvider>,
  );
}

describe("JourneyCollection (T191)", () => {
  it("polkuvalo ansaituista yhteyksistä, muoto koodaa lajin", async () => {
    renderJourney(
      [
        collectible("c-1", "star-first-light", "Ensimmäinen tähti"),
        collectible("c-2", "star-streak", "Seitsentähti"),
        collectible("c-3", "region-aurora", "Revontulialue"),
      ],
      [reward("r-1", "c-1", "2026-09-15T07:00:00.000Z")],
    );
    const sky = await screen.findByTestId("journey-collection");
    expect(sky.querySelector('[data-ui="journey-sky"]')).not.toBeNull();
    // Väli 1→2 ei ole syttynyt (2 odottaa) — vain ansaiteet yhteydet palavat.
    const lines = sky.querySelectorAll("line");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line.getAttribute("stroke")).toBe("var(--lifeos-color-border)");
    }
    // Muoto: tähdet ympyröinä, alue vinoneliönä.
    expect(sky.querySelectorAll("circle")).toHaveLength(2);
    expect(sky.querySelectorAll("rect")).toHaveLength(1);
  });

  it("ansaittu yhteys syttyy + avausehto odottavalle ilman hämeäkieltä", async () => {
    renderJourney(
      [
        collectible("c-1", "star-first-light", "Ensimmäinen tähti"),
        collectible("c-2", "star-streak", "Seitsentähti"),
        collectible("c-3", "region-aurora", "Revontulialue"),
      ],
      [
        reward("r-1", "c-1", "2026-09-15T07:00:00.000Z"),
        reward("r-2", "c-2", "2026-09-16T07:00:00.000Z"),
      ],
    );
    const sky = await screen.findByTestId("journey-collection");
    const lit = sky.querySelector("line");
    expect(lit?.getAttribute("stroke")).toBe("var(--lifeos-color-accent)");
    // Avausehto on tietoa: saavutuksen nimi TAI tasokynnys, ei rankaisua.
    expect(screen.getByText("Avautuu tasolla 5")).toBeInTheDocument();
    expect(screen.getByText(/Avattu 15\.9\.2026/)).toBeInTheDocument();
    expect(screen.getByTestId("journey-summary")).toHaveTextContent("2 / 3 avattu");
    const text = document.body.textContent;
    for (const banned of ["epäonnistu", "häviäjä", "lukittu", "menetit", "et ansainnut"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("avausehto näyttää saavutuksen nimen; tyhjä katalogi → suunniteltu tila", async () => {
    renderJourney(
      [collectible("c-1", "star-first-light", "Ensimmäinen tähti")],
      [],
      [
        {
          id: "a-1",
          createdAt: AT,
          updatedAt: AT,
          version: 1,
          key: "first-task",
          title: "Ensimmäinen tehtävä",
          description: null,
        },
      ],
    );
    expect(
      await screen.findByText("Avautuu saavutuksesta: Ensimmäinen tehtävä"),
    ).toBeInTheDocument();

    renderJourney([], []);
    expect(await screen.findByText("Ei kerättäviä vielä")).toBeInTheDocument();
  });

  it("taivas on koriste — luettelo kantaa luettavan sisällön (§31)", async () => {
    renderJourney([collectible("c-1", "star-first-light", "Ensimmäinen tähti")], []);
    const sky = await screen.findByTestId("journey-collection");
    expect(sky.querySelector('[data-ui="journey-sky"]')?.getAttribute("aria-hidden")).toBe("true");
    const list = screen.getByTestId("journey-list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });
});
