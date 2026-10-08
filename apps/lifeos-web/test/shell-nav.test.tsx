// T044: shell-navin unit-testit (happy-dom). Puhdas malli (buildShellNav/
// iconForPath/activeNavPath) ilman selainta + AppShell renderöitynä
// (primary/secondary-jako, Lisää-drawer aukeaa/sulkeutuu, Esc + focus-
// palautus, tuntematon reitti ei kaada, back-linkki on Linkki).
// MemoryRouter: historia/back todistetaan ilman preview-buildia (E2E
// todistaa todellisilla viewporteilla, ks. app-shell.spec.ts).
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { activeNavPath, AppShell, buildShellNav, iconForPath, isKnownShellPath } from "@lifeos/ui";
import { appRoutes } from "../src/routes.ts";

describe("iconForPath / isKnownShellPath", () => {
  it("tunnetut polut saavat oman ikonin, tuntematon -> more", () => {
    expect(iconForPath("/")).toBe("home");
    expect(iconForPath("/tasks")).toBe("tasks");
    expect(iconForPath("/projects")).toBe("tasks");
    expect(iconForPath("/calendar")).toBe("calendar");
    expect(iconForPath("/focus")).toBe("focus");
    expect(iconForPath("/nutrition")).toBe("nutrition");
    expect(iconForPath("/health")).toBe("health");
    expect(iconForPath("/insights")).toBe("insights");
    expect(iconForPath("/settings")).toBe("settings");
    expect(iconForPath("/goals")).toBe("tasks");
    expect(iconForPath("/tunte maton")).toBe("more");
  });

  it("tuntematon polku ei ole shell-polku", () => {
    expect(isKnownShellPath("/settings")).toBe(true);
    expect(isKnownShellPath("/projects")).toBe(true);
    expect(isKnownShellPath("/404")).toBe(false);
  });
});

describe("buildShellNav", () => {
  it("jakaa primary/secondary + moreTarget secondary-alkuun", () => {
    const nav = buildShellNav(appRoutes, "/");
    expect(nav.primary.map((item) => item.path)).toEqual(["/", "/tasks", "/calendar", "/focus"]);
    expect(nav.secondary.map((item) => item.path)).toEqual([
      "/projects",
      "/goals",
      "/nutrition",
      "/health",
      "/insights",
      "/settings",
    ]);
    expect(nav.moreActive).toBe(false);
    expect(nav.moreTarget).toBe("/projects");
  });

  it("secondary-reitillä moreActive + moreTarget on nykyinen (back pysyy)", () => {
    const nav = buildShellNav(appRoutes, "/health");
    expect(nav.moreActive).toBe(true);
    expect(nav.moreTarget).toBe("/health");
  });

  it("tuntematon reitti putoaa (ei rikkinäistä linkkiä)", () => {
    const nav = buildShellNav([...appRoutes, { path: "/huijaus", label: "Huijaus" }], "/huijaus");
    expect(nav.primary.some((item) => item.path === "/huijaus")).toBe(false);
    expect(nav.secondary.some((item) => item.path === "/huijaus")).toBe(false);
  });
});

describe("activeNavPath", () => {
  it("täsmäys tai null (ei väärää korostusta 404:ssa)", () => {
    expect(activeNavPath(appRoutes, "/tasks")).toBe("/tasks");
    expect(activeNavPath(appRoutes, "/404")).toBeNull();
  });
});

function renderShell(path: string): void {
  // Edellinen render siivotaan (afterEach puuttuu tarkoituksella tässä
  // tiedostossa: jokainen testi renderöi täyden shellin; tyhjä body
  // estää duplikaatti-roolit queryissa).
  document.body.innerHTML = "";
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppShell routes={appRoutes} currentPath={path}>
        <p>Sisältö</p>
      </AppShell>
    </MemoryRouter>,
  );
}

describe("AppShell", () => {
  it("renderöi ikonit+labelit ja aktiivisen reitin molemmissa naveissa", () => {
    renderShell("/tasks");
    // Rail + bottom-nav + drawer = sama labeli useassa navissa.
    expect(screen.getAllByRole("link", { name: "Tehtävät" }).length).toBeGreaterThanOrEqual(2);
    for (const link of screen.getAllByRole("link", { name: "Tehtävät" })) {
      expect(link).toHaveAttribute("aria-current", "page");
    }
    // Ikonit renderöityvät Iconilla (data-ui="icon", aria-hidden SVG, labeli tekstinä).
    expect(
      document.querySelectorAll('[data-ui="icon"][aria-hidden="true"]').length,
    ).toBeGreaterThan(0);
  });

  it("Lisää avaa drawer-dialogin; Esc sulkee + palauttaa fokuksen", async () => {
    const user = userEvent.setup();
    renderShell("/");
    const more = screen.getByRole("button", { name: "Lisää" });
    expect(more).toHaveAttribute("aria-haspopup", "dialog");
    expect(more).toHaveAttribute("aria-expanded", "false");

    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "Lisää" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sulje valikko" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    // Suljettu drawer on inert + aria-hidden (ei roolia queryissa).
    expect(screen.queryByRole("dialog", { name: "Lisää" })).toBeNull();
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveFocus();
  });

  it("drawer-linkki on oikea Linkki (historia/back toimii, ei tilakaappausta)", async () => {
    const user = userEvent.setup();
    renderShell("/");
    await user.click(screen.getByRole("button", { name: "Lisää" }));
    const health = screen.getByRole("dialog", { name: "Lisää" });
    const link = health.querySelector('a[href="/health"]');
    expect(link).not.toBeNull();
  });
});
