import { ensurePreferences, updatePreferences, systemClock } from "@lifeos/data";
import {
  validateHeightCm,
  validateHydrationReminderTime,
  validateHydrationTargetMl,
  validateMacroTargets,
  validateMealSlots,
  validateNotificationCategorySettings,
  validateWeightTarget,
} from "@lifeos/domain";
import {
  readLocalFavoriteFoodIds,
  writeFavoriteFoodIds,
} from "../preferences/favorite-foods-storage.ts";

const LEGACY_PREFERENCE_KEYS = [
  "lifeos-weight-target",
  "lifeos-height-cm",
  "lifeos-hydration-target-ml",
  "lifeos-hydration-reminder-time",
  "lifeos-meal-slots",
  "lifeos-macro-targets",
  "lifeos-notification-categories",
  "lifeos-gamification-visible",
  "lifeos-app-lock-enabled",
  "lifeos-favorite-food-ids",
] as const;
const INVALID_JSON = Symbol("invalid-legacy-json");

function readJson(key: string): unknown {
  const value = window.localStorage.getItem(key);
  if (value === null) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

/** Copy old cleartext preference snapshots into protected SQLite before app content mounts. */
export async function migrateLegacyLocalPreferences(): Promise<void> {
  const patch: Parameters<typeof updatePreferences>[1] = {};
  const weightTarget = validateWeightTarget(readJson("lifeos-weight-target"));
  const rawHeight = window.localStorage.getItem("lifeos-height-cm");
  const heightCm = validateHeightCm(rawHeight === null ? null : Number(rawHeight));
  const rawHydrationTarget = window.localStorage.getItem("lifeos-hydration-target-ml");
  const hydrationTargetMl = validateHydrationTargetMl(
    rawHydrationTarget === null ? null : Number(rawHydrationTarget),
  );
  const hydrationReminderTime = validateHydrationReminderTime(
    window.localStorage.getItem("lifeos-hydration-reminder-time"),
  );
  const mealSlots = validateMealSlots(readJson("lifeos-meal-slots"));
  const macroTargets = validateMacroTargets(readJson("lifeos-macro-targets"));
  const notificationCategories = validateNotificationCategorySettings(
    readJson("lifeos-notification-categories"),
  );
  const gamificationVisible = window.localStorage.getItem("lifeos-gamification-visible");
  const appLockEnabled = window.localStorage.getItem("lifeos-app-lock-enabled");
  const migrationPatch = { ...patch };

  if (weightTarget.ok && window.localStorage.getItem("lifeos-weight-target") !== null) {
    Object.assign(migrationPatch, { weightTarget: weightTarget.value });
  }
  if (heightCm.ok && rawHeight !== null)
    Object.assign(migrationPatch, { heightCm: heightCm.value });
  if (hydrationTargetMl.ok && rawHydrationTarget !== null) {
    Object.assign(migrationPatch, { hydrationTargetMl: hydrationTargetMl.value });
  }
  if (
    hydrationReminderTime.ok &&
    window.localStorage.getItem("lifeos-hydration-reminder-time") !== null
  ) {
    Object.assign(migrationPatch, { hydrationReminderTime: hydrationReminderTime.value });
  }
  if (mealSlots.ok && window.localStorage.getItem("lifeos-meal-slots") !== null) {
    Object.assign(migrationPatch, { mealSlots: mealSlots.value });
  }
  if (macroTargets.ok && window.localStorage.getItem("lifeos-macro-targets") !== null) {
    Object.assign(migrationPatch, { macroTargets: macroTargets.value });
  }
  if (
    notificationCategories.ok &&
    window.localStorage.getItem("lifeos-notification-categories") !== null
  ) {
    Object.assign(migrationPatch, { notificationCategories: notificationCategories.value });
  }
  if (gamificationVisible === "true" || gamificationVisible === "false") {
    Object.assign(migrationPatch, { gamificationVisible: gamificationVisible === "true" });
  }
  if (appLockEnabled === "true" || appLockEnabled === "false") {
    Object.assign(migrationPatch, { appLockEnabled: appLockEnabled === "true" });
  }

  // AppLockProvider keeps this legacy local value as a pre-unlock fallback.
  // It is written again after every unlock, so copying an unchanged value
  // would bump the protected preference version on every page load.
  if (migrationPatch.appLockEnabled !== undefined) {
    const current = await ensurePreferences({
      clock: systemClock(),
      ids: { next: () => crypto.randomUUID() },
    });
    if (!current.ok) throw new Error(current.error.diagnosticCode);
    if (current.value.appLockEnabled === migrationPatch.appLockEnabled) {
      delete migrationPatch.appLockEnabled;
    }
  }

  if (Object.keys(migrationPatch).length > 0) {
    const result = await updatePreferences(
      { clock: systemClock(), ids: { next: () => crypto.randomUUID() } },
      migrationPatch,
    );
    if (!result.ok) throw new Error(result.error.diagnosticCode);
  }
  if (window.localStorage.getItem("lifeos-favorite-food-ids") !== null) {
    await writeFavoriteFoodIds(readLocalFavoriteFoodIds(), true);
  }
  for (const key of LEGACY_PREFERENCE_KEYS) window.localStorage.removeItem(key);
}
