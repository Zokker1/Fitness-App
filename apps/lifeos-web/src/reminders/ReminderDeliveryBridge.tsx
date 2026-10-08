// T285: aktiivisen sovelluksen due-tapahtuma muuttuu näkyväksi toastiksi ja paikalliseksi historiariviksi.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { systemClock } from "@lifeos/data";
import { resolveNotificationCategoryKey } from "@lifeos/domain";
import type { NotificationCategoryKey, ReminderKind, UtcTimestamp } from "@lifeos/domain";
import { Button, Toast, ToastViewport } from "@lifeos/ui";
import { fromDataError } from "../errors/appError.ts";
import { t } from "../language.tsx";
import { createBrowserCapabilities } from "../adapters/index.ts";
import { useNotificationCategories } from "../preferences/NotificationCategoriesContext.tsx";
import { useData } from "../dataContext.tsx";
import { safeNotificationRoute } from "../routes.ts";
import { REMINDER_DUE_EVENT, startReminderScheduler } from "./reminderScheduler.ts";
import type { ReminderDueDetail } from "./reminderScheduler.ts";
import { notificationOccurrenceId } from "./notificationOccurrenceId.ts";
import "./reminder-delivery.css";

const REMEMBERED_OCCURRENCES_MAXIMUM = 256;
const SNOOZE_DURATION_MS = 10 * 60_000;
const REMINDER_KINDS: readonly ReminderKind[] = ["time", "recurring", "deadline", "conditional"];

function isReminderKind(value: unknown): value is ReminderKind {
  return typeof value === "string" && REMINDER_KINDS.includes(value as ReminderKind);
}

function isScheduledAt(value: unknown): value is UtcTimestamp | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

interface ReminderNotice {
  readonly id: string;
  readonly tone: "info" | "danger";
  readonly title: string;
  readonly body: string;
  readonly reminderId?: string;
  readonly route?: string;
}

function parseReminderDueDetail(value: unknown): ReminderDueDetail | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const categoryKey =
    typeof record.categoryKey === "string"
      ? resolveNotificationCategoryKey(record.categoryKey)
      : null;
  if (
    typeof record.reminderId !== "string" ||
    record.reminderId.length === 0 ||
    !isReminderKind(record.kind) ||
    categoryKey === null ||
    typeof record.occurrenceKey !== "string" ||
    record.occurrenceKey.length === 0 ||
    !isScheduledAt(record.scheduledAt) ||
    typeof record.missed !== "boolean"
  ) {
    return null;
  }
  return {
    reminderId: record.reminderId,
    kind: record.kind,
    categoryKey,
    occurrenceKey: record.occurrenceKey,
    scheduledAt: record.scheduledAt,
    missed: record.missed,
  };
}

function rememberOccurrence(seen: Set<string>, occurrenceKey: string): boolean {
  if (seen.has(occurrenceKey)) return false;
  seen.add(occurrenceKey);
  if (seen.size > REMEMBERED_OCCURRENCES_MAXIMUM) {
    const oldest = seen.values().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
  return true;
}

export function ReminderDeliveryBridge(): React.JSX.Element {
  const data = useData();
  const navigate = useNavigate();
  const { categories, loading: categoriesLoading } = useNotificationCategories();
  const categorySettingsRef = useRef(categories);
  categorySettingsRef.current = categories;
  const seenOccurrences = useRef(new Set<string>());
  const snoozingOccurrences = useRef(new Set<string>());
  const [snoozingIds, setSnoozingIds] = useState<ReadonlySet<string>>(new Set());
  const [notices, setNotices] = useState<readonly ReminderNotice[]>([]);

  const snoozeReminder = async (notice: ReminderNotice): Promise<void> => {
    if (notice.reminderId === undefined || snoozingOccurrences.current.has(notice.id)) return;
    snoozingOccurrences.current.add(notice.id);
    setSnoozingIds(new Set(snoozingOccurrences.current));
    try {
      const now = Date.parse(systemClock().nowIso());
      const snoozedUntil = new Date(now + SNOOZE_DURATION_MS).toISOString();
      const stateId = await notificationOccurrenceId(notice.id);
      const saved = await data.reminders.update(notice.reminderId, { snoozedUntil });
      if (!saved.ok) {
        const error = fromDataError(saved.error);
        setNotices((current) => [
          ...current,
          {
            id: `${notice.id}:snooze-error`,
            tone: "danger",
            title: t("Torkutusta ei voitu tallentaa"),
            body: t(error.body),
          },
        ]);
        return;
      }
      const historySaved = await data.notificationStates.update(stateId, { delivery: "snoozed" });
      setNotices((current) => [
        ...current.filter((item) => item.id !== notice.id),
        {
          id: `${notice.id}:snoozed`,
          tone: "info",
          title: t("Muistutus torkutettu"),
          body: t("Näytämme sen uudelleen 10 minuutin kuluttua."),
        },
        ...(historySaved.ok
          ? []
          : [
              {
                id: `${notice.id}:snooze-history-error`,
                tone: "danger" as const,
                title: t("Muistutusta ei voitu kirjata historiaan"),
                body: t(fromDataError(historySaved.error).body),
              },
            ]),
      ]);
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch {
      setNotices((current) => [
        ...current,
        {
          id: `${notice.id}:snooze-error`,
          tone: "danger",
          title: t("Torkutusta ei voitu tallentaa"),
          body: t("Yritä uudelleen. Jos ongelma jatkuu, tarkista tallennustilan asetukset."),
        },
      ]);
    } finally {
      snoozingOccurrences.current.delete(notice.id);
      setSnoozingIds(new Set(snoozingOccurrences.current));
    }
  };

  const markReminderDismissed = async (notice: ReminderNotice): Promise<void> => {
    if (notice.reminderId === undefined) return;
    try {
      const stateId = await notificationOccurrenceId(notice.id);
      const saved = await data.notificationStates.update(stateId, { delivery: "dismissed" });
      if (!saved.ok) {
        const error = fromDataError(saved.error);
        setNotices((current) => [
          ...current,
          {
            id: `${notice.id}:dismiss-history-error`,
            tone: "danger",
            title: t("Muistutusta ei voitu kirjata historiaan"),
            body: t(error.body),
          },
        ]);
        return;
      }
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch {
      setNotices((current) => [
        ...current,
        {
          id: `${notice.id}:dismiss-history-error`,
          tone: "danger",
          title: t("Muistutusta ei voitu kirjata historiaan"),
          body: t("Yritä uudelleen. Jos ongelma jatkuu, tarkista tallennustilan asetukset."),
        },
      ]);
    }
  };

  const openReminder = (notice: ReminderNotice): void => {
    if (notice.reminderId === undefined) return;
    void navigate(safeNotificationRoute(notice.route));
    setNotices((current) => current.filter((item) => item.id !== notice.id));
  };

  useEffect(() => {
    if (categoriesLoading) return;
    let active = true;
    const isActive = (): boolean => active;
    const handleReminderDue = (event: Event): void => {
      const detail = parseReminderDueDetail((event as CustomEvent<unknown>).detail);
      if (
        detail === null ||
        !categorySettingsRef.current[detail.categoryKey] ||
        !rememberOccurrence(seenOccurrences.current, detail.occurrenceKey)
      ) {
        return;
      }

      void (async () => {
        const reminderResult = await data.reminders.getById(detail.reminderId);
        if (!isActive()) return;
        if (!reminderResult.ok) {
          if (reminderResult.error.code === "not-found") return;
          const error = fromDataError(reminderResult.error);
          setNotices((current) => [
            ...current,
            {
              id: `${detail.occurrenceKey}:read-error`,
              tone: "danger",
              title: t("Muistutusta ei voitu avata"),
              body: t(error.body),
            },
          ]);
          return;
        }

        const reminder = reminderResult.value;
        const currentCategory = resolveNotificationCategoryKey(reminder.categoryKey);
        if (
          !reminder.enabled ||
          reminder.deletedAt !== null ||
          currentCategory !== detail.categoryKey ||
          !categorySettingsRef.current[detail.categoryKey]
        ) {
          return;
        }

        const stateId = await notificationOccurrenceId(detail.occurrenceKey);
        const stateResult = await data.notificationStates.createWithId(stateId, {
          reminderId: reminder.id,
          categoryKey: detail.categoryKey,
          delivery: detail.missed ? "missed" : "shown",
          lastEvaluatedAt: systemClock().nowIso(),
        });
        if (!isActive()) return;
        const title = reminder.title.trim().length > 0 ? reminder.title : t("Muistutus");
        const reminderNotice: ReminderNotice = {
          id: detail.occurrenceKey,
          tone: "info",
          title,
          body: detail.missed
            ? t(
                "Muistutus löytyi ajankohdan jälkeen. Sitä ei toimitettu taustalla; näet sen nyt sovelluksessa.",
              )
            : t("Muistutuksen aika."),
          reminderId: reminder.id,
          route: safeNotificationRoute(reminder.route),
        };
        if (!stateResult.ok) {
          if (stateResult.error.code === "already-exists") return;
          const error = fromDataError(stateResult.error);
          setNotices((current) => [
            ...current,
            {
              id: `${detail.occurrenceKey}:history-error`,
              tone: "danger",
              title: t("Muistutusta ei voitu kirjata historiaan"),
              body: t(error.body),
            },
          ]);
          return;
        }

        setNotices((current) => [...current, reminderNotice]);
        if (!detail.missed) {
          void createBrowserCapabilities().notifications.showIfBackgrounded({
            categoryKey: detail.categoryKey,
            route: reminderNotice.route ?? "/",
            title: reminderNotice.title,
            body: reminderNotice.body,
          });
        }
        window.dispatchEvent(new Event("lifeos:data-changed"));
      })().catch(() => {
        if (!isActive()) return;
        setNotices((current) => [
          ...current,
          {
            id: `${detail.occurrenceKey}:unexpected-error`,
            tone: "danger",
            title: t("Muistutusta ei voitu toimittaa"),
            body: t("Yritä uudelleen. Jos ongelma jatkuu, tarkista tallennustilan asetukset."),
          },
        ]);
      });
    };

    window.addEventListener(REMINDER_DUE_EVENT, handleReminderDue);
    const stopScheduler = startReminderScheduler(data, {
      isCategoryEnabled: (categoryKey: NotificationCategoryKey): boolean =>
        categorySettingsRef.current[categoryKey],
    });
    return () => {
      active = false;
      window.removeEventListener(REMINDER_DUE_EVENT, handleReminderDue);
      stopScheduler();
    };
  }, [categoriesLoading, data]);

  return (
    <ToastViewport>
      {notices.map((notice) => (
        <Toast
          key={notice.id}
          tone={notice.tone}
          title={notice.title}
          body={notice.body}
          action={
            notice.reminderId === undefined ? undefined : (
              <div data-ui="reminder-notice-actions">
                <Button
                  variant="secondary"
                  onClick={() => {
                    openReminder(notice);
                  }}
                >
                  {t("Avaa muistutus")}
                </Button>
                <Button
                  variant="secondary"
                  disabled={snoozingIds.has(notice.id)}
                  onClick={() => void snoozeReminder(notice)}
                >
                  {t("Torkuta 10 min")}
                </Button>
              </div>
            )
          }
          duration={notice.reminderId === undefined ? 3_000 : 15_000}
          dismissLabel={t("Sulje muistutus")}
          onDismiss={() => {
            setNotices((current) => current.filter((item) => item.id !== notice.id));
          }}
          onManualDismiss={() => {
            void markReminderDismissed(notice);
          }}
        />
      ))}
    </ToastViewport>
  );
}
