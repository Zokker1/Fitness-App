// T163: visibility/background-resume-silta T162:n timestamp-laskentaan.
// Hookin tickit vain pyytävät uuden snapshotin; aika tulee aina UTC-leimasta.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UtcTimestamp } from "@lifeos/domain";
import {
  calculateFocusCountdown,
  type FocusCountdownInput,
  type FocusCountdownSnapshot,
} from "@lifeos/data";

const COUNTDOWN_REFRESH_MS = 1000;

export interface UseFocusCountdownInput extends Omit<
  FocusCountdownInput,
  "now" | "startedAt" | "durationSeconds"
> {
  readonly startedAt: UtcTimestamp | null;
  readonly durationSeconds: number | null;
  /** Injektoitava kello testeihin; tuotannossa käytetään järjestelmäkelloa. */
  readonly now?: () => UtcTimestamp;
}

export interface UseFocusCountdownResult {
  readonly snapshot: FocusCountdownSnapshot | null;
  readonly isVisible: boolean;
  /** Pakottaa uuden aikaleima-snapshotin esimerkiksi manuaalisesta resumeesta. */
  readonly refresh: () => void;
}

function systemNow(): UtcTimestamp {
  return new Date().toISOString();
}

function readVisibility(): boolean {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

/**
 * Pitää countdownin tuoreena näkyvissä ja synkronoi sen heti tabin palatessa.
 * Backgroundissa selain saa throttlata päivitykset: resume laskee oikean
 * arvon uudelleen aikaleimoista eikä jatka vanhaa interval-laskuria.
 */
export function useFocusCountdown(input: UseFocusCountdownInput): UseFocusCountdownResult {
  const defaultNow = useCallback(systemNow, []);
  const now = input.now ?? defaultNow;
  const nowRef = useRef(now);
  nowRef.current = now;
  const [nowStamp, setNowStamp] = useState<UtcTimestamp>(() => now());
  const [isVisible, setIsVisible] = useState(readVisibility);

  const refresh = useCallback((): void => {
    setNowStamp(nowRef.current());
  }, []);

  useEffect(() => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return undefined;
    }
    const onVisibilityChange = (): void => {
      const visible = document.visibilityState === "visible";
      setIsVisible(visible);
      if (visible) {
        refresh();
      }
    };
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refresh();
      }
    }, COUNTDOWN_REFRESH_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [input.accumulatedPauseSeconds, input.durationSeconds, input.now, input.startedAt, refresh]);

  const snapshot = useMemo(
    () =>
      calculateFocusCountdown({
        startedAt: input.startedAt,
        durationSeconds: input.durationSeconds,
        now: nowStamp,
        ...(input.accumulatedPauseSeconds === undefined
          ? {}
          : { accumulatedPauseSeconds: input.accumulatedPauseSeconds }),
      }),
    [input.accumulatedPauseSeconds, input.durationSeconds, input.startedAt, nowStamp],
  );

  return { snapshot, isVisible, refresh };
}
