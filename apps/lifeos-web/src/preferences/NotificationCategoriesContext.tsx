// T282: muistutuskategoriat tallentuvat UserPreferences-riville pysyvässä
// tilassa ja paikalliseen asetukseen muistivaraston käytössä.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  validateNotificationCategorySettings,
} from "@lifeos/domain";
import type { NotificationCategoryKey, NotificationCategorySettings } from "@lifeos/domain";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";

interface NotificationCategoriesValue {
  readonly categories: NotificationCategorySettings;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly error: AppError | null;
  readonly reload: () => Promise<void>;
  readonly setEnabled: (key: NotificationCategoryKey, enabled: boolean) => Promise<boolean>;
}

const LOCAL_CATEGORIES_KEY = "lifeos-notification-categories";
const preferenceDeps = (): Parameters<typeof ensurePreferences>[0] => ({
  clock: systemClock(),
  ids: { next: () => crypto.randomUUID() },
});

let pendingPreferencesLoad: ReturnType<typeof ensurePreferences> | null = null;

function loadPreferencesOnce(): ReturnType<typeof ensurePreferences> {
  if (pendingPreferencesLoad !== null) return pendingPreferencesLoad;
  pendingPreferencesLoad = ensurePreferences(preferenceDeps()).finally(() => {
    pendingPreferencesLoad = null;
  });
  return pendingPreferencesLoad;
}

function readLocalCategories(): NotificationCategorySettings {
  const raw = window.localStorage.getItem(LOCAL_CATEGORIES_KEY);
  if (raw === null) return { ...DEFAULT_NOTIFICATION_CATEGORY_SETTINGS };
  const validated = validateNotificationCategorySettings(JSON.parse(raw) as unknown);
  if (!validated.ok) throw new Error("notification-categories-invalid");
  return validated.value;
}

const standaloneValue: NotificationCategoriesValue = {
  categories: DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  loading: false,
  saving: false,
  error: null,
  reload: () => Promise.resolve(),
  setEnabled: () => Promise.resolve(true),
};
const NotificationCategoriesContext = createContext(standaloneValue);

export function NotificationCategoriesProvider({
  children,
  persistent,
}: {
  readonly children: ReactNode;
  readonly persistent: boolean;
}): React.JSX.Element {
  const [categories, setCategories] = useState<NotificationCategorySettings>({
    ...DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  });
  const [loading, setLoading] = useState(persistent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (!persistent) {
        setCategories(readLocalCategories());
        return;
      }
      const result = await loadPreferencesOnce();
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setCategories(result.value.notificationCategories);
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [persistent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setEnabled = useCallback(
    async (key: NotificationCategoryKey, enabled: boolean): Promise<boolean> => {
      const next = { ...categories, [key]: enabled };
      const validated = validateNotificationCategorySettings(next);
      if (!validated.ok) return false;
      setSaving(true);
      setError(null);
      try {
        if (persistent) {
          const result = await updatePreferences(preferenceDeps(), {
            notificationCategories: validated.value,
          });
          if (!result.ok) {
            setError(fromDataError(result.error));
            return false;
          }
          setCategories(result.value.notificationCategories);
        } else {
          try {
            window.localStorage.setItem(LOCAL_CATEGORIES_KEY, JSON.stringify(validated.value));
          } catch {
            // Muistivarastossa React-tila säilyttää valinnan tämän session ajan.
          }
          setCategories(validated.value);
        }
        window.dispatchEvent(new Event("lifeos:data-changed"));
        return true;
      } catch (error_: unknown) {
        setError(fromUnknown(error_));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [categories, persistent],
  );

  const value = useMemo(
    () => ({ categories, loading, saving, error, reload, setEnabled }),
    [categories, loading, saving, error, reload, setEnabled],
  );
  return (
    <NotificationCategoriesContext.Provider value={value}>
      {children}
    </NotificationCategoriesContext.Provider>
  );
}

export function useNotificationCategories(): NotificationCategoriesValue {
  return useContext(NotificationCategoriesContext);
}
