// T026: käyttäjä, asetukset ja selaininstanssi (§33 + §39).
// Ei UI- eikä Drive-riippuvuutta: pairing/recovery-tokenit ja
// OAuth-yksityiskohdat eivät kuulu domainiin (B15/B16 täyttävät rajan).

import type { BaseEntity, UtcTimestamp } from "./base.ts";
import {
  DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  type NotificationCategorySettings,
} from "./notifications.ts";

export type ThemePreference = "light" | "dark" | "system";
export type DayStartHour = number;
export type WeightUnit = "kg" | "lb";
export const HEIGHT_CM_RANGE = { minimum: 50, maximum: 250 } as const;

export interface WeightTarget {
  readonly value: number;
  readonly unit: WeightUnit;
}

/** Käyttäjän omat päivätavoitteet. Null tarkoittaa, ettei tavoitetta ole asetettu. */
export interface MacroTargets {
  readonly caloriesKcal: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly fiberG: number | null;
}

export const DEFAULT_MACRO_TARGETS: MacroTargets = {
  caloriesKcal: null,
  proteinG: null,
  carbsG: null,
  fatG: null,
  fiberG: null,
};

export const MACRO_TARGET_MAXIMUMS = {
  caloriesKcal: 100_000,
  proteinG: 10_000,
  carbsG: 10_000,
  fatG: 10_000,
  fiberG: 10_000,
} as const;

/** Käyttäjän oma päivittäinen juomatavoite millilitroina; null = ei tavoitetta. */
export type HydrationTargetMl = number | null;
export const HYDRATION_TARGET_ML_MAXIMUM = 20_000;
/** Paikallinen tarkistusaika HH:mm; null = ehdollinen muistutus pois käytöstä. */
export type HydrationReminderTime = string | null;

/** Aterialuokan pysyvä tunniste, muokattava nimi ja järjestys asetuksissa. */
export interface MealSlotPreference {
  readonly id: string;
  readonly label: string;
  readonly sortOrder: number;
  /** Piilotettu luokka säilyy asetuksissa aiempia kirjauksia varten. */
  readonly archived: boolean;
}

export const MEAL_SLOT_MAX_COUNT = 20;
export const MEAL_SLOT_NAME_MAX_LENGTH = 40;

/** §11:n oletusluokat; käyttäjä voi nimetä, järjestää tai piilottaa ne. */
export const DEFAULT_MEAL_SLOTS = [
  { id: "breakfast", label: "Aamiainen", sortOrder: 0, archived: false },
  { id: "lunch", label: "Lounas", sortOrder: 1, archived: false },
  { id: "dinner", label: "Päivällinen", sortOrder: 2, archived: false },
  { id: "snack", label: "Välipala", sortOrder: 3, archived: false },
] as const satisfies readonly MealSlotPreference[];

/**
 * Oletusasetukset (T060): ennen onboardingia kaikki pääosiot päällä (§25),
 * teema seuraa järjestelmää, gamification näkyvissä (§51: piilotettavissa),
 * ilmoitukset pois oletuksena (opt-in, §30), sovelluksen lukitus pois.
 * Ei id/timestamps/versionia — ne data-kerros täyttää luonnissa.
 */
export const DEFAULT_PREFERENCE_VALUES = {
  theme: "system",
  dayStartHour: 8,
  gamificationVisible: true,
  enabledSections: ["today", "tasks", "calendar", "goals", "focus", "health", "insights"],
  notificationDefaults: { enabled: false },
  notificationCategories: DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  appLockEnabled: false,
  weightTarget: null,
  heightCm: null,
  mealSlots: DEFAULT_MEAL_SLOTS,
  macroTargets: DEFAULT_MACRO_TARGETS,
  hydrationTargetMl: null,
  hydrationReminderTime: null,
} as const;

export interface UserPreferences extends BaseEntity {
  readonly theme: ThemePreference;
  /** Päivän raja tunteina (0–23), onboardingissa kysyttävä (§25). */
  readonly dayStartHour: DayStartHour;
  readonly gamificationVisible: boolean;
  /** Aktiivisesti käytössä olevat pääosiot (onboarding §25). */
  readonly enabledSections: readonly string[];
  readonly notificationDefaults: {
    readonly enabled: boolean;
  };
  readonly notificationCategories: NotificationCategorySettings;
  readonly appLockEnabled: boolean;
  /** Käyttäjän oma painotavoite; yksikkö säilyy eikä arvoa muunnetta. */
  readonly weightTarget: WeightTarget | null;
  /** Käyttäjän ilmoittama pituus senttimetreinä BMI:n laskentaa varten. */
  readonly heightCm: number | null;
  /** Käyttäjän aterialuokat; piilotetut säilyvät historiallisten kirjausten nimiä varten. */
  readonly mealSlots: readonly MealSlotPreference[];
  /** Käyttäjän omat päivittäiset ravintotavoitteet; kukin tavoite on valinnainen. */
  readonly macroTargets: MacroTargets;
  /** Käyttäjän oma päivittäinen juomatavoite millilitroina. */
  readonly hydrationTargetMl: HydrationTargetMl;
  /** Tarkistusajan sisältöä verrataan päivän nestetavoitteeseen. */
  readonly hydrationReminderTime: HydrationReminderTime;
}

/**
 * Selaininstanssi (§39): pysyvä satunnainen installationId, ei
 * fingerprintingia. Revokaatio on eksplisiittinen tila; revoked-instanssi
 * ei kirjoita uusia hyväksyttyjä operaatioita ilman uudelleenvaltuutusta.
 */
export interface BrowserInstallation extends BaseEntity {
  readonly installationId: string;
  readonly installationName: string;
  /** Sovellusversio joka viimeksi kirjasi tältä instanssilta. */
  readonly lastSeenAppVersion: string;
  readonly lastSyncAt: UtcTimestamp | null;
  readonly revokedAt: UtcTimestamp | null;
}
