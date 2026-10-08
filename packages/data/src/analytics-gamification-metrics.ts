// T264: local XP, derived level and quest progression metrics.

import type { Quest, QuestProgress, XPTransaction, XpSource } from "@lifeos/domain";
import { isValidLocalDateKey, toLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";
import { timezoneOffsetMinutesAtInstant } from "./calendar-timezone.ts";
import { levelForTotalXp, levelProgress, type LevelProgress } from "./level-curve.ts";
import { computeQuestProgress, type QuestEventSample } from "./quest-engine.ts";

const XP_SOURCES: readonly XpSource[] = [
  "task",
  "routine",
  "focus",
  "habit",
  "health",
  "quest",
  "manual",
];
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface GamificationXpDayMetric {
  readonly localDate: string;
  /** Tuleville päiville ei palauteta ennustettuja arvoja. */
  readonly xpDelta: number | null;
  readonly transactionCount: number | null;
  readonly xpBySource: Readonly<Record<XpSource, number>> | null;
  /** Ledgerin kumulatiivinen nettosaldo päivän lopussa. */
  readonly totalXp: number | null;
  readonly level: number | null;
  readonly levelProgress: LevelProgress | null;
  readonly levelsGained: number | null;
  readonly levelsLost: number | null;
}

export interface QuestProgressEventStream {
  readonly questId: string;
  readonly events: readonly QuestEventSample[];
}

export interface QuestProgressHistoryDayMetric {
  readonly localDate: string;
  readonly progress: number | null;
  readonly goal: number | null;
  readonly completionRatio: number | null;
  /** Ehdon saavuttaminen; claim-tila ei ole sama asia kuin progress. */
  readonly reached: boolean | null;
}

export type QuestProgressMetricSource = "events" | "snapshot" | "unavailable";

export interface QuestProgressMetric {
  readonly questId: string;
  readonly title: string;
  readonly goal: number | null;
  readonly currentProgress: number | null;
  readonly currentCompletionRatio: number | null;
  readonly claimedAt: string | null;
  readonly source: QuestProgressMetricSource;
  readonly historyAvailable: boolean;
  readonly history: readonly QuestProgressHistoryDayMetric[];
}

export interface GamificationMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  /** XP:n nettomuutos valitun jakson arvioitavina päivinä. */
  readonly xpDelta: number;
  readonly transactionCount: number;
  readonly xpBySource: Readonly<Record<XpSource, number>>;
  readonly totalXpAtPeriodStart: number | null;
  readonly totalXpAtPeriodEnd: number | null;
  readonly levelAtPeriodStart: number | null;
  readonly levelAtPeriodEnd: number | null;
  readonly levelsGained: number;
  readonly levelsLost: number;
  readonly xpTrend: readonly GamificationXpDayMetric[];
  readonly quests: readonly QuestProgressMetric[];
  readonly questsWithHistory: number;
}

export interface GamificationMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly xpTransactions: readonly XPTransaction[];
  readonly quests: readonly Quest[];
  readonly questProgress: readonly QuestProgress[];
  /**
   * Optional source events let the function reconstruct historical quest
   * progress. Include the quest's relevant event history through the selected
   * period; QuestProgress itself is a mutable latest snapshot, not a log.
   */
  readonly questEventStreams?: readonly QuestProgressEventStream[];
}

interface DatedXpTransaction {
  readonly transaction: XPTransaction;
  readonly localDate: string;
}

interface PreparedQuestEvent {
  readonly event: QuestEventSample;
  readonly localDate: string;
}

function invalidMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.gamification.invalid-input", message),
  };
}

function isValidUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function localDateAtInstant(timestamp: string, period: AnalyticsProjectionPeriod): string | null {
  if (!isValidUtcTimestamp(timestamp)) return null;
  let offset = period.timezoneOffsetMinutes;
  if (period.timeZone !== undefined && period.timeZone.trim() !== "") {
    try {
      offset = timezoneOffsetMinutesAtInstant(timestamp, period.timeZone) ?? offset;
    } catch {
      offset = period.timezoneOffsetMinutes;
    }
  }
  return toLocalDateKey(timestamp, offset);
}

function emptyXpBySource(): Record<XpSource, number> {
  return {
    task: 0,
    routine: 0,
    focus: 0,
    habit: 0,
    health: 0,
    quest: 0,
    manual: 0,
  };
}

function compareSnapshot(left: QuestProgress, right: QuestProgress): number {
  return left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);
}

/**
 * Laskee XP- ja level-historian append-only-ledgeristä ja questien historian
 * lähdetapahtumista. LevelState ja QuestProgress ovat vain viimeisimpiä
 * snapshotteja, joten niitä ei käytetä takautuvan trendin totuutena.
 */
export function calculateGamificationMetrics(
  input: GamificationMetricsInput,
): DataResult<GamificationMetrics> {
  if (!isValidLocalDateKey(input.asOfLocalDate)) {
    return invalidMetrics("Arviointipäivän pitää olla kelvollinen paikallispäivä.");
  }

  const projection = buildAnalyticsProjection({
    period: input.period,
    entries: [] as readonly unknown[],
    occurredAt: () => null,
  });
  if (!projection.ok) return projection;
  const period = projection.value.period;
  const dates = projection.value.days.map((day) => day.localDate);
  const evaluatedDates = dates.filter((date) => date <= input.asOfLocalDate);
  const throughDate =
    period.endLocalDate < input.asOfLocalDate ? period.endLocalDate : input.asOfLocalDate;

  for (const quest of input.quests) {
    if (
      (quest.activeFrom !== null && !isValidUtcTimestamp(quest.activeFrom)) ||
      (quest.activeUntil !== null && !isValidUtcTimestamp(quest.activeUntil)) ||
      (quest.activeFrom !== null &&
        quest.activeUntil !== null &&
        quest.activeUntil < quest.activeFrom)
    ) {
      return invalidMetrics("Questin aktiivisuusikkuna ei kelpaa.");
    }
    const conditionKind = quest.condition === null ? null : (quest.condition.kind as string);
    if (
      quest.condition !== null &&
      (!Number.isInteger(quest.condition.goal) ||
        quest.condition.goal < 1 ||
        (conditionKind !== "event-count" && conditionKind !== "active-day-count") ||
        (quest.condition.minimumAmount !== undefined &&
          (!Number.isFinite(quest.condition.minimumAmount) || quest.condition.minimumAmount <= 0)))
    ) {
      return invalidMetrics("Questin ehto ei kelpaa.");
    }
  }
  for (const snapshot of input.questProgress) {
    if (
      !Number.isInteger(snapshot.progress) ||
      snapshot.progress < 0 ||
      !Number.isInteger(snapshot.goal) ||
      snapshot.goal < 1 ||
      (snapshot.completedAt !== null && !isValidUtcTimestamp(snapshot.completedAt))
    ) {
      return invalidMetrics("QuestProgress-snapshot ei kelpaa.");
    }
  }

  const datedXp: DatedXpTransaction[] = [];
  for (const transaction of input.xpTransactions) {
    const localDate = localDateAtInstant(transaction.earnedAt, period);
    if (
      localDate !== null &&
      Number.isSafeInteger(transaction.amount) &&
      XP_SOURCES.includes(transaction.source)
    ) {
      datedXp.push({ transaction, localDate });
    }
  }

  const xpByDate = new Map<
    string,
    { amount: number; count: number; bySource: Record<XpSource, number> }
  >();
  for (const { transaction, localDate } of datedXp) {
    if (localDate < period.startLocalDate || localDate > throughDate) continue;
    const bucket = xpByDate.get(localDate) ?? { amount: 0, count: 0, bySource: emptyXpBySource() };
    bucket.amount += transaction.amount;
    bucket.count += 1;
    bucket.bySource[transaction.source] += transaction.amount;
    xpByDate.set(localDate, bucket);
  }

  let openingXp = 0;
  for (const { transaction, localDate } of datedXp) {
    if (localDate < period.startLocalDate && localDate <= input.asOfLocalDate) {
      openingXp += transaction.amount;
    }
  }

  let runningTotalXp = openingXp;
  let previousLevel = levelForTotalXp(openingXp);
  let levelsGained = 0;
  let levelsLost = 0;
  let xpDelta = 0;
  let transactionCount = 0;
  const xpBySource = emptyXpBySource();
  const xpTrend: GamificationXpDayMetric[] = [];
  for (const localDate of dates) {
    if (localDate > input.asOfLocalDate) {
      xpTrend.push({
        localDate,
        xpDelta: null,
        transactionCount: null,
        xpBySource: null,
        totalXp: null,
        level: null,
        levelProgress: null,
        levelsGained: null,
        levelsLost: null,
      });
      continue;
    }
    const bucket = xpByDate.get(localDate) ?? {
      amount: 0,
      count: 0,
      bySource: emptyXpBySource(),
    };
    runningTotalXp += bucket.amount;
    const level = levelForTotalXp(runningTotalXp);
    const dayLevelsGained = Math.max(0, level - previousLevel);
    const dayLevelsLost = Math.max(0, previousLevel - level);
    levelsGained += dayLevelsGained;
    levelsLost += dayLevelsLost;
    previousLevel = level;
    xpDelta += bucket.amount;
    transactionCount += bucket.count;
    for (const source of XP_SOURCES) xpBySource[source] += bucket.bySource[source];
    xpTrend.push({
      localDate,
      xpDelta: bucket.amount,
      transactionCount: bucket.count,
      xpBySource: bucket.bySource,
      totalXp: runningTotalXp,
      level,
      levelProgress: levelProgress(runningTotalXp),
      levelsGained: dayLevelsGained,
      levelsLost: dayLevelsLost,
    });
  }

  const hasEvaluatedDay = evaluatedDates.some((date) => date >= period.startLocalDate);
  const levelAtPeriodStart = hasEvaluatedDay ? levelForTotalXp(openingXp) : null;
  const lastDay = [...xpTrend].reverse().find((day) => day.totalXp !== null);

  const snapshotsByQuest = new Map<string, QuestProgress>();
  for (const snapshot of input.questProgress) {
    const existing = snapshotsByQuest.get(snapshot.questId);
    if (existing === undefined || compareSnapshot(snapshot, existing) > 0) {
      snapshotsByQuest.set(snapshot.questId, snapshot);
    }
  }

  const streamsByQuest = new Map<string, PreparedQuestEvent[]>();
  const streamPresence = new Set<string>();
  for (const stream of input.questEventStreams ?? []) {
    streamPresence.add(stream.questId);
    const prepared = streamsByQuest.get(stream.questId) ?? [];
    for (const event of stream.events) {
      const localDate = localDateAtInstant(event.at, period);
      if (
        localDate !== null &&
        typeof event.eventId === "string" &&
        event.eventId.length > 0 &&
        (event.amount === undefined || Number.isFinite(event.amount))
      ) {
        prepared.push({ event, localDate });
      }
    }
    streamsByQuest.set(stream.questId, prepared);
  }

  const questMetrics: QuestProgressMetric[] = [];
  for (const quest of [...input.quests].sort((a, b) => a.id.localeCompare(b.id))) {
    const stored = snapshotsByQuest.get(quest.id) ?? null;
    const stream = streamsByQuest.get(quest.id) ?? [];
    const canComputeHistory = streamPresence.has(quest.id) && quest.condition !== null;
    const history: QuestProgressHistoryDayMetric[] = [];
    let latestComputed: QuestProgressHistoryDayMetric | null = null;

    for (const localDate of dates) {
      if (localDate > input.asOfLocalDate) {
        history.push({
          localDate,
          progress: null,
          goal: quest.condition?.goal ?? stored?.goal ?? null,
          completionRatio: null,
          reached: null,
        });
        continue;
      }
      if (!streamPresence.has(quest.id) || quest.condition === null) {
        history.push({
          localDate,
          progress: null,
          goal: quest.condition?.goal ?? stored?.goal ?? null,
          completionRatio: null,
          reached: null,
        });
        continue;
      }
      const questStartLocalDate =
        quest.activeFrom === null ? null : localDateAtInstant(quest.activeFrom, period);
      if (questStartLocalDate !== null && localDate < questStartLocalDate) {
        history.push({
          localDate,
          progress: null,
          goal: quest.condition.goal,
          completionRatio: null,
          reached: null,
        });
        continue;
      }
      const events = stream
        .filter((sample) => sample.localDate <= localDate)
        .map(({ event }) => event);
      const snapshot = computeQuestProgress(quest.condition, events, {
        window: { activeFrom: quest.activeFrom, activeUntil: quest.activeUntil },
        timezoneOffsetMinutes: period.timezoneOffsetMinutes,
        ...(period.timeZone === undefined ? {} : { timeZone: period.timeZone }),
      });
      const point: QuestProgressHistoryDayMetric = {
        localDate,
        progress: snapshot.progress,
        goal: snapshot.goal,
        completionRatio: snapshot.goal === 0 ? null : snapshot.progress / snapshot.goal,
        reached: snapshot.complete,
      };
      history.push(point);
      latestComputed = point;
    }

    const source: QuestProgressMetricSource = canComputeHistory
      ? "events"
      : stored !== null
        ? "snapshot"
        : "unavailable";
    const currentProgress = canComputeHistory
      ? (latestComputed?.progress ?? null)
      : (stored?.progress ?? null);
    const goal = quest.condition?.goal ?? stored?.goal ?? null;
    const currentCompletionRatio =
      currentProgress === null || goal === null || goal <= 0
        ? null
        : Math.min(1, currentProgress / goal);
    const claimedAt =
      stored?.completedAt !== null &&
      stored?.completedAt !== undefined &&
      isValidUtcTimestamp(stored.completedAt) &&
      (localDateAtInstant(stored.completedAt, period) ?? "9999-99-99") <= throughDate
        ? stored.completedAt
        : null;
    questMetrics.push({
      questId: quest.id,
      title: quest.title,
      goal,
      currentProgress,
      currentCompletionRatio,
      claimedAt,
      source,
      historyAvailable: canComputeHistory,
      history,
    });
  }

  return {
    ok: true,
    value: {
      period,
      asOfLocalDate: input.asOfLocalDate,
      xpDelta,
      transactionCount,
      xpBySource,
      totalXpAtPeriodStart: hasEvaluatedDay ? openingXp : null,
      totalXpAtPeriodEnd: lastDay?.totalXp ?? null,
      levelAtPeriodStart,
      levelAtPeriodEnd: lastDay?.level ?? null,
      levelsGained,
      levelsLost,
      xpTrend,
      quests: questMetrics,
      questsWithHistory: questMetrics.filter((quest) => quest.historyAvailable).length,
    },
  };
}
