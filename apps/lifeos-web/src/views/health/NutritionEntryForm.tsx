// T224: ruoka, määrä, syömisaika ja aterialuokka tallentuvat yhtenä entrynä.
import { t, tOptions, tTemplate } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { Button, Card, NumberInput, Select, type SelectOption } from "@lifeos/ui";
import {
  createNutritionEntryService,
  ensurePreferences,
  listFoodsService,
  listNutritionEntriesService,
  systemClock,
} from "@lifeos/data";
import type { Food, MealSlotPreference, NutritionEntry } from "@lifeos/domain";
import type { AppError } from "../../errors/appError.ts";
import { fromDataError, fromUnknown } from "../../errors/appError.ts";
import { useData } from "../../dataContext.tsx";
import {
  readFavoriteFoodIds,
  writeFavoriteFoodIds,
} from "../../preferences/favorite-foods-storage.ts";
import { isPersistentStorage } from "../../storage/persistenceMode.ts";
import { readLocalMealSlots } from "../../preferences/meal-slots-storage.ts";
import "./nutrition-entry-form.css";

function localDateTimeValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function NutritionEntryForm(): React.JSX.Element {
  const { foods, nutritionEntries, xpTransactions } = useData();
  const location = useLocation();
  const persistent = isPersistentStorage(location.search);
  const [foodList, setFoodList] = useState<readonly Food[]>([]);
  const [recentEntries, setRecentEntries] = useState<readonly NutritionEntry[]>([]);
  const [favoriteFoodIds, setFavoriteFoodIds] = useState<readonly string[]>([]);
  const [mealSlots, setMealSlots] = useState<readonly MealSlotPreference[]>([]);
  const [foodId, setFoodId] = useState("");
  const [amountG, setAmountG] = useState("100");
  const [eatenAt, setEatenAt] = useState(() => localDateTimeValue(new Date()));
  const [mealSlotId, setMealSlotId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [formError, setFormError] = useState("");
  const [favoriteError, setFavoriteError] = useState("");
  const [saved, setSaved] = useState(false);

  const activeMealSlots = useMemo(() => mealSlots.filter((slot) => !slot.archived), [mealSlots]);
  const selectedFood = foodList.find((food) => food.id === foodId);
  const foodOptions: readonly SelectOption[] = foodList.map((food) => ({
    value: food.id,
    label: food.name,
  }));
  const foodsById = useMemo(() => new Map(foodList.map((food) => [food.id, food])), [foodList]);
  const favoriteFoods = useMemo(
    () =>
      favoriteFoodIds.flatMap((id) => {
        const food = foodsById.get(id);
        return food === undefined ? [] : [food];
      }),
    [favoriteFoodIds, foodsById],
  );
  const recentFoods = useMemo(() => {
    const seen = new Set<string>();
    const result: Food[] = [];
    for (const entry of recentEntries) {
      const foodId = entry.foodId;
      if (typeof foodId !== "string" || seen.has(foodId)) {
        continue;
      }
      const food = foodsById.get(foodId);
      if (food !== undefined) {
        seen.add(foodId);
        result.push(food);
      }
      if (result.length >= 5) {
        break;
      }
    }
    return result;
  }, [foodsById, recentEntries]);
  const mealSlotOptions: readonly SelectOption[] = activeMealSlots.map((slot) => ({
    value: slot.id,
    label: slot.label,
  }));

  const loadOptions = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [foodResult, recentResult] = await Promise.all([
        listFoodsService({ clock: systemClock(), foods }),
        listNutritionEntriesService(
          { clock: systemClock(), nutritionEntries, foods, mealSlots: [] },
          {},
        ),
      ]);
      if (!foodResult.ok) {
        setError(fromDataError(foodResult.error));
        return;
      }
      if (!recentResult.ok) {
        setError(fromDataError(recentResult.error));
        return;
      }
      let savedMealSlots: readonly MealSlotPreference[];
      if (persistent) {
        const preferences = await ensurePreferences({
          clock: systemClock(),
          ids: { next: () => crypto.randomUUID() },
        });
        if (!preferences.ok) {
          setError(fromDataError(preferences.error));
          return;
        }
        savedMealSlots = preferences.value.mealSlots;
      } else {
        savedMealSlots = readLocalMealSlots();
      }
      const visibleMealSlots = savedMealSlots.filter((slot) => !slot.archived);
      const savedFavoriteFoodIds = await readFavoriteFoodIds(persistent);
      setFoodList(foodResult.value);
      setRecentEntries(recentResult.value);
      setFavoriteFoodIds(savedFavoriteFoodIds);
      setMealSlots(savedMealSlots);
      setFoodId((current) =>
        foodResult.value.some((food) => food.id === current)
          ? current
          : (foodResult.value[0]?.id ?? ""),
      );
      setMealSlotId((current) =>
        visibleMealSlots.some((slot) => slot.id === current)
          ? current
          : (visibleMealSlots[0]?.id ?? ""),
      );
      setError(null);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [foods, nutritionEntries, persistent]);

  useEffect(() => {
    const handleDataChanged = (): void => {
      void loadOptions();
    };
    void loadOptions();
    window.addEventListener("lifeos:data-changed", handleDataChanged);
    return () => {
      window.removeEventListener("lifeos:data-changed", handleDataChanged);
    };
  }, [loadOptions]);

  const changeFoodSelection = (nextFoodId: string): void => {
    const nextFood = foodList.find((food) => food.id === nextFoodId);
    setFoodId(nextFoodId);
    setAmountG(String(nextFood?.servingSizeG ?? 100));
    setFormError("");
    setFavoriteError("");
    setSaved(false);
  };

  const toggleFavorite = async (nextFoodId: string): Promise<void> => {
    const nextFavorites = new Set(favoriteFoodIds);
    if (nextFavorites.has(nextFoodId)) {
      nextFavorites.delete(nextFoodId);
    } else {
      nextFavorites.add(nextFoodId);
    }
    const nextIds = [...nextFavorites];
    try {
      await writeFavoriteFoodIds(nextIds, persistent);
      setFavoriteFoodIds(nextIds);
      setFavoriteError("");
    } catch {
      setFavoriteError(t("Suosikkia ei voitu tallentaa tähän selaimeen."));
    }
  };

  const submit = useCallback(
    async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const amount = Number(amountG);
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormError(t("Määrän on oltava yli nolla grammaa."));
        return;
      }
      const time = new Date(eatenAt);
      if (!Number.isFinite(time.getTime())) {
        setFormError(t("Anna kelvollinen syömisaika."));
        return;
      }
      if (foodId.length === 0 || mealSlotId.length === 0) {
        setFormError("Valitse ruoka ja aterialuokka.");
        return;
      }
      setSaving(true);
      setError(null);
      setFormError("");
      setSaved(false);
      try {
        const result = await createNutritionEntryService(
          {
            clock: systemClock(),
            nutritionEntries,
            foods,
            mealSlots,
            xpTransactions,
            timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
          },
          { foodId, amountG: amount, eatenAt: time.toISOString(), mealSlotId },
        );
        if (!result.ok) {
          setError(fromDataError(result.error));
          return;
        }
        setSaved(true);
        setEatenAt(localDateTimeValue(new Date()));
        window.dispatchEvent(new Event("lifeos:data-changed"));
      } catch (error_: unknown) {
        setError(fromUnknown(error_));
      } finally {
        setSaving(false);
      }
    },
    [amountG, eatenAt, foodId, foods, mealSlotId, mealSlots, nutritionEntries, xpTransactions],
  );

  return (
    <Card heading={t("Kirjaa ruoka")} data-testid="nutrition-entry-card">
      {loading ? <p role="status">{t("Ladataan ruokia ja aterialuokkia…")}</p> : null}
      {!loading && foodList.length === 0 ? (
        <div data-ui="nutrition-entry-empty">
          <p>{t("Lisää ensin ruoka ja sen tunnetut ravintoarvot omaan ruokakirjastoon.")}</p>
          <Link to={{ pathname: "/nutrition/foods", search: location.search }}>
            {t("Avaa ruokakirjasto")}
          </Link>
        </div>
      ) : null}
      {!loading && foodList.length > 0 && activeMealSlots.length > 0 ? (
        <form
          data-testid="nutrition-entry-form"
          noValidate
          onSubmit={(event) => void submit(event)}
        >
          <Select
            label={t("Ruoka")}
            value={foodId}
            options={tOptions(foodOptions)}
            disabled={saving}
            onChange={(event) => {
              changeFoodSelection(event.target.value);
            }}
          />
          {favoriteFoods.length > 0 || recentFoods.length > 0 ? (
            <div data-ui="nutrition-entry-quick-foods">
              {favoriteFoods.length > 0 ? (
                <section aria-labelledby="nutrition-entry-favorites-heading">
                  <h3 id="nutrition-entry-favorites-heading">{t("Suosikit")}</h3>
                  <ul>
                    {favoriteFoods.map((food) => (
                      <li key={food.id}>
                        <Button
                          variant="ghost"
                          type="button"
                          aria-pressed={food.id === foodId}
                          disabled={saving}
                          onClick={() => {
                            changeFoodSelection(food.id);
                          }}
                        >
                          {food.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {recentFoods.length > 0 ? (
                <section aria-labelledby="nutrition-entry-recent-heading">
                  <h3 id="nutrition-entry-recent-heading">{t("Viimeksi käytetyt")}</h3>
                  <ul>
                    {recentFoods.map((food) => (
                      <li key={food.id}>
                        <Button
                          variant="ghost"
                          type="button"
                          aria-pressed={food.id === foodId}
                          disabled={saving}
                          onClick={() => {
                            changeFoodSelection(food.id);
                          }}
                        >
                          {food.name}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}
          {favoriteError !== "" ? (
            <p data-ui="nutrition-entry-favorite-error" role="alert">
              {t(favoriteError)}
            </p>
          ) : null}
          <NumberInput
            label={t("Määrä (g)")}
            min={0.01}
            step="any"
            required
            value={amountG}
            disabled={saving}
            onChange={(event) => {
              setAmountG(event.target.value);
              setFormError("");
              setSaved(false);
            }}
          />
          <Select
            label={t("Aterialuokka")}
            value={mealSlotId}
            options={tOptions(mealSlotOptions)}
            disabled={saving}
            onChange={(event) => {
              setMealSlotId(event.target.value);
              setSaved(false);
            }}
          />
          <label data-ui="nutrition-entry-time">
            <span>{t("Syömisaika")}</span>
            <input
              type="datetime-local"
              required
              value={eatenAt}
              disabled={saving}
              onChange={(event) => {
                setEatenAt(event.target.value);
                setFormError("");
                setSaved(false);
              }}
            />
          </label>
          {formError !== "" ? (
            <p data-ui="field-error" role="alert">
              {t(formError)}
            </p>
          ) : null}
          <div data-ui="nutrition-entry-actions">
            {selectedFood !== undefined ? (
              <Button
                type="button"
                variant="secondary"
                aria-pressed={favoriteFoodIds.includes(selectedFood.id)}
                aria-label={
                  favoriteFoodIds.includes(selectedFood.id)
                    ? tTemplate("Poista {{0}} suosikeista", [selectedFood.name])
                    : tTemplate("Lisää {{0}} suosikkeihin", [selectedFood.name])
                }
                disabled={saving}
                onClick={() => {
                  void toggleFavorite(selectedFood.id);
                }}
              >
                {favoriteFoodIds.includes(selectedFood.id)
                  ? t("★ Poista suosikeista")
                  : t("☆ Lisää suosikiksi")}
              </Button>
            ) : null}
            <Button variant="primary" type="submit" loading={saving} disabled={loading}>
              {t("Tallenna ateria")}
            </Button>
          </div>
          {saved ? <p role="status">{t("Ateria tallennettiin.")}</p> : null}
        </form>
      ) : null}
      {!loading && foodList.length > 0 && activeMealSlots.length === 0 ? (
        <p role="alert">{t("Lisää näkyvä aterialuokka Asetuksissa ennen ruokakirjausta.")}</p>
      ) : null}
      {error !== null ? (
        <p data-ui="nutrition-entry-error" role="alert">
          {error.body}
        </p>
      ) : null}
      {selectedFood !== undefined && !loading ? (
        <p data-ui="nutrition-entry-hint">
          {t("Ravintoarvot tallentuvat")}
          {selectedFood.name}
          {t("-ruoan nykyisistä tiedoista.")}
        </p>
      ) : null}
    </Card>
  );
}
