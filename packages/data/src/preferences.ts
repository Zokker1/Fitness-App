// T060: UserPreferences-palvelu (§33: asetukset paikallisesti, versionoitava).
// Yksi rivi get-or-create singletonina:
// - ensurePreferences(): lukee rivin; jos ei ole, luo oletusarvoilla
//   (domain/identity DEFAULT_PREFERENCE_VALUES) version 1.
// - updatePreferences(patch): varmistaa rivin, yhdistää patchin, validoii
//   domain-säännöllä (validateUserPreferencesValues), version + 1.
// - Rivimapping: SQLite snake_case/0-1/JSON <-> domain camelCase. Mapping
//   epäonnistuu hallitusti (invalid-input, ei poikkeusta) jos tallennettu
//   data on rikki — korjattavissa uudella kirjoituksella, ei hiljaista feikkiä.
// - Ei raakaa SQL:ää tässä: vain nimetyt protocol-opit (worker omistaa SQL:n).
// - Ei Reactia/selainta suoraan; kello ja id-generaattori injektoidaan.

import {
  DEFAULT_PREFERENCE_VALUES,
  type MealSlotPreference,
  type ThemePreference,
  type UserPreferences,
  validateMealSlots,
  validateUserPreferencesValues,
} from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import { type IdGenerator } from "./ids.ts";
import { sendDbRequest, toDataResult } from "./sqliteClient.ts";

export interface PreferencesDeps {
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

type PreferencesRow = {
  readonly id: string;
  readonly theme: string;
  readonly day_start_hour: number;
  readonly gamification_visible: number;
  readonly enabled_sections: string;
  readonly notification_defaults_enabled: number;
  readonly app_lock_enabled: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly version: number;
  readonly weight_target: string | null;
  readonly height_cm: string | null;
  readonly meal_slots: string;
  readonly macro_targets: string;
  readonly hydration_target_ml: number | null;
  readonly hydration_reminder_time: string | null;
  readonly notification_categories: string;
};

function firstRow(rows: readonly unknown[]): PreferencesRow | null {
  const row = rows[0];
  if (typeof row !== "object" || row === null) {
    return null;
  }
  return row as PreferencesRow;
}

function flag(value: unknown): boolean {
  // Protokolla kuljettaa liput booleina; worker muuntaa bindissä 0/1:ksi
  // (sqliteWorker putPreferences). Ei SQLite-numeroita tässä päähän.
  return value === true;
}

function rowToPreferences(row: PreferencesRow): DataResult<UserPreferences> {
  let weightTarget: unknown = null;
  if (row.weight_target !== null) {
    try {
      weightTarget = JSON.parse(row.weight_target) as unknown;
    } catch {
      return {
        ok: false,
        error: invalidInput(
          "data.preferences.corrupt-weight-target",
          "Tallennettua painotavoitetta ei voi lukea.",
        ),
      };
    }
  }
  let rawMealSlots: unknown;
  try {
    rawMealSlots = JSON.parse(row.meal_slots) as unknown;
  } catch {
    return {
      ok: false,
      error: invalidInput(
        "data.preferences.corrupt-meal-slots",
        "Tallennettuja aterialuokkia ei voi lukea.",
      ),
    };
  }
  const mealSlots = validateMealSlots(rawMealSlots);
  if (!mealSlots.ok) {
    return {
      ok: false,
      error: invalidInput("data.preferences.corrupt-meal-slots", mealSlots.error.message),
    };
  }
  let macroTargets: unknown;
  try {
    macroTargets = JSON.parse(row.macro_targets) as unknown;
  } catch {
    return {
      ok: false,
      error: invalidInput(
        "data.preferences.corrupt-macro-targets",
        "Tallennettuja ravintotavoitteita ei voi lukea.",
      ),
    };
  }
  let notificationCategories: unknown;
  try {
    notificationCategories = JSON.parse(row.notification_categories) as unknown;
  } catch {
    return {
      ok: false,
      error: invalidInput(
        "data.preferences.corrupt-notification-categories",
        "Tallennettuja ilmoituskategorioita ei voi lukea.",
      ),
    };
  }
  const validated = validateUserPreferencesValues({
    theme: row.theme,
    dayStartHour: row.day_start_hour,
    weightTarget,
    heightCm: row.height_cm === null ? null : Number(row.height_cm),
    mealSlots: mealSlots.value,
    macroTargets,
    hydrationTargetMl: row.hydration_target_ml,
    hydrationReminderTime: row.hydration_reminder_time,
    notificationCategories,
  });
  if (!validated.ok) {
    return {
      ok: false,
      error: invalidInput(
        "data.preferences.corrupt",
        "Tallennettuja asetuksia ei voi lukea. Arvot palautetaan muokkaamattomina.",
      ),
    };
  }
  let sections: readonly string[];
  try {
    const parsed: unknown = JSON.parse(row.enabled_sections);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
      throw new Error("sections-not-strings");
    }
    sections = parsed as readonly string[];
  } catch {
    return {
      ok: false,
      error: invalidInput(
        "data.preferences.corrupt-sections",
        "Tallennettua osiolistaa ei voi lukea.",
      ),
    };
  }
  return {
    ok: true,
    value: {
      id: row.id,
      theme: validated.value.theme,
      dayStartHour: validated.value.dayStartHour,
      gamificationVisible: row.gamification_visible === 1,
      enabledSections: sections,
      notificationDefaults: { enabled: row.notification_defaults_enabled === 1 },
      appLockEnabled: row.app_lock_enabled === 1,
      weightTarget: validated.value.weightTarget,
      heightCm: validated.value.heightCm,
      mealSlots: validated.value.mealSlots,
      macroTargets: validated.value.macroTargets,
      hydrationTargetMl: validated.value.hydrationTargetMl,
      hydrationReminderTime: validated.value.hydrationReminderTime,
      notificationCategories: validated.value.notificationCategories,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      version: row.version,
    },
  };
}

export function preferencesToParams(
  entity: UserPreferences,
): Record<string, string | number | boolean> {
  return {
    id: entity.id,
    theme: entity.theme,
    day_start_hour: entity.dayStartHour,
    gamification_visible: flag(entity.gamificationVisible),
    enabled_sections: JSON.stringify(entity.enabledSections),
    notification_defaults_enabled: flag(entity.notificationDefaults.enabled),
    app_lock_enabled: flag(entity.appLockEnabled),
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
    version: entity.version,
    weight_target: entity.weightTarget === null ? "" : JSON.stringify(entity.weightTarget),
    height_cm: entity.heightCm === null ? "" : String(entity.heightCm),
    meal_slots: JSON.stringify(entity.mealSlots),
    macro_targets: JSON.stringify(entity.macroTargets),
    hydration_target_ml: entity.hydrationTargetMl === null ? "" : String(entity.hydrationTargetMl),
    hydration_reminder_time: entity.hydrationReminderTime ?? "",
    notification_categories: JSON.stringify(entity.notificationCategories),
  };
}

async function readPreferencesRow(): Promise<DataResult<PreferencesRow | null>> {
  const response = await sendDbRequest({ kind: "query", op: "getPreferences", params: {} });
  return toDataResult<PreferencesRow | null>(response, (rows) => firstRow(rows));
}

/** Reads saved preferences without creating a default row. */
export async function readPreferences(): Promise<DataResult<UserPreferences | null>> {
  const existing = await readPreferencesRow();
  if (!existing.ok) {
    return existing;
  }
  return existing.value === null ? { ok: true, value: null } : rowToPreferences(existing.value);
}

async function savePreferences(entity: UserPreferences): Promise<DataResult<UserPreferences>> {
  const response = await sendDbRequest({
    kind: "exec",
    op: "putPreferences",
    params: preferencesToParams(entity),
  });
  return toDataResult<UserPreferences>(response, () => entity);
}

/** Lukee olemassa olevan asetusrivin tai luo oletukset (v1). */
async function readOrCreatePreferences(
  deps: PreferencesDeps,
): Promise<DataResult<UserPreferences>> {
  const existing = await readPreferencesRow();
  if (!existing.ok) {
    return existing;
  }
  if (existing.value !== null) {
    return rowToPreferences(existing.value);
  }
  const now = deps.clock.nowIso();
  const entity: UserPreferences = {
    ...DEFAULT_PREFERENCE_VALUES,
    notificationDefaults: { ...DEFAULT_PREFERENCE_VALUES.notificationDefaults },
    notificationCategories: { ...DEFAULT_PREFERENCE_VALUES.notificationCategories },
    enabledSections: [...DEFAULT_PREFERENCE_VALUES.enabledSections],
    mealSlots: DEFAULT_PREFERENCE_VALUES.mealSlots.map((slot) => ({ ...slot })),
    macroTargets: { ...DEFAULT_PREFERENCE_VALUES.macroTargets },
    hydrationTargetMl: DEFAULT_PREFERENCE_VALUES.hydrationTargetMl,
    hydrationReminderTime: DEFAULT_PREFERENCE_VALUES.hydrationReminderTime,
    id: deps.ids.next(),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  return savePreferences(entity);
}

let pendingEnsurePreferences: Promise<DataResult<UserPreferences>> | null = null;

/** Yhdistää yhtäaikaiset alkulataukset, jotta ne eivät luo rinnakkaisia singleton-rivejä. */
export function ensurePreferences(deps: PreferencesDeps): Promise<DataResult<UserPreferences>> {
  if (pendingEnsurePreferences !== null) return pendingEnsurePreferences;
  const attempt = readOrCreatePreferences(deps);
  const sharedAttempt = attempt.finally(() => {
    if (pendingEnsurePreferences === sharedAttempt) pendingEnsurePreferences = null;
  });
  pendingEnsurePreferences = sharedAttempt;
  return sharedAttempt;
}

export interface PreferencesPatch {
  readonly theme?: ThemePreference;
  readonly dayStartHour?: number;
  readonly gamificationVisible?: boolean;
  readonly enabledSections?: readonly string[];
  readonly notificationDefaults?: { readonly enabled: boolean };
  readonly notificationCategories?: UserPreferences["notificationCategories"];
  readonly appLockEnabled?: boolean;
  readonly weightTarget?: UserPreferences["weightTarget"];
  readonly heightCm?: UserPreferences["heightCm"];
  readonly mealSlots?: readonly MealSlotPreference[];
  readonly macroTargets?: UserPreferences["macroTargets"];
  readonly hydrationTargetMl?: UserPreferences["hydrationTargetMl"];
  readonly hydrationReminderTime?: UserPreferences["hydrationReminderTime"];
}

function mergePreferences(
  current: UserPreferences,
  patch: PreferencesPatch,
): DataResult<UserPreferences> {
  if (patch.enabledSections !== undefined) {
    if (
      !Array.isArray(patch.enabledSections) ||
      patch.enabledSections.some((section) => typeof section !== "string")
    ) {
      return {
        ok: false,
        error: invalidInput(
          "data.preferences.validation.sections",
          "Osiolistan on oltava merkkijonolista.",
        ),
      };
    }
  }
  const merged: UserPreferences = {
    ...current,
    ...(patch.theme !== undefined ? { theme: patch.theme } : {}),
    ...(patch.dayStartHour !== undefined ? { dayStartHour: patch.dayStartHour } : {}),
    ...(patch.gamificationVisible !== undefined
      ? { gamificationVisible: patch.gamificationVisible }
      : {}),
    ...(patch.enabledSections !== undefined ? { enabledSections: patch.enabledSections } : {}),
    ...(patch.notificationDefaults !== undefined
      ? { notificationDefaults: { ...patch.notificationDefaults } }
      : {}),
    ...(patch.notificationCategories !== undefined
      ? { notificationCategories: { ...patch.notificationCategories } }
      : {}),
    ...(patch.appLockEnabled !== undefined ? { appLockEnabled: patch.appLockEnabled } : {}),
    ...(patch.weightTarget !== undefined ? { weightTarget: patch.weightTarget } : {}),
    ...(patch.heightCm !== undefined ? { heightCm: patch.heightCm } : {}),
    ...(patch.mealSlots !== undefined ? { mealSlots: patch.mealSlots } : {}),
    ...(patch.macroTargets !== undefined ? { macroTargets: patch.macroTargets } : {}),
    ...(patch.hydrationTargetMl !== undefined
      ? { hydrationTargetMl: patch.hydrationTargetMl }
      : {}),
    ...(patch.hydrationReminderTime !== undefined
      ? { hydrationReminderTime: patch.hydrationReminderTime }
      : {}),
  };
  const validated = validateUserPreferencesValues(merged);
  if (!validated.ok) {
    return {
      ok: false,
      error: invalidInput("data.preferences.validation.values", validated.error.message),
    };
  }
  return {
    ok: true,
    value: {
      ...merged,
      mealSlots: validated.value.mealSlots,
      macroTargets: validated.value.macroTargets,
      hydrationTargetMl: validated.value.hydrationTargetMl,
      hydrationReminderTime: validated.value.hydrationReminderTime,
    },
  };
}

/** Versionoitu päivitys: hylkää virheelliset arvot ennen kirjoitusta. */
export async function updatePreferences(
  deps: PreferencesDeps,
  patch: PreferencesPatch,
): Promise<DataResult<UserPreferences>> {
  const current = await ensurePreferences(deps);
  if (!current.ok) {
    return current;
  }
  const merged = mergePreferences(current.value, patch);
  if (!merged.ok) {
    return merged;
  }
  const next: UserPreferences = {
    ...merged.value,
    updatedAt: deps.clock.nowIso(),
    version: current.value.version + 1,
  };
  return savePreferences(next);
}
