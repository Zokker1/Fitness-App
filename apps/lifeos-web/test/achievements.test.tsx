// T189: saavutusgallerian unit-testit (happy-dom).
// - AchievementCard: tila muodolla + sanalla (§31), ei häpeäkieltä (§51);
//   odottava saa samanarvoisen otsikon kuin avattu (§57.14).
// - AchievementsGallery: avatut ensin, odottavat aakkosissa; yhteenveto
//   "N / M avattu"; tyhjä suunniteltu tila; ansaitut päivämäärineen.
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Achievement, UserReward } from "@lifeos/domain";
import { AchievementCard } from "@lifeos/ui";
import { InMemoryStore, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../src/dataContext.tsx";
import { AchievementsGallery } from "../src/views/insights/AchievementsGallery.tsx";

const AT = "2026-09-18T09:00:00.000Z";

function achievement(id: string, title: string): Achievement {
  return {
    id,
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: id,
    title,
    description: null,
  };
}

function reward(id: string, achievementId: string, earnedAt: string): UserReward {
  return {
    id,
    createdAt: earnedAt,
    updatedAt: earnedAt,
    version: 1,
    achievementId,
    collectibleId: null,
    earnedAt,
  };
}

function renderGallery(achievements: readonly Achievement[], rewards: readonly UserReward[]): void {
  document.body.innerHTML = "";
  render(
    <DataProvider
      ids={sequentialIdGenerator("gach")}
      achievementStore={new InMemoryStore<Achievement>("achievement", [...achievements])}
      userRewardStore={new InMemoryStore<UserReward>("user-reward", [...rewards])}
    >
      <AchievementsGallery />
    </DataProvider>,
  );
}

describe("AchievementCard (T189)", () => {
  it("avattu: merkki + status sana + ansaittu päivä", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <ul>
        <AchievementCard
          title="Ensimmäinen tehtävä"
          description="Kirjasit ensimmäisen tehtävän valmiiksi."
          state="earned"
          status="Avattu 15.9.2026"
        />
      </ul>,
    );
    expect(screen.getByText("Ensimmäinen tehtävä")).toBeInTheDocument();
    expect(screen.getByText("Avattu 15.9.2026")).toBeInTheDocument();
    const item = container.querySelector('[data-ui="achievement-card"]');
    expect(item?.getAttribute("data-state")).toBe("earned");
    // Tila näkyy merkin muotona (täytetty ympyrä), ei pelkkänä värinä (§31).
    const mark = container.querySelector('[data-ui="achievement-mark"]');
    expect(mark?.getAttribute("data-state")).toBe("earned");
  });

  it("odottava: samanarvoinen otsikko + kutsu, ei hämeäkieltä", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <ul>
        <AchievementCard title="Viikon putki" state="locked" status="Ei vielä avattu" />
      </ul>,
    );
    expect(screen.getByText("Viikon putki")).toBeInTheDocument();
    expect(screen.getByText("Ei vielä avattu")).toBeInTheDocument();
    const mark = container.querySelector('[data-ui="achievement-mark"]');
    expect(mark?.getAttribute("data-state")).toBe("locked");
    const text = document.body.textContent;
    for (const banned of ["epäonnistu", "häviäjä", "menetit", "lukittu sinulta", "rankaistu"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });
});

describe("AchievementsGallery (T189)", () => {
  it("avatut ensin (uusin ensin), odottavat aakkosissa + yhteenveto", async () => {
    renderGallery(
      [
        achievement("a-1", "Viikon putki"),
        achievement("a-2", "Ensimmäinen tehtävä"),
        achievement("a-3", "Fokustunti"),
      ],
      [
        reward("r-1", "a-3", "2026-09-10T07:00:00.000Z"),
        reward("r-2", "a-2", "2026-09-15T07:00:00.000Z"),
      ],
    );
    const list = await screen.findByTestId("achievements-list");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toHaveLength(3);
    // Avatut ensin, uusin ansaittu ensin → Ensimmäinen tehtävä, Fokustunti;
    // odottava aakkosissa → Viikon putki.
    expect(items[0]?.textContent).toContain("Ensimmäinen tehtävä");
    expect(items[1]?.textContent).toContain("Fokustunti");
    expect(items[2]?.textContent).toContain("Viikon putki");
    expect(screen.getByTestId("achievements-summary")).toHaveTextContent("2 / 3 avattu");
    // Ansaitut näyttävät päivämäärän, odottava kutsun.
    expect(screen.getByText(/Avattu 15\.9\.2026/)).toBeInTheDocument();
    expect(screen.getByText("Ei vielä avattu")).toBeInTheDocument();
  });

  it("tyhjä katalogi → suunniteltu tyhjä tila", async () => {
    renderGallery([], []);
    expect(await screen.findByText("Ei saavutuksia vielä")).toBeInTheDocument();
  });

  it("kaikki avattu → ei odottavia, yhteenveto täynnä", async () => {
    renderGallery(
      [achievement("a-1", "Ensimmäinen tehtävä")],
      [reward("r-1", "a-1", "2026-09-15T07:00:00.000Z")],
    );
    expect(await screen.findByTestId("achievements-summary")).toHaveTextContent("1 / 1 avattu");
    expect(screen.queryByText("Ei vielä avattu")).not.toBeInTheDocument();
  });
});
