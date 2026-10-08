// T088: gamification summary -kooste (pure data-funktio, ei IO:ta).
// Kriteeri: XP, level, momentum ja seuraava reward NÄKYVÄT HALLITUSTI.
// Reiluus (§51): ei rangaistuskieltä, ei nollautuvaa häpeää — kaikki luvut
// ovat neutraaleja toteamuksia.
// - level (T182): derivoitu deterministisesti kokonais-XP:stä level-curve-funktiolla
//   (transaktiovirta on totuus, LevelState-snapshot on vain välimuisti);
// - momentum (T184): liukuva 7/14 päivän suoritusaste (momentum.ts) —
//   yksi huono päivä ei nollaa, tauon jälkeinen paluu painottuu (§57.14);
// - seuraava reward: ensimmäinen ansaitsematon achievement aakkosissa
//   ("seuraava" ilman satunnaisuutta; kerättävät B10-lohkossa).
import type { Achievement, XPTransaction } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { levelProgress, type LevelProgress } from "./level-curve.ts";
import { calculateMomentumScore, type MomentumScore } from "./momentum.ts";

export interface TodayGamificationSummary {
  readonly todayXp: number;
  readonly totalXp: number;
  readonly level: number;
  /** T182: tason etenemä kokonais-XP:stä (raja seuraavaan tasoon). */
  readonly levelProgress: LevelProgress;
  /** T184: liukuva 7/14 päivän jatkuvuus (paluu painottuu, ei nollaudu). */
  readonly momentum: MomentumScore;
  /** Seuraava ansaitsematon achievement tai null (kaikki ansaittu / ei yhtään). */
  readonly nextRewardTitle: string | null;
  readonly earnedCount: number;
}

export interface TodayGamificationInput {
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly xpTransactions: readonly XPTransaction[];
  readonly achievements: readonly Achievement[];
  /** Jo ansaittujen achievementien ID:t. */
  readonly earnedAchievementIds: ReadonlySet<string>;
}

/**
 * Kokoaa gamification-tilanteen. Kaikki syötteet ovat valmiiksi ladattua
 * dataa (ei hakuketjuja tässä).
 */
export function summarizeTodayGamification(
  input: TodayGamificationInput,
): TodayGamificationSummary {
  const todayXp = input.xpTransactions
    .filter((tx) => toLocalDateKey(tx.earnedAt, input.timezoneOffsetMinutes) === input.localDate)
    .reduce((sum, tx) => sum + tx.amount, 0);
  const totalXp = input.xpTransactions.reduce((sum, tx) => sum + tx.amount, 0);

  // T182: level ja tason etenemä suoraan kokonais-XP:stä (deterministinen käyrä).
  const progress = levelProgress(totalXp);
  const level = progress.level;

  // T184: liukuva momentum 7/14 pv ikkunasta (paluupainotus mukana).
  const momentum = calculateMomentumScore({
    localDate: input.localDate,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    xpTransactions: input.xpTransactions,
  });

  // Seuraava reward: ansaitsemattomista aakkosissa ensimmäinen otsikko.
  const nextRewardTitle =
    [...input.achievements]
      .filter((achievement) => !input.earnedAchievementIds.has(achievement.id))
      .sort((a, b) => (a.title < b.title ? -1 : 1))[0]?.title ?? null;

  return {
    todayXp,
    totalXp,
    level,
    levelProgress: progress,
    momentum,
    nextRewardTitle,
    earnedCount: input.earnedAchievementIds.size,
  };
}
