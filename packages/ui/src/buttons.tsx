// T046: Button-perhe (§28: Button, IconButton, FAB) + haptics-hook (§30).
// - Button (primitives.tsx): variantit primary/secondary/danger/ghost +
//   loading/disabled/focus/touch-target (tyylit styles.css:ssä tokeneista).
// - IconButton: pelkkä ikoni + pakollinen saavutettava nimi (aria-label,
//   §31: ei pelkkää ikonia ilman nimeä). Koko 44px, radius control.
// - FAB ("Kirjaa", brief periaate 1): näkymän yksi päätoiminto, aina sama
//   paikka (oikea alakulma, bottom-navin yläpuolella mobiilissa; T090 kytkee
//   Quick Add -avaukseen). Labeli aina mukana (ikoni + teksti, ei pelkkä +).
// - useHaptics: Vibration API valinnaisena enhancementina (§30: ei logiikka-
//   riippuvuutta). Palauttaa trigger(pattern)-funktion joka on no-op ilman
//   tukea (typeof navigator.vibrate). UI-paketissa sallittu suora
//   navigator-luku (ei domain-dataa, ei capability-ketjua; vrt. themeScript
//   matchMedia — sama kevyt ympäristöluku, testattu injektoitavalla
//   vibrate-funktiolla ilman selainta).

import type { ButtonHTMLAttributes, Ref } from "react";
import { useCallback } from "react";
import { Icon } from "./Icon.tsx";
import type { IconKey } from "./icons.ts";

/** Kevyt ympäristöluku Vibration-tuelle (testattava ilman selainta). */
export function isHapticsSupported(vibrate?: unknown): boolean {
  return typeof vibrate === "function";
}

type VibrateFn = (pattern: number | number[]) => boolean;

/** Lukee navigator.vibrate jos olemassa (ei heittoa ilman tukea). */
export function readVibrateFunction(): VibrateFn | null {
  try {
    if (typeof navigator === "undefined") {
      return null;
    }
    // Arrow-kutsu isännän kautta: this säilyy, ei unbound-irrotusta.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const probe: unknown = navigator.vibrate;
    if (!isHapticsSupported(probe)) {
      return null;
    }
    return (pattern: number | number[]) => navigator.vibrate(pattern);
  } catch {
    return null;
  }
}

/**
 * Haptics-hook: palauttaa triggerin joka värähtää lyhyesti (10ms oletus)
 * kun tuki on. No-op ilman tukea/virheessä; ei vaikuta toimintalogiikkaan.
 * Reduced-motion ei estä (Vibration ei ole visuaalista liikettä), mutta
 * kutsuja voi olla kutsumatta (esim. asetus B13:ssa).
 */
export function useHaptics(): (pattern?: number | number[]) => void {
  return useCallback((pattern: number | number[] = 10): void => {
    try {
      readVibrateFunction()?.(pattern);
    } catch {
      // Best-effort: hiljainen no-op.
    }
  }, []);
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly icon: IconKey;
  /** Saavutettava nimi (pakollinen — pelkkä ikoni ei riitä, §31). */
  readonly label: string;
  readonly loading?: boolean;
}

export function IconButton({
  icon,
  label,
  loading = false,
  disabled,
  ...rest
}: IconButtonProps): React.JSX.Element {
  const isDisabled = disabled === true || loading;
  return (
    <button
      type={rest.type ?? "button"}
      data-ui="icon-button"
      data-loading={loading ? "true" : undefined}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      aria-label={label}
      {...rest}
    >
      {loading ? "…" : <Icon name={icon} />}
    </button>
  );
}

interface FabProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** FAB-labeli (oletus "Kirjaa", brief periaate 1: aina sama). */
  readonly label?: string;
  /** Ref natiiville buttonille (esim. fokuksen palautus overlaysta). */
  readonly buttonRef?: Ref<HTMLButtonElement> | undefined;
}

export function Fab({ label = "Kirjaa", buttonRef, ...rest }: FabProps): React.JSX.Element {
  return (
    <button type={rest.type ?? "button"} data-ui="fab" ref={buttonRef} {...rest}>
      <Icon name="add" />
      <span>{label}</span>
    </button>
  );
}
