// T189/T191/T271: Insights-koonti ja pelillistetyn edistymisen lisäosat.
import { t } from "../../language.tsx";
import { Card, EmptyState } from "@lifeos/ui";
import { AchievementsGallery } from "./AchievementsGallery.tsx";
import { JourneyCollection } from "./JourneyCollection.tsx";
import { useGamificationVisibility } from "../../preferences/GamificationVisibilityContext.tsx";
import { GamificationTimeline } from "./GamificationTimeline.tsx";
import { InsightsDashboard } from "./InsightsDashboard.tsx";

export function InsightsView(): React.JSX.Element {
  const { visible } = useGamificationVisibility();
  return (
    <>
      <InsightsDashboard />
      {visible === true ? (
        <>
          <GamificationTimeline />
          <AchievementsGallery />
          <JourneyCollection />
        </>
      ) : visible === false ? (
        <Card>
          <EmptyState
            title={t("Pelillistetty edistyminen on piilotettu")}
            hint={t(
              "Muut Insights-mittarit näkyvät edelleen. Voit ottaa edistymisen takaisin käyttöön asetuksissa.",
            )}
          />
        </Card>
      ) : null}
    </>
  );
}
