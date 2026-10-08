// T224: ruokakirjaus tallentaa ruoan, grammamäärän, ajan, aterialuokan ja
// ravintoarvosnapshotin yhtenä pysyvänä NutritionEntry-entiteettinä.

import { containsControlCharacters } from "@lifeos/domain";
import type { Food, MealSlotPreference, NutritionEntry, UtcTimestamp } from "@lifeos/domain";
import { awardHealthTrackingXp, type HealthTrackingXpDeps } from "./health-tracking-xp.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface NutritionEntryServiceDeps extends HealthTrackingXpDeps {
  readonly nutritionEntries: EntityRepository<NutritionEntry>;
  readonly foods: EntityRepository<Food>;
  readonly mealSlots: readonly MealSlotPreference[];
}

export interface CreateNutritionEntryInput {
  readonly foodId: string;
  readonly amountG: number;
  readonly eatenAt?: UtcTimestamp | undefined;
  readonly mealSlotId: string;
}

export interface ListNutritionEntriesOptions {
  readonly from?: UtcTimestamp | undefined;
  readonly to?: UtcTimestamp | undefined;
  readonly includeDeleted?: boolean | undefined;
}

function invalidNutritionEntry<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.nutrition-entry.validation.${field}`, message),
  };
}

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    return false;
  }
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function scaleNutrient(
  valuePer100G: number | null | undefined,
  amountG: number,
  field: string,
): DataResult<number | null> {
  if (valuePer100G === null || valuePer100G === undefined) {
    return { ok: true, value: null };
  }
  if (typeof valuePer100G !== "number" || !Number.isFinite(valuePer100G) || valuePer100G < 0) {
    return invalidNutritionEntry(field, "Ruoan tallennettua ravintoarvoa ei voi käyttää.");
  }
  const value = (valuePer100G * amountG) / 100;
  if (!Number.isFinite(value)) {
    return invalidNutritionEntry(
      "nutrition-overflow",
      "Annos on liian suuri ravintoarvon laskentaan.",
    );
  }
  return { ok: true, value };
}

function isNutritionEntryActive(entry: NutritionEntry): boolean {
  const deletedAt: unknown = entry.deletedAt;
  return deletedAt === null || deletedAt === undefined;
}

/** Luo syödyn ruoan; Food-arvot kopioidaan entryyn eivätkä muutu ruoan editoinnissa. */
export async function createNutritionEntryService(
  deps: NutritionEntryServiceDeps,
  input: CreateNutritionEntryInput,
): Promise<DataResult<NutritionEntry>> {
  if (
    typeof input.foodId !== "string" ||
    input.foodId.trim().length === 0 ||
    containsControlCharacters(input.foodId)
  ) {
    return invalidNutritionEntry("food", "Valitse ruoka kirjastosta.");
  }
  if (typeof input.amountG !== "number" || !Number.isFinite(input.amountG) || input.amountG <= 0) {
    return invalidNutritionEntry("amount", "Määrän on oltava äärellinen ja yli nolla grammaa.");
  }
  if (
    typeof input.mealSlotId !== "string" ||
    input.mealSlotId.trim().length === 0 ||
    containsControlCharacters(input.mealSlotId)
  ) {
    return invalidNutritionEntry("meal-slot", "Valitse aterialuokka.");
  }
  const mealSlot = deps.mealSlots.find((slot) => slot.id === input.mealSlotId && !slot.archived);
  if (mealSlot === undefined) {
    return invalidNutritionEntry("meal-slot", "Valitse näkyvissä oleva aterialuokka.");
  }
  const eatenAt = input.eatenAt ?? deps.clock.nowIso();
  if (!isValidUtcTimestamp(eatenAt)) {
    return invalidNutritionEntry("eaten-at", "Syömisaika on annettava kelvollisena UTC-aikana.");
  }

  const food = await deps.foods.getById(input.foodId);
  if (!food.ok) {
    return food;
  }
  if (food.value.deletedAt !== null) {
    return invalidNutritionEntry(
      "deleted-food",
      "Poistettua ruokaa ei voi kirjata uutena ateriana.",
    );
  }

  const calories = scaleNutrient(food.value.caloriesPer100G, input.amountG, "calories");
  if (!calories.ok) {
    return calories;
  }
  const proteinG = scaleNutrient(food.value.proteinPer100G, input.amountG, "protein");
  if (!proteinG.ok) {
    return proteinG;
  }
  const carbsG = scaleNutrient(food.value.carbsPer100G, input.amountG, "carbs");
  if (!carbsG.ok) {
    return carbsG;
  }
  const fatG = scaleNutrient(food.value.fatPer100G, input.amountG, "fat");
  if (!fatG.ok) {
    return fatG;
  }
  const fiberG = scaleNutrient(food.value.fiberPer100G, input.amountG, "fiber");
  if (!fiberG.ok) {
    return fiberG;
  }

  const created = await deps.nutritionEntries.create({
    eatenAt,
    foodId: food.value.id,
    amountG: input.amountG,
    mealSlotId: mealSlot.id,
    label: food.value.name,
    calories: calories.value,
    proteinG: proteinG.value,
    carbsG: carbsG.value,
    fatG: fatG.value,
    fiberG: fiberG.value,
    deletedAt: null,
  });
  if (created.ok) {
    await awardHealthTrackingXp(deps, "nutrition", created.value.eatenAt);
  }
  return created;
}

/** Listaa kirjaukset uusimmasta alkaen; aikarajat ovat mukaan lukevia. */
export async function listNutritionEntriesService(
  deps: NutritionEntryServiceDeps,
  options: ListNutritionEntriesOptions = {},
): Promise<DataResult<readonly NutritionEntry[]>> {
  if (options.from !== undefined && !isValidUtcTimestamp(options.from)) {
    return invalidNutritionEntry("from", "Alkupäivä on annettava kelvollisena UTC-aikana.");
  }
  if (options.to !== undefined && !isValidUtcTimestamp(options.to)) {
    return invalidNutritionEntry("to", "Loppupäivä on annettava kelvollisena UTC-aikana.");
  }
  if (
    options.from !== undefined &&
    options.to !== undefined &&
    Date.parse(options.from) > Date.parse(options.to)
  ) {
    return invalidNutritionEntry("range", "Aikavälin alku ei voi olla loppua myöhemmin.");
  }
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== "boolean") {
    return invalidNutritionEntry(
      "include-deleted",
      "Poistettujen kirjausten valinta on virheellinen.",
    );
  }
  const listed = await deps.nutritionEntries.list();
  if (!listed.ok) {
    return listed;
  }
  const entries = listed.value
    .filter((entry) => options.includeDeleted === true || isNutritionEntryActive(entry))
    .filter(
      (entry) =>
        options.from === undefined || Date.parse(entry.eatenAt) >= Date.parse(options.from),
    )
    .filter(
      (entry) => options.to === undefined || Date.parse(entry.eatenAt) <= Date.parse(options.to),
    )
    .sort(
      (left, right) =>
        Date.parse(right.eatenAt) - Date.parse(left.eatenAt) || left.id.localeCompare(right.id),
    );
  return { ok: true, value: entries };
}
