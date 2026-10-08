// T230: nestetavoite tallentuu UserPreferences-riville pysyvässä tilassa
// sekä selaimen omaan asetukseen muistivaraston käytössä.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import { validateHydrationReminderTime, validateHydrationTargetMl } from "@lifeos/domain";

interface HydrationTargetContextValue {
  readonly targetMilliliters: number | null;
  readonly reminderTime: string | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly reload: () => Promise<void>;
  readonly setSettings: (
    targetMilliliters: number | null,
    reminderTime: string | null,
  ) => Promise<boolean>;
}

const STORAGE_KEY = "lifeos-hydration-target-ml";
const REMINDER_STORAGE_KEY = "lifeos-hydration-reminder-time";
const DEFAULT_VALUE: HydrationTargetContextValue = {
  targetMilliliters: null,
  reminderTime: null,
  loading: false,
  error: null,
  reload: () => Promise.resolve(),
  setSettings: () => Promise.resolve(false),
};
const HydrationTargetContext = createContext(DEFAULT_VALUE);

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return { clock: systemClock(), ids: { next: () => crypto.randomUUID() } };
}

function readLocalTarget(): number | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  const validated = validateHydrationTargetMl(parsed);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  return validated.value;
}

function readLocalReminderTime(): string | null {
  const raw = window.localStorage.getItem(REMINDER_STORAGE_KEY);
  if (raw === null) {
    return null;
  }
  const validated = validateHydrationReminderTime(raw);
  if (!validated.ok) {
    throw new Error(validated.error.message);
  }
  return validated.value;
}

export function HydrationTargetProvider({
  children,
  persistent,
}: {
  readonly children: ReactNode;
  readonly persistent: boolean;
}): React.JSX.Element {
  const [targetMilliliters, setTargetMilliliters] = useState<number | null>(null);
  const [reminderTime, setReminderTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      if (persistent) {
        const preferences = await ensurePreferences(preferenceDeps());
        if (!preferences.ok) {
          setError(preferences.error.userMessage);
          return;
        }
        setTargetMilliliters(preferences.value.hydrationTargetMl);
        setReminderTime(preferences.value.hydrationReminderTime);
        return;
      }
      setTargetMilliliters(readLocalTarget());
      setReminderTime(readLocalReminderTime());
    } catch {
      setError("Nestetavoitetta ei voitu lukea.");
    } finally {
      setLoading(false);
    }
  }, [persistent]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setSettings = useCallback(
    async (target: number | null, reminder: string | null): Promise<boolean> => {
      const validatedTarget = validateHydrationTargetMl(target);
      if (!validatedTarget.ok) {
        setError(validatedTarget.error.message);
        return false;
      }
      const validatedReminder = validateHydrationReminderTime(reminder);
      if (!validatedReminder.ok) {
        setError(validatedReminder.error.message);
        return false;
      }
      const nextReminder = validatedTarget.value === null ? null : validatedReminder.value;
      setError(null);
      try {
        if (persistent) {
          const preferences = await updatePreferences(preferenceDeps(), {
            hydrationTargetMl: validatedTarget.value,
            hydrationReminderTime: nextReminder,
          });
          if (!preferences.ok) {
            setError(preferences.error.userMessage);
            return false;
          }
          setTargetMilliliters(preferences.value.hydrationTargetMl);
          setReminderTime(preferences.value.hydrationReminderTime);
        } else {
          if (validatedTarget.value === null) {
            window.localStorage.removeItem(STORAGE_KEY);
          } else {
            window.localStorage.setItem(STORAGE_KEY, String(validatedTarget.value));
          }
          if (nextReminder === null) {
            window.localStorage.removeItem(REMINDER_STORAGE_KEY);
          } else {
            window.localStorage.setItem(REMINDER_STORAGE_KEY, nextReminder);
          }
          setTargetMilliliters(validatedTarget.value);
          setReminderTime(nextReminder);
        }
        window.dispatchEvent(new Event("lifeos:data-changed"));
        return true;
      } catch {
        setError("Nestetavoitetta ei voitu tallentaa.");
        return false;
      }
    },
    [persistent],
  );

  const value = useMemo(
    () => ({ targetMilliliters, reminderTime, loading, error, reload, setSettings }),
    [targetMilliliters, reminderTime, loading, error, reload, setSettings],
  );
  return (
    <HydrationTargetContext.Provider value={value}>{children}</HydrationTargetContext.Provider>
  );
}

export function useHydrationTarget(): HydrationTargetContextValue {
  return useContext(HydrationTargetContext);
}
