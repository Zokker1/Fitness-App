// T054: reduced-motion-hook (§30/§31). Kevyt ympäristöluku samalla
// mallilla kuin haptics (buttons.tsx) ja themeScript (web-puoli):
// - readSystemReducedMotion: matchMedia.matches tai false ilman tukea
//   (typeof-tarkistukset + try/catch, ei heittoa, SSR-turvallinen).
// - useReducedMotion: lukee kerran mountissa ja seuraa muutosta
//   (change-kuuntelija; ilman addEventListener-tukea ei kuuntele).
// Hook on JS-puolen apu kutsujalle joka päättää imperatiivisesta
// palautteesta (esim. B08 valmistumispalaute); CSS:n media-kysely hoitaa
// visuaalisen degradation aina (motionPresetFor on sen puhdas peili).

import { useEffect, useState } from "react";
import { REDUCED_MOTION_QUERY } from "./motion.ts";

/** matchMedia-olio tai null (ei selainta / ei tukea / virhe). */
function readMotionQuery(): MediaQueryList | null {
  try {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return null;
    }
    return window.matchMedia(REDUCED_MOTION_QUERY);
  } catch {
    return null;
  }
}

/** OS:n hillitty liike nyt (false ilman tietoa/tukea — liike sallitaan). */
export function readSystemReducedMotion(): boolean {
  return readMotionQuery()?.matches === true;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(readSystemReducedMotion);
  useEffect(() => {
    const query = readMotionQuery();
    if (query === null || typeof query.addEventListener !== "function") {
      return undefined;
    }
    const listener = (): void => {
      setReduced(query.matches);
    };
    query.addEventListener("change", listener);
    return () => {
      query.removeEventListener("change", listener);
    };
  }, []);
  return reduced;
}
