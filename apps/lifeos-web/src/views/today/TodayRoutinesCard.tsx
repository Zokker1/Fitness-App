// T084/T153: päivän rutiinikortti (§4). MetricCard-perhe näyttää aktiiviset
// rutiinit ja, kun tämän päivän suoritus on olemassa, todellisen progressin
// sekä seuraavan vaiheen. Ilman suoritusdataa kortti ei valehtele 0 %:ia.
// Linkki avaa tai jatkaa rutiinin playeria (/goals?routine=...).
//
// TIEDOT: TodayView syöttää summaryn (kortti ei hae, ei laske).
import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { MetricCard, Meta, ProgressBar } from "@lifeos/ui";
import type { TodayRoutinesSummary } from "@lifeos/data";

export function TodayRoutinesCard({
  summary,
}: {
  readonly summary: TodayRoutinesSummary;
}): React.JSX.Element {
  if (summary.routines.length === 0) {
    return (
      <MetricCard
        heading={t("Päivän rutiinit")}
        value="Ei rutiineja"
        valueLabel={t("Ei aktiivisia rutiineja")}
        data-testid="today-routines-empty"
      >
        <Meta>{t("Luo ensimmäinen rutiini Tavoitteet ja rutiinit -näkymässä.")}</Meta>
        <p>
          <Link to="/goals">{t("Avaa tavoitteet ja rutiinit")}</Link>
        </p>
      </MetricCard>
    );
  }
  const stepWord =
    summary.totalSteps === 1
      ? t("1 askel")
      : tTemplate("{{0}} askelta", [String(summary.totalSteps)]);
  const progressText =
    summary.progressPercent === null
      ? tTemplate("{{0}} yhteensä.", [stepWord])
      : tTemplate("{{0}} % rutiinivaiheista käsitelty tänään.", [
          String(Math.round(summary.progressPercent)),
        ]);
  return (
    <MetricCard
      heading={t("Päivän rutiinit")}
      value={tTemplate("{{0}} rutiinia", [String(summary.routineCount)])}
      valueLabel={tTemplate("{{0}} aktiivista rutiinia, {{1}}", [
        String(summary.routineCount),
        stepWord,
      ])}
      changeText={
        summary.totalSteps === 0
          ? t("Rutiineilla ei ole askelia vielä — lisää ensimmäinen Tavoitteet-näkymässä.")
          : progressText
      }
      data-testid="today-routines-card"
    >
      <ul data-ui="card-log-list">
        {summary.routines.map((view) => (
          <li key={view.routine.id} data-ui="card-log-row">
            <div>
              <strong>{view.routine.title}</strong>
              <Meta>
                {view.todayRun?.status === "completed"
                  ? view.todayRun.dayMode === "minimum"
                    ? t("Minimipäivä valmis")
                    : t("Valmis tänään")
                  : view.todayRun?.status === "running"
                    ? tTemplate("{{0}} / {{1}} vaihetta käsitelty{{2}}", [
                        String(view.completedSteps),
                        String(view.targetSteps),
                        view.todayRun.dayMode === "minimum" ? t(" · minimipäivä") : "",
                      ])
                    : t("Ei vielä aloitettu tänään")}
              </Meta>
              {view.steps.length === 0 ? (
                <Meta>{t("Ei askelia vielä")}</Meta>
              ) : (
                <>
                  {view.progressPercent !== null ? (
                    <ProgressBar
                      value={view.progressPercent}
                      label={tTemplate("{{0}}: {{1}} / {{2}} vaihetta", [
                        view.routine.title,
                        String(view.completedSteps),
                        String(view.targetSteps),
                      ])}
                      size="sm"
                    />
                  ) : null}
                  <ol data-ui="routine-steps">
                    {view.steps.map((step) => (
                      <li
                        key={step.id}
                        data-state={view.currentStep?.id === step.id ? "current" : undefined}
                      >
                        {step.title}
                      </li>
                    ))}
                  </ol>
                  {view.currentStep !== null ? (
                    <p data-ui="routine-next-step">
                      {view.todayRun?.status === "running" ? t("Seuraavaksi") : t("Aloita tästä")}:{" "}
                      {view.currentStep.title}
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <span data-ui="card-log-value">
              <Link
                to={`/goals?routine=${encodeURIComponent(view.routine.id)}`}
                aria-label={
                  view.todayRun?.status === "running"
                    ? tTemplate("Jatka rutiinia {{0}}", [view.routine.title])
                    : tTemplate("Avaa rutiini {{0}}", [view.routine.title])
                }
                data-testid={`routine-open-${view.routine.id}`}
              >
                {view.todayRun?.status === "running" ? t("Jatka") : t("Avaa")}
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </MetricCard>
  );
}
