import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import type { CalendarBlock, FocusSession, Task, XPTransaction } from "@lifeos/domain";
import { Meta } from "@lifeos/ui";

interface FocusHistoryProps {
  readonly sessions: readonly FocusSession[];
  readonly tasks: readonly Task[];
  readonly calendarBlocks: readonly CalendarBlock[];
  readonly xpTransactions: readonly XPTransaction[];
  readonly showGamification: boolean;
}

function sessionTimestamp(session: FocusSession): number {
  const timestamp = Date.parse(session.endedAt ?? session.startedAt ?? session.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sessionSeconds(session: FocusSession): number | null {
  const value =
    session.activeElapsedSeconds ??
    (session.phase === "completed" ? session.durationSeconds : null);
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) {
    return t("Aikaa ei tallentunut");
  }
  const minutes = Math.floor((seconds + 30) / 60);
  return seconds > 0 && minutes === 0 ? t("Alle 1 min") : `${String(minutes)} min`;
}

function formatTimestamp(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return t("Ajankohta tuntematon");
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function sessionTitle(
  session: FocusSession,
  tasks: readonly Task[],
  calendarBlocks: readonly CalendarBlock[],
): string {
  if (session.taskId !== null) {
    return tasks.find((task) => task.id === session.taskId)?.title ?? t("Tehtäväfokus");
  }
  if (session.calendarBlockId !== null && session.calendarBlockId !== undefined) {
    return calendarBlocks.find((block) => block.id === session.calendarBlockId)?.title ?? "Timebox";
  }
  return session.routineId === null ? t("Itsenäinen fokus") : t("Rutiinifokus");
}

function interruptionCount(session: FocusSession): number {
  const count = session.interruptionCount ?? 0;
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function formatInterruptions(count: number): string {
  return count === 1 ? t("1 keskeytys") : tTemplate("{{0}} keskeytystä", [String(count)]);
}

function formatSessionCount(count: number): string {
  return count === 1 ? t("1 istunto") : tTemplate("{{0}} istuntoa", [String(count)]);
}

export function FocusHistory({
  sessions,
  tasks,
  calendarBlocks,
  xpTransactions,
  showGamification,
}: FocusHistoryProps): React.JSX.Element {
  const history = sessions
    .filter((session) => session.phase === "completed" || session.phase === "cancelled")
    .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left));
  const knownDurations = history
    .map(sessionSeconds)
    .filter((seconds): seconds is number => seconds !== null);
  const totalSeconds = knownDurations.reduce((total, seconds) => total + seconds, 0);
  const totalInterruptions = history.reduce(
    (total, session) => total + interruptionCount(session),
    0,
  );

  return (
    <section data-ui="focus-history" aria-labelledby="focus-history-title">
      <div data-ui="focus-history-header">
        <h2 id="focus-history-title">{t("Fokushistoria")}</h2>
        {history.length > 0 ? (
          <Meta>
            {formatSessionCount(history.length)} ·{" "}
            {knownDurations.length > 0
              ? tTemplate("{{0}} tallennettua", [formatDuration(totalSeconds)])
              : t("Aikaa ei tallentunut")}{" "}
            · {formatInterruptions(totalInterruptions)}
          </Meta>
        ) : null}
      </div>
      {showGamification ? (
        <p data-ui="focus-history-xp-rules">
          {t("Vähintään 5 aktiivista minuuttia: +15 XP · enintään 3 palkkiota päivässä.")}
        </p>
      ) : null}
      {history.length === 0 ? (
        <p data-ui="focus-history-empty">
          {t("Valmiit fokusjaksot ja keskeytykset näkyvät täällä.")}
        </p>
      ) : (
        <ul data-ui="focus-history-list">
          {history.map((session) => {
            const timestamp = session.endedAt ?? session.startedAt ?? session.updatedAt;
            const status = session.phase === "completed" ? t("Valmis") : t("Peruttu");
            const xp = showGamification
              ? xpTransactions.find(
                  (transaction) =>
                    transaction.source === "focus" && transaction.sourceEntityId === session.id,
                )
              : undefined;
            return (
              <li key={session.id} data-ui="focus-history-item">
                <div data-ui="focus-history-item-heading">
                  <h3>{sessionTitle(session, tasks, calendarBlocks)}</h3>
                  <time dateTime={timestamp}>{formatTimestamp(timestamp)}</time>
                </div>
                <p>
                  {status} · {formatDuration(sessionSeconds(session))} ·{" "}
                  {formatInterruptions(interruptionCount(session))}
                  {xp === undefined ? null : (
                    <span data-ui="focus-history-xp">
                      {" "}
                      · +{String(xp.amount)} {t(" XP")}
                    </span>
                  )}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
