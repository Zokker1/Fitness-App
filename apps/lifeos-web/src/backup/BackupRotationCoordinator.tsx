// T322: update encrypted retention only while the app is visible and a user-unlocked key is active.
import { useCallback, useEffect, useRef } from "react";
import { createEncryptedBackup, dueBackupRotationPeriods } from "@lifeos/data";
import { useData } from "../dataContext.tsx";
import { useGamificationVisibility } from "../preferences/GamificationVisibilityContext.tsx";
import { useHeight } from "../preferences/HeightContext.tsx";
import { useHydrationTarget } from "../preferences/HydrationTargetContext.tsx";
import { readFavoriteFoodIds } from "../preferences/favorite-foods-storage.ts";
import { readNutritionPreferenceSnapshot } from "../preferences/nutritionPreferenceSnapshot.ts";
import { useWeightTarget } from "../preferences/WeightTargetContext.tsx";
import {
  BACKUP_ROTATION_STATE_EVENT,
  createBrowserEncryptedBackupRotationStore,
} from "../security/indexedDbEncryptedBackupStore.ts";
import { useTheme } from "../theme/ThemeContext.tsx";
import { getActiveSyncWriteContext, SYNC_KEY_STATE_EVENT } from "../sync/syncRuntime.ts";
import { isPersistentStorage } from "../storage/persistenceMode.ts";
import { collectPortableSnapshotInput } from "../views/settings/collectPortableSnapshotInput.ts";

const MIN_CHECK_INTERVAL_MS = 60_000;
const ACTIVE_CHECK_INTERVAL_MS = 15 * 60_000;

type BackupRotationState =
  | {
      readonly status: "saved";
      readonly latestCreatedAt: string;
      readonly retainedCount: number;
    }
  | {
      readonly status: "current";
      readonly latestCreatedAt: string | null;
      readonly retainedCount: number;
    }
  | { readonly status: "error" };

function publishRotationState(detail: BackupRotationState): void {
  window.dispatchEvent(new CustomEvent(BACKUP_ROTATION_STATE_EVENT, { detail }));
}

export function BackupRotationCoordinator(): null {
  const data = useData();
  const theme = useTheme();
  const weightTarget = useWeightTarget();
  const height = useHeight();
  const hydrationTarget = useHydrationTarget();
  const gamification = useGamificationVisibility();
  const running = useRef(false);
  const lastCheckAt = useRef(0);

  const settingsLoading =
    weightTarget.loading ||
    height.loading ||
    hydrationTarget.loading ||
    gamification.loading ||
    gamification.visible === null;
  const settingsError =
    weightTarget.error !== null ||
    height.error !== null ||
    hydrationTarget.error !== null ||
    gamification.error !== null;

  const maybeRotate = useCallback(async (): Promise<void> => {
    if (
      typeof document === "undefined" ||
      document.visibilityState !== "visible" ||
      !isPersistentStorage(window.location.search) ||
      settingsLoading ||
      settingsError ||
      running.current ||
      Date.now() - lastCheckAt.current < MIN_CHECK_INTERVAL_MS
    ) {
      return;
    }
    const activeContext = getActiveSyncWriteContext();
    if (activeContext === null) return;

    running.current = true;
    lastCheckAt.current = Date.now();
    try {
      const store = createBrowserEncryptedBackupRotationStore();
      const existing = await store.list();
      let periods = dueBackupRotationPeriods(existing, new Date());
      if (periods.daily === null && periods.weekly === null && periods.monthly === null) {
        const result = await store.prune();
        publishRotationState({
          status: "current",
          latestCreatedAt: result.entries[0]?.createdAt ?? null,
          retainedCount: result.entries.length,
        });
        return;
      }

      const nutritionPreferences = await readNutritionPreferenceSnapshot(true);
      const favoriteFoodIds = await readFavoriteFoodIds(true);
      const snapshotInput = await collectPortableSnapshotInput(
        data,
        {
          theme: theme.preference,
          gamificationVisible: gamification.visible,
          weightTarget: weightTarget.target,
          heightCm: height.heightCm,
          mealSlots: nutritionPreferences.mealSlots,
          macroTargets: nutritionPreferences.macroTargets,
          hydrationTargetMl: hydrationTarget.targetMilliliters,
          hydrationReminderTime: hydrationTarget.reminderTime,
          favoriteFoodIds,
        },
        isPersistentStorage(window.location.search),
      );
      periods = dueBackupRotationPeriods(existing, new Date(snapshotInput.exportedAt));
      if (periods.daily === null && periods.weekly === null && periods.monthly === null) {
        const result = await store.prune();
        publishRotationState({
          status: "current",
          latestCreatedAt: result.entries[0]?.createdAt ?? null,
          retainedCount: result.entries.length,
        });
        return;
      }
      const encrypted = await createEncryptedBackup(snapshotInput, activeContext.keySession);
      if (!encrypted.ok) throw new Error(encrypted.error.diagnosticCode);

      const saved = await store.saveAndRotate({
        id: encrypted.value.manifest.id,
        createdAt: encrypted.value.manifest.createdAt,
        daily: periods.daily,
        weekly: periods.weekly,
        monthly: periods.monthly,
        backup: encrypted.value,
      });
      publishRotationState({
        status: "saved",
        latestCreatedAt: encrypted.value.manifest.createdAt,
        retainedCount: saved.entries.length,
      });
    } catch {
      publishRotationState({ status: "error" });
    } finally {
      running.current = false;
    }
  }, [
    data,
    gamification.visible,
    height.heightCm,
    hydrationTarget.targetMilliliters,
    hydrationTarget.reminderTime,
    settingsError,
    settingsLoading,
    theme.preference,
    weightTarget.target,
  ]);

  useEffect(() => {
    const wake = (): void => {
      void maybeRotate();
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") wake();
    };
    const timer = window.setInterval(wake, ACTIVE_CHECK_INTERVAL_MS);
    window.addEventListener(SYNC_KEY_STATE_EVENT, wake);
    window.addEventListener("lifeos:data-changed", wake);
    document.addEventListener("visibilitychange", onVisible);
    wake();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(SYNC_KEY_STATE_EVENT, wake);
      window.removeEventListener("lifeos:data-changed", wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [maybeRotate]);

  return null;
}
