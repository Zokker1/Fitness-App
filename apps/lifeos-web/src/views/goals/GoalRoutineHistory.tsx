// T157: goal- ja routine-historian hakunäkymä sekä JSON/CSV-vienti.
import { t, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Display, EmptyState, Input, Meta, Skeleton } from "@lifeos/ui";
import {
  buildGoalRoutineHistory,
  filterGoalRoutineHistory,
  serializeGoalRoutineHistory,
  type GoalRoutineHistoryExportFormat,
  type GoalRoutineHistoryRecord,
  type GoalRoutineHistoryStatus,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { downloadCsv } from "../../utils/downloadCsv.ts";

const STATUS_LABELS: Readonly<Record<GoalRoutineHistoryStatus, string>> = {
  completed: "Valmis",
  "not-completed": "Ei valmis",
  running: "Kesken",
  skipped: "Ohitettu",
  cancelled: "Peruttu",
};

function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T00:00:00.000Z`));
}

function kindLabel(record: GoalRoutineHistoryRecord): string {
  return t(record.kind === "goal-day" ? "Tavoitepäivä" : "Rutiinipäivä");
}

function downloadHistory(
  records: readonly GoalRoutineHistoryRecord[],
  format: GoalRoutineHistoryExportFormat,
): void {
  const content = serializeGoalRoutineHistory(records, format);
  if (format === "csv") {
    downloadCsv(content, "lifeos-historia.csv");
    return;
  }
  const blob = new Blob([content], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lifeos-historia.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function HistoryRow({ record }: { readonly record: GoalRoutineHistoryRecord }): React.JSX.Element {
  return (
    <li data-ui="history-row" data-testid={`history-row-${record.id}`}>
      <div data-ui="history-row-marker" aria-hidden="true">
        {record.kind === "goal-day" ? "○" : "↗"}
      </div>
      <div data-ui="history-row-content">
        <div data-ui="history-row-heading">
          <strong>
            {record.title === "Poistettu tavoite" || record.title === "Poistettu rutiini"
              ? t(record.title)
              : record.title}
          </strong>
          <Meta>{kindLabel(record)}</Meta>
        </div>
        <p>
          {formatDate(record.localDate)} · {t(record.detail)}
        </p>
      </div>
      <span data-ui="history-row-status" data-state={record.status}>
        {t(STATUS_LABELS[record.status])}
      </span>
    </li>
  );
}

export function GoalRoutineHistory({ onBack }: { readonly onBack: () => void }): React.JSX.Element {
  const { goals, goalDays, routines, routineSteps, routineRuns, routineStepRuns } = useData();
  const [records, setRecords] = useState<readonly GoalRoutineHistoryRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const [goalResult, goalDayResult, routineResult, stepResult, runResult, stepRunResult] =
      await Promise.all([
        goals.list(),
        goalDays.list(),
        routines.list(),
        routineSteps.list(),
        routineRuns.list(),
        routineStepRuns.list(),
      ]);
    if (
      !goalResult.ok ||
      !goalDayResult.ok ||
      !routineResult.ok ||
      !stepResult.ok ||
      !runResult.ok ||
      !stepRunResult.ok
    ) {
      setLoadError("Historiaa ei voitu ladata.");
      setLoading(false);
      return;
    }
    setRecords(
      buildGoalRoutineHistory({
        goals: goalResult.value,
        goalDays: goalDayResult.value,
        routines: routineResult.value,
        routineSteps: stepResult.value,
        routineRuns: runResult.value,
        routineStepRuns: stepRunResult.value,
      }),
    );
    setLoadError(null);
    setLoading(false);
  }, [goalDays, goals, routineRuns, routineStepRuns, routineSteps, routines]);

  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => {
          setLoadError("Historiaa ei voitu ladata.");
          setLoading(false);
        });
      }
    };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setLoadError("Historiaa ei voitu ladata.");
        setLoading(false);
      }
    });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const visibleRecords = useMemo(() => filterGoalRoutineHistory(records, query), [query, records]);

  if (loading) {
    return (
      <section aria-label={t("Historia")} data-testid="goal-routine-history-loading">
        <Display>{t("Historia")}</Display>
        <Skeleton lines={6} label={t("Ladataan historiaa…")} />
      </section>
    );
  }

  return (
    <section aria-label={t("Tavoite- ja rutiinihistoria")} data-testid="goal-routine-history">
      <div data-ui="history-header">
        <Button variant="secondary" onClick={onBack} aria-label={t("Palaa tavoitteisiin")}>
          {t("← Tavoitteet")}
        </Button>
        <div>
          <Display>{t("Historia")}</Display>
          <p>{t("Kaikki kirjautuneet tavoitepäivät ja rutiinisuoritukset samassa aikajanassa.")}</p>
        </div>
      </div>
      {loadError !== null ? (
        <Alert tone="warning" title={t("Historia ei päivittynyt")}>
          <p>{t(loadError)}</p>
        </Alert>
      ) : null}
      <Card heading={t("Hae ja vie")} data-testid="history-controls">
        <Input
          id="goal-routine-history-search"
          label={t("Hae historiasta")}
          hint={t("Hae nimen, päivämäärän tai tilan perusteella.")}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
          placeholder={t("Esim. aamu tai 2026-09-21")}
        />
        <div data-ui="history-export-actions">
          <Button
            variant="secondary"
            onClick={() => {
              downloadHistory(records, "json");
            }}
            disabled={records.length === 0}
          >
            {t("Vie historia JSON")}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              downloadHistory(records, "csv");
            }}
            disabled={records.length === 0}
          >
            {t("Vie historia CSV")}
          </Button>
        </div>
        <Meta>
          {t("Näytetään")} {String(visibleRecords.length)} / {String(records.length)}{" "}
          {t("merkintää.")}
        </Meta>
      </Card>
      {visibleRecords.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={records.length === 0 ? t("Historiaa ei vielä ole.") : "Ei osumia."}
          hint={
            records.length === 0
              ? t("Kun kirjaat tavoitepäivän tai päätät rutiinin, se näkyy tässä.")
              : t("Kokeile toista hakusanaa tai tyhjennä haku.")
          }
        />
      ) : (
        <Card heading={t("Kirjaukset")} data-testid="history-list-card">
          <ol data-ui="history-list" aria-label={t("Tavoite- ja rutiinihistoria")}>
            {visibleRecords.map((record) => (
              <HistoryRow key={`${record.kind}-${record.id}`} record={record} />
            ))}
          </ol>
        </Card>
      )}
    </section>
  );
}
