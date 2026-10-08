// T291: paikallinen reminder history näyttää näkyvän toimituksen ja käyttäjän päätökset.
import { useCallback, useEffect, useState } from "react";
import type { NotificationDelivery, NotificationState, Reminder } from "@lifeos/domain";
import { Button, Card, EmptyState } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";
import { fromDataError, fromUnknown } from "../../errors/appError.ts";
import type { AppError } from "../../errors/appError.ts";
import { ErrorCard } from "../../errors/ErrorCard.tsx";
import { t, useLanguage } from "../../language.tsx";
import "./notification-history.css";

const HISTORY_PAGE_SIZE = 20;
const HISTORY_DELIVERIES: readonly NotificationDelivery[] = [
  "shown",
  "missed",
  "snoozed",
  "dismissed",
];

interface ReminderHistoryRow {
  readonly state: NotificationState;
  readonly title: string | null;
}

function historyStatusLabel(delivery: NotificationDelivery): string {
  switch (delivery) {
    case "shown":
      return t("Näytetty");
    case "missed":
      return t("Jäi väliin");
    case "snoozed":
      return t("Torkutettu");
    case "dismissed":
      return t("Suljettu");
    case "pending":
      return t("Odottaa");
  }
}

function formatTimestamp(value: string, language: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return t("Ajankohta ei ole tiedossa");
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fi-FI", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function NotificationHistorySection(): React.JSX.Element {
  const data = useData();
  const { language } = useLanguage();
  const [rows, setRows] = useState<readonly ReminderHistoryRow[]>([]);
  const [visibleCount, setVisibleCount] = useState(HISTORY_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<AppError | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [stateResult, reminderResult] = await Promise.all([
        data.notificationStates.list(),
        data.reminders.list(),
      ]);
      if (!stateResult.ok) {
        setError(fromDataError(stateResult.error));
        return;
      }
      if (!reminderResult.ok) {
        setError(fromDataError(reminderResult.error));
        return;
      }

      const remindersById = new Map<string, Reminder>(
        reminderResult.value.map((reminder) => [reminder.id, reminder]),
      );
      const history = stateResult.value
        .filter((state) => HISTORY_DELIVERIES.includes(state.delivery))
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .map((state) => {
          const reminder =
            state.reminderId === null ? undefined : remindersById.get(state.reminderId);
          const title = reminder?.title.trim();
          return {
            state,
            title: title !== undefined && title.length > 0 ? title : null,
          };
        });
      setRows(history);
    } catch (error_) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    void reload();
    const onDataChanged = (): void => {
      void reload();
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [reload]);

  const visibleRows = rows.slice(0, visibleCount);

  return (
    <Card heading={t("Muistutushistoria")} data-testid="notification-history">
      <p>{t("Täällä näet muistutusten viimeisimmät toimitustilat ja tekemäsi valinnat.")}</p>
      {loading ? <p role="status">{t("Ladataan muistutushistoriaa…")}</p> : null}
      {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
      {!loading && error === null && rows.length === 0 ? (
        <EmptyState
          title={t("Ei kirjattuja muistutuksia vielä")}
          hint={t("Näytetyt, väliin jääneet, torkutetut ja suljetut muistutukset näkyvät täällä.")}
        />
      ) : null}
      {!loading && error === null && visibleRows.length > 0 ? (
        <ul data-ui="notification-history-list">
          {visibleRows.map(({ state, title }) => (
            <li key={state.id} data-ui="notification-history-row">
              <div data-ui="notification-history-copy">
                <strong>{title ?? t("Muistutus")}</strong>
                <time dateTime={state.updatedAt}>{formatTimestamp(state.updatedAt, language)}</time>
              </div>
              <span data-ui="notification-history-status" data-state={state.delivery}>
                {historyStatusLabel(state.delivery)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {!loading && error === null && rows.length > visibleCount ? (
        <p>
          <Button
            variant="secondary"
            onClick={() => {
              setVisibleCount((count) => count + HISTORY_PAGE_SIZE);
            }}
          >
            {t("Näytä vanhemmat")}
          </Button>
        </p>
      ) : null}
    </Card>
  );
}
