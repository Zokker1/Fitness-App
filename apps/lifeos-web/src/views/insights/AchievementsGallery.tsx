// T189: saavutusgalleria (§9 Achievement, §30 palaute, §51/§57.14 ei
// häpeäkieltä). Kriteeri: lukitut/avatut saavutukset esitetään laadukkaasti
// ilman häpeäkieltä.
// - Rivi-indeksi (AchievementCard, LogCard-rytmi): merkki | teksti | status.
//   Ei laatikkopakkaa eikä kultamitaleja — brief §4 anti-harmaa-laatikko.
// - Tila muodolla + sanalla (§31): ansaittu täytetty ympyrä + "Avattu d.m.yyyy";
//   odottava ääriviivaympyrä + "Ei vielä avattu" (kutsu, ei rankaisu §57.14).
// - Avatut ensin (uusin ensin), odottavat aakkosissa — palkinto näkyy,
//   lukitut pysyvät luettavina ilman häpeää.
// TIEDOT: useData.achievements + useData.userRewards (T188 moottorista
// listEarnedAchievementIds/findEarnedReward).
import { t, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useState } from "react";
import { Alert, AchievementCard, Card, EmptyState, Meta, Skeleton } from "@lifeos/ui";
import type { Achievement, UserReward } from "@lifeos/domain";
import { findEarnedReward, listEarnedAchievementIds } from "@lifeos/data";
import { useData } from "../../dataContext.tsx";

function formatEarnedDate(earnedAt: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(new Date(earnedAt));
}

interface GalleryRow {
  readonly achievement: Achievement;
  readonly reward: UserReward | undefined;
}

function buildRows(
  achievements: readonly Achievement[],
  rewards: readonly UserReward[],
): readonly GalleryRow[] {
  const earnedIds = listEarnedAchievementIds(rewards);
  const rows = achievements.map((achievement) => ({
    achievement,
    reward: findEarnedReward(rewards, achievement.id),
  }));
  // Avatut ensin (uusin ansaittu ensin), odottavat aakkosissa — palkinto
  // näkyy heti, odottavat pysyvät luettavina ilman häpeäjärjestystä (§51).
  return rows.sort((a, b) => {
    const aEarned = earnedIds.has(a.achievement.id);
    const bEarned = earnedIds.has(b.achievement.id);
    if (aEarned !== bEarned) {
      return aEarned ? -1 : 1;
    }
    if (aEarned && bEarned) {
      const aAt = a.reward?.earnedAt ?? "";
      const bAt = b.reward?.earnedAt ?? "";
      return aAt < bAt ? 1 : aAt > bAt ? -1 : 0;
    }
    return a.achievement.title < b.achievement.title ? -1 : 1;
  });
}

export function AchievementsGallery(): React.JSX.Element {
  const { achievements, userRewards } = useData();
  const [rows, setRows] = useState<readonly GalleryRow[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const refresh = useCallback(async () => {
    const [listedAchievements, listedRewards] = await Promise.all([
      achievements.list(),
      userRewards.list(),
    ]);
    if (listedAchievements.ok && listedRewards.ok) {
      setRows(buildRows(listedAchievements.value, listedRewards.value));
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, [achievements, userRewards]);
  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => undefined);
      }
    };
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!guard.cancelled) {
          setLoading(false);
        }
      });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const earnedCount = (rows ?? []).filter((row) => row.reward !== undefined).length;

  return (
    <Card heading={t("Saavutukset")} data-testid="achievements-gallery">
      {loading ? (
        <Skeleton label={t("Ladataan saavutuksia…")} />
      ) : loadFailed || rows === undefined ? (
        <Alert tone="danger" title={t("Saavutuksia ei voitu lukea")}>
          {t("Yritä uudelleen hetken kuluttua.")}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Ei saavutuksia vielä")}
          hint={t("Saavutukset avautuvat, kun suoritat merkkejä aidosta tekemisestä.")}
        />
      ) : (
        <>
          <Meta>
            <span data-ui="achievement-summary" data-testid="achievements-summary">
              {String(earnedCount)} / {String(rows.length)} {t("avattu")}
            </span>
          </Meta>
          <ul data-ui="achievement-list" data-testid="achievements-list">
            {rows.map(({ achievement, reward }) => (
              <AchievementCard
                key={achievement.id}
                title={achievement.title}
                description={achievement.description ?? undefined}
                state={reward === undefined ? "locked" : "earned"}
                status={
                  reward === undefined
                    ? "Ei vielä avattu"
                    : `Avattu ${formatEarnedDate(reward.earnedAt)}`
                }
              />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
