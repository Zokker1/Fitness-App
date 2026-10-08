// T225: päivän ravintopäiväkirja ryhmittelee ateriat meal slot -asetusten mukaan.
import { getIntlLocale, t, tTemplate } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card } from "@lifeos/ui";
import {
  createNutritionEntryService,
  ensurePreferences,
  listFoodsService,
  listNutritionEntriesService,
  systemClock,
} from "@lifeos/data";
import { DEFAULT_MACRO_TARGETS } from "@lifeos/domain";
import type { MacroTargets, MealSlotPreference, NutritionEntry } from "@lifeos/domain";
import { Link, useLocation } from "react-router";
import type { AppError } from "../../errors/appError.ts";
import { fromDataError, fromUnknown } from "../../errors/appError.ts";
import { useData } from "../../dataContext.tsx";
import { isPersistentStorage } from "../../storage/persistenceMode.ts";
import { readLocalMacroTargets } from "../../preferences/macro-targets-storage.ts";
import { readLocalMealSlots } from "../../preferences/meal-slots-storage.ts";
import "./nutrition-diary.css";

interface NutritionDiaryGroup {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly NutritionEntry[];
}

type NutrientKey = "calories" | "proteinG" | "carbsG" | "fatG" | "fiberG";

type MacroTargetKey = keyof MacroTargets;

interface NutrientAmount {
  readonly total: number;
  readonly missing: number;
}

interface NutrientSummary {
  readonly label: string;
  readonly value: string;
  readonly note: string | null;
}

interface MacroProgressItem {
  readonly key: MacroTargetKey;
  readonly label: string;
  readonly progressValue: number;
  readonly targetValue: number;
  readonly currentText: string;
  readonly targetText: string;
  readonly missing: number;
}

interface NutritionEntryCopyInput {
  readonly foodId: string;
  readonly amountG: number;
  readonly eatenAt: string;
}

const MACRO_PROGRESS_FIELDS = [
  { key: "caloriesKcal", nutrient: "calories", label: "Energia", unit: "kcal" },
  { key: "proteinG", nutrient: "proteinG", label: "Proteiini", unit: "g" },
  { key: "carbsG", nutrient: "carbsG", label: "Hiilihydraatit", unit: "g" },
  { key: "fatG", nutrient: "fatG", label: "Rasva", unit: "g" },
  { key: "fiberG", nutrient: "fiberG", label: "Kuitu", unit: "g" },
] as const satisfies readonly {
  readonly key: MacroTargetKey;
  readonly nutrient: NutrientKey;
  readonly label: string;
  readonly unit: string;
}[];

const numberFormat = {
  format: (value: number): string =>
    new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(value),
};
const calorieFormat = {
  format: (value: number): string =>
    new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 0 }).format(value),
};

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function localDayRange(dateKey: string): { readonly from: string; readonly to: string } | null {
  const date = parseLocalDateKey(dateKey);
  if (date === null) {
    return null;
  }
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
  return {
    from: start.toISOString(),
    to: new Date(end.getTime() - 1).toISOString(),
  };
}

function shiftDate(dateKey: string, offset: number): string {
  const date = parseLocalDateKey(dateKey);
  if (date === null) {
    return localDateKey(new Date());
  }
  return localDateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset, 12));
}

function copyTimeToDate(value: string, destinationDateKey: string): string | null {
  const sourceTime = new Date(value);
  const destinationDate = parseLocalDateKey(destinationDateKey);
  if (!Number.isFinite(sourceTime.getTime()) || destinationDate === null) {
    return null;
  }
  destinationDate.setHours(
    sourceTime.getHours(),
    sourceTime.getMinutes(),
    sourceTime.getSeconds(),
    sourceTime.getMilliseconds(),
  );
  return destinationDate.toISOString();
}

function formatDay(dateKey: string): string {
  const date = parseLocalDateKey(dateKey);
  if (date === null) {
    return dateKey;
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function nutrientAmount(entries: readonly NutritionEntry[], key: NutrientKey): NutrientAmount {
  const values = entries
    .map((entry) => entry[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    missing: entries.length - values.length,
  };
}

function formatNutrientValue(value: number, key: NutrientKey, missing: number): string {
  const formatted = key === "calories" ? calorieFormat.format(value) : numberFormat.format(value);
  return `${missing > 0 ? "≥ " : ""}${formatted}`;
}

function nutrientSummary(
  entries: readonly NutritionEntry[],
  key: NutrientKey,
  label: string,
  unit: string,
): NutrientSummary {
  const amount = nutrientAmount(entries, key);
  const formatted = formatNutrientValue(amount.total, key, amount.missing);
  return {
    label,
    value: `${formatted} ${unit}`,
    note: amount.missing > 0 ? `${String(amount.missing)} kirjauksesta puuttuu arvo` : null,
  };
}

function macroProgressItems(
  entries: readonly NutritionEntry[],
  targets: MacroTargets,
): readonly MacroProgressItem[] {
  return MACRO_PROGRESS_FIELDS.flatMap((field) => {
    const target = targets[field.key];
    if (target === null) {
      return [];
    }
    const amount = nutrientAmount(entries, field.nutrient);
    const currentText = `${formatNutrientValue(amount.total, field.nutrient, amount.missing)} ${field.unit}`;
    const targetText = `${field.nutrient === "calories" ? calorieFormat.format(target) : numberFormat.format(target)} ${field.unit}`;
    return [
      {
        key: field.key,
        label: field.label,
        progressValue: target === 0 ? 0 : Math.min(amount.total, target),
        targetValue: target,
        currentText,
        targetText,
        missing: amount.missing,
      },
    ];
  });
}

function mealGroups(
  entries: readonly NutritionEntry[],
  mealSlots: readonly MealSlotPreference[],
): readonly NutritionDiaryGroup[] {
  const grouped = new Map<string, NutritionEntry[]>();
  for (const entry of entries) {
    const key = entry.mealSlotId ?? "";
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  const knownIds = new Set(mealSlots.map((slot) => slot.id));
  const groups: NutritionDiaryGroup[] = [...mealSlots]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id))
    .flatMap((slot) => {
      const slotEntries = grouped.get(slot.id);
      return slotEntries === undefined || slotEntries.length === 0
        ? []
        : [{ id: slot.id, label: slot.label, entries: slotEntries }];
    });
  const unassigned = entries.filter(
    (entry) =>
      entry.mealSlotId === null ||
      entry.mealSlotId === undefined ||
      !knownIds.has(entry.mealSlotId),
  );
  if (unassigned.length > 0) {
    groups.push({ id: "unassigned", label: "Muu tai aiempi aterialuokka", entries: unassigned });
  }
  return groups.map((group) => ({
    ...group,
    entries: [...group.entries].sort(
      (left, right) => left.eatenAt.localeCompare(right.eatenAt) || left.id.localeCompare(right.id),
    ),
  }));
}

export function NutritionDiary(): React.JSX.Element {
  const { foods, nutritionEntries, xpTransactions } = useData();
  const location = useLocation();
  const persistent = isPersistentStorage(location.search);
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [entries, setEntries] = useState<readonly NutritionEntry[]>([]);
  const [previousEntries, setPreviousEntries] = useState<readonly NutritionEntry[]>([]);
  const [mealSlots, setMealSlots] = useState<readonly MealSlotPreference[]>([]);
  const [macroTargets, setMacroTargets] = useState<MacroTargets>(() => ({
    ...DEFAULT_MACRO_TARGETS,
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);
  const [copyingMealId, setCopyingMealId] = useState<string | null>(null);
  const [blockedCopyMealIds, setBlockedCopyMealIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [copyFeedback, setCopyFeedback] = useState<{
    readonly kind: "status" | "error";
    readonly message: string;
  } | null>(null);
  const requestSequence = useRef(0);

  const loadDiary = useCallback(async (): Promise<void> => {
    const requestId = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const range = localDayRange(selectedDate);
      const previousRange = localDayRange(shiftDate(selectedDate, -1));
      if (range === null || previousRange === null) {
        if (requestSequence.current !== requestId) {
          return;
        }
        setError(fromUnknown(new Error("Valitse kelvollinen päivä.")));
        return;
      }
      let slots: readonly MealSlotPreference[];
      let targets: MacroTargets;
      if (persistent) {
        const preferences = await ensurePreferences({
          clock: systemClock(),
          ids: { next: () => crypto.randomUUID() },
        });
        if (!preferences.ok) {
          if (requestSequence.current === requestId) {
            setError(fromDataError(preferences.error));
          }
          return;
        }
        slots = preferences.value.mealSlots;
        targets = preferences.value.macroTargets;
      } else {
        slots = readLocalMealSlots();
        targets = readLocalMacroTargets();
      }
      const listDeps = {
        clock: systemClock(),
        nutritionEntries,
        foods,
        mealSlots: [],
      };
      const [listed, previousListed] = await Promise.all([
        listNutritionEntriesService(listDeps, range),
        listNutritionEntriesService(listDeps, previousRange),
      ]);
      if (requestSequence.current !== requestId) {
        return;
      }
      if (!listed.ok) {
        setError(fromDataError(listed.error));
        return;
      }
      if (!previousListed.ok) {
        setError(fromDataError(previousListed.error));
        return;
      }
      setEntries(listed.value);
      setPreviousEntries(previousListed.value);
      setMealSlots(slots);
      setMacroTargets(targets);
    } catch (error_: unknown) {
      if (requestSequence.current === requestId) {
        setError(fromUnknown(error_));
      }
    } finally {
      if (requestSequence.current === requestId) {
        setLoading(false);
      }
    }
  }, [foods, nutritionEntries, persistent, selectedDate]);

  useEffect(() => {
    void loadDiary();
    return () => {
      requestSequence.current += 1;
    };
  }, [loadDiary]);

  useEffect(() => {
    setBlockedCopyMealIds(new Set());
    setCopyFeedback(null);
  }, [selectedDate]);

  useEffect(() => {
    const handleDataChanged = (): void => {
      void loadDiary();
    };
    window.addEventListener("lifeos:data-changed", handleDataChanged);
    return () => {
      window.removeEventListener("lifeos:data-changed", handleDataChanged);
    };
  }, [loadDiary]);

  const groups = useMemo(() => mealGroups(entries, mealSlots), [entries, mealSlots]);
  const previousGroups = useMemo(
    () => mealGroups(previousEntries, mealSlots),
    [mealSlots, previousEntries],
  );
  const copyPreviousMeal = useCallback(
    async (group: NutritionDiaryGroup): Promise<void> => {
      const destinationDateKey = selectedDate;
      const activeMealSlot = mealSlots.find((slot) => slot.id === group.id && !slot.archived);
      if (activeMealSlot === undefined) {
        setCopyFeedback({
          kind: "error",
          message: "Aterialuokka ei ole enää käytössä, joten ateriaa ei voi kopioida.",
        });
        return;
      }

      const copyInputs = group.entries.map((entry): NutritionEntryCopyInput | null => {
        const eatenAt = copyTimeToDate(entry.eatenAt, destinationDateKey);
        if (
          typeof entry.foodId !== "string" ||
          typeof entry.amountG !== "number" ||
          !Number.isFinite(entry.amountG) ||
          entry.amountG <= 0 ||
          eatenAt === null
        ) {
          return null;
        }
        return { foodId: entry.foodId, amountG: entry.amountG, eatenAt };
      });
      if (copyInputs.some((item) => item === null)) {
        setCopyFeedback({
          kind: "error",
          message: "Aterian ruoka, annos tai kellonaika ei ole kopioitavissa.",
        });
        return;
      }
      const preparedInputs = copyInputs.filter(
        (item): item is NutritionEntryCopyInput => item !== null,
      );

      setCopyingMealId(group.id);
      setCopyFeedback(null);
      try {
        const foodList = await listFoodsService({ clock: systemClock(), foods });
        if (!foodList.ok) {
          setCopyFeedback({ kind: "error", message: foodList.error.userMessage });
          return;
        }
        const availableFoodIds = new Set(foodList.value.map((food) => food.id));
        if (preparedInputs.some((item) => !availableFoodIds.has(item.foodId))) {
          setCopyFeedback({
            kind: "error",
            message: "Aterian ruoka tai annos ei ole enää käytettävissä. Ateriaa ei kopioitu.",
          });
          return;
        }

        let copiedCount = 0;
        for (const item of preparedInputs) {
          const result = await createNutritionEntryService(
            {
              clock: systemClock(),
              nutritionEntries,
              foods,
              mealSlots,
              xpTransactions,
              timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
            },
            {
              foodId: item.foodId,
              amountG: item.amountG,
              eatenAt: item.eatenAt,
              mealSlotId: activeMealSlot.id,
            },
          );
          if (!result.ok) {
            if (copiedCount > 0) {
              setBlockedCopyMealIds((current) => new Set(current).add(group.id));
              setCopyFeedback({
                kind: "error",
                message: tTemplate(
                  "{{0}}/{{1}} kirjauksesta kopioitiin. Tallennus keskeytyi: {{2}} Älä kopioi ateriaa uudelleen, jotta jo tallennetut kirjaukset eivät kahdennu.",
                  [String(copiedCount), String(group.entries.length), result.error.userMessage],
                ),
              });
              window.dispatchEvent(new Event("lifeos:data-changed"));
            } else {
              setCopyFeedback({ kind: "error", message: result.error.userMessage });
            }
            return;
          }
          copiedCount += 1;
        }

        setCopyFeedback({
          kind: "status",
          message: tTemplate("{{0}}: {{1}} {{2}} kopioitiin päivälle {{3}}.", [
            group.label,
            String(copiedCount),
            copiedCount === 1 ? "kirjaus" : "kirjausta",
            formatDay(destinationDateKey),
          ]),
        });
        window.dispatchEvent(new Event("lifeos:data-changed"));
      } catch (error_: unknown) {
        setCopyFeedback({
          kind: "error",
          message: fromUnknown(error_).body,
        });
      } finally {
        setCopyingMealId(null);
      }
    },
    [foods, mealSlots, nutritionEntries, selectedDate, xpTransactions],
  );
  const today = localDateKey(new Date());
  const dailyTotals = useMemo(
    () => [
      nutrientSummary(entries, "calories", "Energia", "kcal"),
      nutrientSummary(entries, "proteinG", "Proteiini", "g"),
      nutrientSummary(entries, "carbsG", "Hiilihydraatit", "g"),
      nutrientSummary(entries, "fatG", "Rasva", "g"),
      ...(macroTargets.fiberG !== null ||
      entries.some((entry) => entry.fiberG !== null && entry.fiberG !== undefined)
        ? [nutrientSummary(entries, "fiberG", "Kuitu", "g")]
        : []),
    ],
    [entries, macroTargets.fiberG],
  );
  const macroProgress = useMemo(
    () => macroProgressItems(entries, macroTargets),
    [entries, macroTargets],
  );

  return (
    <Card heading={t("Päivän ravinto")} data-testid="nutrition-diary-card">
      <div data-ui="nutrition-diary-controls">
        <Button
          variant="secondary"
          type="button"
          aria-label={t("Edellinen päivä")}
          disabled={copyingMealId !== null}
          onClick={() => {
            setSelectedDate((current) => shiftDate(current, -1));
          }}
        >
          {t("Edellinen")}
        </Button>
        <label data-ui="nutrition-diary-date">
          <span>{t("Valittu päivä")}</span>
          <input
            type="date"
            value={selectedDate}
            disabled={copyingMealId !== null}
            onChange={(event) => {
              setSelectedDate(event.target.value);
            }}
          />
        </label>
        <Button
          variant="secondary"
          type="button"
          aria-label={t("Seuraava päivä")}
          disabled={copyingMealId !== null}
          onClick={() => {
            setSelectedDate((current) => shiftDate(current, 1));
          }}
        >
          {t("Seuraava")}
        </Button>
        <Button
          variant="ghost"
          type="button"
          disabled={selectedDate === today || copyingMealId !== null}
          onClick={() => {
            setSelectedDate(today);
          }}
        >
          {t("Tänään")}
        </Button>
        <p data-ui="nutrition-diary-readable-date">{formatDay(selectedDate)}</p>
      </div>

      {loading ? <p role="status">{t("Ladataan päivän kirjauksia…")}</p> : null}
      {!loading && error !== null ? (
        <p data-ui="nutrition-diary-error" role="alert">
          {error.body}
        </p>
      ) : null}
      {!loading && error === null ? (
        <>
          <dl data-ui="nutrition-diary-totals" aria-label={t("Päivän ravintoarvot")}>
            {dailyTotals.map((total) => (
              <div key={total.label}>
                <dt>{total.label}</dt>
                <dd>
                  {entries.length === 0
                    ? total.label === "Energia"
                      ? t("0 kcal")
                      : t("0 g")
                    : total.value}
                </dd>
                {total.note !== null ? <small>{total.note}</small> : null}
              </div>
            ))}
          </dl>

          <section
            data-ui="nutrition-target-progress"
            aria-labelledby="nutrition-target-progress-heading"
          >
            <h3 id="nutrition-target-progress-heading">{t("Päivän tavoitteet")}</h3>
            {macroProgress.length === 0 ? (
              <p data-ui="nutrition-target-empty">
                {t("Päivittäisiä tavoitteita ei ole asetettu.")}{" "}
                <Link to={{ pathname: "/settings", search: location.search }}>
                  {t("Aseta tavoitteet")}
                </Link>
              </p>
            ) : (
              <ul aria-label={t("Päivän eteneminen ravintotavoitteisiin")}>
                {macroProgress.map((item) => (
                  <li key={item.key}>
                    <div data-ui="nutrition-target-values">
                      <span>{item.label}</span>
                      <span>
                        {item.currentText} / {item.targetText}
                      </span>
                    </div>
                    {item.targetValue > 0 ? (
                      <progress
                        data-ui="progress-bar"
                        value={item.progressValue}
                        max={item.targetValue}
                        aria-label={tTemplate("{{0}}: {{1}} / {{2}}", [
                          t(item.label),
                          item.currentText,
                          item.targetText,
                        ])}
                        aria-valuetext={`${item.currentText} / ${item.targetText}`}
                      >
                        {`${item.currentText} / ${item.targetText}`}
                      </progress>
                    ) : (
                      <p data-ui="nutrition-target-zero-note">
                        {t("Tavoite on 0; etenemispalkkia ei näytetä.")}
                      </p>
                    )}
                    {item.missing > 0 ? (
                      <small>
                        {String(item.missing)} {t(" ruokakirjauksesta puuttuu arvo.")}
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details data-ui="nutrition-copy-previous">
            <summary>
              {t("Edellisen päivän aterian kopiointi (")}
              {formatDay(shiftDate(selectedDate, -1))})
            </summary>
            <p data-ui="nutrition-copy-hint">
              {t(
                "Määrät ja kellonajat kopioidaan valittuun päivään. Ravintoarvot lasketaan ruokakirjaston nykyisistä tiedoista.",
              )}
            </p>
            {previousGroups.length === 0 ? (
              <p data-ui="nutrition-copy-empty">
                {t("Edelliseltä päivältä ei löytynyt aterioita.")}
              </p>
            ) : (
              <div data-ui="nutrition-copy-meals">
                {previousGroups.map((group) => {
                  const hasActiveMealSlot = mealSlots.some(
                    (slot) => slot.id === group.id && !slot.archived,
                  );
                  const blocked = blockedCopyMealIds.has(group.id);
                  return (
                    <section key={group.id} data-ui="nutrition-copy-meal">
                      <div data-ui="nutrition-copy-meal-heading">
                        <h4>{group.label}</h4>
                        <span>
                          {group.entries.length}{" "}
                          {group.entries.length === 1 ? t("kirjaus") : t("kirjausta")}
                        </span>
                      </div>
                      <ul
                        aria-label={tTemplate("{{0}}: edellisen päivän kirjaukset", [group.label])}
                      >
                        {group.entries.map((entry) => (
                          <li key={entry.id}>
                            <span>{entry.label}</span>
                            <span>
                              {entry.amountG === null || entry.amountG === undefined
                                ? t("Määrä ei tiedossa")
                                : `${numberFormat.format(entry.amountG)} g`}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        variant="secondary"
                        type="button"
                        disabled={copyingMealId !== null || blocked || !hasActiveMealSlot}
                        onClick={() => void copyPreviousMeal(group)}
                      >
                        {copyingMealId === group.id
                          ? t("Kopioidaan…")
                          : blocked
                            ? t("Kopiointi keskeytyi")
                            : t("Kopioi tähän päivään")}
                      </Button>
                      {!hasActiveMealSlot ? (
                        <small>
                          {t("Aterialuokka ei ole enää käytössä, joten sitä ei voi kopioida.")}
                        </small>
                      ) : null}
                    </section>
                  );
                })}
              </div>
            )}
            {copyFeedback !== null ? (
              <p
                data-ui="nutrition-copy-feedback"
                role={copyFeedback.kind === "status" ? "status" : "alert"}
              >
                {copyFeedback.message}
              </p>
            ) : null}
          </details>

          {groups.length === 0 ? (
            <p data-ui="nutrition-diary-empty">{t("Ei ruokakirjauksia tälle päivälle.")}</p>
          ) : (
            <div data-ui="nutrition-diary-groups">
              {groups.map((group) => (
                <section key={group.id} data-ui="nutrition-diary-meal">
                  <h3>{group.label}</h3>
                  <ul>
                    {group.entries.map((entry) => (
                      <li key={entry.id}>
                        <time dateTime={entry.eatenAt}>{formatTime(entry.eatenAt)}</time>
                        <span data-ui="nutrition-diary-entry-name">{entry.label}</span>
                        <span data-ui="nutrition-diary-entry-amount">
                          {entry.amountG === null || entry.amountG === undefined
                            ? t("Määrä ei tiedossa")
                            : `${numberFormat.format(entry.amountG)} g`}
                        </span>
                        <span data-ui="nutrition-diary-entry-calories">
                          {entry.calories === null
                            ? t("Energia ei tiedossa")
                            : `${calorieFormat.format(entry.calories)} kcal`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
