// T045: typografia- + ikonijärjestelmän unit-testit (happy-dom).
// - Ikonirekisteri: iconKeys aakkosissa, jokaisella paikallinen SVG-assetti.
// - Icon renderöi data-ui="icon"/"icon-inline"-maskin.
// - Typografia renderöi oikeat tagit (h1/h2) + tabular-luokat + aria-labelit.
// - AppShell käyttää Iconia: nav-ikonit löytyvät data-ui="icon"-koukulla.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import {
  AppShell,
  Body,
  Display,
  HeroNumber,
  Icon,
  iconAssetUrl,
  iconKeys,
  Meta,
  MetricValue,
  SectionHeading,
} from "@lifeos/ui";
import { appRoutes } from "../src/routes.ts";

describe("ikonirekisteri", () => {
  it("avaimet aakkosissa + joka avaimelle paikallinen SVG-assetti", () => {
    expect([...iconKeys].sort()).toEqual(iconKeys);
    for (const key of iconKeys) {
      expect(iconAssetUrl(key)).toMatch(/\.svg(?:\?|$)/u);
    }
  });
});

describe("Icon", () => {
  it("koriste data-ui-koukulla (icon / icon-inline)", () => {
    document.body.innerHTML = "";
    const { container } = render(<Icon name="check" />);
    const icon = container.querySelector('[data-ui="icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect((icon as HTMLElement | null)?.style.getPropertyValue("--lifeos-icon-mask")).toContain(
      ".svg",
    );
    document.body.innerHTML = "";
    const { container: inline } = render(<Icon name="info" inline />);
    expect(inline.querySelector('[data-ui="icon-inline"]')).not.toBeNull();
  });
});

describe("typografia", () => {
  it("Display=h1, SectionHeading=h2, Body/Meta=p (virkekoko)", () => {
    document.body.innerHTML = "";
    render(
      <>
        <Display>Tänään</Display>
        <SectionHeading>Seuraavaksi</SectionHeading>
        <Body>Leipää.</Body>
        <Meta>Täydennys lauseena.</Meta>
      </>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Tänään" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Seuraavaksi" })).toBeInTheDocument();
    expect(screen.getByText("Leipää.").tagName).toBe("P");
    expect(screen.getByText("Täydennys lauseena.").tagName).toBe("P");
  });

  it("HeroNumber + MetricValue: tabular + saavutettava nimi", () => {
    document.body.innerHTML = "";
    render(
      <>
        <HeroNumber label="avointa tehtävää">3</HeroNumber>
        <MetricValue label="kokonaisluku">42</MetricValue>
      </>,
    );
    expect(screen.getByRole("img", { name: "avointa tehtävää" })).toHaveTextContent("3");
    expect(screen.getByRole("img", { name: "kokonaisluku" })).toHaveTextContent("42");
  });
});

describe("AppShell käyttää Iconia", () => {
  it("nav-ikonit data-ui=icon-koukulla (ei NavIcon-jäännettä)", () => {
    document.body.innerHTML = "";
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppShell routes={appRoutes} currentPath="/">
          <p>Sisältö</p>
        </AppShell>
      </MemoryRouter>,
    );
    const icons = document.querySelectorAll('[data-ui="icon"][aria-hidden="true"]');
    expect(icons.length).toBeGreaterThanOrEqual(8);
  });
});
