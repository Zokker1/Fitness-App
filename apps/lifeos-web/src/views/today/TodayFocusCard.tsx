// T087: focus summary -kortti (§4). MetricCard-perhe: minuutit tänään +
// istunnot sanallisesti ("35 min, 2 istuntoa tänään"), tyhjänä neutraali
// toteamus ("Ei fokusta vielä tänään" — ei moitetta §52). Kaksi tilaa:
// - käynnissä oleva istunto → "Jatka"-linkki /focus-reitille + kulunut aika;
// - ei käynnissä → "Aloita fokus" -linkki /focus-reitille (suora toiminto,
//   ei syvää navigointia). Fokusnäkymä rakentuu myöhemmissä lohkoissa, joten
//   linkki vie sinne eikä riko mitään.
//
// TIEDOT: TodayView syöttää valmiin summaryn (kortti ei hae, ei laske).
import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { MetricCard, Meta } from "@lifeos/ui";
import type { TodayFocusSummary } from "@lifeos/data";

export function TodayFocusCard({
  summary,
}: {
  readonly summary: TodayFocusSummary;
}): React.JSX.Element {
  if (summary.sessionsToday === 0 && summary.running === null) {
    return (
      <MetricCard
        heading={t("Päivän fokus")}
        value="Ei fokusta"
        valueLabel={t("Ei fokusistuntoja tänään")}
        data-testid="today-focus-empty"
      >
        <Meta>{t("Ei fokusta vielä tänään. Aloita ensimmäinen istunto Fokus-näkymässä.")}</Meta>
        <p>
          <Link to="/focus">{t("Aloita fokus")}</Link>
        </p>
      </MetricCard>
    );
  }
  const minutesWord = summary.minutesToday === 1 ? "1 min" : `${String(summary.minutesToday)} min`;
  const sessionsWord =
    summary.sessionsToday === 1 ? "1 istunto" : `${String(summary.sessionsToday)} istuntoa`;
  return (
    <MetricCard
      heading={t("Päivän fokus")}
      value={minutesWord}
      valueLabel={tTemplate("{{0}} fokusta tänään", [minutesWord])}
      changeText={tTemplate("{{0}} tänään.", [sessionsWord])}
      data-testid="today-focus-card"
    >
      {summary.running === null ? (
        <p>
          <Link to="/focus">{t("Aloita fokus")}</Link>
        </p>
      ) : (
        <p>
          <Link to="/focus" data-testid="today-focus-resume">
            {t("Jatka istuntoa")}
            {summary.runningElapsedMinutes === null
              ? ""
              : ` (${String(summary.runningElapsedMinutes)} min kulunut)`}
          </Link>
        </p>
      )}
    </MetricCard>
  );
}
