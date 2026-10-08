// T237: vain aktiivinen, onnistunut terveyskirjaus voi tuottaa pienen XP:n.
import type { XPTransaction, UtcTimestamp } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import type { EntityRepository } from "./repositories.ts";
import { calculateXpAward, type XpRules } from "./xp-rules.ts";
import { createXpAward, findXpAward } from "./xp-ledger.ts";

export type HealthTrackingKind = "nutrition" | "hydration" | "supplement";

export interface HealthTrackingXpDeps {
  readonly clock: Clock;
  readonly xpTransactions?: EntityRepository<XPTransaction> | undefined;
  readonly xpRules?: XpRules | undefined;
  /** Minuutit UTC-ajasta käyttäjän paikalliseen aikaan. */
  readonly timezoneOffsetMinutes?: number | undefined;
}

const TRACKING_LABELS: Readonly<Record<HealthTrackingKind, string>> = {
  nutrition: "Ravintoseuranta kirjattu.",
  hydration: "Nesteseuranta kirjattu.",
  supplement: "Lisäravinteen seuranta kirjattu.",
};

/**
 * Palkitsee yhden aidon merkinnän per seurantatapa paikallispäivässä.
 * Määrä, ravintoarvot, tavoitteen saavutus tai terveysmittaukset eivät muuta
 * palkkiota. Menneet ja tulevat merkinnät sekä automaattiset pending-rivit
 * eivät tuota XP:tä.
 */
export async function awardHealthTrackingXp(
  deps: HealthTrackingXpDeps,
  kind: HealthTrackingKind,
  activityAt: UtcTimestamp,
): Promise<void> {
  const xpTransactions = deps.xpTransactions;
  const offset = deps.timezoneOffsetMinutes ?? 0;
  if (xpTransactions === undefined || !Number.isInteger(offset) || offset < -840 || offset > 840) {
    return;
  }

  try {
    const earnedAt = deps.clock.nowIso();
    const activityTime = Date.parse(activityAt);
    const nowTime = Date.parse(earnedAt);
    if (!Number.isFinite(activityTime) || !Number.isFinite(nowTime) || activityTime > nowTime) {
      return;
    }
    const localDate = toLocalDateKey(earnedAt, offset);
    if (toLocalDateKey(activityAt, offset) !== localDate) {
      return;
    }

    const sourceEntityId = `daily-${kind}-${localDate}`;
    const listed = await xpTransactions.list();
    if (!listed.ok) return;
    const key = { source: "health" as const, sourceEntityId };
    if (findXpAward(listed.value, key) !== undefined) return;

    const earnedToday = listed.value.reduce(
      (total, transaction) =>
        transaction.source === "health" &&
        transaction.amount > 0 &&
        Number.isFinite(Date.parse(transaction.earnedAt)) &&
        toLocalDateKey(transaction.earnedAt, offset) === localDate
          ? total + transaction.amount
          : total,
      0,
    );
    const amount = calculateXpAward({ kind: "health-tracking-logged", earnedToday }, deps.xpRules);
    if (amount === null) return;

    await createXpAward(xpTransactions, {
      ...key,
      amount,
      earnedAt,
      reason: TRACKING_LABELS[kind],
    });
  } catch {
    // A failed optional XP write must never turn a successful health log into
    // a visible save failure after its data has already been persisted.
  }
}
