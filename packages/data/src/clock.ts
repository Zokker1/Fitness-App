// T027: kellorajapinta. Aika injektoidaan jotta data-kerros on
// deterministisesti testattava (§32: timestamps UTC:ssa). Tuotannossa
// systemClock(); testeissä fixedClock()/manualClock().

import type { UtcTimestamp } from "@lifeos/domain";

export interface Clock {
  nowIso(): UtcTimestamp;
}

export function systemClock(): Clock {
  return {
    nowIso(): UtcTimestamp {
      return new Date().toISOString();
    },
  };
}

/** Deterministinen kello testeihin: palauttaa aina saman hetken. */
export function fixedClock(at: UtcTimestamp): Clock {
  return {
    nowIso(): UtcTimestamp {
      return at;
    },
  };
}
