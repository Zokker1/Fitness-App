// T223: §11:n aterialuokat ovat oletuksia, joita käyttäjä voi muokata.
import { t, tTemplate } from "../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card } from "@lifeos/ui";
import { MEAL_SLOT_MAX_COUNT, MEAL_SLOT_NAME_MAX_LENGTH, validateMealSlots } from "@lifeos/domain";
import type { MealSlotPreference } from "@lifeos/domain";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import { ErrorCard } from "../errors/ErrorCard.tsx";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";
import { readLocalMealSlots, writeLocalMealSlots } from "./meal-slots-storage.ts";
import { isPersistentStorage } from "../storage/persistenceMode.ts";
import "./meal-slots-settings.css";

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return { clock: systemClock(), ids: { next: () => crypto.randomUUID() } };
}

function reorderSlots(
  slots: readonly MealSlotPreference[],
  index: number,
  direction: -1 | 1,
): readonly MealSlotPreference[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= slots.length) {
    return slots;
  }
  const next = [...slots];
  const currentSlot = next[index];
  const targetSlot = next[nextIndex];
  if (currentSlot === undefined || targetSlot === undefined) {
    return slots;
  }
  next[index] = { ...targetSlot, sortOrder: index };
  next[nextIndex] = { ...currentSlot, sortOrder: nextIndex };
  return next;
}

export function MealSlotsSettings(): React.JSX.Element {
  const persistent = typeof window !== "undefined" && isPersistentStorage(window.location.search);
  const [slots, setSlots] = useState<readonly MealSlotPreference[] | null>(null);
  const [draft, setDraft] = useState<readonly MealSlotPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(
    () => slots !== null && JSON.stringify(slots) !== JSON.stringify(draft),
    [slots, draft],
  );

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      let loaded: readonly MealSlotPreference[];
      if (persistent) {
        const result = await ensurePreferences(preferenceDeps());
        if (!result.ok) {
          setError(fromDataError(result.error));
          return;
        }
        loaded = result.value.mealSlots;
      } else {
        loaded = readLocalMealSlots();
      }
      setSlots(loaded);
      setDraft(loaded);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [persistent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(async (): Promise<void> => {
    const validated = validateMealSlots(draft);
    if (!validated.ok) {
      setError(fromUnknown(new Error(validated.error.message)));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (persistent) {
        const result = await updatePreferences(preferenceDeps(), { mealSlots: validated.value });
        if (!result.ok) {
          setError(fromDataError(result.error));
          return;
        }
        setSlots(result.value.mealSlots);
        setDraft(result.value.mealSlots);
      } else {
        writeLocalMealSlots(validated.value);
        setSlots(validated.value);
        setDraft(validated.value);
      }
      setSaved(true);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setSaving(false);
    }
  }, [draft, persistent]);

  const activeCount = draft.filter((slot) => !slot.archived).length;

  return (
    <Card heading={t("Aterialuokat")}>
      <div data-ui="meal-slots-settings">
        <p data-ui="meal-slots-hint">
          {t(
            "Aamiainen, lounas, päivällinen ja välipala ovat oletuksia. Voit muuttaa nimiä ja järjestystä, lisätä luokkia tai piilottaa tarpeettomat. Piilotetut luokat säilyvät aiempien kirjausten tunnisteina.",
          )}
        </p>
        {loading ? <p role="status">{t("Ladataan aterialuokkia…")}</p> : null}
        {!loading && slots !== null ? (
          <form
            data-testid="meal-slots-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <ol data-ui="meal-slots-list">
              {draft.map((slot, index) => (
                <li key={slot.id} data-archived={slot.archived ? "true" : "false"}>
                  <label>
                    <span>{slot.archived ? t("Piilotettu") : t("Aterialuokan nimi")}</span>
                    <input
                      type="text"
                      value={slot.label}
                      maxLength={MEAL_SLOT_NAME_MAX_LENGTH}
                      required
                      disabled={saving}
                      aria-label={tTemplate("{{0}} nimi", [slot.label || t("Uusi aterialuokka")])}
                      onChange={(event) => {
                        setDraft((previous) =>
                          previous.map((item) =>
                            item.id === slot.id ? { ...item, label: event.target.value } : item,
                          ),
                        );
                        setSaved(false);
                        setError(null);
                      }}
                    />
                  </label>
                  <div data-ui="meal-slot-actions">
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={saving || index === 0}
                      aria-label={tTemplate("Siirrä {{0}} ylemmäs", [slot.label || "aterialuokka"])}
                      onClick={() => {
                        setDraft((previous) => reorderSlots(previous, index, -1));
                        setSaved(false);
                      }}
                    >
                      {t("Ylös")}
                    </Button>
                    <Button
                      variant="ghost"
                      type="button"
                      disabled={saving || index === draft.length - 1}
                      aria-label={tTemplate("Siirrä {{0}} alemmas", [slot.label || "aterialuokka"])}
                      onClick={() => {
                        setDraft((previous) => reorderSlots(previous, index, 1));
                        setSaved(false);
                      }}
                    >
                      {t("Alas")}
                    </Button>
                    <Button
                      variant="secondary"
                      type="button"
                      disabled={saving || (!slot.archived && activeCount <= 1)}
                      aria-label={
                        slot.archived
                          ? tTemplate("Näytä {{0}}", [slot.label])
                          : tTemplate("Piilota {{0}}", [slot.label])
                      }
                      onClick={() => {
                        setDraft((previous) =>
                          previous.map((item) =>
                            item.id === slot.id ? { ...item, archived: !item.archived } : item,
                          ),
                        );
                        setSaved(false);
                      }}
                    >
                      {slot.archived ? t("Näytä") : t("Piilota")}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
            <div data-ui="meal-slots-form-actions">
              <Button
                variant="secondary"
                type="button"
                disabled={saving || draft.length >= MEAL_SLOT_MAX_COUNT}
                onClick={() => {
                  const id = `custom-${crypto.randomUUID()}`;
                  setDraft((previous) => [
                    ...previous,
                    { id, label: "", sortOrder: previous.length, archived: false },
                  ]);
                  setSaved(false);
                }}
              >
                {t("Lisää luokka")}
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={saving || !dirty}
                onClick={() => {
                  setDraft(slots);
                  setError(null);
                  setSaved(false);
                }}
              >
                {t("Peru muutokset")}
              </Button>
              <Button variant="primary" type="submit" loading={saving} disabled={!dirty}>
                {t("Tallenna luokat")}
              </Button>
            </div>
            {saved ? <p role="status">{t("Aterialuokat tallennettiin.")}</p> : null}
          </form>
        ) : null}
        {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
      </div>
    </Card>
  );
}
