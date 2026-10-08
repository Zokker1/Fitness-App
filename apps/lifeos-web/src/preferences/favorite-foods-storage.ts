import { getEntityDoc, putEntityDoc } from "@lifeos/data";

export const LOCAL_FAVORITE_FOODS_KEY = "lifeos-favorite-food-ids";
const PRIVATE_PREFERENCE_TYPE = "local-preference";
const FAVORITE_FOODS_ID = "favorite-foods";

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

function sanitizeFavoriteFoodIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  for (const item of value) {
    if (
      typeof item === "string" &&
      item.trim().length > 0 &&
      item.length <= 200 &&
      !hasControlCharacters(item)
    ) {
      unique.add(item);
    }
    if (unique.size >= 500) {
      break;
    }
  }
  return [...unique];
}

export async function readFavoriteFoodIds(persistent: boolean): Promise<readonly string[]> {
  if (!persistent) return readLocalFavoriteFoodIds();
  const result = await getEntityDoc(PRIVATE_PREFERENCE_TYPE, FAVORITE_FOODS_ID);
  if (!result.ok) throw new Error(result.error.diagnosticCode);
  const row = result.value[0];
  if (typeof row !== "object" || row === null || Array.isArray(row)) return [];
  const value = (row as { readonly value?: unknown }).value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
    return sanitizeFavoriteFoodIds((parsed as { readonly foodIds?: unknown }).foodIds);
  } catch {
    return [];
  }
}

export async function writeFavoriteFoodIds(
  foodIds: readonly string[],
  persistent: boolean,
): Promise<void> {
  const sanitized = sanitizeFavoriteFoodIds(foodIds);
  if (!persistent) {
    writeLocalFavoriteFoodIds(sanitized);
    return;
  }
  const now = new Date().toISOString();
  const result = await putEntityDoc(
    PRIVATE_PREFERENCE_TYPE,
    FAVORITE_FOODS_ID,
    0,
    JSON.stringify({
      id: FAVORITE_FOODS_ID,
      createdAt: now,
      updatedAt: now,
      version: 1,
      foodIds: sanitized,
    }),
    now,
    now,
  );
  if (!result.ok) throw new Error(result.error.diagnosticCode);
}

/** Lukee selaimen suosikit ja ohittaa virheellisen tai vanhentuneen tallenteen. */
export function readLocalFavoriteFoodIds(): readonly string[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_FAVORITE_FOODS_KEY);
    if (raw === null) {
      return [];
    }
    return sanitizeFavoriteFoodIds(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

/** Tallentaa rajatun ja duplikaateista puhdistetun suosikkilistan. */
export function writeLocalFavoriteFoodIds(foodIds: readonly string[]): void {
  window.localStorage.setItem(
    LOCAL_FAVORITE_FOODS_KEY,
    JSON.stringify(sanitizeFavoriteFoodIds(foodIds)),
  );
}
