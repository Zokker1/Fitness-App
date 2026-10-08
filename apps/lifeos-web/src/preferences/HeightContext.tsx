// T205: käyttäjän ilmoittama pituus BMI-laskennan lähtötietona.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import { validateHeightCm } from "@lifeos/domain";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";

interface HeightContextValue {
  readonly heightCm: number | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: AppError | null;
  readonly reload: () => Promise<void>;
  readonly setHeightCm: (heightCm: number | null) => Promise<boolean>;
}

const HEIGHT_STORAGE_KEY = "lifeos-height-cm";
const standaloneValue: HeightContextValue = {
  heightCm: null,
  loading: false,
  saving: false,
  error: null,
  reload: () => Promise.resolve(),
  setHeightCm: () => Promise.resolve(true),
};
const HeightContext = createContext<HeightContextValue>(standaloneValue);

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return { clock: systemClock(), ids: { next: () => crypto.randomUUID() } };
}

export function HeightProvider({
  children,
  persistent,
}: {
  readonly children: ReactNode;
  readonly persistent: boolean;
}): React.JSX.Element {
  const [heightCm, setHeightState] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (!persistent) {
        const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
        if (raw === null) {
          setHeightState(null);
        } else {
          const validated = validateHeightCm(Number(raw));
          if (!validated.ok) {
            setError(fromUnknown(new Error("Tallennettua pituutta ei voitu lukea.")));
          } else {
            setHeightState(validated.value);
          }
        }
        return;
      }
      const result = await ensurePreferences(preferenceDeps());
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setHeightState(result.value.heightCm);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [persistent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setHeightCm = useCallback(
    async (nextHeight: number | null): Promise<boolean> => {
      const validated = validateHeightCm(nextHeight);
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
              window.localStorage.removeItem(HEIGHT_STORAGE_KEY);
            } else {
              window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(validated.value));
            }
          } catch {
            // Muistivarastossa näkymän tila toimii, vaikka storage estettäisiin.
          }
          setHeightState(validated.value);
          return true;
        }
        const result = await updatePreferences(preferenceDeps(), { heightCm: validated.value });
        if (!result.ok) {
          setError(fromDataError(result.error));
          return false;
        }
        setHeightState(result.value.heightCm);
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

  const value = useMemo<HeightContextValue>(
    () => ({ heightCm, loading, saving, error, reload, setHeightCm }),
    [heightCm, loading, saving, error, reload, setHeightCm],
  );
  return <HeightContext.Provider value={value}>{children}</HeightContext.Provider>;
}

export function useHeight(): HeightContextValue {
  return useContext(HeightContext);
}
