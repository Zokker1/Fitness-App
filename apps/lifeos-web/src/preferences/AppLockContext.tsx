import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ensurePreferences, systemClock, updatePreferences } from "@lifeos/data";
import type { AppError } from "../errors/appError.ts";
import { fromDataError, fromUnknown } from "../errors/appError.ts";
import { startAutoLockController } from "../security/autoLockController.ts";
import {
  isSyncWriteKeyActive,
  lockActiveSyncWriteKey,
  SYNC_KEY_STATE_EVENT,
} from "../sync/syncRuntime.ts";

interface AppLockValue {
  readonly enabled: boolean | null;
  readonly loading: boolean;
  readonly saving: boolean;
  readonly localContentLocked: boolean;
  readonly error: AppError | null;
  readonly reload: () => Promise<void>;
  readonly setEnabled: (enabled: boolean) => Promise<boolean>;
}

const LOCAL_APP_LOCK_KEY = "lifeos-app-lock-enabled";
const AppLockContext = createContext<AppLockValue | null>(null);
let pendingPreferencesLoad: ReturnType<typeof ensurePreferences> | null = null;

function preferenceDeps(): Parameters<typeof ensurePreferences>[0] {
  return { clock: systemClock(), ids: { next: () => crypto.randomUUID() } };
}

function loadPreferencesOnce(): ReturnType<typeof ensurePreferences> {
  if (pendingPreferencesLoad !== null) return pendingPreferencesLoad;
  pendingPreferencesLoad = ensurePreferences(preferenceDeps()).finally(() => {
    pendingPreferencesLoad = null;
  });
  return pendingPreferencesLoad;
}

function readLocalAppLock(): boolean {
  try {
    return window.localStorage.getItem(LOCAL_APP_LOCK_KEY) === "true";
  } catch {
    return false;
  }
}

function writeLocalAppLock(enabled: boolean): void {
  try {
    window.localStorage.setItem(LOCAL_APP_LOCK_KEY, String(enabled));
  } catch {
    // Use the current React state if the browser blocks local preference storage.
  }
}

export function AppLockProvider({
  children,
  persistent,
  localContentEncryptionEnabled = false,
}: {
  readonly children: ReactNode;
  readonly persistent: boolean;
  readonly localContentEncryptionEnabled?: boolean;
}): React.JSX.Element {
  const [enabled, setEnabledState] = useState<boolean | null>(() =>
    persistent ? null : readLocalAppLock(),
  );
  const [loading, setLoading] = useState(persistent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [keyActive, setKeyActive] = useState(isSyncWriteKeyActive);

  const reload = useCallback(async (): Promise<void> => {
    if (localContentEncryptionEnabled && !isSyncWriteKeyActive()) {
      setEnabledState(readLocalAppLock());
      setError(null);
      setLoading(false);
      return;
    }
    if (!persistent) {
      setEnabledState(readLocalAppLock());
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const preferences = await loadPreferencesOnce();
      if (!preferences.ok) {
        setError(fromDataError(preferences.error));
        return;
      }
      setEnabledState(preferences.value.appLockEnabled);
      writeLocalAppLock(preferences.value.appLockEnabled);
    } catch (loadError) {
      setError(fromUnknown(loadError));
    } finally {
      setLoading(false);
    }
  }, [localContentEncryptionEnabled, persistent]);

  useEffect(() => {
    void reload();
    const onKeyState = (): void => {
      const active = isSyncWriteKeyActive();
      setKeyActive(active);
      if (active) void reload();
    };
    const onStorage = (event: StorageEvent): void => {
      if (event.key === LOCAL_APP_LOCK_KEY) {
        setEnabledState(readLocalAppLock());
      }
    };
    window.addEventListener(SYNC_KEY_STATE_EVENT, onKeyState);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(SYNC_KEY_STATE_EVENT, onKeyState);
      window.removeEventListener("storage", onStorage);
    };
  }, [reload]);

  useEffect(() => {
    if (enabled !== true || !keyActive) return;
    return startAutoLockController({
      enabled: true,
      lock: lockActiveSyncWriteKey,
    });
  }, [enabled, keyActive]);

  const setEnabled = useCallback(
    async (nextEnabled: boolean): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        if (!persistent) {
          writeLocalAppLock(nextEnabled);
          setEnabledState(nextEnabled);
          return true;
        }
        const result = await updatePreferences(preferenceDeps(), {
          appLockEnabled: nextEnabled,
        });
        if (!result.ok) {
          setError(fromDataError(result.error));
          return false;
        }
        setEnabledState(result.value.appLockEnabled);
        writeLocalAppLock(result.value.appLockEnabled);
        return true;
      } catch (saveError) {
        setError(fromUnknown(saveError));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [persistent],
  );

  const value = useMemo<AppLockValue>(
    () => ({
      enabled,
      loading,
      saving,
      error,
      localContentLocked: localContentEncryptionEnabled && !keyActive,
      reload,
      setEnabled,
    }),
    [enabled, loading, saving, error, localContentEncryptionEnabled, keyActive, reload, setEnabled],
  );
  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock(): AppLockValue {
  const value = useContext(AppLockContext);
  if (value === null) throw new Error("useAppLock must be used inside AppLockProvider.");
  return value;
}
