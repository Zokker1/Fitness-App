// T087: focus summary -kooste (pure data-funktio, ei IO:ta).
// Kriteeri: päivän fokusminuutit ja start focus -toiminto ovat SUORIA.
// Kooste: minuutit tänään + istuntojen määrä + KÄYNNISSÄ oleva istunto
// (vain yksi voi olla käynnissä kerrallaan — jos useita running-tilassa,
// valitaan aikaisin aloitettu ja UI näyttää sen; data ei valehtele).
// durationSeconds on totuus (laskettu, ei ajastin — domain T026);
// käynnissä olevan kesto lasketaan now − startedAt (kutsujan kello).
// Terveysneutraali (§52): ei tuomioita nollapäivästä ("Ei fokusta vielä"
// on toteamus, ei moite).
import type { FocusSession, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

export interface TodayFocusSummary {
  readonly minutesToday: number;
  readonly sessionsToday: number;
  /** Käynnissä oleva istunto tai null (UI: jatka-linkki vs. aloita-nappi). */
  readonly running: FocusSession | null;
  /** Käynnissä olevan kulunut aika minuutteina (pyöristetty alas) tai null. */
  readonly runningElapsedMinutes: number | null;
}

export interface TodayFocusInput {
  readonly now: UtcTimestamp;
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly sessions: readonly FocusSession[];
}

/**
 * Kokoaa fokustilanteen. Vain completed-istunnot lasketaan minuutteihin
 * (käynnissä/keskeytetty eivät ole vielä suoritusta); käynnissä oleva
 * raportoidaan erikseen jatkamista varten.
 */
export function summarizeTodayFocus(input: TodayFocusInput): TodayFocusSummary {
  const today = input.sessions.filter(
    (session) =>
      session.startedAt !== null &&
      toLocalDateKey(session.startedAt, input.timezoneOffsetMinutes) === input.localDate,
  );
  const done = today.filter((session) => session.phase === "completed");
  const minutesToday = done.reduce((sum, session) => sum + (session.durationSeconds ?? 0), 0) / 60;
  const running = today
    .filter((session) => session.phase === "running" && session.startedAt !== null)
    .sort((a, b) => ((a.startedAt ?? "") < (b.startedAt ?? "") ? -1 : 1))[0];
  return {
    minutesToday: Math.round(minutesToday),
    sessionsToday: done.length,
    running: running ?? null,
    runningElapsedMinutes:
      running === undefined || running.startedAt === null
        ? null
        : Math.max(0, Math.floor((Date.parse(input.now) - Date.parse(running.startedAt)) / 60_000)),
  };
}
