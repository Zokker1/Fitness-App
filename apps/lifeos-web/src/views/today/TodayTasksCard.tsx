// T083: päivän tehtäväkortti (§4). MetricCard-perhe: progress + tärkeimmät
// tehtävät aidosta datasta. Jokaisella rivillä natiivi checkbox
// (valmis-merkintä suoraan kortista — ei syvää navigointia); rivin nimi on
// label sidottuna id:llä. Myöhässä-rivit erottuvat SANALLA ("myöhässä"),
// eivät pelkällä värillä (§31). Valmiit tänään alempana läpivedolla
// (aria: checkbox checked riittää, ei koriste-strikeä yksin — teksti säilyy).
// Katkaistu lista kertoo piilotettujen määrän; loput /tasks-reitillä.
//
// TIEDOT: TodayView syöttää T080-projektion ryhmät + summaryn (kortti ei hae).
// Valmis-merkintä kutsuu onComplete-kallbackin (TodayView kytkee servicen).

import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { Checkbox, MetricCard, Meta } from "@lifeos/ui";
import type { TodayTasksSummary } from "@lifeos/data";

export interface TodayTasksCardProps {
  readonly summary: TodayTasksSummary;
  readonly onComplete: (taskId: string) => void;
}

export function TodayTasksCard({ summary, onComplete }: TodayTasksCardProps): React.JSX.Element {
  if (summary.progressPercent === null) {
    return (
      <MetricCard
        heading={t("Päivän tehtävät")}
        value="Ei tehtäviä"
        valueLabel={t("Ei avoimia eikä tänään valmistuneita tehtäviä")}
        data-testid="today-tasks-empty"
      >
        <Meta>
          {t("Luo ensimmäinen tehtävä Tehtävät-näkymässä — se ilmestyy tähän automaattisesti.")}
        </Meta>
        <p>
          <Link to="/tasks">{t("Avaa tehtävät")}</Link>
        </p>
      </MetricCard>
    );
  }
  const changeText =
    summary.doneCount === 0
      ? tTemplate("{{0}} avoinna — aloita yhdestä.", [String(summary.openCount)])
      : tTemplate("{{0}} valmiina tänään, {{1}} avoinna.", [
          String(summary.doneCount),
          String(summary.openCount),
        ]);
  return (
    <MetricCard
      heading={t("Päivän tehtävät")}
      value={`${String(summary.doneCount)}/${String(summary.doneCount + summary.openCount)}`}
      valueLabel={tTemplate("{{0}} valmista, {{1}} avoinna", [
        String(summary.doneCount),
        String(summary.openCount),
      ])}
      progress={summary.progressPercent}
      changeText={changeText}
      data-testid="today-tasks-card"
    >
      <ul data-ui="card-log-list">
        {summary.visible.map((view) => {
          const checkboxId = `today-task-${view.task.id}`;
          return (
            <li key={view.task.id} data-ui="card-log-row">
              <div>
                <Checkbox
                  id={checkboxId}
                  data-ui="task-checkbox"
                  data-testid={`task-checkbox-${view.task.id}`}
                  onChange={() => {
                    onComplete(view.task.id);
                  }}
                >
                  <strong>{view.task.title}</strong>
                  {view.overdue ? t(" — myöhässä") : ""}
                </Checkbox>
                {view.checklistTotal > 0 ? (
                  <Meta>
                    {t("Alivaiheet")}
                    {String(view.checklistDone)}/{String(view.checklistTotal)}
                  </Meta>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {summary.hiddenCount > 0 ? (
        <p>
          <Link to="/tasks" data-testid="today-tasks-more">
            +{String(summary.hiddenCount)} {t("lisää Tehtävissä")}
          </Link>
        </p>
      ) : null}
      <p>
        <Link to="/tasks">{t("Avaa tehtävät")}</Link>
      </p>
    </MetricCard>
  );
}
