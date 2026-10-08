// T054: motion system -puhdas ydin (§30: motion kertoo tilasta; brief §7:
// 120/200/320ms ease-out + opacity-only reduced-motionissa).
// - motionPresets: suljettu lista sallituista liikkeistä; jokainen vastaa
//   tilamuutosta (rekisteri lukitsee merkityksen — ei koristeanimaatiota,
//   ei jatkuvaa tarpeetonta liikettä).
// - motionPresetFor: reduced-motionissa jokainen liike täyttyy
//   opacity-only-vastineellaan (fade-in) — sama sääntö kuin styles.css:n
//   @media (prefers-reduced-motion: reduce) -lohkossa; tämä on JS-puolen
//   peili kutsujalle joka käynnistää liikkeen imperatiivisesti.
// - REDUCED_MOTION_QUERY: kanoninen matchMedia-merkkijono (motion.tsx:n
//   hook + testit käyttävät samaa; ei hajautettuja merkkijonoja).
// Ei selainviittauksia tässä (testattava ilman ympäristöä).

/** matchMedia-ehto jolla käyttöjärjestelmän hillitty liike luetaan. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Sallitut motion-presetit (data-motion-attribuutti styles.css:ssä). */
export const motionPresets = ["rise-in", "fade-in", "pop", "slide-up"] as const;

export type MotionPreset = (typeof motionPresets)[number];

/** §30: liike kertoo tilan — presetin merkitys on osa julkista sopimusta. */
export const motionPresetStates: Record<MotionPreset, string> = {
  "rise-in": "Sisältö saapuu näkymään (mount/reitinvaihto).",
  "fade-in": "Hiljainen ilmestyminen (ei liikettä, ei estä).",
  pop: "Onnistumis- tai valmistumispalaute käyttäjän teon jälkeen.",
  "slide-up": "Pinta saapuu näkyviin käyttäjän teon vastauksena (overlay/toast).",
};

/** Tyyppikaidatin (esim. kestodatalle ennen attribuuttiin kirjoitusta). */
export function isMotionPreset(value: unknown): value is MotionPreset {
  return typeof value === "string" && (motionPresets as readonly string[]).includes(value);
}

/**
 * Efektiivinen preset annetulla reduced-motion-tilalla: hillityssä
 * liikkeessä jokainen liike on opacity-only fade-in (brief §7).
 */
export function motionPresetFor(preset: MotionPreset, reduced: boolean): MotionPreset {
  return reduced ? "fade-in" : preset;
}
