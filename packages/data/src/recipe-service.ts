// T222: reseptit koostuvat ruoista grammoina ja niiden ravintoarvot
// johdetaan deterministisesti Food-entiteettien per-100 g arvoista.

import { containsControlCharacters } from "@lifeos/domain";
import type { Food, Recipe, RecipeIngredient } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

const RECIPE_NAME_MAX_LENGTH = 200;
type FoodNutrientField =
  "caloriesPer100G" | "proteinPer100G" | "carbsPer100G" | "fatPer100G" | "fiberPer100G";

export interface RecipeServiceDeps {
  readonly clock: Clock;
  readonly recipes: EntityRepository<Recipe>;
  readonly foods: EntityRepository<Food>;
}

export interface CreateRecipeInput {
  readonly name: string;
  readonly ingredients: readonly RecipeIngredient[];
  /** Oletuksena koko resepti on yksi annos. */
  readonly servings?: number | undefined;
}

export interface UpdateRecipeInput {
  readonly name?: string | undefined;
  readonly ingredients?: readonly RecipeIngredient[] | undefined;
  readonly servings?: number | undefined;
}

export interface ListRecipesOptions {
  readonly query?: string | undefined;
  readonly includeDeleted?: boolean | undefined;
}

export interface RecipeNutrients {
  readonly calories: number | null;
  readonly proteinG: number | null;
  readonly carbsG: number | null;
  readonly fatG: number | null;
  readonly fiberG: number | null;
}

export interface RecipeNutrition {
  readonly total: RecipeNutrients;
  readonly perServing: RecipeNutrients;
  readonly servings: number;
}

function invalidRecipe<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.recipe.validation.${field}`, message),
  };
}

function validateRecipeName(value: unknown): DataResult<string> {
  if (typeof value !== "string") {
    return invalidRecipe("name", "Anna reseptille nimi.");
  }
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > RECIPE_NAME_MAX_LENGTH ||
    containsControlCharacters(name)
  ) {
    return invalidRecipe(
      "name",
      `Nimen pituuden tulee olla 1–${String(RECIPE_NAME_MAX_LENGTH)} merkkiä ilman ohjausmerkkejä.`,
    );
  }
  return { ok: true, value: name };
}

function validateServings(value: unknown): DataResult<number> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return invalidRecipe("servings", "Annosmäärän on oltava äärellinen luku, joka on yli nolla.");
  }
  return { ok: true, value };
}

function validateIngredients(value: unknown): DataResult<readonly RecipeIngredient[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return invalidRecipe("ingredients", "Reseptissä on oltava vähintään yksi ruoka-aine.");
  }

  const ingredients: RecipeIngredient[] = [];
  for (const [index, ingredient] of value.entries()) {
    if (typeof ingredient !== "object" || ingredient === null) {
      return invalidRecipe("ingredients", "Tarkista ruoka-aineiden määrät grammoina.");
    }
    const record = ingredient as Record<string, unknown>;
    if (
      typeof record.foodId !== "string" ||
      record.foodId.trim().length === 0 ||
      containsControlCharacters(record.foodId)
    ) {
      return invalidRecipe(
        "ingredient-food",
        "Valitse jokaiselle ruoka-aineelle tallennettu ruoka.",
      );
    }
    if (
      typeof record.amountG !== "number" ||
      !Number.isFinite(record.amountG) ||
      record.amountG <= 0
    ) {
      return invalidRecipe(
        `ingredient-amount-${String(index)}`,
        "Ruoka-aineen määrän on oltava äärellinen ja yli nolla grammaa.",
      );
    }
    ingredients.push({ foodId: record.foodId, amountG: record.amountG });
  }
  return { ok: true, value: ingredients };
}

async function ensureFoodsExist(
  foods: EntityRepository<Food>,
  ingredients: readonly RecipeIngredient[],
): Promise<DataResult<ReadonlyMap<string, Food>>> {
  const foodIds = [...new Set(ingredients.map(({ foodId }) => foodId))].sort(compareIds);
  const found = new Map<string, Food>();
  for (const foodId of foodIds) {
    const result = await foods.getById(foodId);
    if (!result.ok) {
      return result;
    }
    // Soft-poistetun ruoan ravintoarvot ovat edelleen käytettävissä jo
    // tallennetussa reseptissä, eikä poistaminen riko viitettä.
    found.set(foodId, result.value);
  }
  return { ok: true, value: found };
}

/** Luo reseptin; ainesosat tallentuvat grammoina, annosmäärä voi olla desimaali. */
export async function createRecipeService(
  deps: RecipeServiceDeps,
  input: CreateRecipeInput,
): Promise<DataResult<Recipe>> {
  const name = validateRecipeName(input.name);
  if (!name.ok) {
    return name;
  }
  const ingredients = validateIngredients(input.ingredients);
  if (!ingredients.ok) {
    return ingredients;
  }
  const servings = validateServings(input.servings ?? 1);
  if (!servings.ok) {
    return servings;
  }
  const existingFoods = await ensureFoodsExist(deps.foods, ingredients.value);
  if (!existingFoods.ok) {
    return existingFoods;
  }
  const foodIds = [...new Set(ingredients.value.map(({ foodId }) => foodId))];
  return deps.recipes.create({
    name: name.value,
    ingredients: ingredients.value,
    servings: servings.value,
    foodIds,
    deletedAt: null,
  });
}

/** Hakee reseptin myös silloin, kun se on merkitty poistetuksi. */
export function getRecipeService(deps: RecipeServiceDeps, id: string): Promise<DataResult<Recipe>> {
  return deps.recipes.getById(id);
}

/** Listaa reseptit nimijärjestyksessä; poistetut voi pyytää erikseen. */
export async function listRecipesService(
  deps: RecipeServiceDeps,
  options: ListRecipesOptions = {},
): Promise<DataResult<readonly Recipe[]>> {
  if (
    options.query !== undefined &&
    (typeof options.query !== "string" || containsControlCharacters(options.query))
  ) {
    return invalidRecipe("query", "Hakuteksti ei voi sisältää ohjausmerkkejä.");
  }
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== "boolean") {
    return invalidRecipe(
      "include-deleted",
      "Poistettujen reseptien valinnan on oltava kyllä tai ei.",
    );
  }
  const listed = await deps.recipes.list();
  if (!listed.ok) {
    return listed;
  }
  const query = options.query?.trim().toLocaleLowerCase("fi-FI") ?? "";
  const recipes = listed.value
    .filter((recipe) => options.includeDeleted === true || recipe.deletedAt === null)
    .filter(
      (recipe) => query.length === 0 || recipe.name.toLocaleLowerCase("fi-FI").includes(query),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "fi-FI", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
  return { ok: true, value: recipes };
}

/** Päivittää nimen, ainesosat tai annosmäärän; tyhjä päivitys hylätään. */
export async function updateRecipeService(
  deps: RecipeServiceDeps,
  id: string,
  patch: UpdateRecipeInput,
): Promise<DataResult<Recipe>> {
  const existing = await deps.recipes.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return invalidRecipe("update-deleted", "Poistettua reseptiä ei voi muokata.");
  }
  if (patch.name === undefined && patch.ingredients === undefined && patch.servings === undefined) {
    return invalidRecipe("empty-update", "Muuta reseptin nimeä, ruoka-aineita tai annosmäärää.");
  }

  const fields: {
    name?: string;
    ingredients?: readonly RecipeIngredient[];
    servings?: number;
    foodIds?: readonly string[];
  } = {};
  if (patch.name !== undefined) {
    const name = validateRecipeName(patch.name);
    if (!name.ok) {
      return name;
    }
    fields.name = name.value;
  }
  if (patch.ingredients !== undefined) {
    const ingredients = validateIngredients(patch.ingredients);
    if (!ingredients.ok) {
      return ingredients;
    }
    const existingFoods = await ensureFoodsExist(deps.foods, ingredients.value);
    if (!existingFoods.ok) {
      return existingFoods;
    }
    fields.ingredients = ingredients.value;
    fields.foodIds = [...new Set(ingredients.value.map(({ foodId }) => foodId))];
  }
  if (patch.servings !== undefined) {
    const servings = validateServings(patch.servings);
    if (!servings.ok) {
      return servings;
    }
    fields.servings = servings.value;
  }
  return deps.recipes.update(id, fields);
}

/** Poistaa reseptin pehmeästi säilyttäen reseptin sekä sen viitteet historiassa. */
export async function deleteRecipeService(
  deps: RecipeServiceDeps,
  id: string,
): Promise<DataResult<Recipe>> {
  const existing = await deps.recipes.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt !== null) {
    return invalidRecipe("delete-transition", "Resepti on jo poistettu.");
  }
  return deps.recipes.update(id, { deletedAt: deps.clock.nowIso() });
}

/** Palauttaa aiemmin pehmeästi poistetun reseptin. */
export async function restoreRecipeService(
  deps: RecipeServiceDeps,
  id: string,
): Promise<DataResult<Recipe>> {
  const existing = await deps.recipes.getById(id);
  if (!existing.ok) {
    return existing;
  }
  if (existing.value.deletedAt === null) {
    return invalidRecipe("restore-transition", "Resepti ei ole poistettu.");
  }
  return deps.recipes.update(id, { deletedAt: null });
}

function stableIngredients(ingredients: readonly RecipeIngredient[]): readonly RecipeIngredient[] {
  return [...ingredients].sort(
    (left, right) => compareIds(left.foodId, right.foodId) || left.amountG - right.amountG,
  );
}

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Laskee yhden ravintoaineen Kahan-summauksella; tuntematon arvo pysyy nullina. */
function sumNutrient(
  ingredients: readonly RecipeIngredient[],
  foods: ReadonlyMap<string, Food>,
  field: FoodNutrientField,
): number | null {
  let sum = 0;
  let compensation = 0;
  for (const ingredient of ingredients) {
    const food = foods.get(ingredient.foodId);
    if (food === undefined) {
      return null;
    }
    const per100G = food[field] ?? null;
    if (per100G === null) {
      return null;
    }
    if (typeof per100G !== "number" || !Number.isFinite(per100G) || per100G < 0) {
      return Number.NaN;
    }
    const value = (per100G * ingredient.amountG) / 100;
    if (!Number.isFinite(value)) {
      return Number.NaN;
    }
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = next - sum - adjusted;
    sum = next;
  }
  return Number.isFinite(sum) ? sum : Number.NaN;
}

function calculateNutrition(
  ingredients: readonly RecipeIngredient[],
  servings: number,
  foods: ReadonlyMap<string, Food>,
): DataResult<RecipeNutrition> {
  const sorted = stableIngredients(ingredients);
  const total: RecipeNutrients = {
    calories: sumNutrient(sorted, foods, "caloriesPer100G"),
    proteinG: sumNutrient(sorted, foods, "proteinPer100G"),
    carbsG: sumNutrient(sorted, foods, "carbsPer100G"),
    fatG: sumNutrient(sorted, foods, "fatPer100G"),
    fiberG: sumNutrient(sorted, foods, "fiberPer100G"),
  };
  if (Object.values(total).some((value) => value !== null && !Number.isFinite(value))) {
    return invalidRecipe(
      "nutrition-overflow",
      "Reseptin ravintoarvo on liian suuri laskettavaksi.",
    );
  }
  const perServingValues: RecipeNutrients = {
    calories: total.calories === null ? null : total.calories / servings,
    proteinG: total.proteinG === null ? null : total.proteinG / servings,
    carbsG: total.carbsG === null ? null : total.carbsG / servings,
    fatG: total.fatG === null ? null : total.fatG / servings,
    fiberG: total.fiberG === null ? null : total.fiberG / servings,
  };
  if (Object.values(perServingValues).some((value) => value !== null && !Number.isFinite(value))) {
    return invalidRecipe(
      "nutrition-overflow",
      "Ravintoarvoa ei voi laskea annosta kohti tällä annosmäärällä.",
    );
  }
  return {
    ok: true,
    value: { total, perServing: perServingValues, servings },
  };
}

/** Laskee reseptin kaikki arvot aina nykyisistä Food-arvoista, pyöristämättä välituloksia. */
export async function getRecipeNutritionService(
  deps: RecipeServiceDeps,
  id: string,
): Promise<DataResult<RecipeNutrition>> {
  const recipe = await deps.recipes.getById(id);
  if (!recipe.ok) {
    return recipe;
  }
  if (recipe.value.ingredients === undefined) {
    return invalidRecipe(
      "legacy-ingredients-missing",
      "Tämän vanhan reseptin ruoka-aineille pitää lisätä määrät ennen ravintoarvojen laskentaa.",
    );
  }
  const ingredients = validateIngredients(recipe.value.ingredients);
  if (!ingredients.ok) {
    return ingredients;
  }
  const servings = validateServings(recipe.value.servings ?? 1);
  if (!servings.ok) {
    return servings;
  }
  const existingFoods = await ensureFoodsExist(deps.foods, ingredients.value);
  if (!existingFoods.ok) {
    return existingFoods;
  }
  const nutrition = calculateNutrition(ingredients.value, servings.value, existingFoods.value);
  if (!nutrition.ok) {
    return nutrition;
  }
  return nutrition;
}
