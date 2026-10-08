// T042/T043: teema-preferenssin puhdas ydin (ei IO:ta, ei selainta,
// ei Reactia). Sama eristysmalli kuin storage/lifecycle.ts (T036):
// kaikki sivuvaikutukset (matchMedia/localStorage/DOM) elävät adaptereissa
// ja providerissa; tämä on deterministisesti testattava.
//
// Malli (brief §2 + §26 teemavaraus):
// - ThemePreference: käyttäjän valinta — "system" (oletus, seuraa
//   käyttöjärjestelmää), "light", "dark". Collectible-teemat (§26)
//   laajentavat tätä unionia myöhemmin; resolve-logiikka ei muutu.
// - ResolvedTheme: aina konkreettinen "light" | "dark" (renderöinti ei
//   haaraudu preferenssistä, vain tästä).
// - Storage-avain on versionoitu (v1) jotta formaattimuutos ei lue
//   vanhaa arvoa väärin; tuntematon arvo -> system (fail-safe, ei heittoa).
// - Domain-data ei kulje tässä (ADR-001 §4: teema on UI-asetus, ei
//   domain-entiteetti; B03:n UserPreferences on erillinen asia).

export const THEME_STORAGE_KEY = "lifeos.theme.v1";

export type ThemePreference = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

const PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** Tuntematon/puuttuva/tyhjä tallennettu arvo -> "system" (fail-safe). */
export function parseThemePreference(value: unknown): ThemePreference {
  return typeof value === "string" && (PREFERENCES as readonly string[]).includes(value)
    ? (value as ThemePreference)
    : "system";
}

/**
 * Preferenssi -> konkreettinen teema. "system" seuraa OS:ää
 * (systemDark null = ei tietoa -> light, ei pimeää arvausta).
 */
export function resolveTheme(
  preference: ThemePreference,
  systemDark: boolean | null,
): ResolvedTheme {
  if (preference === "light") {
    return "light";
  }
  if (preference === "dark") {
    return "dark";
  }
  return systemDark === true ? "dark" : "light";
}

/** data-theme-attribuutin arvo DOM:ssa (CSS-valitsin [data-theme="dark"] + E2E). */
export function themeAttribute(theme: ResolvedTheme): string {
  return theme;
}

/** theme-color (index.html) seuraa aktiivista teemaa (PWA-yläpalkki). */
export function themeColorFor(theme: ResolvedTheme): string {
  return theme === "dark" ? "#101915" : "#1A2E22";
}

/** Näyttötekstit teemavalintaan (virkekoko, ei ALL-CAPS; brief §3). */
export function themePreferenceLabel(preference: ThemePreference): string {
  if (preference === "light") {
    return "Vaalea";
  }
  if (preference === "dark") {
    return "Tumma";
  }
  return "Järjestelmän mukaan";
}
