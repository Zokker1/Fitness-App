// T196: XP- tai palkintokirjauksen pieni onnistumispalaute (§9/§30/§51).
// Lähteenä on append-only XP-/reward-ledger: alkuperäinen lataus vain alustaa
// vertailun, joten vanhat tapahtumat tai retryt eivät laukaise juhlaa uudelleen.
import { useCallback, useEffect, useRef, useState } from "react";
import { Toast, ToastViewport, useHaptics } from "@lifeos/ui";
import { useData } from "../dataContext.tsx";
import { useGamificationVisibility } from "../preferences/GamificationVisibilityContext.tsx";

interface CelebrationNotice {
  readonly id: number;
  readonly title: string;
  readonly body: string;
}

interface GamificationSnapshot {
  readonly xpIds: ReadonlySet<string>;
  readonly rewardIds: ReadonlySet<string>;
}

export function GamificationCelebration(): React.JSX.Element {
  const { xpTransactions, userRewards } = useData();
  const { visible } = useGamificationVisibility();
  const haptics = useHaptics();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const snapshot = useRef<GamificationSnapshot | null>(null);
  const requestQueue = useRef<Promise<void>>(Promise.resolve());
  const sequence = useRef(0);
  const mounted = useRef(false);
  const [notice, setNotice] = useState<CelebrationNotice | null>(null);

  const refresh = useCallback((): Promise<void> => {
    const request = requestQueue.current.then(async () => {
      const [listedXp, listedRewards] = await Promise.all([
        xpTransactions.list(),
        userRewards.list(),
      ]);
      if (!listedXp.ok || !listedRewards.ok) {
        return;
      }

      const previous = snapshot.current;
      snapshot.current = {
        xpIds: new Set(listedXp.value.map((transaction) => transaction.id)),
        rewardIds: new Set(listedRewards.value.map((reward) => reward.id)),
      };
      if (previous === null || !mounted.current || visibleRef.current !== true) {
        return;
      }

      const newXp = listedXp.value.filter(
        (transaction) => !previous.xpIds.has(transaction.id) && transaction.amount > 0,
      );
      const newRewards = listedRewards.value.filter((reward) => !previous.rewardIds.has(reward.id));
      const totalXp = newXp.reduce((total, transaction) => total + transaction.amount, 0);
      if (totalXp <= 0 && newRewards.length === 0) {
        return;
      }

      const reward = newRewards[0];
      const rewardTitle =
        reward?.achievementId !== null && reward?.achievementId !== undefined
          ? "Saavutus avattu"
          : reward?.collectibleId !== null && reward?.collectibleId !== undefined
            ? "Keräilyesine avattu"
            : "Palkinto avattu";
      const title = newRewards.length > 0 ? rewardTitle : `+${String(totalXp)} XP`;
      const body =
        totalXp > 0 ? `+${String(totalXp)} XP kirjattiin.` : "Löydät sen Insights-näkymästä.";

      sequence.current += 1;
      setNotice({ id: sequence.current, title, body });
      haptics(newRewards.length > 0 ? [18, 32, 18] : 18);
    });
    requestQueue.current = request.catch(() => undefined);
    return request;
  }, [haptics, userRewards, xpTransactions]);

  useEffect(() => {
    mounted.current = true;
    void refresh().catch(() => undefined);
    const onDataChanged = (): void => {
      void refresh().catch(() => undefined);
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      mounted.current = false;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  return (
    <ToastViewport>
      {notice !== null ? (
        <Toast
          key={notice.id}
          tone="success"
          motion="pop"
          title={notice.title}
          body={notice.body}
          duration={4_500}
          onDismiss={() => {
            setNotice((current) => (current?.id === notice.id ? null : current));
          }}
        />
      ) : null}
    </ToastViewport>
  );
}
