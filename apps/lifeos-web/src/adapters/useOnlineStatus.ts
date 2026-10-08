// T081 (siirretty T095:ssä views/today → adapters): online-tilan seuranta
// (navigator.onLine + online/offline-tapahtumat). Jaettu hookki kaikille
// näkymille (TodayHeader + QuickAdd-offlinehuomautus).
// App-kerros saa käyttää selainrajapintoja suoraan. Ei PII:tä.
import { useEffect, useState } from "react";

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  useEffect(() => {
    const goOnline = (): void => {
      setOnline(true);
    };
    const goOffline = (): void => {
      setOnline(false);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}
