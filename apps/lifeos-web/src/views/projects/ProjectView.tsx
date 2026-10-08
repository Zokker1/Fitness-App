// T107: Projektit-näkymä (§5 kategoriat/projektit). Kriteeri: tehtäväryhmällä
// on progress, status ja historia.
// - Luonti: nimi → "Luo projekti" (yksi vuorovaikutus, §21).
// - Yhteenveto per projekti (summarizeProjects, data-paketti): MetricCard
//   progressilla (done/total + %), johdettu status (Käynnissä/Valmis/
//   Arkistoitu — ei häpeäkieltä §51) ja valmistumishistoria (uusin ensin).
// TIEDOT: useData.projects + useData.tasks (yksi haku, T080-malli);
// data-changed-eventti päivittää näkymän (sama kaava kuin TaskInboxView).
import { t, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Display,
  EmptyState,
  Input,
  Meta,
  MetricCard,
  Skeleton,
} from "@lifeos/ui";
import type { ProjectSummary } from "@lifeos/data";
import { summarizeProjects } from "@lifeos/data";
import { useData } from "../../dataContext.tsx";

const STATUS_LABELS: Readonly<Record<ProjectSummary["status"], string>> = {
  active: "Käynnissä",
  complete: "Valmis",
  archived: "Arkistoitu",
};

function formatHistoryTime(completedAt: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(completedAt));
}

export function ProjectView(): React.JSX.Element {
  const { projects, tasks } = useData();
  const [summaries, setSummaries] = useState<readonly ProjectSummary[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const refresh = useCallback(async () => {
    const [listedProjects, listedTasks] = await Promise.all([projects.list(), tasks.list()]);
    if (listedProjects.ok && listedTasks.ok) {
      setSummaries(summarizeProjects(listedProjects.value, listedTasks.value));
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoading(false);
  }, [projects, tasks]);
  useEffect(() => {
    const guard = { cancelled: false };
    const shouldStop = (): boolean => guard.cancelled;
    const onDataChanged = (): void => {
      if (!shouldStop()) {
        void refresh().catch(() => undefined);
      }
    };
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!shouldStop()) {
          setLoading(false);
        }
      });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const create = async (): Promise<void> => {
    const trimmed = name.trim();
    if (trimmed.length === 0 || creating) {
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const created = await projects.create({
        name: trimmed,
        colorKey: null,
        archivedAt: null,
        deletedAt: null,
      });
      if (!created.ok) {
        setCreateError(created.error.userMessage);
        return;
      }
      setName("");
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } catch {
      setCreateError(t("Luonti epäonnistui. Yritä uudelleen."));
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <section aria-label={t("Projektit")} data-testid="project-view">
        <Display>{t("Projektit")}</Display>
        <Skeleton lines={3} label={t("Ladataan projekteja…")} />
      </section>
    );
  }
  return (
    <section aria-label={t("Projektit")} data-testid="project-view">
      <Display>{t("Projektit")}</Display>
      {loadFailed ? (
        <Alert tone="warning" title={t("Projekteja ei voitu ladata")}>
          <p>{t("Yritä ladata näkymä uudelleen hetken kuluttua.")}</p>
        </Alert>
      ) : null}
      <Card heading={t("Uusi projekti")}>
        <Input
          label={t("Projektin nimi")}
          placeholder={t("Esim. Remontti")}
          value={name}
          error={createError === "" ? undefined : t(createError)}
          disabled={creating}
          onChange={(event) => {
            setName(event.target.value);
            if (createError !== "") {
              setCreateError("");
            }
          }}
        />
        <p>
          <Button
            variant="primary"
            loading={creating}
            disabled={name.trim().length === 0 || creating}
            data-testid="project-create"
            onClick={() => void create()}
          >
            {t("Luo projekti")}
          </Button>
        </p>
        <Meta>{t("Liitä tehtäviä projektiin Quick Task -lomakkeen Projekti-valinnalla.")}</Meta>
      </Card>
      {summaries !== undefined && summaries.length === 0 ? (
        <EmptyState
          icon="add"
          title={t("Ei projekteja.")}
          hint={t("Luo ensimmäinen projekti yltä — tehtävät liittyvät projektiin Quick Taskissa.")}
        />
      ) : null}
      {summaries !== undefined && summaries.length > 0 ? (
        <div data-testid="project-list">
          {summaries.map((summary) => (
            <MetricCard
              key={summary.projectId}
              heading={summary.name}
              value={`${String(summary.doneCount)}/${String(summary.total)}`}
              valueLabel={t(STATUS_LABELS[summary.status])}
              progress={summary.progressPercent}
              changeText={`${String(summary.openCount)} avoinna`}
              data-testid={`project-card-${summary.projectId}`}
            >
              <Meta>
                {t(STATUS_LABELS[summary.status])} — {String(summary.progressPercent)} %
              </Meta>
              {summary.history.length > 0 ? (
                <div>
                  <Meta>{t("Historia")}</Meta>
                  <ul data-ui="card-log-list" data-testid={`project-history-${summary.projectId}`}>
                    {summary.history.slice(0, 5).map((entry) => (
                      <li key={entry.taskId} data-ui="card-log-row">
                        <div>
                          <strong>{entry.title}</strong>
                          <Meta>
                            {t("Valmistui ")}
                            {formatHistoryTime(entry.completedAt)}
                          </Meta>
                        </div>
                      </li>
                    ))}
                  </ul>
                  {summary.history.length > 5 ? (
                    <Meta>
                      {t("Ja ")}
                      {String(summary.history.length - 5)} {t(" aiempaa valmistumista.")}
                    </Meta>
                  ) : null}
                </div>
              ) : (
                <Meta>{t("Ei valmistumishistoriaa vielä.")}</Meta>
              )}
            </MetricCard>
          ))}
        </div>
      ) : null}
    </section>
  );
}
