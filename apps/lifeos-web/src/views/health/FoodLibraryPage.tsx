// T221: käyttäjän omat ruoat ilman ulkoista tietokantaa.

import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  Alert,
  Button,
  Card,
  Display,
  EmptyState,
  Input,
  Meta,
  NumberInput,
  Select,
  Skeleton,
} from "@lifeos/ui";
import {
  createFoodService,
  deleteFoodService,
  listFoodsService,
  restoreFoodService,
  systemClock,
  updateFoodService,
} from "@lifeos/data";
import type { FoodNutritionInput, FoodNutritionValues } from "@lifeos/data";
import type { Food } from "@lifeos/domain";
import { useData } from "../../dataContext.tsx";
import "./food-library.css";

type NutritionBasis = FoodNutritionInput["basis"];
type NutrientKey = "calories" | "proteinG" | "carbsG" | "fatG" | "fiberG";

interface FoodDraft {
  readonly name: string;
  readonly basis: NutritionBasis;
  readonly servingSizeG: string;
  readonly calories: string;
  readonly proteinG: string;
  readonly carbsG: string;
  readonly fatG: string;
  readonly fiberG: string;
}

const EMPTY_DRAFT: FoodDraft = {
  name: "",
  basis: "per-100g",
  servingSizeG: "",
  calories: "",
  proteinG: "",
  carbsG: "",
  fatG: "",
  fiberG: "",
};

const BASIS_OPTIONS = [
  { value: "per-100g", label: "Per 100 g" },
  { value: "per-serving", label: "Annosta kohti" },
] as const;

const NUTRIENT_FIELDS: readonly {
  readonly key: NutrientKey;
  readonly label: string;
  readonly unit: string;
}[] = [
  { key: "calories", label: "Energia", unit: "kcal" },
  { key: "proteinG", label: "Proteiini", unit: "g" },
  { key: "carbsG", label: "Hiilihydraatit", unit: "g" },
  { key: "fatG", label: "Rasva", unit: "g" },
  { key: "fiberG", label: "Kuitu", unit: "g" },
];

function parseOptionalNumber(value: string):
  | { readonly ok: true; readonly value: number | null }
  | {
      readonly ok: false;
    } {
  const normalized = value.trim().replace(",", ".");
  if (normalized.length === 0) {
    return { ok: true, value: null };
  }
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) {
    return { ok: false };
  }
  return { ok: true, value: number };
}

function formatValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined) {
    return "Ei ilmoitettu";
  }
  const formatted = new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 2 }).format(
    value,
  );
  return `${formatted} ${unit}`;
}

function nutrientValue(food: Food, key: NutrientKey): number | null | undefined {
  switch (key) {
    case "calories":
      return food.caloriesPer100G;
    case "proteinG":
      return food.proteinPer100G;
    case "carbsG":
      return food.carbsPer100G;
    case "fatG":
      return food.fatPer100G;
    case "fiberG":
      return food.fiberPer100G;
  }
}

function draftFromFood(food: Food): FoodDraft {
  const servingSizeG = food.servingSizeG ?? null;
  const basis: NutritionBasis = servingSizeG === null ? "per-100g" : "per-serving";
  const toServingValue = (value: number | null | undefined): string => {
    if (value === null || value === undefined) {
      return "";
    }
    return String(servingSizeG === null ? value : (value * servingSizeG) / 100);
  };
  return {
    name: food.name,
    basis,
    servingSizeG: servingSizeG === null ? "" : String(servingSizeG),
    calories: toServingValue(food.caloriesPer100G),
    proteinG: toServingValue(food.proteinPer100G),
    carbsG: toServingValue(food.carbsPer100G),
    fatG: toServingValue(food.fatPer100G),
    fiberG: toServingValue(food.fiberPer100G),
  };
}

function FoodRow({
  food,
  archived,
  busy,
  onEdit,
  onDelete,
  onRestore,
}: {
  readonly food: Food;
  readonly archived: boolean;
  readonly busy: boolean;
  readonly onEdit: (food: Food) => void;
  readonly onDelete: (food: Food) => void;
  readonly onRestore: (food: Food) => void;
}): React.JSX.Element {
  return (
    <li data-ui="food-row" data-archived={archived ? "true" : undefined}>
      <div data-ui="food-row-heading">
        <div>
          <h3>{food.name}</h3>
          <Meta>
            {t("Arvot per 100 g")}
            {food.servingSizeG === null || food.servingSizeG === undefined
              ? ""
              : ` · annoskoko ${formatValue(food.servingSizeG, "g")}`}
          </Meta>
        </div>
        <div data-ui="food-row-actions">
          {archived ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => {
                onRestore(food);
              }}
            >
              {t("Palauta")}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  onEdit(food);
                }}
              >
                {t("Muokkaa")}
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  onDelete(food);
                }}
              >
                {t("Poista")}
              </Button>
            </>
          )}
        </div>
      </div>
      <dl data-ui="food-nutrition-values">
        {NUTRIENT_FIELDS.map(({ key, label, unit }) => {
          return (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{formatValue(nutrientValue(food, key), unit)}</dd>
            </div>
          );
        })}
      </dl>
    </li>
  );
}

export function FoodLibraryPage(): React.JSX.Element {
  const { foods } = useData();
  const location = useLocation();
  const clock = useMemo(() => systemClock(), []);
  const deps = useMemo(() => ({ clock, foods }), [clock, foods]);
  const [items, setItems] = useState<readonly Food[]>([]);
  const [draft, setDraft] = useState<FoodDraft>(EMPTY_DRAFT);
  const [editingFood, setEditingFood] = useState<Food | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyFoodId, setBusyFoodId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await listFoodsService(deps, { includeDeleted: true });
      if (result.ok) {
        setItems(result.value);
        setLoadError("");
      } else {
        setLoadError(result.error.userMessage);
      }
    } catch {
      setLoadError(t("Ruokia ei voitu ladata. Yritä uudelleen."));
    } finally {
      setLoading(false);
    }
  }, [deps]);

  useEffect(() => {
    const onDataChanged = (): void => {
      void refresh();
    };
    void refresh();
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const matchingItems = items.filter((food) =>
    food.name
      .toLocaleLowerCase(getIntlLocale())
      .includes(query.trim().toLocaleLowerCase(getIntlLocale())),
  );
  const activeFoods = matchingItems.filter((food) => food.deletedAt === null);
  const archivedFoods = matchingItems.filter((food) => food.deletedAt !== null);

  const changeDraft = <K extends keyof FoodDraft>(field: K, value: FoodDraft[K]): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFormError("");
    setFeedback("");
  };

  const resetForm = (): void => {
    setDraft(EMPTY_DRAFT);
    setEditingFood(null);
    setFormError("");
  };

  const startEditing = (food: Food): void => {
    setEditingFood(food);
    setDraft(draftFromFood(food));
    setFormError("");
    setFeedback("");
    document.getElementById("food-name")?.focus();
  };

  const submit = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setFormError("");
    setFeedback("");

    const numericValues: Record<NutrientKey, number | null> = {
      calories: null,
      proteinG: null,
      carbsG: null,
      fatG: null,
      fiberG: null,
    };
    for (const { key } of NUTRIENT_FIELDS) {
      const parsed = parseOptionalNumber(draft[key]);
      if (!parsed.ok) {
        setFormError("Ravintoarvojen tulee olla nollaa suurempia tai nolla.");
        return;
      }
      numericValues[key] = parsed.value;
    }

    const values: FoodNutritionValues = numericValues;
    let nutrition: FoodNutritionInput;
    if (draft.basis === "per-serving") {
      const servingSize = parseOptionalNumber(draft.servingSizeG);
      if (!servingSize.ok || servingSize.value === null || servingSize.value <= 0) {
        setFormError("Anna annoksen paino grammoina. Painon tulee olla suurempi kuin nolla.");
        return;
      }
      nutrition = { basis: "per-serving", servingSizeG: servingSize.value, ...values };
    } else {
      nutrition = { basis: "per-100g", ...values };
    }

    setSaving(true);
    try {
      const result =
        editingFood === null
          ? await createFoodService(deps, { name: draft.name, nutrition })
          : await updateFoodService(deps, editingFood.id, { name: draft.name, nutrition });
      if (!result.ok) {
        setFormError(result.error.userMessage);
        return;
      }
      setFeedback(
        editingFood === null
          ? tTemplate("{{0}} lisättiin ruokakirjastoon.", [result.value.name])
          : `${result.value.name} tallennettiin.`,
      );
      resetForm();
      await refresh();
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch {
      setFormError(t("Ruokaa ei voitu tallentaa. Yritä uudelleen."));
    } finally {
      setSaving(false);
    }
  };

  const archiveFood = async (food: Food): Promise<void> => {
    setBusyFoodId(food.id);
    setFeedback("");
    try {
      const result = await deleteFoodService(deps, food.id);
      if (!result.ok) {
        setLoadError(result.error.userMessage);
        return;
      }
      setFeedback(`${food.name} poistettiin aktiivisesta listasta.`);
      await refresh();
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch {
      setLoadError(t("Ruokaa ei voitu poistaa. Yritä uudelleen."));
    } finally {
      setBusyFoodId(null);
    }
  };

  const restoreFood = async (food: Food): Promise<void> => {
    setBusyFoodId(food.id);
    setFeedback("");
    try {
      const result = await restoreFoodService(deps, food.id);
      if (!result.ok) {
        setLoadError(result.error.userMessage);
        return;
      }
      setFeedback(`${food.name} palautettiin ruokakirjastoon.`);
      await refresh();
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch {
      setLoadError(t("Ruokaa ei voitu palauttaa. Yritä uudelleen."));
    } finally {
      setBusyFoodId(null);
    }
  };

  const renderFoodRows = (rows: readonly Food[], archived: boolean): React.JSX.Element => (
    <ul data-ui="food-list">
      {rows.map((food) => (
        <FoodRow
          key={food.id}
          food={food}
          archived={archived}
          busy={busyFoodId === food.id}
          onEdit={startEditing}
          onDelete={(item) => void archiveFood(item)}
          onRestore={(item) => void restoreFood(item)}
        />
      ))}
    </ul>
  );

  return (
    <div data-ui="food-page">
      <Link to={{ pathname: "/nutrition", search: location.search }} data-ui="food-back-link">
        {t("Ravinto")}
      </Link>
      <Display>{t("Omat ruoat")}</Display>
      <p data-ui="food-page-intro">
        {t("Lisää ruoat omilla ravintoarvoillasi. Ulkoista ruokatietokantaa ei tarvita.")}
      </p>

      {feedback !== "" ? (
        <Alert tone="success" title={t("Valmis")}>
          {feedback}
        </Alert>
      ) : null}
      {loadError !== "" ? (
        <Alert
          tone="danger"
          title={t("Ruokakirjastoa ei voitu päivittää")}
          action={
            <Button type="button" variant="secondary" onClick={() => void refresh()}>
              {t("Yritä uudelleen")}
            </Button>
          }
        >
          {t(loadError)}
        </Alert>
      ) : null}

      <div data-ui="food-library-layout">
        <Card
          heading={editingFood === null ? t("Lisää oma ruoka") : `Muokkaa: ${editingFood.name}`}
          data-testid="food-editor"
        >
          <Meta>
            {t(
              "Kirjaa tunnetut arvot pakkauksesta tai omasta mittauksesta. Tyhjät arvot jäävät ilmoittamatta.",
            )}
          </Meta>
          <form data-testid="food-form" noValidate onSubmit={(event) => void submit(event)}>
            <Input
              id="food-name"
              label={t("Ruoan nimi")}
              value={draft.name}
              maxLength={200}
              required
              disabled={saving}
              onChange={(event) => {
                changeDraft("name", event.target.value);
              }}
            />
            <Select
              label={t("Arvot ilmoitettu")}
              value={draft.basis}
              options={tOptions(BASIS_OPTIONS)}
              disabled={saving}
              onChange={(event) => {
                changeDraft("basis", event.target.value as NutritionBasis);
              }}
            />
            {draft.basis === "per-serving" ? (
              <NumberInput
                label={t("Annoskoko (g)")}
                value={draft.servingSizeG}
                min={0.01}
                step="any"
                required
                disabled={saving}
                onChange={(event) => {
                  changeDraft("servingSizeG", event.target.value);
                }}
              />
            ) : null}
            <div data-ui="food-nutrient-grid">
              {NUTRIENT_FIELDS.map(({ key, label, unit }) => (
                <NumberInput
                  key={key}
                  label={tTemplate("{{0}} ({{1}})", [t(label), unit])}
                  value={draft[key]}
                  min={0}
                  step="any"
                  disabled={saving}
                  onChange={(event) => {
                    changeDraft(key, event.target.value);
                  }}
                />
              ))}
            </div>
            <Meta>
              {draft.basis === "per-serving"
                ? t("Tallennus muuntaa arvot per 100 g -muotoon ja säilyttää annoskoon.")
                : t("Arvot tallennetaan per 100 g. Kuitu on vapaaehtoinen.")}
            </Meta>
            {formError !== "" ? (
              <p data-ui="field-error" role="alert">
                {t(formError)}
              </p>
            ) : null}
            <div data-ui="food-form-actions">
              <Button type="submit" variant="primary" loading={saving}>
                {editingFood === null ? t("Lisää ruoka") : t("Tallenna muutokset")}
              </Button>
              {editingFood !== null ? (
                <Button type="button" variant="secondary" disabled={saving} onClick={resetForm}>
                  {t("Peruuta muokkaus")}
                </Button>
              ) : null}
            </div>
          </form>
        </Card>

        <Card heading={`Ruokakirjasto (${String(activeFoods.length)})`} data-testid="food-library">
          <Input
            label={t("Hae omista ruoista")}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {loading ? <Skeleton lines={4} label={t("Ladataan ruokakirjastoa…")} /> : null}
          {!loading && loadError === "" && activeFoods.length === 0 ? (
            <EmptyState
              title={
                query !== ""
                  ? t("Aktiivisia ruokia ei löytynyt")
                  : archivedFoods.length > 0
                    ? "Ei aktiivisia ruokia"
                    : t("Ei omia ruokia vielä")
              }
              hint={
                query !== ""
                  ? t("Kokeile toista hakusanaa. Poistetut vastaavat ruoat näkyvät alla.")
                  : archivedFoods.length > 0
                    ? "Voit palauttaa aiemmin poistetun ruoan listasta."
                    : t("Lisää ruoka ja sen tunnetut ravintoarvot.")
              }
              action={
                query === "" && archivedFoods.length === 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => document.getElementById("food-name")?.focus()}
                  >
                    {t("Lisää ensimmäinen ruoka")}
                  </Button>
                ) : undefined
              }
            />
          ) : null}
          {!loading && loadError === "" && activeFoods.length > 0
            ? renderFoodRows(activeFoods, false)
            : null}
          {!loading && loadError === "" && archivedFoods.length > 0 ? (
            <details data-ui="food-archived-list">
              <summary>
                {t("Poistetut ruoat (")}
                {String(archivedFoods.length)})
              </summary>
              {renderFoodRows(archivedFoods, true)}
            </details>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
