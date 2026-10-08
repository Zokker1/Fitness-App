// T042/T043: teeman unit-testit (happy-dom). Puhdas ydin (parse/resolve/
// labels/themeColor) suoraan @lifeos/ui:sta + adapteri (storage/memory) +
// provider renderöitynä (preferenssi, persistointi, OS-seuranta, DOM-kirjoitus).
// Ei OPFS/SQL/capability-kutsuja; matchMedia/localStorage stubataan per testi.
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  themeAttribute,
  themeColorFor,
  themePreferenceLabel,
} from "@lifeos/ui";
import { ThemeProvider, useTheme } from "../src/theme/ThemeContext.tsx";
import {
  readStoredThemePreference,
  readSystemDark,
  storeThemePreference,
} from "../src/theme/themeScript.ts";

function stubMatchMedia(matches: boolean): void {
  const query = {
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(() => query),
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("parseThemePreference", () => {
  it("hyväksyy system/light/dark, muu -> system", () => {
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("constellation")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference(undefined)).toBe("system");
    expect(parseThemePreference("")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("eksplisiittinen voittaa OS:n; system seuraa; null -> light", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", null)).toBe("light");
  });
});

describe("labelit, attribuutti ja theme-color", () => {
  it("virkekokoiset labelit + attribuutti + PWA-väri per teema", () => {
    expect(themePreferenceLabel("system")).toBe("Järjestelmän mukaan");
    expect(themePreferenceLabel("light")).toBe("Vaalea");
    expect(themePreferenceLabel("dark")).toBe("Tumma");
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeColorFor("light")).toBe("#1A2E22");
    expect(themeColorFor("dark")).toBe("#101915");
  });
});

describe("THEME_BOOT_SCRIPT", () => {
  it("vastaa index.html:n ennen CSS:ää lataamaa ulkoista bootstrapia", async () => {
    const { THEME_BOOT_SCRIPT } = await import("../src/theme/themeScript.ts");
    const fs = await import("node:fs");
    const html = fs.readFileSync("index.html", "utf-8");
    const boot = fs.readFileSync("public/theme-boot.js", "utf-8");
    expect(html).toContain('<script src="/theme-boot.js"></script>');
    expect(boot).toContain(THEME_STORAGE_KEY);
    expect(boot).toContain('setAttribute("data-theme"');
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain('setAttribute("data-theme"');
  });
});

describe("themeScript-adapteri", () => {
  it("lukee tallennetun, tuntematon -> system", () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(readStoredThemePreference()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "constellation");
    expect(readStoredThemePreference()).toBe("system");
  });

  it("store: light/dark kirjoittaa, system tyhjentää", () => {
    stubMatchMedia(false);
    storeThemePreference("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    storeThemePreference("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("readSystemDark: matchMedia-tulos / ei tukea -> null", () => {
    stubMatchMedia(true);
    expect(readSystemDark()).toBe(true);
    vi.unstubAllGlobals();
    const boundMatchMedia =
      typeof window.matchMedia === "function" ? window.matchMedia.bind(window) : undefined;
    Object.defineProperty(window, "matchMedia", { value: undefined, configurable: true });
    expect(readSystemDark()).toBeNull();
    Object.defineProperty(window, "matchMedia", { value: boundMatchMedia, configurable: true });
  });
});

function Probe(): React.JSX.Element {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <p data-testid="pref">{preference}</p>
      <p data-testid="resolved">{resolved}</p>
      <button
        type="button"
        onClick={() => {
          setPreference("dark");
        }}
      >
        tumma
      </button>
      <button
        type="button"
        onClick={() => {
          setPreference("system");
        }}
      >
        järjestelmä
      </button>
    </div>
  );
}

describe("ThemeProvider", () => {
  it("oletus system + OS light -> light + data-theme", () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("pref")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("tallennettu dark voittaa OS lightin; vaihto persistoi + kirjoittaa DOM:iin", async () => {
    stubMatchMedia(false);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    await user.click(screen.getByRole("button", { name: "järjestelmä" }));
    expect(screen.getByTestId("pref")).toHaveTextContent("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("setPreference dark kirjoittaa storageen + DOM:iin", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "tumma" }));
    expect(screen.getByTestId("pref")).toHaveTextContent("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });
});
