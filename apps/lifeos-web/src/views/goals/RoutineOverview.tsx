// T152: rutiinimallit ovat näkyvä kirjasto, eivät automaattinen onboarding.
// Käyttäjän on painettava luontia ennen kuin yhtään rutiinia tai vaihetta syntyy.
import { t, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import type { Routine, RoutineStep } from "@lifeos/domain";
import { Alert, Button, Card, EmptyState, Meta, Skeleton } from "@lifeos/ui";
import {
  createRoutineFromTemplate,
  listRoutineTemplates,
  systemClock,
  type RoutineTemplateKey,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";

function stepCountLabel(steps: readonly RoutineStep[]): string {
  const optionalCount = steps.filter((step) => step.optional === true).length;
  const base = `${String(steps.length)} vaihe${steps.length === 1 ? "" : "tta"}`;
  return optionalCount === 0
    ? base
    : `${base}, ${String(optionalCount)} valinnainen ${optionalCount === 1 ? "vaihe" : "vaihetta"}`;
}

export function RoutineOverview(): React.JSX.Element {
  const { routines, routineSteps, routineSchedules, routineRuns, routineStepRuns } = useData();
  const templates = useMemo(() => listRoutineTemplates(), []);
  const [items, setItems] = useState<readonly Routine[]>([]);
  const [steps, setSteps] = useState<readonly RoutineStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<RoutineTemplateKey | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [routineResult, stepResult] = await Promise.all([routines.list(), routineSteps.list()]);
    if (!routineResult.ok || !stepResult.ok) {
      setLoadError("Rutiineja ei voitu ladata.");
      setLoading(false);
      return;
    }
    const activeRoutines = routineResult.value
      .filter((routine) => routine.deletedAt === null && routine.archivedAt === null)
      .sort((left, right) => left.title.localeCompare(right.title, getIntlLocale()));
    const activeRoutineIds = new Set(activeRoutines.map((routine) => routine.id));
    setItems(activeRoutines);
    setSteps(
      stepResult.value
        .filter((step) => step.deletedAt === null && activeRoutineIds.has(step.routineId))
        .sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id)),
    );
    setLoadError(null);
    setLoading(false);
  }, [routineSteps, routines]);

  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => {
          setLoadError("Rutiineja ei voitu ladata.");
          setLoading(false);
        });
      }
    };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setLoadError("Rutiineja ei voitu ladata.");
        setLoading(false);
      }
    });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const createFromTemplate = async (templateKey: RoutineTemplateKey): Promise<void> => {
    setCreating(templateKey);
    setLoadError(null);
    const result = await createRoutineFromTemplate(
      {
        clock: systemClock(),
        routines,
        routineSteps,
        routineSchedules,
        routineRuns,
        routineStepRuns,
      },
      { templateKey },
    );
    if (!result.ok) {
      setLoadError(result.error.userMessage);
      setCreating(null);
      return;
    }
    window.dispatchEvent(new Event("lifeos:data-changed"));
    await refresh().catch(() => {
      setLoadError(t("Rutiini luotiin, mutta listaa ei voitu päivittää."));
    });
    setCreating(null);
  };

  if (loading) {
    return (
      <Card heading={t("Rutiinit")} data-testid="routine-overview-loading">
        <Skeleton lines={5} label={t("Ladataan rutiineja…")} />
      </Card>
    );
  }

  return (
    <Card heading={t("Rutiinit")} data-testid="routine-overview">
      <div data-ui="routine-overview-header">
        <div>
          <Meta>{t("Valitse omaan päivääsi sopiva rytmi")}</Meta>
          <p>
            {t(
              "Malli antaa alun, jota voit seurata vaihe kerrallaan. Valinnaisen vaiheen saa ohittaa perustellusti.",
            )}
          </p>
        </div>
      </div>
      <p data-ui="routine-template-note">
        {t("Mallit ovat valinnaisia — mitään ei luoda ennen kuin valitset mallin.")}
      </p>
      {loadError !== null ? (
        <Alert tone="warning" title={t("Rutiinien tila ei päivittynyt")}>
          <p>{t(loadError)}</p>
        </Alert>
      ) : null}
      <div data-ui="routine-template-grid">
        {templates.map((template) => (
          <article
            key={template.key}
            data-ui="routine-template-card"
            data-testid={`routine-template-${template.key}`}
          >
            <div data-ui="routine-template-card-header">
              <div>
                <Meta>{template.key === "morning" ? t("Aamu") : t("Ilta")}</Meta>
                <h3>{template.title}</h3>
              </div>
              <span data-ui="routine-template-count">
                {template.steps.length} {t(" askelta")}
              </span>
            </div>
            <p>{template.description}</p>
            <ol data-ui="routine-template-steps">
              {template.steps.map((step) => (
                <li key={step.title}>
                  <span aria-hidden="true" data-ui="routine-template-step-marker" />
                  <span>{step.title}</span>
                  {step.optional ? <Meta>{t("Valinnainen")}</Meta> : null}
                </li>
              ))}
            </ol>
            <Button
              variant="secondary"
              data-testid={`routine-template-create-${template.key}`}
              loading={creating === template.key}
              disabled={creating !== null}
              onClick={() => {
                void createFromTemplate(template.key);
              }}
            >
              {t("Luo")} {template.key === "morning" ? t("aamurutiini") : t("iltarutiini")}
            </Button>
          </article>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={t("Omat rutiinit näkyvät tässä.")}
          hint={t(
            "Valitse yllä olevasta mallista vain sellainen, joka sopii tämänhetkiseen päivääsi.",
          )}
        />
      ) : (
        <div data-ui="routine-existing-list">
          <div data-ui="routine-existing-heading">
            <Meta>{t("Omat rutiinit")}</Meta>
            <span>
              {items.length} {t(" aktiivista")}
            </span>
          </div>
          <ul>
            {items.map((routine) => {
              const routineStepsForItem = steps.filter((step) => step.routineId === routine.id);
              return (
                <li key={routine.id}>
                  <Link to={`/goals?routine=${encodeURIComponent(routine.id)}`}>
                    <span>{routine.title}</span>
                    <Meta>{stepCountLabel(routineStepsForItem)}</Meta>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}
