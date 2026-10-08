// T043: teema-provider. Omistaa preferenssin (system/light/dark) ja
// kirjoittaa resolvotun teeman DOM:iin. Kuluttaa vain themeScript-adapteria
// + ui:n puhdasta ydintä (resolveTheme) — ei suoria selainviittauksia tässä,
// ei domain/data-kytkentää (teema on UI-asetus, ei entiteetti).
//
// Käyttäytyminen:
// - Alku: tallennettu preferenssi (localStorage) tai system; resolved
//   lasketaan OS-tilasta (matchMedia). CSS-media hoitaa ensimaalin ennen
//   Reactia (FOUC-esto); provider synkronoi attribuutin + meta-värin.
// - OS-muutos system-tilassa päivittyy automaattisesti (watchSystemTheme).
// - setPreference persistoi (system tyhjentää avaimen) + soveltaa heti.
// - Paljastaa preferenssin + resolvotun teeman (E2E + valinta-UI).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { resolveTheme, type ResolvedTheme, type ThemePreference } from "@lifeos/ui";
import {
  applyResolvedTheme,
  readStoredThemePreference,
  readSystemDark,
  storeThemePreference,
  watchSystemTheme,
} from "./themeScript.ts";

export interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readStoredThemePreference(),
  );
  const [systemDark, setSystemDark] = useState<boolean | null>(() => readSystemDark());
  const resolved = resolveTheme(preference, systemDark);

  // Kirjoita DOM:iin joka resolvomuutoksella (attribuutti + PWA-metan väri).
  useEffect(() => {
    applyResolvedTheme(resolved);
  }, [resolved]);

  // Seuraa OS-teemaa (vaikuttaa vain system-preferenssillä; kuuntelija on
  // halpa ja elää providerin elinkaaren — ei vuotoa, cleanup mukana).
  useEffect(() => {
    return watchSystemTheme(() => {
      setSystemDark(readSystemDark());
    });
  }, []);

  const setPreference = useCallback((next: ThemePreference): void => {
    storeThemePreference(next);
    setPreferenceState(next);
    // system: resolvo heti nykyisestä OS-tilasta (ei odoteta media-eventiä).
    if (next === "system") {
      setSystemDark(readSystemDark());
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Ainoa sallittu teema-hook komponenteille (vrt. useAppStorageStatus). */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error("useTheme vaatii ThemeProviderin yläpuolelleen.");
  }
  return value;
}
