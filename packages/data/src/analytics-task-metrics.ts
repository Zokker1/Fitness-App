// T261: tehtävien valmistumisaste johdetaan paikallisista tehtäväriveistä.

import type { Task } from "@lifeos/domain";
import { isValidLocalDateKey } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import {
  buildAnalyticsProjection,
  type AnalyticsProjectionPeriod,
} from "./analytics-projection.ts";

export interface TaskCompletionDayMetric {
  readonly localDate: string;
  readonly completedTaskCount: number;
  readonly openDueTaskCount: number;
  readonly eligibleTaskCount: number;
  /** Osuus välillä 0–1; null tarkoittaa, ettei päivälle ole arvioitavaa tehtävää. */
  readonly completionRate: number | null;
}

export interface TaskCompletionMetrics {
  readonly period: AnalyticsProjectionPeriod;
  readonly asOfLocalDate: string;
  readonly completedTaskCount: number;
  readonly openDueTaskCount: number;
  readonly eligibleTaskCount: number;
  /** Osuus välillä 0–1; null tarkoittaa, ettei jaksolla ole arvioitavia tehtäviä. */
  readonly completionRate: number | null;
  readonly trend: readonly TaskCompletionDayMetric[];
}

export interface TaskCompletionMetricsInput {
  readonly period: AnalyticsProjectionPeriod;
  /** Tulevat päivät jäävät trendissä arvioimatta. Kutsuja antaa paikallisen päivän. */
  readonly asOfLocalDate: string;
  readonly tasks: readonly Task[];
}

function invalidTaskMetrics<T>(message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput("data.analytics.task-completion.invalid-input", message),
  };
}

/**
 * Valmistumisaste = jaksolla valmistuneet / (jaksolla valmistuneet +
 * jaksolla erääntyvät, yhä avoimet tehtävät). Pehmeästi poistetut tehtävät ja
 * tulevat päivät eivät vaikuta. Aikatauluttamaton avoin tehtävä ei kuulu
 * nimittäjään; valmistunut tehtävä lasketaan completedAt-päivälle.
 */
export function calculateTaskCompletionMetrics(
  input: TaskCompletionMetricsInput,
): DataResult<TaskCompletionMetrics> {
  if (!isValidLocalDateKey(input.asOfLocalDate)) {
    return invalidTaskMetrics("Arviointipäivän pitää olla kelvollinen paikallispäivä.");
  }

  const projected = buildAnalyticsProjection({
    period: input.period,
    entries: input.tasks,
    occurredAt: (task) => {
      return task.status === "done" ? task.completedAt : task.dueAt;
    },
    includeEntry: (task) => task.deletedAt === null,
  });
  if (!projected.ok) return projected;

  const trend = projected.value.days.map((day): TaskCompletionDayMetric => {
    if (day.localDate > input.asOfLocalDate) {
      return {
        localDate: day.localDate,
        completedTaskCount: 0,
        openDueTaskCount: 0,
        eligibleTaskCount: 0,
        completionRate: null,
      };
    }

    const completedTaskCount = day.entries.filter((task) => task.status === "done").length;
    const openDueTaskCount = day.entries.length - completedTaskCount;
    const eligibleTaskCount = completedTaskCount + openDueTaskCount;
    return {
      localDate: day.localDate,
      completedTaskCount,
      openDueTaskCount,
      eligibleTaskCount,
      completionRate: eligibleTaskCount === 0 ? null : completedTaskCount / eligibleTaskCount,
    };
  });

  const completedTaskCount = trend.reduce((total, day) => total + day.completedTaskCount, 0);
  const openDueTaskCount = trend.reduce((total, day) => total + day.openDueTaskCount, 0);
  const eligibleTaskCount = completedTaskCount + openDueTaskCount;

  return {
    ok: true,
    value: {
      period: projected.value.period,
      asOfLocalDate: input.asOfLocalDate,
      completedTaskCount,
      openDueTaskCount,
      eligibleTaskCount,
      completionRate: eligibleTaskCount === 0 ? null : completedTaskCount / eligibleTaskCount,
      trend,
    },
  };
}
