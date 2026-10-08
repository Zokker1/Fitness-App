import { DEFAULT_MEAL_SLOTS, validateMealSlots } from "@lifeos/domain";
import type { MealSlotPreference } from "@lifeos/domain";

export const LOCAL_MEAL_SLOTS_KEY = "lifeos-meal-slots";

/** Muistipohjaisen sovellustilan aterialuokat; palauttaa aina validoidun listan. */
export function readLocalMealSlots(): readonly MealSlotPreference[] {
  const raw = window.localStorage.getItem(LOCAL_MEAL_SLOTS_KEY);
  if (raw === null) {
    return DEFAULT_MEAL_SLOTS.map((slot) => ({ ...slot }));
  }
  const validated = validateMealSlots(JSON.parse(raw) as unknown);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  return validated.value;
}

/** Tallentaa vain domain-validoinnin läpäisseen listan. */
export function writeLocalMealSlots(slots: readonly MealSlotPreference[]): void {
  const validated = validateMealSlots(slots);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  window.localStorage.setItem(LOCAL_MEAL_SLOTS_KEY, JSON.stringify(validated.value));
}
