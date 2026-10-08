// T052: progress-komponenttien unit-testit (happy-dom).
// - ProgressBar: natiivi progress (value/max/label/tekstivastine), clamp
//   0–100 + pyöristys, koot sm/md.
// - ProgressRing: role=img + label, dasharray vastaa arvoa, oletuskeskellä
//   prosentti, slottilapsi korvaa sen.
// - StreakDots: lista + tilat (data-state) + ruudunlukijasanat (ei pelkkä väri).
// - GoalProgress: kooste (rengas + luvut + palkki + sanallinen jatkumotila).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoalProgress, LevelProgress, ProgressBar, ProgressRing, StreakDots } from "@lifeos/ui";

describe("ProgressBar", () => {
  it("natiivi progress arvolla + labelilla + tekstivastineella", () => {
    document.body.innerHTML = "";
    render(<ProgressBar value={62} label="Viikon fokus 62 prosenttia" />);
    const bar = screen.getByRole("progressbar", { name: "Viikon fokus 62 prosenttia" });
    expect(bar.getAttribute("value")).toBe("62");
    expect(bar.getAttribute("max")).toBe("100");
    expect(bar).toHaveTextContent("62 prosenttia");
  });

  it("clampaa 0–100 ja pyöristää; sm-koko", () => {
    document.body.innerHTML = "";
    const { container, rerender } = render(<ProgressBar value={140.6} label="yli" />);
    expect(container.querySelector("progress")?.getAttribute("value")).toBe("100");
    rerender(<ProgressBar value={-3} label="alle" size="sm" />);
    const bar = container.querySelector("progress");
    expect(bar?.getAttribute("value")).toBe("0");
    expect(bar?.getAttribute("data-size")).toBe("sm");
  });
});

describe("ProgressRing", () => {
  it("role=img + label + dasharray vastaa arvoa + prosentti keskellä", () => {
    document.body.innerHTML = "";
    const { container } = render(<ProgressRing value={50} label="Tavoite puolivälissä" />);
    expect(screen.getByRole("img", { name: "Tavoite puolivälissä" })).toBeInTheDocument();
    const fill = container.querySelector('[data-ui="progress-ring-fill"]');
    const [filled = 0, total = 0] = (fill?.getAttribute("stroke-dasharray") ?? "0 0")
      .split(" ")
      .map(Number);
    expect(total).toBeGreaterThan(0);
    expect(total === 0 ? 0 : filled / total).toBeCloseTo(0.5, 2);
    expect(screen.getByText("50 %")).toBeInTheDocument();
  });

  it("slottilapsi korvaa prosenttikeskustan", () => {
    document.body.innerHTML = "";
    render(
      <ProgressRing value={71} label="Vesi 5/7 päivää">
        <span>5/7</span>
      </ProgressRing>,
    );
    expect(screen.getByText("5/7")).toBeInTheDocument();
  });
});

describe("StreakDots", () => {
  it("lista tiloilla + ruudunlukijasanat", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <StreakDots days={["done", "partial", "open"]} label="1/3 päivää tehty" />,
    );
    expect(screen.getByRole("list", { name: "1/3 päivää tehty" })).toBeInTheDocument();
    const dots = container.querySelectorAll('[data-ui="streak-dot"]');
    expect(dots).toHaveLength(3);
    expect(dots[0]?.getAttribute("data-state")).toBe("done");
    expect(dots[1]?.getAttribute("data-state")).toBe("partial");
    expect(dots[2]?.getAttribute("data-state")).toBe("open");
    // Jokaisella pisteellä sanallinen tila (ei pelkkä väri, §31).
    expect(screen.getByText("tehty")).toBeInTheDocument();
    expect(screen.getByText("osittain")).toBeInTheDocument();
    expect(screen.getByText("tuleva")).toBeInTheDocument();
  });
});

describe("GoalProgress", () => {
  it("rengas + luvut + palkki + sanallinen jatkumotila", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <GoalProgress
        value={71}
        label="Vesi 5/7 päivää"
        current="5/7 päivää"
        target="tavoite 7 päivää"
        statusText="Jatkuu — 2 päivää jäljellä"
      />,
    );
    expect(screen.getByRole("img", { name: "Vesi 5/7 päivää" })).toBeInTheDocument();
    expect(screen.getByText("5/7 päivää")).toBeInTheDocument();
    expect(screen.getByText("tavoite 7 päivää")).toBeInTheDocument();
    // Sisäinen palkki on koriste (ulkokääre ilmoittaa arvon kerran, ei
    // kaksoisilmoitusta); rakenne todistetaan data-ui-koukulla.
    expect(
      container.querySelector('[data-ui="goal-progress"] [data-ui="progress-bar"]'),
    ).not.toBeNull();
    expect(screen.getByText("Jatkuu — 2 päivää jäljellä")).toBeInTheDocument();
  });
});

describe("LevelProgress (T183)", () => {
  it("tasonumero renkaan keskellä + luvut + raja + jatkumolause", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <LevelProgress
        level={3}
        value={50}
        label="Taso 3: 150 / 300 XP, 150 XP seuraavaan tasoon"
        current="150 / 300 XP"
        target="seuraava taso 600 XP:stä"
        statusText="150 XP seuraavaan tasoon."
      />,
    );
    expect(
      screen.getByRole("img", { name: "Taso 3: 150 / 300 XP, 150 XP seuraavaan tasoon" }),
    ).toBeInTheDocument();
    // Sankarinumero renkaan keskellä (Display-paino, tabular).
    expect(container.querySelector('[data-ui="level-progress-level"]')?.textContent).toBe("3");
    expect(container.querySelector('[data-ui="level-progress-caption"]')?.textContent).toBe("taso");
    expect(screen.getByText("150 / 300 XP")).toBeInTheDocument();
    expect(screen.getByText("seuraava taso 600 XP:stä")).toBeInTheDocument();
    // Sisäinen palkki koristeena (yksi luettava ulkokääreellä).
    expect(
      container.querySelector('[data-ui="level-progress"] [data-ui="progress-bar"]'),
    ).not.toBeNull();
    expect(screen.getByText("150 XP seuraavaan tasoon.")).toBeInTheDocument();
  });

  it("nolla-etenemä ei piirrä täyttökaarta", () => {
    document.body.innerHTML = "";
    const { container } = render(
      <LevelProgress
        level={1}
        value={0}
        label="Taso 1: 0 / 100 XP, 100 XP seuraavaan tasoon"
        current="0 / 100 XP"
        target="seuraava taso 100 XP:stä"
        statusText="100 XP seuraavaan tasoon."
      />,
    );
    const fill = container.querySelector(
      '[data-ui="level-progress"] [data-ui="progress-ring-fill"]',
    );
    expect(fill).toBeNull();
  });
});
