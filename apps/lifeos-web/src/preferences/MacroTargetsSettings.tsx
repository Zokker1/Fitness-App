// T226: käyttäjä määrittää itse seurattavat päivittäiset ravintotavoitteet.
import { t } from "../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, NumberInput } from "@lifeos/ui";
import { DEFAULT_MACRO_TARGETS, MACRO_TARGET_MAXIMUMS, validateMacroTargets } from "@lifeos/domain";
import type { MacroTargets } from "@lifeos/domain";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import { ErrorCard } from "../errors/ErrorCard.tsx";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";
import { readLocalMacroTargets, writeLocalMacroTargets } from "./macro-targets-storage.ts";
import { isPersistentStorage } from "../storage/persistenceMode.ts";
import "./macro-targets-settings.css";

interface MacroTargetsDraft {
  readonly caloriesKcal: string;
  readonly proteinG: string;
  readonly carbsG: string;
  readonly fatG: string;
  readonly fiberG: string;
}

const FIELDS = [
  { key: "caloriesKcal", label: "Energia (kcal)" },
  { key: "proteinG", label: "Proteiini (g)" },
  { key: "carbsG", label: "Hiilihydraatit (g)" },
  { key: "fatG", label: "Rasva (g)" },
  { key: "fiberG", label: "Kuitu (g)" },
] as const satisfies readonly { readonly key: keyof MacroTargets; readonly label: string }[];

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return { clock: systemClock(), ids: { next: () => crypto.randomUUID() } };
}

function valueToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function targetsToDraft(targets: MacroTargets): MacroTargetsDraft {
  return {
    caloriesKcal: valueToInput(targets.caloriesKcal),
    proteinG: valueToInput(targets.proteinG),
    carbsG: valueToInput(targets.carbsG),
    fatG: valueToInput(targets.fatG),
    fiberG: valueToInput(targets.fiberG),
  };
}

function inputToValue(value: string): number | null {
  return value.trim().length === 0 ? null : Number(value);
}

function draftToTargets(draft: MacroTargetsDraft): MacroTargets {
  return {
    caloriesKcal: inputToValue(draft.caloriesKcal),
    proteinG: inputToValue(draft.proteinG),
    carbsG: inputToValue(draft.carbsG),
    fatG: inputToValue(draft.fatG),
    fiberG: inputToValue(draft.fiberG),
  };
}

export function MacroTargetsSettings(): React.JSX.Element {
  const persistent = typeof window !== "undefined" && isPersistentStorage(window.location.search);
  const [targets, setTargets] = useState<MacroTargets | null>(null);
  const [draft, setDraft] = useState<MacroTargetsDraft>(() =>
    targetsToDraft(DEFAULT_MACRO_TARGETS),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const dirty = useMemo(
    () => targets !== null && JSON.stringify(targetsToDraft(targets)) !== JSON.stringify(draft),
    [draft, targets],
  );

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      let loaded: MacroTargets;
      if (persistent) {
        const result = await ensurePreferences(preferenceDeps());
        if (!result.ok) {
          setError(fromDataError(result.error));
          return;
        }
        loaded = result.value.macroTargets;
      } else {
        loaded = readLocalMacroTargets();
      }
      setTargets(loaded);
      setDraft(targetsToDraft(loaded));
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
    const validated = validateMacroTargets(draftToTargets(draft));
    if (!validated.ok) {
      setError(fromUnknown(new Error(validated.error.message)));
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      if (persistent) {
        const result = await updatePreferences(preferenceDeps(), {
          macroTargets: validated.value,
        });
        if (!result.ok) {
          setError(fromDataError(result.error));
          return;
        }
        setTargets(result.value.macroTargets);
        setDraft(targetsToDraft(result.value.macroTargets));
      } else {
        writeLocalMacroTargets(validated.value);
        setTargets(validated.value);
        setDraft(targetsToDraft(validated.value));
      }
      window.dispatchEvent(new Event("lifeos:data-changed"));
      setSaved(true);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setSaving(false);
    }
  }, [draft, persistent]);

  return (
    <Card heading={t("Ravintotavoitteet")}>
      <div data-ui="macro-targets-settings">
        <p data-ui="macro-targets-hint">
          {t(
            "Aseta vain arvot, joita haluat seurata. Tyhjä kenttä tarkoittaa, ettei kyseistä päivätavoitetta ole asetettu.",
          )}
        </p>
        {loading ? <p role="status">{t("Ladataan ravintotavoitteita…")}</p> : null}
        {!loading && targets !== null ? (
          <form
            data-testid="macro-targets-form"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div data-ui="macro-targets-fields">
              {FIELDS.map(({ key, label }) => (
                <NumberInput
                  key={key}
                  label={label}
                  min={0}
                  max={MACRO_TARGET_MAXIMUMS[key]}
                  step="any"
                  value={draft[key]}
                  disabled={saving}
                  onChange={(event) => {
                    setDraft((previous) => ({ ...previous, [key]: event.target.value }));
                    setSaved(false);
                    setError(null);
                  }}
                />
              ))}
            </div>
            <div data-ui="macro-targets-actions">
              <Button
                variant="ghost"
                type="button"
                disabled={saving || !dirty}
                onClick={() => {
                  setDraft(targetsToDraft(targets));
                  setSaved(false);
                  setError(null);
                }}
              >
                {t("Peru muutokset")}
              </Button>
              <Button variant="primary" type="submit" loading={saving} disabled={!dirty}>
                {t("Tallenna tavoitteet")}
              </Button>
            </div>
            {saved ? <p role="status">{t("Ravintotavoitteet tallennettiin.")}</p> : null}
          </form>
        ) : null}
        {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
      </div>
    </Card>
  );
}
