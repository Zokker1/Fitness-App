// T204: painotavoite on UserPreferences-asetus pysyvässä tilassa ja selaimen
// paikallinen asetus muistivaraston käytössä.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import type { WeightTarget } from "@lifeos/domain";
import { validateWeightTarget } from "@lifeos/domain";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";

interface WeightTargetContextValue {
  readonly target: WeightTarget | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: AppError | null;
  readonly reload: () => Promise<void>;
  readonly setTarget: (target: WeightTarget | null) => Promise<boolean>;
}

const TARGET_STORAGE_KEY = "lifeos-weight-target";
const standaloneValue: WeightTargetContextValue = {
  target: null,
  loading: false,
  saving: false,
  error: null,
  reload: () => Promise.resolve(),
  setTarget: () => Promise.resolve(true),
};
const WeightTargetContext = createContext<WeightTargetContextValue>(standaloneValue);

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return { clock: systemClock(), ids: { next: () => crypto.randomUUID() } };
}

export function WeightTargetProvider({
  children,
  persistent,
}: {
  readonly children: ReactNode;
  readonly persistent: boolean;
}): React.JSX.Element {
  const [target, setTargetState] = useState<WeightTarget | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (!persistent) {
        const raw = window.localStorage.getItem(TARGET_STORAGE_KEY);
        if (raw === null) {
          setTargetState(null);
        } else {
          const parsed: unknown = JSON.parse(raw);
          const validated = validateWeightTarget(parsed);
          if (!validated.ok) {
            setError(fromUnknown(new Error("Tallennettua tavoitepainoa ei voitu lukea.")));
          } else {
            setTargetState(validated.value);
          }
        }
        return;
      }
      const result = await ensurePreferences(preferenceDeps());
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setTargetState(result.value.weightTarget);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [persistent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setTarget = useCallback(
    async (nextTarget: WeightTarget | null): Promise<boolean> => {
      const validated = validateWeightTarget(nextTarget);
      if (!validated.ok) {
        setError(fromUnknown(new Error(validated.error.message)));
        return false;
      }
      setSaving(true);
      setError(null);
      try {
        if (!persistent) {
          try {
            if (validated.value === null) {
              window.localStorage.removeItem(TARGET_STORAGE_KEY);
            } else {
              window.localStorage.setItem(TARGET_STORAGE_KEY, JSON.stringify(validated.value));
            }
          } catch {
            // Muistivarastossa näkymän tila toimii silti, vaikka storage estettäisiin.
          }
          setTargetState(validated.value);
          return true;
        }
        const result = await updatePreferences(preferenceDeps(), { weightTarget: validated.value });
        if (!result.ok) {
          setError(fromDataError(result.error));
          return false;
        }
        setTargetState(result.value.weightTarget);
        return true;
      } catch (error_: unknown) {
        setError(fromUnknown(error_));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [persistent],
  );

  const value = useMemo<WeightTargetContextValue>(
    () => ({ target, loading, saving, error, reload, setTarget }),
    [target, loading, saving, error, reload, setTarget],
  );
  return <WeightTargetContext.Provider value={value}>{children}</WeightTargetContext.Provider>;
}

export function useWeightTarget(): WeightTargetContextValue {
  return useContext(WeightTargetContext);
}
