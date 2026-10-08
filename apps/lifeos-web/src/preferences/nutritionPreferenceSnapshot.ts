import { ensurePreferences, systemClock } from "@lifeos/data";
import type { MacroTargets, MealSlotPreference } from "@lifeos/domain";
import { readLocalMacroTargets } from "./macro-targets-storage.ts";
import { readLocalMealSlots } from "./meal-slots-storage.ts";

export async function readNutritionPreferenceSnapshot(persistent: boolean): Promise<{
  readonly mealSlots: readonly MealSlotPreference[];
  readonly macroTargets: MacroTargets;
}> {
  if (!persistent) {
    return { mealSlots: readLocalMealSlots(), macroTargets: readLocalMacroTargets() };
  }
  const preferences = await ensurePreferences({
    clock: systemClock(),
    ids: { next: () => crypto.randomUUID() },
  });
  if (!preferences.ok) throw new Error("nutrition-preferences-read-failed");
  return {
    mealSlots: preferences.value.mealSlots,
    macroTargets: preferences.value.macroTargets,
  };
}
