// T028: responsiiviset breakpointit (§27). Yksi lähde layout-päätöksille:
// - mobile: yhden käden käyttö, bottom navigation, safe area.
// - desktop: rail/sidebar, leveämmät dashboardit, multi-column vain hyödyllä.
// Arvot ovat min-width CSS-px; JS-puoli käyttää matchMediaa (T036+), CSS-puoli
// samoja arvoja custom propertyna (styles.css). Ei laitefingerprintingia.

export const breakpoints = {
  /** Mobiili yläraja: alle tämän bottom navigation. */
  mobileMax: 719,
  /** Desktop alaraja: tästä ylöspäin rail/sidebar. */
  desktopMin: 720,
  /** Leveä dashboard: multi-column sallittu vain tästä ylöspäin. */
  wideMin: 1200,
} as const;

export type BreakpointKey = "mobile" | "desktop" | "wide";

export function breakpointForWidth(widthPx: number): BreakpointKey {
  if (widthPx >= breakpoints.wideMin) {
    return "wide";
  }
  if (widthPx >= breakpoints.desktopMin) {
    return "desktop";
  }
  return "mobile";
}

export function mobileQuery(): string {
  return `(max-width: ${String(breakpoints.mobileMax)}px)`;
}

export function desktopQuery(): string {
  return `(min-width: ${String(breakpoints.desktopMin)}px)`;
}
