// T085: päivän tavoitekortit (§4). MetricCard-perhe: jokainen aktiivinen
// tavoite rivinä + natiivi checkbox tälle päivälle (vaihto suoraan kortista —
// ei syvää navigointia). Vain TÄMÄ päivä on vaihdettavissa UI:ssa
// (toggleGoalDay hylkää tulevan completionin — ei väärää completionia).
// Tila sanana ("tehty"/"tekemättä"), ei pelkkänä värinä (§31); katkennut
// putki ei rankaise (ei streak-häpeää §57.14 — rivi on neutraali toteamus).
// Tyhjätila ohjaa Tavoitteet-näkymään.
//
// TIEDOT: TodayView syöttää goalViews:t (T080-projektio) + todayKeyn; vaihto
// kutsuu onToggle-kallbackin (TodayView kytkee repositoryt).
import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { Checkbox, MetricCard, Meta } from "@lifeos/ui";
import type { TodayGoalView } from "@lifeos/data";

export interface TodayGoalsCardProps {
  readonly views: readonly TodayGoalView[];
  readonly onToggle: (goalId: string, completed: boolean) => void;
}

export function TodayGoalsCard({ views, onToggle }: TodayGoalsCardProps): React.JSX.Element {
  if (views.length === 0) {
    return (
      <MetricCard
        heading={t("Päivän tavoitteet")}
        value="Ei tavoitteita"
        valueLabel={t("Ei aktiivisia tavoitteita")}
        data-testid="today-goals-empty"
      >
        <Meta>{t("Luo ensimmäinen tavoite Tavoitteet ja rutiinit -näkymässä.")}</Meta>
        <p>
          <Link to="/goals">{t("Avaa tavoitteet ja rutiinit")}</Link>
        </p>
      </MetricCard>
    );
  }
  const doneCount = views.filter((view) => view.state === "completed").length;
  return (
    <MetricCard
      heading={t("Päivän tavoitteet")}
      value={`${String(doneCount)}/${String(views.length)}`}
      valueLabel={tTemplate("{{0}} tehty, {{1}} tekemättä tänään", [
        String(doneCount),
        String(views.length - doneCount),
      ])}
      changeText={
        doneCount === views.length
          ? "Kaikki tämän päivän tavoitteet tehty."
          : tTemplate("{{0}} tekemättä tänään.", [String(views.length - doneCount)])
      }
      data-testid="today-goals-card"
    >
      <ul data-ui="card-log-list">
        {views.map((view) => {
          const checkboxId = `today-goal-${view.goal.id}`;
          const checked = view.state === "completed";
          return (
            <li key={view.goal.id} data-ui="card-log-row">
              <div>
                <Checkbox
                  id={checkboxId}
                  data-ui="task-checkbox"
                  data-testid={`goal-checkbox-${view.goal.id}`}
                  checked={checked}
                  onChange={() => {
                    onToggle(view.goal.id, !checked);
                  }}
                >
                  <strong>{view.goal.title}</strong>
                </Checkbox>
                <Meta>{checked ? t("tehty") : t("tekemättä")}</Meta>
              </div>
            </li>
          );
        })}
      </ul>
      <p>
        <Link to="/goals">{t("Avaa tavoitteet ja rutiinit")}</Link>
      </p>
    </MetricCard>
  );
}
