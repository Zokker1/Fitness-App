// T187: Recovery Bonus (§9: "epäonnistuneen päivän jälkeen paluusta saa
// positiivisen palautteen", §30 palaute, §51 reiluus). Kriteeri: tauon
// jälkeinen paluu palkitaan hallitusti.
// - Paluu = aktiivinen päivä (≥1 XP-tapahtuma), jota edeltää ≥2 päivän tauko
//   (sama kynnys kuin T184:n paluupainotuksessa) ja jonka takana on ollut
//   aktiivisuutta — aloitus ei ole paluu.
// - Hallittu palkinto (§9 anti-gaming): 5 XP + 1 XP / ylimääräinen taukopäivä,
//   katto 15 XP. Tauko maksaa enemmän kuin bonus tuottaa → ei kannata farmata.
// - Idempotentti (T181-henki): palkkioavain on paluupäivä (source + source-
//   EntityId), joten retry ja synkka palkitsevat kerran.
// - §57.14: viesti on positiivinen eikä mainitse katkennutta putkea (ei
//   häpeää, ei punaista failure wallia).

import type { XPTransaction } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { DataResult } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";
import { RETURN_GAP_DAYS } from "./momentum.ts";
import { createXpAward, type XpAwardResult } from "./xp-ledger.ts";

export const RECOVERY_BONUS_BASE_XP = 5;
export const RECOVERY_BONUS_MAX_XP = 15;
export const RECOVERY_BONUS_MESSAGE = "Tervetuloa takaisin — paluustasi palkittiin.";

export interface RecoveryReturnEvaluation {
  readonly qualifies: boolean;
  readonly gapDays: number;
  /** Hallittu bonus (0 jos ei paluutilannetta). */
  readonly amount: number;
}

export interface RecoveryReturnInput {
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly xpTransactions: readonly XPTransaction[];
}

function dayDiff(older: string, newer: string): number {
  return Math.round(
    (Date.parse(`${newer}T00:00:00Z`) - Date.parse(`${older}T00:00:00Z`)) / 86_400_000,
  );
}

export function recoveryReturnEventId(localDate: string): string {
  return `recovery-${localDate}`;
}

/**
 * Arvioi onko päivä paluupäivä (tauko → aktiivisuus). Puhdas funktio:
 * sama input aina sama tulos.
 */
export function evaluateRecoveryReturn(input: RecoveryReturnInput): RecoveryReturnEvaluation {
  const activeDates = new Set<string>();
  for (const tx of input.xpTransactions) {
    activeDates.add(toLocalDateKey(tx.earnedAt, input.timezoneOffsetMinutes));
  }
  if (!activeDates.has(input.localDate)) {
    return { qualifies: false, gapDays: 0, amount: 0 };
  }
  let previousActive: string | null = null;
  for (const day of activeDates) {
    if (day < input.localDate && (previousActive === null || day > previousActive)) {
      previousActive = day;
    }
  }
  if (previousActive === null) {
    // Ensimmäinen suoritus koskaan on aloitus, ei paluu.
    return { qualifies: false, gapDays: 0, amount: 0 };
  }
  const gapDays = dayDiff(previousActive, input.localDate) - 1;
  if (gapDays < RETURN_GAP_DAYS) {
    return { qualifies: false, gapDays, amount: 0 };
  }
  const amount = Math.min(
    RECOVERY_BONUS_BASE_XP + (gapDays - RETURN_GAP_DAYS),
    RECOVERY_BONUS_MAX_XP,
  );
  return { qualifies: true, gapDays, amount };
}

export interface RecoveryBonusDeps {
  readonly clock: Clock;
  readonly xpTransactions: EntityRepository<XPTransaction>;
}

export interface GrantRecoveryBonusInput {
  /** Paluupäivä (yleensä tänään, kutsujan paikallispäivä §50). */
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
}

export type RecoveryBonusResult =
  | {
      readonly kind: "awarded";
      readonly amount: number;
      readonly transaction: XPTransaction;
      readonly message: string;
    }
  | { readonly kind: "duplicate"; readonly transaction: XPTransaction }
  | { readonly kind: "none" };

/**
 * Palkitsee tauon jälkeisen paluun hallitusti ja idempotentisti.
 * Ei paluutilannetta → "none" (ei virhettä, ei nollautumista).
 */
export async function grantRecoveryBonusService(
  deps: RecoveryBonusDeps,
  input: GrantRecoveryBonusInput,
): Promise<DataResult<RecoveryBonusResult>> {
  const listed = await deps.xpTransactions.list();
  if (!listed.ok) {
    return listed;
  }
  const evaluation = evaluateRecoveryReturn({
    localDate: input.localDate,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    xpTransactions: listed.value,
  });
  if (!evaluation.qualifies) {
    return { ok: true, value: { kind: "none" } };
  }
  const awarded: DataResult<XpAwardResult> = await createXpAward(deps.xpTransactions, {
    source: "habit",
    sourceEntityId: recoveryReturnEventId(input.localDate),
    amount: evaluation.amount,
    earnedAt: deps.clock.nowIso(),
    reason: RECOVERY_BONUS_MESSAGE,
  });
  if (!awarded.ok) {
    return awarded;
  }
  if (awarded.value.kind === "duplicate") {
    return { ok: true, value: { kind: "duplicate", transaction: awarded.value.transaction } };
  }
  if (awarded.value.kind === "excluded") {
    // §40: vain bulk-import voi johtaa tähän; paluupalkintoa ei kirjata.
    return { ok: true, value: { kind: "none" } };
  }
  return {
    ok: true,
    value: {
      kind: "awarded",
      amount: evaluation.amount,
      transaction: awarded.value.transaction,
      message: RECOVERY_BONUS_MESSAGE,
    },
  };
}
