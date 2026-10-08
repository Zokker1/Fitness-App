// T036: sovelluksen storage-kytkentä. Käärii useStorageStatus-hookin:
// - Hook elää kerran koko appin elinkaaren (ei per-reitti-instanssia):
//   snapshot+DB-health haetaan kerran, virkistys näkyvyydessä/minuutissa.
// - Banneri näkyy vain huomio/kriittinen-tasolla (ei ok/tuntematon-flappia);
//   koko kortti elää asetuksissa. Molemmat kuluttavat samaa hook-tulosta.
// - Ei capability/SQL-kutsuja tässä; ne elävät hookissa + adaptereissa.

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { useStorageStatus, type UseStorageStatusResult } from "./useStorageStatus.ts";

const StorageStatusContext = createContext<UseStorageStatusResult | null>(null);

export function StorageStatusProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const value = useStorageStatus();
  const memoized = useMemo(() => value, [value]);
  return <StorageStatusContext.Provider value={memoized}>{children}</StorageStatusContext.Provider>;
}

/** Ainoa sallittu storage-hook komponenteille (T036-raja). */
export function useAppStorageStatus(): UseStorageStatusResult {
  const value = useContext(StorageStatusContext);
  if (value === null) {
    throw new Error("useAppStorageStatus vaatii StorageStatusProviderin yläpuolelleen.");
  }
  return value;
}
