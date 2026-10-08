// T102: Tänään-kortti ryhmittelyllä (§5 näkymät). MetricCard-perhe:
// Myöhässä-ryhmä omalla otsikolla (vanhin ensin, sanallinen "myöhässä"),
// Tänään-ryhmä prioriteettijärjestyksessä, Seuraavat (lähin ensin),
// Valmiit tänään läpivedolla. Ei sekoita ryhmiä (§5: Seuraavat/Myöhässä
// erillään valmistuneista — T103:n tarkennus tulee omalla näkymällään).
// Ei keksittyä "scheduled"-prosenttia (ei suoritusdataa).
//
// TIEDOT: TodayView syöttää ryhmät (T102 groupTasksForToday) + checkboxit
// (complete/reopen servicen kautta — sama kuin T083).
import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { Checkbox, MetricCard, Meta } from "@lifeos/ui";
import type { TodayTaskGroups } from "@lifeos/data";

export interface TodayTasksGroupsCardProps {
  readonly groups: TodayTaskGroups;
  readonly onComplete: (taskId: string) => void;
  readonly onReopen: (taskId: string) => void;
}

function TaskRow({
  taskId,
  title,
  suffix,
  checked,
  onToggle,
}: {
  readonly taskId: string;
  readonly title: string;
  readonly suffix: string;
  readonly checked: boolean;
  readonly onToggle: () => void;
}): React.JSX.Element {
  const checkboxId = `groups-task-${taskId}`;
  return (
    <li data-ui="card-log-row">
      <div>
        <Checkbox
          id={checkboxId}
          data-ui="task-checkbox"
          data-testid={checkboxId}
          checked={checked}
          aria-label={`${title}${suffix}`}
          onChange={onToggle}
        >
          <strong>{title}</strong>
          {suffix}
        </Checkbox>
      </div>
    </li>
  );
}

export function TodayTasksGroupsCard({
  groups,
  onComplete,
  onReopen,
}: TodayTasksGroupsCardProps): React.JSX.Element {
  const hasAny =
    groups.overdue.length > 0 ||
    groups.dueToday.length > 0 ||
    groups.scheduled.length > 0 ||
    groups.completedToday.length > 0;
  if (!hasAny) {
    return (
      <MetricCard
        heading={t("Päivän tehtävät")}
        value="Ei tehtäviä"
        valueLabel={t("Ei avoimia eikä tänään valmistuneita tehtäviä")}
        data-testid="today-groups-empty"
      >
        <Meta>
          {t("Luo ensimmäinen tehtävä Tehtävät-näkymässä — se ilmestyy tänne automaattisesti.")}
        </Meta>
        <p>
          <Link to="/tasks">{t("Avaa tehtävät")}</Link>
        </p>
      </MetricCard>
    );
  }
  const doneCount = groups.completedToday.length;
  const openCount = groups.overdue.length + groups.dueToday.length + groups.scheduled.length;
  return (
    <MetricCard
      heading={t("Päivän tehtävät")}
      value={`${String(doneCount)}/${String(doneCount + openCount)}`}
      valueLabel={tTemplate("{{0}} valmista, {{1}} avoinna", [
        String(doneCount),
        String(openCount),
      ])}
      progress={
        doneCount + openCount === 0 ? 0 : Math.round((doneCount / (doneCount + openCount)) * 100)
      }
      changeText={
        doneCount === 0
          ? tTemplate("{{0}} avoinna — aloita yhdestä.", [String(openCount)])
          : tTemplate("{{0}} valmiina tänään, {{1}} avoinna.", [
              String(doneCount),
              String(openCount),
            ])
      }
      data-testid="today-groups-card"
    >
      {groups.overdue.length > 0 ? (
        <section aria-label={t("Myöhässä")}>
          <Meta>{t("Myöhässä")}</Meta>
          <ul data-ui="card-log-list">
            {groups.overdue.map((row) => (
              <TaskRow
                key={row.id}
                taskId={row.id}
                title={row.title}
                suffix={t(" — myöhässä")}
                checked={false}
                onToggle={() => {
                  onComplete(row.id);
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.dueToday.length > 0 ? (
        <section aria-label={t("Tänään erääntyvät")}>
          <Meta>{t("Tänään")}</Meta>
          <ul data-ui="card-log-list">
            {groups.dueToday.map((row) => (
              <TaskRow
                key={row.id}
                taskId={row.id}
                title={row.title}
                suffix=""
                checked={false}
                onToggle={() => {
                  onComplete(row.id);
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.scheduled.length > 0 ? (
        <section aria-label={t("Tulevat")}>
          <Meta>{t("Tulevat")}</Meta>
          <ul data-ui="card-log-list">
            {groups.scheduled.map((row) => (
              <TaskRow
                key={row.id}
                taskId={row.id}
                title={row.title}
                suffix=""
                checked={false}
                onToggle={() => {
                  onComplete(row.id);
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.completedToday.length > 0 ? (
        <section aria-label={t("Valmiit tänään")}>
          <Meta>{t("Valmiit tänään")}</Meta>
          <ul data-ui="card-log-list">
            {groups.completedToday.map((row) => (
              <TaskRow
                key={row.id}
                taskId={row.id}
                title={row.title}
                suffix=""
                checked={true}
                onToggle={() => {
                  onReopen(row.id);
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </MetricCard>
  );
}
