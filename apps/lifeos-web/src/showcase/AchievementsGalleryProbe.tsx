// T189: saavutusgallerian visuaalinen E2E-näyteikkuna. Fixtures elävät vain
// sisäisessä muistirepossa, jotta tuotannon pysyvä tietokanta ei muutu.
// Näyte näyttää kummatkin tilat: avattu (palkinto näkyy) ja odottava
// (kutsu, ei häpeää §57.14).
import { useMemo } from "react";
import type { Achievement, Collectible, UserReward } from "@lifeos/domain";
import { InMemoryStore, sequentialIdGenerator } from "@lifeos/data";
import { DataProvider } from "../dataContext.tsx";
import { AchievementsGallery } from "../views/insights/AchievementsGallery.tsx";
import { JourneyCollection } from "../views/insights/JourneyCollection.tsx";

const AT = "2026-09-18T09:00:00.000Z";

const PROBE_ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "nx-gach-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "first-task",
    title: "Ensimmäinen tehtävä",
    description: "Kirjasit ensimmäisen tehtävän valmiiksi.",
  },
  {
    id: "nx-gach-2",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "week-streak",
    title: "Viikon putki",
    description: "Seitsemän päivää putkeen.",
  },
  {
    id: "nx-gach-3",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "focus-hour",
    title: "Fokustunti",
    description: "60 min yhtenäistä fokusta.",
  },
  {
    id: "nx-gach-4",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "water-week",
    title: "Vesiviikko",
    description: "Vesikirjauksia viitenä päivänä.",
  },
];

const PROBE_REWARDS: readonly UserReward[] = [
  {
    id: "nx-greward-1",
    createdAt: "2026-09-15T07:00:00.000Z",
    updatedAt: "2026-09-15T07:00:00.000Z",
    version: 1,
    achievementId: "nx-gach-1",
    collectibleId: null,
    earnedAt: "2026-09-15T07:00:00.000Z",
  },
  {
    id: "nx-greward-2",
    createdAt: "2026-09-12T07:00:00.000Z",
    updatedAt: "2026-09-12T07:00:00.000Z",
    version: 1,
    achievementId: "nx-gach-3",
    collectibleId: null,
    earnedAt: "2026-09-12T07:00:00.000Z",
  },
];

export function AchievementsGalleryProbe(): React.JSX.Element {
  const ids = useMemo(() => sequentialIdGenerator("nx-gach"), []);
  const achievementStore = useMemo(
    () => new InMemoryStore<Achievement>("achievements-probe", [...PROBE_ACHIEVEMENTS]),
    [],
  );
  const userRewardStore = useMemo(
    () => new InMemoryStore<UserReward>("user-rewards-probe", [...PROBE_REWARDS]),
    [],
  );
  return (
    <section data-testid="achievements-gallery-probe" aria-label="Saavutusgalleria (E2E)">
      <DataProvider ids={ids} achievementStore={achievementStore} userRewardStore={userRewardStore}>
        <AchievementsGallery />
      </DataProvider>
    </section>
  );
}

// T191: tähtikartan (Journey/Constellation) visuaalinen E2E-näyteikkuna.
// Fixtures vain muistissa: kaksi vierekkäistä tähteä ansaittuja (ensimmäinen
// väli syttyy polkuvalona), kaksi odottavaa hämärinä (avausehdot näkyvät).
const JOURNEY_COLLECTIBLES: readonly Collectible[] = [
  {
    id: "nx-jcoll-1",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "star-first-light",
    title: "Ensimmäinen tähti",
    unlocksThemeKey: null,
  },
  {
    id: "nx-jcoll-2",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "star-streak",
    title: "Seitsentähti",
    unlocksThemeKey: null,
  },
  {
    id: "nx-jcoll-3",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "star-focus",
    title: "Kirkas tähti",
    unlocksThemeKey: null,
  },
  {
    id: "nx-jcoll-4",
    createdAt: AT,
    updatedAt: AT,
    version: 1,
    key: "region-aurora",
    title: "Revontulialue",
    unlocksThemeKey: "aurora",
  },
];

const JOURNEY_REWARDS: readonly UserReward[] = [
  {
    id: "nx-jreward-1",
    createdAt: "2026-09-15T07:00:00.000Z",
    updatedAt: "2026-09-15T07:00:00.000Z",
    version: 1,
    achievementId: null,
    collectibleId: "nx-jcoll-1",
    earnedAt: "2026-09-15T07:00:00.000Z",
  },
  {
    id: "nx-jreward-2",
    createdAt: "2026-09-16T07:00:00.000Z",
    updatedAt: "2026-09-16T07:00:00.000Z",
    version: 1,
    achievementId: null,
    collectibleId: "nx-jcoll-2",
    earnedAt: "2026-09-16T07:00:00.000Z",
  },
];

export function JourneyCollectionProbe(): React.JSX.Element {
  const ids = useMemo(() => sequentialIdGenerator("nx-jcoll"), []);
  const achievementStore = useMemo(
    () => new InMemoryStore<Achievement>("journey-achievements-probe", [...PROBE_ACHIEVEMENTS]),
    [],
  );
  const collectibleStore = useMemo(
    () => new InMemoryStore<Collectible>("journey-collectibles-probe", [...JOURNEY_COLLECTIBLES]),
    [],
  );
  const userRewardStore = useMemo(
    () => new InMemoryStore<UserReward>("journey-rewards-probe", [...JOURNEY_REWARDS]),
    [],
  );
  return (
    <section data-testid="journey-collection-probe" aria-label="Tähtikartta (E2E)">
      <DataProvider
        ids={ids}
        achievementStore={achievementStore}
        collectibleStore={collectibleStore}
        userRewardStore={userRewardStore}
      >
        <JourneyCollection />
      </DataProvider>
    </section>
  );
}
