// T150: vaiheittainen rutiinisuoritus. Player näyttää yhden seuraavan
// toiminnon kerrallaan ja käyttää T149:n service-rajaa; se ei kirjoita
// routine- tai history-repositoryihin suoraan.
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Display,
  EmptyState,
  Input,
  Meta,
  ProgressBar,
  Skeleton,
} from "@lifeos/ui";
import type { Routine, RoutineRunDayMode, RoutineStep } from "@lifeos/domain";
import {
  completeRoutineRun,
  completeRoutineStep,
  listRoutineHistory,
  listRoutineSteps,
  skipRoutineStep,
  startRoutineRun,
  systemClock,
  type RoutineHistoryEntry,
  type RoutineServiceDeps,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";

function localTodayKey(): string {
  const offset = -new Date().getTimezoneOffset();
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
}

function formatDate(localDate: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${localDate}T00:00:00.000Z`));
}

function isFinished(status: "pending" | "completed" | "skipped"): boolean {
  return status === "completed" || status === "skipped";
}

export function RoutinePlayer({
  routineId,
  onBack,
}: {
  readonly routineId: string;
  readonly onBack: () => void;
}): React.JSX.Element {
  const { routines, routineSteps, routineSchedules, routineRuns, routineStepRuns, xpTransactions } =
    useData();
  const clock = useMemo(() => systemClock(), []);
  const service = useMemo<RoutineServiceDeps>(
    () => ({
      clock,
      routines,
      routineSteps,
      routineSchedules,
      routineRuns,
      routineStepRuns,
      xpTransactions,
    }),
    [clock, routineRuns, routineSchedules, routineStepRuns, routineSteps, routines, xpTransactions],
  );
  const todayKey = useMemo(() => localTodayKey(), []);
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [steps, setSteps] = useState<readonly RoutineStep[]>([]);
  const [todayEntry, setTodayEntry] = useState<RoutineHistoryEntry | null>(null);
  const [lastEntry, setLastEntry] = useState<RoutineHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSkipForm, setShowSkipForm] = useState(false);
  const [skipReason, setSkipReason] = useState("");

  const refresh = useCallback(async (): Promise<void> => {
    const [routineResult, stepsResult, historyResult] = await Promise.all([
      routines.getById(routineId),
      listRoutineSteps(service, routineId),
      listRoutineHistory(service, routineId),
    ]);
    if (!routineResult.ok) {
      setRoutine(null);
      setError(t("Rutiinia ei löytynyt. Se on voitu poistaa toisessa näkymässä."));
      setLoading(false);
      return;
    }
    if (!stepsResult.ok || !historyResult.ok) {
      setRoutine(routineResult.value);
      setError("Rutiinin vaiheita ei voitu ladata.");
      setLoading(false);
      return;
    }
    const todays = historyResult.value.find((entry) => entry.run.localDate === todayKey) ?? null;
    const previous = historyResult.value.find((entry) => entry.run.localDate !== todayKey) ?? null;
    setRoutine(routineResult.value);
    setSteps(stepsResult.value);
    setTodayEntry(todays);
    setLastEntry(previous);
    setError(null);
    setLoading(false);
  }, [routineId, routines, service, todayKey]);

  useEffect(() => {
    const guard = { cancelled: false };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setError("Rutiinia ei voitu ladata.");
        setLoading(false);
      }
    });
    return () => {
      guard.cancelled = true;
    };
  }, [refresh]);

  const stepRunByStepId = useMemo(
    () => new Map((todayEntry?.steps ?? []).map((stepRun) => [stepRun.routineStepId, stepRun])),
    [todayEntry],
  );
  const isRunning = todayEntry?.run.status === "running";
  const isComplete = todayEntry?.run.status === "completed";
  const isMinimumDay = todayEntry?.run.dayMode === "minimum";
  const targetStepCount = isMinimumDay ? Math.min(1, steps.length) : steps.length;
  const completedCount = steps.reduce((count, step, stepIndex) => {
    if (isMinimumDay && stepIndex > 0) {
      return count;
    }
    const stepRun = stepRunByStepId.get(step.id);
    return count + (stepRun !== undefined && isFinished(stepRun.status) ? 1 : 0);
  }, 0);
  const activeStep = steps.find((step) => {
    const stepRun = stepRunByStepId.get(step.id);
    return stepRun === undefined || !isFinished(stepRun.status);
  });
  const progress = targetStepCount === 0 ? 0 : (completedCount / targetStepCount) * 100;

  const start = async (dayMode: RoutineRunDayMode = "full"): Promise<void> => {
    if (steps.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    const result = await startRoutineRun(service, { routineId, localDate: todayKey, dayMode });
    if (!result.ok) {
      setError(result.error.userMessage);
      setBusy(false);
      return;
    }
    await refresh().catch(() => {
      setError(t("Rutiinin tila ei päivittynyt."));
    });
    setBusy(false);
  };

  const maybeCompleteRun = async (resolvedStepRunId: string): Promise<string | null> => {
    if (todayEntry === null) {
      return null;
    }
    const allFinished = todayEntry.steps.every(
      (item) => item.id === resolvedStepRunId || isFinished(item.status),
    );
    if (!allFinished) {
      return null;
    }
    const completed = await completeRoutineRun(service, todayEntry.run.id);
    if (completed.ok) {
      window.dispatchEvent(new Event("lifeos:data-changed"));
    }
    return completed.ok ? null : completed.error.userMessage;
  };

  const completeActiveStep = async (): Promise<void> => {
    if (todayEntry === null || todayEntry.run.status !== "running" || activeStep === undefined) {
      return;
    }
    const stepRun = stepRunByStepId.get(activeStep.id);
    if (stepRun === undefined) {
      setError(t("Rutiinin seuraavaa vaihetta ei löytynyt."));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await completeRoutineStep(service, stepRun.id);
    if (!result.ok) {
      setError(result.error.userMessage);
      setBusy(false);
      return;
    }
    const completionError = await maybeCompleteRun(result.value.id);
    setShowSkipForm(false);
    setSkipReason("");
    await refresh().catch(() => {
      setError(t("Rutiinin tila ei päivittynyt."));
    });
    if (completionError !== null) {
      setError(completionError);
    }
    setBusy(false);
  };

  const skipActiveStep = async (): Promise<void> => {
    if (
      todayEntry === null ||
      todayEntry.run.status !== "running" ||
      activeStep === undefined ||
      activeStep.optional !== true
    ) {
      return;
    }
    const stepRun = stepRunByStepId.get(activeStep.id);
    if (stepRun === undefined) {
      setError(t("Rutiinin seuraavaa vaihetta ei löytynyt."));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await skipRoutineStep(service, stepRun.id, skipReason);
    if (!result.ok) {
      setError(result.error.userMessage);
      setBusy(false);
      return;
    }
    const completionError = await maybeCompleteRun(result.value.id);
    setShowSkipForm(false);
    setSkipReason("");
    await refresh().catch(() => {
      setError(t("Rutiinin tila ei päivittynyt."));
    });
    if (completionError !== null) {
      setError(completionError);
    }
    setBusy(false);
  };

  if (loading) {
    return (
      <section aria-label={t("Rutiini")} data-testid="routine-player-loading">
        <Display>{t("Rutiini")}</Display>
        <Skeleton lines={6} label={t("Ladataan rutiinia…")} />
      </section>
    );
  }

  if (routine === null) {
    return (
      <section aria-label={t("Rutiini")} data-testid="routine-player-error">
        <Display>{t("Rutiini")}</Display>
        <Alert tone="warning" title={t("Rutiinia ei löytynyt")}>
          <p>{error ?? "Tarkista linkki tai palaa tavoitteiden listaan."}</p>
          <Button onClick={onBack}>{t("Palaa tavoitteisiin")}</Button>
        </Alert>
      </section>
    );
  }

  return (
    <section aria-label={tTemplate("Rutiini: {{0}}", [routine.title])} data-testid="routine-player">
      <div data-ui="routine-player-header">
        <Button variant="secondary" onClick={onBack} aria-label={t("Palaa tavoitteiden listaan")}>
          {t("← Tavoitteet")}
        </Button>
        <div>
          <Display>{routine.title}</Display>
          <p>{t("Yksi vaihe kerrallaan. Riittää, että aloitat seuraavasta.")}</p>
        </div>
      </div>
      {error !== null ? (
        <Alert tone="warning" title={t("Rutiinin tila ei päivittynyt")}>
          <p>{t(error)}</p>
        </Alert>
      ) : null}
      <Card heading={t("Tänään")} data-testid="routine-player-card">
        <div data-ui="routine-player-summary">
          <div>
            <Meta>
              {isComplete
                ? isMinimumDay
                  ? t("Minimipäivä valmis")
                  : t("Rutiini valmis")
                : isRunning
                  ? isMinimumDay
                    ? t("Minimipäivä käynnissä")
                    : t("Käynnissä")
                  : t("Ei vielä aloitettu")}
            </Meta>
            <strong data-ui="routine-player-count">
              {String(completedCount)} / {String(targetStepCount)}
            </strong>
            <span> {t(" vaihetta")}</span>
          </div>
          <ProgressBar
            value={progress}
            label={tTemplate("{{0}}: {{1}} / {{2}} vaihetta", [
              routine.title,
              String(completedCount),
              String(targetStepCount),
            ])}
          />
        </div>

        {steps.length === 0 ? (
          <EmptyState
            icon="check"
            title={t("Rutiinilla ei ole vaiheita vielä.")}
            hint={t(
              "Lisää ensin rutiinille vaiheet, jotta voit suorittaa sen yksi askel kerrallaan.",
            )}
          />
        ) : (
          <>
            <ol data-ui="routine-player-steps" aria-label={t("Rutiinin vaiheet")}>
              {steps.map((step, index) => {
                const stepRun = stepRunByStepId.get(step.id);
                const state =
                  stepRun?.status === "completed"
                    ? "done"
                    : stepRun?.status === "skipped"
                      ? "skipped"
                      : activeStep?.id === step.id && isRunning
                        ? "current"
                        : "pending";
                return (
                  <li key={step.id} data-state={state} data-testid={`routine-step-${step.id}`}>
                    <span data-ui="routine-player-step-marker" aria-hidden="true">
                      {state === "done" ? "✓" : String(index + 1)}
                    </span>
                    <div>
                      <strong>{step.title}</strong>
                      <Meta>
                        {state === "done"
                          ? t("Tehty")
                          : state === "current"
                            ? t("Nykyinen vaihe")
                            : state === "skipped"
                              ? isMinimumDay
                                ? t("Ei kuulu minimipäivään")
                                : t("Ohitettu")
                              : activeStep?.id === step.id
                                ? t("Aloita tästä")
                                : t("Myöhemmin")}
                      </Meta>
                      {step.optional === true ? (
                        <span data-ui="routine-player-step-optional">{t("Valinnainen")}</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ol>
            <div data-ui="routine-player-actions">
              {!isRunning && !isComplete ? (
                <div data-ui="routine-player-start-options">
                  <p>
                    {t(
                      "Jos päivä on raskas, voit tehdä vain rutiinin ensimmäisen tärkeän vaiheen.",
                    )}
                  </p>
                  <div data-ui="routine-player-start-actions">
                    <Button
                      onClick={() => void start("full")}
                      loading={busy}
                      data-testid="routine-start"
                    >
                      {t("Aloita tämän päivän rutiini")}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void start("minimum")}
                      loading={busy}
                      data-testid="routine-start-minimum"
                    >
                      {t("Tee minimipäivä")}
                    </Button>
                  </div>
                </div>
              ) : null}
              {isRunning && activeStep !== undefined ? (
                <>
                  <div data-ui="routine-player-action-row">
                    <Button
                      onClick={() => void completeActiveStep()}
                      loading={busy}
                      data-testid="routine-complete-step"
                    >
                      {t("Merkitse vaihe tehdyksi")}
                    </Button>
                    {activeStep.optional === true ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setShowSkipForm(true);
                          setError(null);
                        }}
                        disabled={busy}
                        data-testid="routine-skip"
                      >
                        {t("Ohita tämä vaihe")}
                      </Button>
                    ) : null}
                  </div>
                  {showSkipForm ? (
                    <div data-ui="routine-player-skip-form" data-testid="routine-skip-form">
                      <Input
                        id="routine-skip-reason"
                        label={t("Miksi ohitat tämän vaiheen?")}
                        hint={t("Lyhyt syy auttaa tulkitsemaan rutiinin historiaa myöhemmin.")}
                        value={skipReason}
                        onChange={(event) => {
                          setSkipReason(event.currentTarget.value);
                        }}
                        autoFocus
                      />
                      <div data-ui="routine-player-skip-actions">
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setShowSkipForm(false);
                            setSkipReason("");
                          }}
                          disabled={busy}
                        >
                          {t("Peruuta")}
                        </Button>
                        <Button
                          onClick={() => void skipActiveStep()}
                          loading={busy}
                          disabled={skipReason.trim().length === 0}
                          data-testid="routine-skip-submit"
                        >
                          {t("Ohita vaihe")}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
              {isComplete ? (
                <div data-ui="routine-player-complete" role="status">
                  <strong>
                    {isMinimumDay
                      ? t("Hyvä — minimipäivä on valmis tältä päivältä.")
                      : t("Hyvä — tämä rutiini on valmis tältä päivältä.")}
                  </strong>
                  <Meta>
                    {isMinimumDay
                      ? t(
                          "Kevyt tavoite kirjautui omana tilanaan; päivä ei muutu epäonnistuneeksi.",
                        )
                      : t("Voit palata myöhemmin katsomaan historiaa.")}
                  </Meta>
                </div>
              ) : null}
            </div>
          </>
        )}
      </Card>
      {lastEntry !== null ? (
        <Card heading={t("Viimeisin suoritus")} data-testid="routine-player-history">
          <p>
            {formatDate(lastEntry.run.localDate)} ·{" "}
            {lastEntry.run.status === "completed" ? t("valmis") : t("kesken")}
          </p>
          <Meta>{t("Historia säilyy erillään rutiinin nykyisistä vaiheista.")}</Meta>
        </Card>
      ) : null}
    </section>
  );
}
