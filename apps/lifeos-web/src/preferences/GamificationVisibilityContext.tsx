// T195: käyttäjän gamification-näkyvyysasetus (§9, §30, §51).
// Asetus tallentuu data-kerroksen UserPreferences-riville; sen piilottaminen
// vaikuttaa vain esitykseen, ei XP:n tai palkintojen kirjaamiseen.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";

interface GamificationVisibilityValue {
  readonly visible: boolean | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: AppError | null;
  readonly reload: () => Promise<void>;
  readonly setVisible: (visible: boolean) => Promise<boolean>;
}

// Oletus säilyttää komponenttien erillisen esikatselun toimivana; varsinainen
// sovellus käärii Appin aina alla olevalla providerilla.
const standaloneValue: GamificationVisibilityValue = {
  visible: true,
  loading: false,
  saving: false,
  error: null,
  reload: () => Promise.resolve(),
  setVisible: () => Promise.resolve(true),
};
const GamificationVisibilityContext = createContext<GamificationVisibilityValue>(standaloneValue);
const LOCAL_VISIBILITY_KEY = "lifeos-gamification-visible";

function readLocalVisibility(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_VISIBILITY_KEY) !== "false";
  } catch {
    return true;
  }
}

function writeLocalVisibility(visible: boolean): void {
  window.localStorage.setItem(LOCAL_VISIBILITY_KEY, String(visible));
}

let pendingPreferencesLoad: ReturnType<typeof ensurePreferences> | null = null;

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return {
    clock: systemClock(),
    ids: { next: () => crypto.randomUUID() },
  };
}

function loadPreferencesOnce(): ReturnType<typeof ensurePreferences> {
  if (pendingPreferencesLoad !== null) {
    return pendingPreferencesLoad;
  }
  pendingPreferencesLoad = ensurePreferences(preferenceDeps()).finally(() => {
    pendingPreferencesLoad = null;
  });
  return pendingPreferencesLoad;
}

export function GamificationVisibilityProvider({
  children,
  persistent,
}: {
  readonly children: ReactNode;
  readonly persistent: boolean;
}): React.JSX.Element {
  const [visible, setVisibleState] = useState<boolean | null>(() =>
    persistent ? null : readLocalVisibility(),
  );
  const [loading, setLoading] = useState(persistent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    if (!persistent) {
      setVisibleState(readLocalVisibility());
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await loadPreferencesOnce();
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setVisibleState(result.value.gamificationVisible);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [persistent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setVisible = useCallback(
    async (nextVisible: boolean): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        if (!persistent) {
          try {
            writeLocalVisibility(nextVisible);
          } catch {
            // Muistivarastossa React-tila riittää, jos selain estää localStoragen.
          }
          setVisibleState(nextVisible);
          return true;
        }
        const result = await updatePreferences(preferenceDeps(), {
          gamificationVisible: nextVisible,
        });
        if (!result.ok) {
          setError(fromDataError(result.error));
          return false;
        }
        setVisibleState(result.value.gamificationVisible);
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

  const value = useMemo<GamificationVisibilityValue>(
    () => ({ visible, loading, saving, error, reload, setVisible }),
    [visible, loading, saving, error, reload, setVisible],
  );
  return (
    <GamificationVisibilityContext.Provider value={value}>
      {children}
    </GamificationVisibilityContext.Provider>
  );
}

export function useGamificationVisibility(): GamificationVisibilityValue {
  return useContext(GamificationVisibilityContext);
}
