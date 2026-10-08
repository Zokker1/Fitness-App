// T197: XP-ledgerin jäljitettävä aikajana (§9, §30, §51).
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FocusSession,
  Goal,
  GoalDay,
  Routine,
  RoutineRun,
  Task,
  XPTransaction,
  XpSource,
} from "@lifeos/domain";
import { Link } from "react-router";
import { Alert, Button, Card, EmptyState, Skeleton } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";

const SOURCE_LABELS: Record<XpSource, string> = {
  task: "Tehtävä",
  routine: "Rutiini",
  focus: "Fokus",
  habit: "Tavoitepäivä",
  health: "Terveyskirjaus",
  quest: "Haaste",
  manual: "XP-muutos",
};

const DEFAULT_REASONS: Record<XpSource, string> = {
  task: "Tehtävä valmis",
  routine: "Rutiinipäivä valmis",
  focus: "Fokusjakso valmis",
  habit: "Tavoitepäivä valmis",
  health: "Terveyskirjaus",
  quest: "Haasteen suoritus",
  manual: "Manuaalinen XP-kirjaus",
};

interface TimelineEntry {
  readonly transaction: XPTransaction;
  readonly title: string;
  readonly reason: string;
  readonly href: string | undefined;
}

interface SourceLookups {
  readonly tasks: ReadonlyMap<string, Task>;
  readonly routines: ReadonlyMap<string, Routine>;
  readonly routineRuns: ReadonlyMap<string, RoutineRun>;
  readonly focusSessions: ReadonlyMap<string, FocusSession>;
  readonly goalDays: ReadonlyMap<string, GoalDay>;
  readonly goals: ReadonlyMap<string, Goal>;
}

function indexById<T extends { readonly id: string }>(items: readonly T[]): ReadonlyMap<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function describeSource(transaction: XPTransaction, sources: SourceLookups): string {
  const sourceId = transaction.sourceEntityId;
  if (sourceId === null) {
    return t(SOURCE_LABELS[transaction.source]);
  }

  switch (transaction.source) {
    case "task": {
      const task = sources.tasks.get(sourceId);
      return task === undefined ? t("Tehtävä") : tTemplate("Tehtävä: {{0}}", [task.title]);
    }
    case "routine": {
      const run = sources.routineRuns.get(sourceId);
      const routine = run === undefined ? undefined : sources.routines.get(run.routineId);
      return routine === undefined ? t("Rutiini") : tTemplate("Rutiini: {{0}}", [routine.title]);
    }
    case "focus": {
      const session = sources.focusSessions.get(sourceId);
      if (session?.taskId !== null && session?.taskId !== undefined) {
        const task = sources.tasks.get(session.taskId);
        if (task !== undefined) {
          return tTemplate("Fokus: {{0}}", [task.title]);
        }
      }
      if (session?.routineId !== null && session?.routineId !== undefined) {
        const routine = sources.routines.get(session.routineId);
        if (routine !== undefined) {
          return tTemplate("Fokus: {{0}}", [routine.title]);
        }
      }
      return t("Fokusjakso");
    }
    case "habit": {
      const day = sources.goalDays.get(sourceId);
      const goal = day === undefined ? undefined : sources.goals.get(day.goalId);
      return goal === undefined ? t("Tavoitepäivä") : tTemplate("Tavoite: {{0}}", [goal.title]);
    }
    case "health":
      // Terveyslähteen sisältöä ei nosteta tähän yhteenvetoon.
      return t("Terveyskirjaus");
    case "quest":
      return t("Haaste");
    case "manual":
      return transaction.reason?.startsWith("Lunastuksen XP-vähennys:") === true
        ? t("Palkinnon lunastus")
        : t("XP-muutos");
  }
}

function sourceHref(transaction: XPTransaction, sources: SourceLookups): string | undefined {
  const sourceId = transaction.sourceEntityId;
  if (sourceId === null) {
    return undefined;
  }

  switch (transaction.source) {
    case "task":
      return sources.tasks.has(sourceId)
        ? `/tasks?task=${encodeURIComponent(sourceId)}`
        : undefined;
    case "routine":
      return sources.routineRuns.has(sourceId) ? "/goals" : undefined;
    case "focus": {
      const session = sources.focusSessions.get(sourceId);
      if (session?.taskId !== null && session?.taskId !== undefined) {
        const task = sources.tasks.get(session.taskId);
        if (task !== undefined) {
          return `/tasks?task=${encodeURIComponent(task.id)}`;
        }
      }
      if (session?.routineId !== null && session?.routineId !== undefined) {
        return sources.routines.has(session.routineId) ? "/goals" : undefined;
      }
      return session === undefined ? undefined : "/focus";
    }
    case "habit": {
      const day = sources.goalDays.get(sourceId);
      const goal = day === undefined ? undefined : sources.goals.get(day.goalId);
      return goal === undefined ? undefined : `/goals?goal=${encodeURIComponent(goal.id)}`;
    }
    case "health":
      return "/health";
    case "quest":
    case "manual":
      return undefined;
  }
}

function buildTimeline(
  transactions: readonly XPTransaction[],
  sources: SourceLookups,
): readonly TimelineEntry[] {
  return transactions
    .map((transaction) => ({
      transaction,
      title: describeSource(transaction, sources),
      reason:
        typeof transaction.reason !== "string"
          ? t(DEFAULT_REASONS[transaction.source])
          : transaction.reason,
      href: sourceHref(transaction, sources),
    }))
    .sort((a, b) => {
      const timeOrder = Date.parse(b.transaction.earnedAt) - Date.parse(a.transaction.earnedAt);
      return timeOrder === 0 ? b.transaction.id.localeCompare(a.transaction.id) : timeOrder;
    });
}

function formatEarnedAt(earnedAt: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(earnedAt));
}

function formatAmount(amount: number): string {
  if (amount > 0) {
    return `+${String(amount)} XP`;
  }
  if (amount < 0) {
    return `−${String(Math.abs(amount))} XP`;
  }
  return "0 XP";
}

const INITIAL_VISIBLE_COUNT = 20;
const PAGE_SIZE = 20;

export function GamificationTimeline(): React.JSX.Element {
  const { xpTransactions, tasks, routines, routineRuns, focusSessions, goalDays, goals } =
    useData();
  const [entries, setEntries] = useState<readonly TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT);
  const mounted = useRef(false);
  const latestRequest = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    try {
      const [
        listedXp,
        listedTasks,
        listedRuns,
        listedRoutines,
        listedFocus,
        listedDays,
        listedGoals,
      ] = await Promise.all([
        xpTransactions.list(),
        tasks.list(),
        routineRuns.list(),
        routines.list(),
        focusSessions.list(),
        goalDays.list(),
        goals.list(),
      ]);
      if (requestId !== latestRequest.current || !mounted.current) {
        return;
      }
      if (!listedXp.ok) {
        setLoadFailed(true);
        return;
      }

      const sources: SourceLookups = {
        tasks: indexById(listedTasks.ok ? listedTasks.value : []),
        routines: indexById(listedRoutines.ok ? listedRoutines.value : []),
        routineRuns: indexById(listedRuns.ok ? listedRuns.value : []),
        focusSessions: indexById(listedFocus.ok ? listedFocus.value : []),
        goalDays: indexById(listedDays.ok ? listedDays.value : []),
        goals: indexById(listedGoals.ok ? listedGoals.value : []),
      };
      setEntries(buildTimeline(listedXp.value, sources));
      setLoadFailed(false);
    } catch {
      if (requestId === latestRequest.current && mounted.current) {
        setLoadFailed(true);
      }
    } finally {
      if (requestId === latestRequest.current && mounted.current) {
        setLoading(false);
      }
    }
  }, [focusSessions, goalDays, goals, routineRuns, routines, tasks, xpTransactions]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const onDataChanged = (): void => {
      void refresh();
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      mounted.current = false;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const retry = (): void => {
    setLoading(true);
    void refresh();
  };

  return (
    <Card heading={t("XP-tapahtumat")} data-testid="gamification-timeline">
      {loading ? (
        <Skeleton label={t("Ladataan XP-tapahtumia…")} />
      ) : loadFailed ? (
        <Alert
          tone="danger"
          title={t("XP-tapahtumia ei voitu lukea")}
          action={
            <Button variant="secondary" onClick={retry}>
              {t("Yritä uudelleen")}
            </Button>
          }
        >
          {t("Yritä uudelleen hetken kuluttua.")}
        </Alert>
      ) : entries.length === 0 ? (
        <EmptyState
          title={t("Ei XP-tapahtumia vielä")}
          hint={t("Kun ansaitset tai käytät XP:tä, näet täällä lähteen ja kirjauksen ajan.")}
        />
      ) : (
        <>
          <ol data-ui="xp-timeline-list" aria-label={t("XP-tapahtumat uusimmasta vanhimpaan")}>
            {entries.slice(0, visibleCount).map(({ transaction, title, reason, href }) => (
              <li key={transaction.id} data-ui="xp-timeline-row">
                <div data-ui="xp-timeline-event">
                  <p data-ui="xp-timeline-title">
                    <strong>
                      {href === undefined ? (
                        title
                      ) : (
                        <Link data-ui="xp-timeline-source-link" to={href}>
                          {title}
                        </Link>
                      )}
                    </strong>
                  </p>
                  <p data-ui="xp-timeline-reason">{reason}</p>
                  <time data-ui="xp-timeline-time" dateTime={transaction.earnedAt}>
                    {formatEarnedAt(transaction.earnedAt)}
                  </time>
                </div>
                <span
                  data-ui="xp-timeline-amount"
                  data-sign={
                    transaction.amount > 0
                      ? "positive"
                      : transaction.amount < 0
                        ? "negative"
                        : "zero"
                  }
                >
                  {formatAmount(transaction.amount)}
                </span>
              </li>
            ))}
          </ol>
          {entries.length > visibleCount ? (
            <Button
              variant="secondary"
              data-ui="xp-timeline-more"
              onClick={() => {
                setVisibleCount((count) => count + PAGE_SIZE);
              }}
            >
              {t("Näytä vanhempia tapahtumia")}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
