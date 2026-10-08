// T043: FOUC-esto + teema-adapterin puhdas ydin. Kaksi osaa:
//
// 1. THEME_BOOT_SCRIPT: theme-boot.js-tiedoston teemaosuuden malli.
//    Bootstrap julkaistaan public/-hakemistosta, jotta CSP ei tarvitse
//    inline-JS:ää. Se lukee tallennetun preferenssin (localStorage —
//    UI-asetus, EI domain-dataa; ADR-001 §4 kieltää vain domain-datan)
//    ja kirjoittaa data-theme:n <html>:iin ENNEN CSS:n latausta -> ei
//    vaaleaa välähdystä dark-käyttäjälle. Tuntematon arvo -> ei
//    attribuuttia -> CSS:n prefers-color-scheme-media hoitaa systemin.
//    Ei riippuvuuksia, ei DOM-virheitä (try/catch, SSR-turvallinen).
// 2. Adapterifunktiot providerille: lue/tallenna preferenssi +
//    OS-seuranta matchMedialla. Ainoa paikka joka koskee matchMedia/
//    localStorage/document-teemaa (T025-raja: ei selainta muualla).
import { THEME_STORAGE_KEY, parseThemePreference, type ThemePreference } from "@lifeos/ui";

export const THEME_BOOT_SCRIPT = `(function(){try{var v=localStorage.getItem("${THEME_STORAGE_KEY}");if(v==="light"||v==="dark"){document.documentElement.setAttribute("data-theme",v);}}catch(e){}})();`;

/** Tallennettu preferenssi tai system (ei tietoa / ei tukea / virhe). */
export function readStoredThemePreference(): ThemePreference {
  try {
    if (typeof localStorage === "undefined") {
      return "system";
    }
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

/** Persistoi preferenssi; system tyhjentää avaimen (OS seuraa CSS:llä). */
export function storeThemePreference(preference: ThemePreference): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    if (preference === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
      return;
    }
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Best-effort (yksityinen selaus): provider jatkaa muistissa.
  }
}

/** OS:n dark-tila nyt (null = ei tietoa / ei matchMedia-tukea). */
export function readSystemDark(): boolean | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return null;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return null;
  }
}

/**
 * Seuraa OS-teeman muutoksia (soitto aina kun arvio voi muuttua).
 * Palauttaa lopettajan. Ei tukea -> no-op-lopettaja.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return () => undefined;
    }
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (): void => {
      onChange();
    };
    // Vanha Safari (<14) tuntee vain addListener/removeListener — kutsutaan
    // dynaamisesti (ei staattista deprecated-viittausta linttiin).
    const legacy = query as unknown as {
      addEventListener?: unknown;
      addListener?: unknown;
      removeListener?: unknown;
    };
    if (typeof legacy.addEventListener === "function") {
      query.addEventListener("change", listener);
      return () => {
        query.removeEventListener("change", listener);
      };
    }
    if (typeof legacy.addListener === "function") {
      const add = legacy.addListener as (fn: () => void) => void;
      add.call(query, listener);
      return () => {
        const remove = legacy.removeListener as ((fn: () => void) => void) | undefined;
        if (typeof remove === "function") {
          remove.call(query, listener);
        }
      };
    }
    return () => undefined;
  } catch {
    return () => undefined;
  }
}

/** Kirjoittaa data-theme:n + theme-color-metan (PWA-yläpalkki). */
export function applyResolvedTheme(resolved: "light" | "dark"): void {
  try {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.setAttribute("data-theme", resolved);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta !== null) {
      meta.setAttribute("content", resolved === "dark" ? "#101915" : "#1a2e22");
    }
  } catch {
    // Best-effort: teema jatkuu CSS-mediasta.
  }
}
