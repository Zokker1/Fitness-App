// T220: ruoat ja ravintoarvot (§11, §21, §23, §51–§52).
// Kaikki tallennetut ravintoarvot ovat per 100 g, jotta reseptit ja annokset
// voidaan laskea yhdenmukaisesti riippumatta käyttäjän syöttöperusteesta.

import { containsControlCharacters } from "@lifeos/domain";
import type { Food } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

const FOOD_NAME_MAX_LENGTH = 200;
const NUTRIENT_FIELDS = ["calories", "proteinG", "carbsG", "fatG", "fiberG"] as const;

export interface FoodNutritionValues {
  readonly calories: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  /** Kuitu on vapaaehtoinen, koska sitä ei ole kaikissa ravintoarvomerkinnöissä. */
  readonly fiberG?: number | null | undefined;
}

/** Per-serving input normalisoidaan palvelussa tallennusmuotoon per 100 g. */
export type FoodNutritionInput =
  | (FoodNutritionValues & { readonly basis: "per-100g" })
  | (FoodNutritionValues & { readonly basis: "per-serving"; readonly servingSizeG: number });

export interface FoodServiceDeps {
  readonly clock: Clock;
  readonly foods: EntityRepository<Food>;
}

export interface CreateFoodInput {
  readonly name: string;
  readonly nutrition: FoodNutritionInput;
}

export interface UpdateFoodInput {
  readonly name?: string | undefined;
  readonly nutrition?: FoodNutritionInput | undefined;
}

export interface ListFoodsOptions {
  readonly query?: string | undefined;
  readonly includeDeleted?: boolean | undefined;
}

type FoodNutrition = Pick<
  Food,
  | "caloriesPer100G"
  | "proteinPer100G"
  | "carbsPer100G"
  | "fatPer100G"
  | "fiberPer100G"
  | "servingSizeG"
>;

function invalidFood<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.food.validation.${field}`, message),
  };
}

function validateFoodName(value: unknown): DataResult<string> {
  if (typeof value !== "string") {
    return invalidFood("name", "Anna ruoalle nimi.");
  }
  const name = value.trim();
  if (name.length === 0 || name.length > FOOD_NAME_MAX_LENGTH || containsControlCharacters(name)) {
    return invalidFood(
      "name",
      `Nimen pituuden tulee olla 1–${String(FOOD_NAME_MAX_LENGTH)} merkkiä ilman ohjausmerkkejä.`,
    );
  }
  return { ok: true, value: name };
}

function validateNutrition(input: unknown): DataResult<FoodNutrition> {
  if (typeof input !== "object" || input === null) {
    return invalidFood("nutrition", "Anna ravintoarvot ja niiden laskentaperuste.");
  }
  const record = input as Record<string, unknown>;
  if (record.basis !== "per-100g" && record.basis !== "per-serving") {
    return invalidFood("nutrition-basis", "Valitse arvot per 100 g tai annosta kohti.");
  }

  let servingSizeG: number | null = null;
  if (record.basis === "per-serving") {
    const size = record.servingSizeG;
    if (typeof size !== "number" || !Number.isFinite(size) || size <= 0) {
      return invalidFood("serving-size", "Annoksen painon on oltava äärellinen ja yli 0 g.");
    }
    servingSizeG = size;
  }

  const values: Record<(typeof NUTRIENT_FIELDS)[number], number | null> = {
    calories: null,
    proteinG: null,
    carbsG: null,
    fatG: null,
    fiberG: null,
  };
  for (const field of NUTRIENT_FIELDS) {
    const value = field === "fiberG" ? (record[field] ?? null) : record[field];
    if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      return invalidFood(field, "Ravintoarvon on oltava äärellinen ja vähintään nolla, tai tyhjä.");
    }
    if (value !== null) {
      const per100G = servingSizeG === null ? value : (value / servingSizeG) * 100;
      if (!Number.isFinite(per100G)) {
        return invalidFood(field, "Ravintoarvo on liian suuri muunnettavaksi per 100 g.");
      }
      values[field] = per100G;
    }
  }

  return {
    ok: true,
    value: {
      caloriesPer100G: values.calories,
      proteinPer100G: values.proteinG,
      carbsPer100G: values.carbsG,
      fatPer100G: values.fatG,
      fiberPer100G: values.fiberG,
      servingSizeG,
    },
  };
}

/** Luo ruoan ja validoi arvot per 100 g tai käyttäjän ilmoittamaa annosta kohti. */
export async function createFoodService(
  deps: FoodServiceDeps,
  input: CreateFoodInput,
): Promise<DataResult<Food>> {
  const name = validateFoodName(input.name);
  if (!name.ok) {
    return name;
  }
  const nutrition = validateNutrition(input.nutrition);
  if (!nutrition.ok) {
    return nutrition;
  }
  return deps.foods.create({
    name: name.value,
    ...nutrition.value,
    deletedAt: null,
  });
}

/** Hakee ruoan ID:llä; käytöstä poistettuja ruokia ei piiloteta haussa ID:llä. */
export function getFoodService(deps: FoodServiceDeps, id: string): Promise<DataResult<Food>> {
  return deps.foods.getById(id);
}

/** Listaa aktiiviset ruoat nimijärjestyksessä; poistettuja voi pyytää erikseen. */
export async function listFoodsService(
  deps: FoodServiceDeps,
  options: ListFoodsOptions = {},
): Promise<DataResult<readonly Food[]>> {
  if (
    options.query !== undefined &&
    (typeof options.query !== "string" || containsControlCharacters(options.query))
  ) {
    return invalidFood("query", "Hakuteksti ei voi sisältää ohjausmerkkejä.");
  }
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== "boolean") {
    return invalidFood("include-deleted", "Poistettujen ruokien valinnan on oltava kyllä tai ei.");
  }
  const listed = await deps.foods.list();
  if (!listed.ok) {
    return listed;
  }
  const query = options.query?.trim().toLocaleLowerCase("fi-FI") ?? "";
  const foods = listed.value
    .filter((food) => options.includeDeleted === true || food.deletedAt === null)
    .filter((food) => query.length === 0 || food.name.toLocaleLowerCase("fi-FI").includes(query))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "fi-FI", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
  return { ok: true, value: foods };
}

/** Päivittää ruoan nimen ja/tai ravintoarvot; tyhjä päivitys hylätään. */
export async function updateFoodService(
  deps: FoodServiceDeps,
  id: string,
  patch: UpdateFoodInput,
): Promise<DataResult<Food>> {
  const existing = await deps.foods.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return invalidFood("update-deleted", "Poistettua ruokaa ei voi muokata.");
  }
  if (patch.name === undefined && patch.nutrition === undefined) {
    return invalidFood("empty-update", "Muuta nimeä tai ravintoarvoja.");
  }

  const fields: {
    name?: string;
    caloriesPer100G?: number | null;
    proteinPer100G?: number | null;
    carbsPer100G?: number | null;
    fatPer100G?: number | null;
    fiberPer100G?: number | null;
    servingSizeG?: number | null;
  } = {};
  if (patch.name !== undefined) {
    const name = validateFoodName(patch.name);
    if (!name.ok) {
      return name;
    }
    fields.name = name.value;
  }
  if (patch.nutrition !== undefined) {
    const nutrition = validateNutrition(patch.nutrition);
    if (!nutrition.ok) {
      return nutrition;
    }
    Object.assign(fields, nutrition.value);
  }
  return deps.foods.update(id, fields);
}

/** Poistaa ruoan pehmeästi, jotta myöhemmät merkinnät ja synkka säilyvät. */
export async function deleteFoodService(
  deps: FoodServiceDeps,
  id: string,
): Promise<DataResult<Food>> {
  const existing = await deps.foods.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return invalidFood("delete-transition", "Ruoka on jo poistettu.");
  }
  return deps.foods.update(id, { deletedAt: deps.clock.nowIso() });
}

/** Palauttaa aiemmin pehmeästi poistetun ruoan. */
export async function restoreFoodService(
  deps: FoodServiceDeps,
  id: string,
): Promise<DataResult<Food>> {
  const existing = await deps.foods.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt === null) {
    return invalidFood("restore-transition", "Ruoka ei ole poistettu.");
  }
  return deps.foods.update(id, { deletedAt: null });
}
