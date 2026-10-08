// T041: yhteiset design-tokenit (hyväksytyn briefin T040 pohjalta).
// Yksi lähde kaikille visuaalisille arvoille: TS-olio (JS-käyttöön) +
// CSS-custom-properties (styles.css) samassa nimiavaruudessa --lifeos-*.
//
// Kategoriat (brief §7): color (base/semantic, light + dark-ylikirjoitus),
// type (perhe/asteikko/riviväli/tabular-numerot), space (4px-kanta),
// radius (10/14/20), elevation (3 tasoa + tonaalinen dark), motion
// (120/200/320ms ease-out + opacity-only reduced-motionissa), focus
// (2px rengas + offset), touch (min 44px).
//
// Kontrastit mitattu (WCAG 2.2 AA, laskettu sRGB-rel.luminanssista):
// light: ink/bg 14.09, surface-vs-ink 15.20, muted/bg 6.88, on-brand 12.60,
// success-text/bg 7.66, info-text/bg 7.35, warning-text/bg 6.22,
// danger-text/bg 7.01, warning-solid-ink/Kuura 6.83,
// link/bg 8.16, link/surface 8.81, link/semanttiset 7.02–7.43,
// border/bg 3.51 (UI-raja 3:1), focus-accent/surface 5.69.
// dark: text/bg 15.34, muted/bg 8.94, on-brand 12.67, success 5.88,
// info 6.06, warning 6.69, danger 5.22, link/bg 8.00, link/surface 6.43,
// link/semanttiset 6.06–6.73, border/bg 4.32, border/surface 3.47,
// focus-accent/surface 6.21. Kaikki teksti ≥ 4.5:1,
// UI-komponentti/grafiikka ≥ 3:1. T042/T043 todistavat renderöidyt
// kontrastit selaimessa (theme.spec); tähän ei kirjata silmämääräistä arviota.
//
// Collectible-teemat (§26) käyttävät samaa [data-theme]-mekanismia
// (vrt. tokensDark alla); kauppaa ei rakenneta tässä (brief §9).

/**
 * Light-teeman base-paletti (brief §2). Wirkallinen käyttö kulkee
 * aina semanttisten alias-tokenien kautta (theme.ts: lightTheme/darkTheme):
 * - kuura/kuusi/sammal/koivu/jarvi/marja/ink = brändin nimetyt lähtöarvot.
 * - link/border = saavutettavuusmitatut johdannaiset (link 8.16 bg:llä,
 *   border 3.51 bg:llä ≥ UI-raja 3:1). Uusia värejä ei lisätä suoraan
 *   CSS:ään — ensin mittaus tähän, sitten alias + CSS-muuttuja.
 */
export const palette = {
  /** Tausta (paperi, vihreään taittava). */
  kuura: "#EDF1EA",
  /** Brändi/pääpinta (syvä kuusenvihreä; = theme-color). */
  kuusi: "#1A2E22",
  /** Toissijainen korostus / onnistuminen / rauhallinen grafiikka. */
  sammal: "#476B4E",
  /** Huomio/varoitus tekstikelpoisena (tumma olki). */
  koivu: "#9A6B12",
  /** Informaatio / terveysmittausten neutraali korostus. */
  jarvi: "#2E6E7B",
  /** Vaara/kriittinen (marja). */
  marja: "#A63A52",
  /** Pääteksti Kuuralla. */
  ink: "#16241D",
  /** Linkki light-pinnoilla (tummempi kuin accent; §31-linkkikontrasti). */
  link: "#1E4D56",
  /** Reuna light-pinnoilla (UI-raja 3:1, ei tekstikäyttöön yksin). */
  border: "#6F8474",
} as const;

/** Semanttiset pinnat light-teemassa: aina kolmikko tausta+teksti+reuna. */
export const semanticLight = {
  success: { bg: "#DDE7DD", text: "#2C4B32", border: "#476B4E" },
  info: { bg: "#D8E7EA", text: "#1E4D56", border: "#2E6E7B" },
  warning: { bg: "#F1E5C3", text: "#6B4D0A", border: "#9A6B12" },
  danger: { bg: "#F3D9DF", text: "#7C2A3D", border: "#A63A52" },
} as const;

/**
 * Dark-teema (sama hierarkia, ei käänteinen kopio; brief §2).
 * Linkki/reuna mitattu kuten light (link 8.00 bg:llä, border 4.32 bg:llä).
 */
export const paletteDark = {
  bg: "#101915",
  surface: "#1A2E22",
  text: "#E9EFE8",
  muted: "#A9BCAC",
  brandSolid: "#D8E4D6",
  brandSolidText: "#14211A",
  sammal: "#8FB395",
  koivu: "#D9A83C",
  jarvi: "#7FB6C2",
  marja: "#D77E90",
  link: "#7FB6C2",
  border: "#5E8570",
} as const;

export const semanticDark = {
  success: { bg: "#1E3225", text: "#8FB395", border: "#8FB395" },
  info: { bg: "#173237", text: "#7FB6C2", border: "#7FB6C2" },
  warning: { bg: "#33270E", text: "#D9A83C", border: "#D9A83C" },
  danger: { bg: "#3A1E26", text: "#D77E90", border: "#D77E90" },
} as const;

/** Typografia: yksi perhe (Hanken Grotesk variable, 100–900, latin-ext). */
export const typeTokens = {
  family: "'Hanken Grotesk Variable', 'Hanken Grotesk', system-ui, sans-serif",
  /** 1.25-suhde, xs→3xl (rem, 16px-kanta). */
  scale: {
    xs: "0.8rem",
    sm: "0.9rem",
    md: "1rem",
    lg: "1.25rem",
    xl: "1.563rem",
    "2xl": "1.953rem",
    "3xl": "2.441rem",
  },
  weight: { body: 400, bodyStrong: 500, meta: 500, display: 700 },
  lineHeight: { body: 1.55, display: 1.15, meta: 1.4 },
  letterSpacing: { display: "-0.01em", body: "0em" },
  /** Leipätekstin rivipituus (68ch, brief §3). */
  measure: "68ch",
} as const;

/** Spacing: 4px-kanta (rem, 16px-kanta). */
export const spaceTokens = {
  "3xs": "0.125rem",
  "2xs": "0.25rem",
  xs: "0.5rem",
  sm: "0.75rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
  "3xl": "4rem",
} as const;

/** Radius hierarkian mukaan (brief §4): ohjaimet / kortit / sheetit. */
export const radiusTokens = {
  control: "10px",
  card: "14px",
  sheet: "20px",
} as const;

/** Elevation: 3 pehmeää tasoa (vihreä varjo); darkissa tonaalinen. */
export const elevationTokens = {
  level1: "0 1px 2px rgb(22 36 29 / 0.06)",
  level2: "0 2px 8px rgb(22 36 29 / 0.08)",
  level3: "0 8px 24px rgb(22 36 29 / 0.12)",
} as const;

/** Motion: kertoo tilasta (§30); äänet erikseen pois oletuksena. */
export const motionTokens = {
  fast: "120ms",
  base: "200ms",
  slow: "320ms",
  easing: "ease-out",
} as const;

/** Focus: 2px rengas + offset, aina näkyvä (§31). */
export const focusTokens = {
  width: "2px",
  offset: "2px",
} as const;

/** Touch: min 44px (jo T028:ssa; lukitaan tokeniksi). */
export const touchTokens = {
  minTarget: "44px",
} as const;
