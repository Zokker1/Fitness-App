// T036: storage-elinkaaren hook. Ainoa paikka joka:
// - lukee StorageCapability-snapshotin (quota/persisted/opfs-kelpoisuus),
// - avaa tietokannan (openDatabase) healthin (backend/backend-persistointi),
// - pyytää navigator.storage.persist():n T025-capabilityrajan kautta
//   perustellussa kohdassa: käyttäjän napista TAI automaattisesti kun
//   tila on best-effort (persisted === false) eikä pyyntöä ole vielä tehty.
// - päivittää tilan näkyvyyden/periodisesti muuttuessa (ei pollausta).
//
// Raja: ei raakaa Storage/SQL:ää tässä; capability + data-kerros + puhdas
// lifecycle-moduuli. Ei domain-logiikkaa; pelkkä orkestrointi.
// §2 kohta 9: käyttäjä näkee best-effort/quota-tilan + backup-ohjeen.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserCapabilities } from "../adapters/index.ts";
import { openDatabase } from "@lifeos/data";
import type { DatabaseHealth } from "@lifeos/data";
import type { StorageCapabilitySnapshot } from "@lifeos/capabilities";
import { fromCapabilityError, fromDataError } from "../errors/appError.ts";
import { buildStorageStatus, shouldRequestPersistence, type StorageStatus } from "./lifecycle.ts";

export type StorageRefreshReason = "mount" | "visible" | "interval" | "manual";

export interface StorageRequestState {
  readonly requested: boolean;
  readonly granted: boolean | null;
  readonly error: string | null;
}

export interface UseStorageStatusResult {
  readonly status: StorageStatus;
  readonly dbHealth: DatabaseHealth | null;
  readonly snapshot: StorageCapabilitySnapshot | null;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly persistence: StorageRequestState;
  /** Pyytää pysyvää tallennusta käyttäjän aloitteesta (nappi). */
  readonly requestPersistence: () => Promise<boolean>;
  readonly refresh: (reason?: StorageRefreshReason) => Promise<void>;
}

const REFRESH_INTERVAL_MS = 60_000;

function snapshotKey(snapshot: StorageCapabilitySnapshot | null): string {
  if (snapshot === null) {
    return "null";
  }
  return [
    String(snapshot.opfsSupported),
    String(snapshot.persisted),
    String(snapshot.quotaBytes),
    String(snapshot.usageBytes),
  ].join("|");
}

export function useStorageStatus(): UseStorageStatusResult {
  const capabilities = useMemo(() => createBrowserCapabilities(), []);
  const [snapshot, setSnapshot] = useState<StorageCapabilitySnapshot | null>(null);
  const [dbHealth, setDbHealth] = useState<DatabaseHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistence, setPersistence] = useState<StorageRequestState>({
    requested: false,
    granted: null,
    error: null,
  });
  const autoRequested = useRef(false);

  const refresh = useCallback(
    async (reason: StorageRefreshReason = "manual"): Promise<void> => {
      if (reason !== "manual") {
        // Syy ohjaa kutsujia (mount/näkyvyys/intervalli); sisältö on sama.
        // Haara pitää parametrin merkityksellisenä ilman void-operaattoria.
      }
      setLoading(true);
      const snapshotResult = await capabilities.storage.snapshot();
      if (snapshotResult.ok) {
        setSnapshot((previous) => {
          // Vältä turhat renderit: päivitä vain jos arvot muuttuivat.
          if (previous !== null && snapshotKey(previous) === snapshotKey(snapshotResult.value)) {
            return previous;
          }
          return snapshotResult.value;
        });
        setLoadError(null);
      } else {
        setSnapshot(null);
        setLoadError(fromCapabilityError(snapshotResult.error).body);
      }
      const health = await openDatabase();
      if (health.ok) {
        setDbHealth(health.value);
      } else {
        setDbHealth(null);
        if (snapshotResult.ok) {
          setLoadError(fromDataError(health.error).body);
        }
      }
      setLoading(false);
    },
    [capabilities],
  );

  // Automaattinen persist-pyyntö perustellussa kohdassa: heti kun tiedetään
  // ettei tila ole pysyvä (best-effort) — sekä mount-refreshin jälkeen että
  // jos snapshot päivittyy myöhemmin. Korkeintaan kerran per mount.
  useEffect(() => {
    if (snapshot === null || autoRequested.current || !shouldRequestPersistence(snapshot)) {
      return;
    }
    autoRequested.current = true;
    void (async () => {
      const result = await capabilities.storage.requestPersistence();
      setPersistence((previous) => ({
        requested: true,
        granted: result.ok ? result.value : previous.granted,
        error: result.ok ? null : fromCapabilityError(result.error).body,
      }));
      if (result.ok && result.value) {
        await refresh("interval");
      }
    })();
  }, [snapshot, capabilities, refresh]);

  const requestPersistence = useCallback(async (): Promise<boolean> => {
    const result = await capabilities.storage.requestPersistence();
    setPersistence({
      requested: true,
      granted: result.ok ? result.value : null,
      error: result.ok ? null : fromCapabilityError(result.error).body,
    });
    if (result.ok && result.value) {
      await refresh("manual");
      return true;
    }
    return result.ok && result.value;
  }, [capabilities, refresh]);

  // Lataus mountissa + virkistys kun välilehti aktivoituu + minuutin välein.
  useEffect(() => {
    void refresh("mount");
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        void refresh("visible");
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      void refresh("interval");
    }, REFRESH_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [refresh]);

  const status = useMemo(
    () =>
      buildStorageStatus(
        snapshot,
        dbHealth === null
          ? null
          : {
              backend: dbHealth.backend,
              persisted: dbHealth.persisted,
              open: dbHealth.open,
              integrity: dbHealth.integrity,
              schemaVersion: dbHealth.schemaVersion,
            },
      ),
    [snapshot, dbHealth],
  );

  return {
    status,
    dbHealth,
    snapshot,
    loading,
    loadError,
    persistence,
    requestPersistence,
    refresh,
  };
}
