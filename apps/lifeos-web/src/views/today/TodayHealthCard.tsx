// T086: health summary -kortti (§4). MetricCard-perhe RIVEINÄ (LogCard-
// rakenne MetricCard-kehyksessä on tarpeeton — MetricCardin lapset riittävät):
// otsikko "Terveys tänään" + neutraalit toteamusrivit (uni, mieliala,
// lisäravinteet, neste). Ei diagnooseja, ei hälytyksiä (periaate 4, §52);
// tyhjätila sanoo ettei lukuja ole vielä (ei "0"-harhaa). Linkki vie
// Terveys- ja Ravinto-näkymiin.
//
// TIEDOT: TodayView syöttää valmiin summaryn (kortti ei hae, ei laske).
import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { MetricCard, Meta } from "@lifeos/ui";
import type { TodayHealthSummary } from "@lifeos/data";

function displayHealthValue(value: string): string {
  const exactTranslation = t(value);
  if (exactTranslation !== value) return exactTranslation;

  return value
    .replace(/, laatu /gu, `, ${t("laatu")} `)
    .replace(/, energia /gu, `, ${t("energia")} `)
    .replace(/ ml tänään/u, ` ml ${t("tänään")}`)
    .replace(
      /^(Ottamatta|Otettu|Ohitettu|Odottaa|Ei kirjattu):/u,
      (_match, label: string) => `${t(label)}:`,
    );
}

export function TodayHealthCard({
  summary,
}: {
  readonly summary: TodayHealthSummary;
}): React.JSX.Element {
  if (summary.rows.length === 0) {
    return (
      <MetricCard
        heading={t("Terveys tänään")}
        value="Ei lukuja"
        valueLabel={t("Ei terveyskirjauksia vielä")}
        data-testid="today-health-empty"
      >
        <Meta>{t("Kirjaa uni tai mieliala Terveys-näkymässä ja neste Ravinto-näkymässä.")}</Meta>
        <p>
          <Link to="/health">{t("Avaa terveys")}</Link>
          {" · "}
          <Link to="/nutrition">{t("Avaa ravinto")}</Link>
        </p>
      </MetricCard>
    );
  }
  return (
    <MetricCard
      heading={t("Terveys tänään")}
      value={`${String(summary.rows.length)} lukua`}
      valueLabel={tTemplate("{{0}} terveyslukua tänään", [String(summary.rows.length)])}
      data-testid="today-health-card"
    >
      <ul data-ui="card-log-list">
        {summary.rows.map((row) => (
          <li key={row.label} data-ui="card-log-row">
            <div>
              <strong>{t(row.label)}</strong>
            </div>
            <span data-ui="card-log-value">{displayHealthValue(row.value)}</span>
          </li>
        ))}
      </ul>
      <p>
        <Link to="/health">{t("Avaa terveys")}</Link>
        {" · "}
        <Link to="/nutrition">{t("Avaa ravinto")}</Link>
      </p>
    </MetricCard>
  );
}
