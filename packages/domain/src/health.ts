// T026: terveys-domain. Mittaukset ovat append-only (§36: ne yhdistyvät
// ilman kenttäkonflikteja). Yksiköt kulkevat datan mukana; muunnokset ja
// graafirajat B12:ssa. Ei diagnoosilogiikkaa (§56 ei-rakenneta-itse).

import type { BaseEntity, EntityId, SoftDeletable, UtcTimestamp } from "./base.ts";

export type MeasurementType =
  "weight" | "blood-pressure" | "blood-sugar" | "temperature" | "spo2" | "body-measure" | "custom";

export type BloodPressureContext = "morning" | "evening" | "resting" | "after-activity" | "other";

export interface Measurement extends BaseEntity {
  readonly type: MeasurementType;
  /** Pääarvo (esim. paino kg, systolinen — laajennus B12:ssa). */
  readonly value: number;
  readonly secondaryValue: number | null;
  readonly unit: string;
  /** Mittarin nimi esimerkiksi vyötärölle tai käyttäjän omalle kehon mitalla. */
  readonly metricName?: string | null | undefined;
  /** Verenpainemittauksen pulssi lyöntiä minuutissa. */
  readonly pulseBpm?: number | null | undefined;
  /** Verenpainemittauksen käyttäjän valitsema konteksti. */
  readonly context?: BloodPressureContext | null | undefined;
  readonly measuredAt: UtcTimestamp;
  readonly note: string | null;
}

export interface NutritionEntry extends BaseEntity, SoftDeletable {
  readonly eatenAt: UtcTimestamp;
  /** Ruoan ID ja grammamäärä voivat puuttua T069:n vanhoista kirjauksista. */
  readonly foodId?: EntityId | null | undefined;
  readonly amountG?: number | null | undefined;
  /** Aterialuokan vakaa tunniste UserPreferences.mealSlots-listasta. */
  readonly mealSlotId?: string | null | undefined;
  readonly label: string;
  readonly calories: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly fiberG?: number | null | undefined;
}

export interface Food extends BaseEntity, SoftDeletable {
  readonly name: string;
  /** Ruoan ravintoarvot säilytetään yhteismitallisesti per 100 g. */
  readonly caloriesPer100G: number | null;
  readonly proteinPer100G: number | null;
  readonly carbsPer100G: number | null;
  readonly fatPer100G: number | null;
  /** Valinnainen kuitumäärä per 100 g. */
  readonly fiberPer100G?: number | null | undefined;
  /** Valinnainen oletusannos; ravintoarvot voi tällöin esittää annosta kohti. */
  readonly servingSizeG?: number | null | undefined;
}

export interface Recipe extends BaseEntity, SoftDeletable {
  readonly name: string;
  /** Reseptin ainesosien määrät grammoina; vanhoissa entiteeteissä voi puuttua. */
  readonly ingredients?: readonly RecipeIngredient[] | undefined;
  /** Reseptistä saatavien annosten määrä; vanhoissa entiteeteissä voi puuttua. */
  readonly servings?: number | undefined;
  /** @deprecated T069:n vanha reseptiruokien ID-lista ilman määriä. */
  readonly foodIds?: readonly EntityId[] | undefined;
}

export interface RecipeIngredient {
  readonly foodId: EntityId;
  readonly amountG: number;
}

export interface HydrationEntry extends BaseEntity {
  readonly drunkAt: UtcTimestamp;
  readonly milliliters: number;
}

export interface Supplement extends BaseEntity, SoftDeletable {
  readonly name: string;
  /** Uudet kirjaukset tallentavat määrän ja yksikön erillään. Optional = vanha JSON-yhteensopivuus. */
  readonly amount?: number | undefined;
  readonly unit?: string | undefined;
  /** Päivittäiset paikalliset ottoajat muodossa HH:mm. */
  readonly schedule?: readonly string[] | undefined;
  /** Käyttäjän viimeksi tarkistama saldo samassa yksikössä kuin annos. */
  readonly stockAmount?: number | null | undefined;
  readonly stockUnit?: string | null | undefined;
  /** Saldoa verrataan vain tämän tarkistushetken jälkeen otettuihin annoksiin. */
  readonly stockCountedAt?: UtcTimestamp | null | undefined;
  /** Vanhojen merkintöjen vapaa annosteksti; uudet kirjaukset tuottavat tämän määrän/yksikön näytölle. */
  readonly doseLabel: string | null;
}

export type SupplementLogStatus = "taken" | "skipped" | "pending";

export interface SupplementLog extends BaseEntity {
  readonly supplementId: EntityId;
  /** Puuttuva tila vanhassa datassa tulkitaan otetuksi. Uudet lokit tallentavat aina tilan. */
  readonly status?: SupplementLogStatus | undefined;
  /** Paikallisen aikataulun suunniteltu UTC-ajankohta; null = aikatauluton kirjaus. */
  readonly scheduledAt?: UtcTimestamp | null | undefined;
  /** Suunnitellun annoksen määrä ja yksikkö tallennetaan lokiin saldoarviota varten. */
  readonly doseAmount?: number | null | undefined;
  readonly doseUnit?: string | null | undefined;
  /** Toteutunut ottoaika. Skipatut ja odottavat kirjaukset eivät saa ottoaikaa. */
  readonly takenAt: UtcTimestamp | null;
}

export interface SleepEntry extends BaseEntity, SoftDeletable {
  /** UTC-hetket säilyttävät todellisen keston myös aikavyöhyke- ja DST-vaihdoksissa. */
  readonly sleepStart: UtcTimestamp;
  readonly sleepEnd: UtcTimestamp;
  readonly quality: number | null;
  /** Puuttuva arvo vanhassa datassa tarkoittaa yöunta; uudet palvelukirjaukset asettavat arvon. */
  readonly isNap?: boolean | undefined;
}

export interface ActivityEntry extends BaseEntity, SoftDeletable {
  readonly activityAt: UtcTimestamp;
  readonly kind: string;
  readonly durationSeconds: number | null;
  readonly distanceMeters: number | null;
  /** Vanhoissa merkinnöissä puuttuva vapaa muistiinpano tulkitaan tyhjäksi. */
  readonly note?: string | null | undefined;
}

export interface MoodCheckinScales {
  /** Kaikki asteikot käyttävät neutraalia numeroarvoa 1–5. */
  readonly mood: number;
  readonly stress: number | null;
  readonly energy: number | null;
  readonly motivation: number | null;
  readonly focus: number | null;
}

export interface MoodCheckin extends BaseEntity, MoodCheckinScales {
  readonly checkedAt: UtcTimestamp;
  readonly note: string | null;
}

export const JOURNAL_REFLECTION_FIELD_MAX_LENGTH = 2000;

export interface JournalEntry extends BaseEntity, SoftDeletable {
  readonly writtenAt: UtcTimestamp;
  readonly title: string | null;
  readonly body: string;
  readonly reflectionSuccess: string | null;
  readonly reflectionDifficult: string | null;
  readonly reflectionTomorrow: string | null;
}

export interface BreathingSession extends BaseEntity {
  readonly startedAt: UtcTimestamp;
  readonly endedAt: UtcTimestamp | null;
  readonly patternKey: string;
}

export const BREATHING_PHASE_KINDS = ["inhale", "hold", "exhale", "rest"] as const;
export type BreathingPhaseKind = (typeof BREATHING_PHASE_KINDS)[number];

export const BREATHING_PROTOCOL_RISKS = ["breath-hold", "rapid-breathing"] as const;
export type BreathingProtocolRisk = (typeof BREATHING_PROTOCOL_RISKS)[number];

export const BREATHING_RISK_CONTEXTS = [
  "water",
  "driving",
  "standing",
  "operating-machinery",
] as const;
export type BreathingRiskContext = (typeof BREATHING_RISK_CONTEXTS)[number];

export const BREATHING_PHASE_DURATION_MIN_SECONDS = 1;
export const BREATHING_PHASE_DURATION_MAX_SECONDS = 60;
export const BREATHING_PHASE_BREATH_MIN_SECONDS = 3;
export const BREATHING_PHASE_HOLD_MAX_SECONDS = 10;
export const BREATHING_PROTOCOL_MAX_PHASES = 8;
export const BREATHING_PROTOCOL_ROUNDS_MIN = 1;
export const BREATHING_PROTOCOL_ROUNDS_MAX = 30;
export const BREATHING_PROTOCOL_TOTAL_DURATION_MAX_SECONDS = 3600;
export const BREATHING_PROTOCOL_KEY_MAX_LENGTH = 64;
export const BREATHING_PROTOCOL_NAME_MAX_LENGTH = 80;
export const BREATHING_SAFETY_WARNING_MAX_LENGTH = 1000;

export interface BreathingProtocolPhase {
  readonly kind: BreathingPhaseKind;
  readonly durationSeconds: number;
}

/** Turvallisuusdata kulkee protokollan mukana, jotta UI voi aina näyttää sen. */
export interface BreathingSafetyMetadata {
  readonly risks: readonly BreathingProtocolRisk[];
  readonly warning: string | null;
  readonly avoidContexts: readonly BreathingRiskContext[];
}

/** Uudelleenkäytettävä hengitysharjoituksen rytmi ennen yksittäistä istuntoa. */
export interface BreathingProtocol {
  readonly key: string;
  readonly name: string;
  readonly phases: readonly BreathingProtocolPhase[];
  readonly rounds: number;
  readonly safety: BreathingSafetyMetadata;
}
