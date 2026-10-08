// T184: momentum score (§9 liukuva suoritusaste, §51 reiluus, §57.14 palkinto
// ei rangaistus). Kriteeri: 7/14 päivän jatkuvuus painottaa paluuta eikä
// nollaudu yhdestä päivästä.
//
// Malli (deterministinen, ei kellonaikaa):
// - Ikkuna: 14 paikallista kalenteripäivää, tänään mukaan lukien.
// - Aktiivinen päivä: vähintään yksi XP-tapahtuma (suoritus) sinä päivänä.
// - Pisteet: viimeiset 7 pv aktiivisesta 2 pt, 8.–14. pv aktiivisesta 1 pt
//   (liukuva painotus: lähimenneisyys ratkaisee → paluu näkyy heti).
// - Paluupainotus: ensimmäinen aktiivinen päivä ≥2 päivän tauon jälkeen saa
//   +2 pt. Tauko ei nollaa mittaria, ja palaaminen painottuu. Bonus vaatii
//   aiempaa aktiivisuutta (ennen taukoa) — aloittaminen ei ole paluu.
//   Yhden päivän lipsahdus EI saa bonusta mutta menettää vain oman painonsa.
// - score = min(100, round(100 * pisteet / 21)).

import type { XPTransaction } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

export interface MomentumScore {
  /** Liukuva suoritusaste 0–100. */
  readonly score: number;
  readonly activeDaysLast7: number;
  readonly activeDaysLast14: number;
  /** Ikkunassa oli ≥2 päivän tauko, jonka jälkeen palattiin (T187:n lähde). */
  readonly returnedAfterGap: boolean;
}

export interface MomentumInput {
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly xpTransactions: readonly XPTransaction[];
}

const WINDOW_DAYS = 14;
const RECENT_DAYS = 7;
const RECENT_DAY_POINTS = 2;
const EARLIER_DAY_POINTS = 1;
/** Tauon kynnys (päivää) — jaettu T187:n Recovery Bonuksen kanssa. */
export const RETURN_GAP_DAYS = 2;
const RETURN_BONUS_POINTS = 2;
const MAX_POINTS =
  RECENT_DAYS * RECENT_DAY_POINTS + (WINDOW_DAYS - RECENT_DAYS) * EARLIER_DAY_POINTS;

function dayKeyBack(localDate: string, daysBack: number): string {
  const baseMs = Date.parse(`${localDate}T12:00:00.000Z`);
  return new Date(baseMs - daysBack * 86_400_000).toISOString().slice(0, 10);
}

export function calculateMomentumScore(input: MomentumInput): MomentumScore {
  const activeDates = new Set<string>();
  for (const tx of input.xpTransactions) {
    activeDates.add(toLocalDateKey(tx.earnedAt, input.timezoneOffsetMinutes));
  }
  return calculateMomentumScoreFromActiveDates(input.localDate, activeDates);
}

/** T263: laskee tutun momentum-säännön valmiiksi aikavyöhykkeeseen muunnetuista päivistä. */
export function calculateMomentumScoreFromActiveDates(
  localDate: string,
  activeDates: ReadonlySet<string>,
): MomentumScore {
  const windowStart = dayKeyBack(localDate, WINDOW_DAYS - 1);
  // Historiaa ennen ikkunaa: yli ikkunan tauko on silti tauko, ei aloitus.
  let hasPriorHistory = false;
  for (const day of activeDates) {
    if (day < windowStart) {
      hasPriorHistory = true;
      break;
    }
  }

  let points = 0;
  let activeDaysLast7 = 0;
  let activeDaysLast14 = 0;
  let returnedAfterGap = false;
  let inactiveRun = 0;
  let sawActivity = false;
  // Vanhin ensin, jotta tauko tunnistetaan ennen paluupäivää.
  for (let age = WINDOW_DAYS - 1; age >= 0; age -= 1) {
    if (!activeDates.has(dayKeyBack(localDate, age))) {
      inactiveRun += 1;
      continue;
    }
    activeDaysLast14 += 1;
    if (age < RECENT_DAYS) {
      activeDaysLast7 += 1;
    }
    points += age < RECENT_DAYS ? RECENT_DAY_POINTS : EARLIER_DAY_POINTS;
    if (inactiveRun >= RETURN_GAP_DAYS && (sawActivity || hasPriorHistory)) {
      points += RETURN_BONUS_POINTS;
      returnedAfterGap = true;
    }
    inactiveRun = 0;
    sawActivity = true;
  }

  return {
    score: Math.min(100, Math.round((points / MAX_POINTS) * 100)),
    activeDaysLast7,
    activeDaysLast14,
    returnedAfterGap,
  };
}
