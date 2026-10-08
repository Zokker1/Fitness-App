// T181: idempotentti XPTransaction. Sama suoritus (source + sourceEntityId)
// tuottaa täsmälleen yhden XP-tapahtuman — retry, reopen-uudelleenvalmistus ja
// kahden replikan yhdistäminen eivät voi antaa XP:tä kahdesti (§9 anti-gaming,
// §51 reiluus). Tapahtuman id on derivoitu palkkioavaimesta, joten kaksi
// synkkaavaa instanssia tuottaa saman entiteetin id:n eikä erillisiä rivejä.
// Append-only: olemassa olevaa tapahtumaa ei muuteta eikä poisteta tästä.

import type { EntityId, XPTransaction, XpSource } from "@lifeos/domain";
import type { DataResult } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

/** Yksi palkkio per (lähde, kohde) — esim. tehtävän valmistuminen. */
export interface XpAwardKey {
  readonly source: XpSource;
  readonly sourceEntityId: EntityId;
}

export interface CreateXpAwardInput extends XpAwardKey {
  readonly amount: number;
  readonly earnedAt: XPTransaction["earnedAt"];
  readonly reason: string | null;
  /** T194 (§40): bulk-import ei tuota XP:tä. Oletus false (aito suoritus). */
  readonly imported?: boolean | undefined;
}

/**
 * Deterministinen tapahtuma-id palkkioavaimesta. Kahdella instanssilla sama
 * suoritus → sama id → synkkauksen merge säilyttää yhden rivin.
 */
export function xpAwardEventId(key: XpAwardKey): EntityId {
  return `xp-${key.source}-${key.sourceEntityId}`;
}

/** Löytää aiemmin kirjatun palkkion (myös ennen T181:ä luoduilla satunnais-id:llä). */
export function findXpAward(
  transactions: readonly XPTransaction[],
  key: XpAwardKey,
): XPTransaction | undefined {
  return transactions.find(
    (transaction) =>
      transaction.source === key.source && transaction.sourceEntityId === key.sourceEntityId,
  );
}

export type XpAwardResult =
  | { readonly kind: "awarded"; readonly transaction: XPTransaction }
  | { readonly kind: "duplicate"; readonly transaction: XPTransaction }
  /** §40: bulk-import — ei palkkiota eikä riviä ledgeriin. */
  | { readonly kind: "excluded"; readonly transaction: null };

/**
 * Luo XP-tapahtuman idempotentisti. Jos sama palkkioavain on jo kirjattu
 * (retry tai synkka), palautetaan olemassa oleva tapahtuma eikä luoda uutta.
 * `imported` (§40 bulk-import): historiallinen tuonti EI tuota XP:tä — ei
 * kirjausta lainkaan, joten myöhempi aito suoritus voi palkita normaalisti.
 */
export async function createXpAward(
  xpTransactions: EntityRepository<XPTransaction>,
  input: CreateXpAwardInput,
): Promise<DataResult<XpAwardResult>> {
  if (input.imported === true) {
    return { ok: true, value: { kind: "excluded", transaction: null } };
  }
  const key: XpAwardKey = { source: input.source, sourceEntityId: input.sourceEntityId };
  const eventId = xpAwardEventId(key);

  const byId = await xpTransactions.getById(eventId);
  if (byId.ok) {
    return { ok: true, value: { kind: "duplicate", transaction: byId.value } };
  }
  if (byId.error.code !== "not-found") {
    return byId;
  }

  const listed = await xpTransactions.list();
  if (!listed.ok) {
    return listed;
  }
  const legacy = findXpAward(listed.value, key);
  if (legacy !== undefined) {
    return { ok: true, value: { kind: "duplicate", transaction: legacy } };
  }

  const created = await xpTransactions.createWithId(eventId, {
    source: input.source,
    sourceEntityId: input.sourceEntityId,
    amount: input.amount,
    earnedAt: input.earnedAt,
    reason: input.reason,
  });
  if (!created.ok) {
    // Retry-rasitus: toinen kirjoitus ehti samaan id:seen → olemassa oleva voittaa.
    if (created.error.code === "already-exists") {
      const raced = await xpTransactions.getById(eventId);
      if (raced.ok) {
        return { ok: true, value: { kind: "duplicate", transaction: raced.value } };
      }
    }
    return created;
  }
  return { ok: true, value: { kind: "awarded", transaction: created.value } };
}
