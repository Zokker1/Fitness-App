// T191: Journey/Constellation -keräily (§9: "suoritukset avaavat tähtiä, alueita
// tai pieniä collectible-kortteja"; teema constellation/journey, ei rahaa;
// §30 palaute, §51/§57.14 ei hämeäkieltä). Kriteeri: keräilynäkymä visualisoi
// etenemisen omana visuaalisena maailmana.
// - Taivas-paneeli (koriste, §31: sisältö luetaan luettelosta): nouseva polku
//   hiusviivoina; ansaiteet yhdistävät kohdat syttyvät (rohkea elementti),
//   odottavat pysyvät hämärinä pisteinä. Muoto koodaa lajin: tähti = ympyrä,
//   alue = vinoneliö (muoto = tietoa, ei koristetta).
// - Sama merkkisanasto kuin T189:ssä: ansaittu = täytetty Sammal; odottava =
//   ääriviiva. Kummallakin sanallinen status rivillä (§31) ilman häpeää.
// - Odottavan rivin avausehto on tietoa ei rankaisua: "Avautuu saavutuksesta X"
//   tai "Avautuu tasolla N" (T190:n CollectibleUnlockRule).
// TIEDOT: useData.collectibles + userRewards + achievements (avausehtojen
// otsikot); järjestys ja säännöt COLLECTIBLE_DEFINITIONS-mallistosta (T190).
import { t, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useState } from "react";
import { Alert, Card, EmptyState, Meta, Skeleton, Body } from "@lifeos/ui";
import type { Achievement, Collectible, UserReward } from "@lifeos/domain";
import {
  COLLECTIBLE_DEFINITIONS,
  findCollectedReward,
  type CollectibleDefinition,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 120;

function formatEarnedDate(earnedAt: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(new Date(earnedAt));
}

interface JourneyRow {
  readonly collectible: Collectible;
  readonly definition: CollectibleDefinition | undefined;
  readonly reward: UserReward | undefined;
  readonly statusText: string;
  readonly earned: boolean;
  /** Alue = vinoneliö, tähti (tai muu) = ympyrä — muoto koodaa lajin. */
  readonly isRegion: boolean;
}

function unlockHint(
  definition: CollectibleDefinition | undefined,
  achievements: readonly Achievement[],
): string {
  if (definition === undefined) {
    return "Avautuu suorituksista";
  }
  const rule = definition.unlockedBy;
  if (rule.kind === "level") {
    return `Avautuu tasolla ${String(rule.level)}`;
  }
  const source = achievements.find((achievement) => achievement.key === rule.achievementKey);
  const name = source?.title ?? rule.achievementKey;
  return `Avautuu saavutuksesta: ${name}`;
}

function buildRows(
  collectibles: readonly Collectible[],
  rewards: readonly UserReward[],
  achievements: readonly Achievement[],
): readonly JourneyRow[] {
  const rows = collectibles.map((collectible) => {
    const definition = COLLECTIBLE_DEFINITIONS.find((item) => item.key === collectible.key);
    const reward = findCollectedReward(rewards, collectible.id);
    return {
      collectible,
      definition,
      reward,
      earned: reward !== undefined,
      isRegion: collectible.key.startsWith("region-"),
      statusText:
        reward === undefined
          ? unlockHint(definition, achievements)
          : `Avattu ${formatEarnedDate(reward.earnedAt)}`,
    };
  });
  // Matkan järjestys: malliston polku (tähdet ensin, alue viimeiseksi),
  // tuntemattomat avaimet aakkosissa perässä.
  return rows.sort((a, b) => {
    const aIndex = COLLECTIBLE_DEFINITIONS.findIndex((item) => item.key === a.collectible.key);
    const bIndex = COLLECTIBLE_DEFINITIONS.findIndex((item) => item.key === b.collectible.key);
    const aOrder = aIndex === -1 ? Number.MAX_SAFE_INTEGER : aIndex;
    const bOrder = bIndex === -1 ? Number.MAX_SAFE_INTEGER : bIndex;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    return a.collectible.title < b.collectible.title ? -1 : 1;
  });
}

/** Polun pisteet: nouseva kaari alavasemmalta oikealle ylös (matka etenee). */
function trailPoints(count: number): readonly { x: number; y: number }[] {
  if (count <= 0) {
    return [];
  }
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    return {
      x: 30 + t * (VIEW_WIDTH - 60),
      y: VIEW_HEIGHT - 34 - t * (VIEW_HEIGHT - 66),
    };
  });
}

function StarMark({
  point,
  earned,
  isRegion,
}: {
  readonly point: { x: number; y: number };
  readonly earned: boolean;
  readonly isRegion: boolean;
}): React.JSX.Element {
  const fill = earned ? "var(--lifeos-color-accent)" : "var(--lifeos-color-surface)";
  const stroke = earned ? "var(--lifeos-color-accent)" : "var(--lifeos-color-border)";
  if (isRegion) {
    // Vinoneliö = alue (muoto koodaa lajin §31).
    return (
      <rect
        x={point.x - 7}
        y={point.y - 7}
        width={14}
        height={14}
        rx={2}
        transform={`rotate(45 ${String(point.x)} ${String(point.y)})`}
        fill={fill}
        stroke={stroke}
        strokeWidth={2}
      />
    );
  }
  return <circle cx={point.x} cy={point.y} r={7} fill={fill} stroke={stroke} strokeWidth={2} />;
}

function ConstellationSky({ rows }: { readonly rows: readonly JourneyRow[] }): React.JSX.Element {
  const points = trailPoints(rows.length);
  return (
    <div data-ui="journey-sky" aria-hidden="true">
      <svg
        viewBox={`0 0 ${String(VIEW_WIDTH)} ${String(VIEW_HEIGHT)}`}
        data-ui="journey-sky-svg"
        focusable="false"
      >
        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          if (next === undefined) {
            return null;
          }
          // Väli syttyy kun molemmat päädyt ovat ansaittuja (polkuvalo).
          const lit = rows[index]?.earned === true && rows[index + 1]?.earned === true;
          return (
            <line
              key={`segment-${String(index)}`}
              x1={point.x}
              y1={point.y}
              x2={next.x}
              y2={next.y}
              stroke={lit ? "var(--lifeos-color-accent)" : "var(--lifeos-color-border)"}
              strokeWidth={lit ? 2 : 1}
              strokeOpacity={lit ? 1 : 0.45}
              strokeLinecap="round"
            />
          );
        })}
        {rows.map((row, index) => {
          const point = points[index];
          if (point === undefined) {
            return null;
          }
          return (
            <StarMark
              key={row.collectible.id}
              point={point}
              earned={row.earned}
              isRegion={row.isRegion}
            />
          );
        })}
      </svg>
    </div>
  );
}

export function JourneyCollection(): React.JSX.Element {
  const { collectibles, userRewards, achievements } = useData();
  const [rows, setRows] = useState<readonly JourneyRow[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const refresh = useCallback(async () => {
    const [listedCollectibles, listedRewards, listedAchievements] = await Promise.all([
      collectibles.list(),
      userRewards.list(),
      achievements.list(),
    ]);
    if (listedCollectibles.ok && listedRewards.ok && listedAchievements.ok) {
      setRows(buildRows(listedCollectibles.value, listedRewards.value, listedAchievements.value));
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, [collectibles, userRewards, achievements]);
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

  const earnedCount = (rows ?? []).filter((row) => row.earned).length;

  return (
    <Card heading={t("Tähtikartta")} data-testid="journey-collection">
      {loading ? (
        <Skeleton label={t("Ladataan tähtikarttaa…")} />
      ) : loadFailed || rows === undefined ? (
        <Alert tone="danger" title={t("Tähtikarttaa ei voitu lukea")}>
          {t("Yritä uudelleen hetken kuluttua.")}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          title={t("Ei kerättäviä vielä")}
          hint={t("Tähdet ja alueet avautuvat suorituksista ja tasoista.")}
        />
      ) : (
        <>
          <ConstellationSky rows={rows} />
          <Meta>
            <span data-ui="journey-summary" data-testid="journey-summary">
              {String(earnedCount)} / {String(rows.length)} {t("avattu")}
            </span>
          </Meta>
          <ul data-ui="journey-list" data-testid="journey-list">
            {rows.map((row) => (
              <li
                key={row.collectible.id}
                data-ui="journey-row"
                data-state={row.earned ? "earned" : "locked"}
              >
                <span
                  data-ui="journey-row-mark"
                  data-state={row.earned ? "earned" : "locked"}
                  data-shape={row.isRegion ? "region" : "star"}
                  aria-hidden="true"
                />
                <div data-ui="journey-row-body">
                  <Body>
                    <strong>{row.collectible.title}</strong>
                  </Body>
                  <Meta>{row.statusText}</Meta>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
