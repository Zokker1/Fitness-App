// T026: gamification-domain. XP on append-only-tapahtumavirtaa
// (bulk-import ei tuota XP:tä, §40 — raja pannaan täytäntöön B09:ssä).
// Tasot/saavutukset derivoidaan transaktiovirrasta; snapshotit ovat
// välimuistia, eivät totuutta.

import type { BaseEntity, EntityId, UtcTimestamp } from "./base.ts";

export type XpSource = "task" | "routine" | "focus" | "habit" | "health" | "quest" | "manual";

export interface XPTransaction extends BaseEntity {
  readonly source: XpSource;
  readonly sourceEntityId: EntityId | null;
  readonly amount: number;
  readonly earnedAt: UtcTimestamp;
  readonly reason: string | null;
}

export interface LevelState extends BaseEntity {
  readonly totalXp: number;
  readonly level: number;
  readonly computedAt: UtcTimestamp;
}

export type QuestConditionKind = "event-count" | "active-day-count";

/** Questin tallennettu ehto; goal on tapahtumien tai aktiivisten päivien määrä. */
export interface QuestCondition {
  readonly kind: QuestConditionKind;
  readonly goal: number;
  /** Tapahtuman vähimmäiskoko, esimerkiksi fokuksen vähimmäiskesto sekunteina. */
  readonly minimumAmount?: number | undefined;
}

export interface Quest extends BaseEntity {
  readonly title: string;
  readonly description: string | null;
  readonly activeFrom: UtcTimestamp | null;
  readonly activeUntil: UtcTimestamp | null;
  /** Null sallitaan vain vanhoille questeille, joiden sääntöä ei voida päätellä. */
  readonly condition: QuestCondition | null;
}

export interface QuestProgress extends BaseEntity {
  readonly questId: EntityId;
  readonly progress: number;
  readonly goal: number;
  readonly completedAt: UtcTimestamp | null;
}

export interface Achievement extends BaseEntity {
  readonly key: string;
  readonly title: string;
  readonly description: string | null;
}

export interface Collectible extends BaseEntity {
  readonly key: string;
  readonly title: string;
  /** Teema-avaus tms. myöhäinen sidonta (B09/B02). */
  readonly unlocksThemeKey: string | null;
}

export interface UserReward extends BaseEntity {
  readonly achievementId: EntityId | null;
  readonly collectibleId: EntityId | null;
  readonly earnedAt: UtcTimestamp;
}

/**
 * T192: Reward Vault (§9) — käyttäjän itse määrittämä oikean elämän palkinto
 * XP-kynnykselle, esim. "1000 XP → elokuvailta". Sovellus ei oleta palkinnon
 * rahallista arvoa. Lunastus/claim (T193) on erillinen mekanismi.
 */
export interface VaultReward extends BaseEntity {
  readonly title: string;
  readonly note: string | null;
  /** Palkinnon avautumiskynnys kokonais-XP:stä (§9 pistekynnys). */
  readonly xpThreshold: number;
}

/**
 * T193: palkinnon lunastus (§9 Reward Vault; §51 reiluus). Lunastus on
 * append-only historiankirjaus: palkintorivi ja XP-historia pysyvät ennallaan.
 * XP ei vähene ellei käyttäjä nimenomaisesti valitse vähennystä (xpDeducted
 * kertoo valitun vähennyksen; 0 = ei vähennetty).
 */
export interface VaultRewardClaim extends BaseEntity {
  readonly rewardId: EntityId;
  readonly claimedAt: UtcTimestamp;
  /** Nimenomaisesti valittu XP-vähennys (0 = lunastus oli maksuton). */
  readonly xpDeducted: number;
}
