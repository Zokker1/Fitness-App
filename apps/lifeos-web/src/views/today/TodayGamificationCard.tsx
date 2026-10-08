// T088: gamification summary -kortti (§4). MetricCard-perhe: "48 XP tänään,
// taso 3" + momentum sanallisesti ("aktiivinen 4/7 päivää" — neutraali
// toteamus, ei rangaistuskieltä §51) + seuraava reward ("Seuraava: Hopeamitali"
// tai ansaittujen määrä). Linkki vie /insights-reitille (Insights-näkymä
// rakentuu T271:ssä; siihen asti reitti on placeholder — ei riko mitään).
// Tyhjätila ilman dataa on rauhallinen ("Ei XP:tä vielä" — toiminta ensin).
//
// T183: LevelProgress tuo korttiin tason, etenemän ja seuraavan rajan
// (level-curve-data T182:sta). Yksi sankarinumero renkaan keskellä — muu
// pysyy hiljaisena (brief §5: boldius yhteen paikkaan).
//
// TIEDOT: TodayView syöttää valmiin summaryn (kortti ei hae, ei laske).
import { t, tTemplate } from "../../language.tsx";
import { Link } from "react-router";
import { Icon, LevelProgress, MetricCard, Meta } from "@lifeos/ui";
import type { TodayGamificationSummary, LevelProgress as LevelProgressData } from "@lifeos/data";
import "./TodayGamificationCard.css";

function levelBlock(progress: LevelProgressData): React.JSX.Element {
  const span = progress.nextLevelAtXp - progress.currentLevelAtXp;
  return (
    <LevelProgress
      level={progress.level}
      value={progress.progressPercent}
      label={tTemplate("Taso {{0}}: {{1}} / {{2}} XP, {{3}} XP seuraavaan tasoon", [
        String(progress.level),
        String(progress.xpIntoLevel),
        String(span),
        String(progress.xpToNextLevel),
      ])}
      current={`${String(progress.xpIntoLevel)} / ${String(span)} XP`}
      target={tTemplate("tason {{0}} raja", [String(progress.level + 1)])}
      statusText={tTemplate("{{0}} XP seuraavaan tasoon.", [String(progress.xpToNextLevel)])}
    />
  );
}

export function TodayGamificationCard({
  summary,
}: {
  readonly summary: TodayGamificationSummary;
}): React.JSX.Element {
  if (summary.totalXp === 0) {
    return (
      <MetricCard
        heading={t("Edistyminen")}
        value="Ei XP:tä"
        valueLabel={t("Ei ansaittua XP:tä vielä")}
        className="today-gamification-card"
        data-testid="today-gamification-empty"
      >
        {levelBlock(summary.levelProgress)}
        <div data-ui="today-gamification-sources">
          <Meta>{t("XP:tä kertyy näistä")}</Meta>
          <ul aria-label={t("XP:n lähteet")}>
            <li>
              <Icon name="tasks" />
              <span>{t("Tehtävät")}</span>
            </li>
            <li>
              <Icon name="focus" />
              <span>{t("Fokus")}</span>
            </li>
            <li>
              <Icon name="check" />
              <span>{t("Rutiinit")}</span>
            </li>
          </ul>
        </div>
        <p data-ui="today-gamification-action">
          <Link to="/insights" data-ui="today-gamification-link">
            {t("Avaa insights")}
          </Link>
        </p>
      </MetricCard>
    );
  }
  const earnedWord =
    summary.earnedCount === 1
      ? "1 palkinto ansaittu"
      : `${String(summary.earnedCount)} palkintoa ansaittu`;
  return (
    <MetricCard
      heading={t("Edistyminen")}
      value={`${String(summary.todayXp)} XP`}
      valueLabel={tTemplate("{{0}} XP tänään, taso {{1}}", [
        String(summary.todayXp),
        String(summary.level),
      ])}
      changeText={tTemplate("Taso {{0}}, aktiivinen {{1}}/7 päivää. {{2}}.", [
        String(summary.level),
        String(summary.momentum.activeDaysLast7),
        earnedWord,
      ])}
      className="today-gamification-card"
      data-testid="today-gamification-card"
    >
      {levelBlock(summary.levelProgress)}
      {summary.nextRewardTitle === null ? null : (
        <Meta>
          {t("Seuraava: ")}
          {summary.nextRewardTitle}
        </Meta>
      )}
      <p data-ui="today-gamification-action">
        <Link to="/insights" data-ui="today-gamification-link">
          {t("Avaa insights")}
        </Link>
      </p>
    </MetricCard>
  );
}
