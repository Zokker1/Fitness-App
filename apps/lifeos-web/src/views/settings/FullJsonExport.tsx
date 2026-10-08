// T275: käyttäjän koko paikallisen datan portable JSON-vienti.
import { t } from "../../language.tsx";
import { useState } from "react";
import { useSearchParams } from "react-router";
import { Alert, Button, Card } from "@lifeos/ui";
import { serializePortableDataSnapshot } from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { useHeight } from "../../preferences/HeightContext.tsx";
import { useHydrationTarget } from "../../preferences/HydrationTargetContext.tsx";
import { useWeightTarget } from "../../preferences/WeightTargetContext.tsx";
import { useGamificationVisibility } from "../../preferences/GamificationVisibilityContext.tsx";
import { readFavoriteFoodIds } from "../../preferences/favorite-foods-storage.ts";
import { readNutritionPreferenceSnapshot } from "../../preferences/nutritionPreferenceSnapshot.ts";
import { isPersistentStorage } from "../../storage/persistenceMode.ts";
import { useTheme } from "../../theme/ThemeContext.tsx";
import { downloadJson } from "../../utils/downloadJson.ts";
import { collectPortableSnapshotInput } from "./collectPortableSnapshotInput.ts";

export function FullJsonExport({
  embedded = false,
}: {
  readonly embedded?: boolean;
}): React.JSX.Element {
  const data = useData();
  const theme = useTheme();
  const weightTarget = useWeightTarget();
  const height = useHeight();
  const hydrationTarget = useHydrationTarget();
  const gamification = useGamificationVisibility();
  const [searchParams] = useSearchParams();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const settingsLoading =
    weightTarget.loading ||
    height.loading ||
    hydrationTarget.loading ||
    gamification.loading ||
    gamification.visible === null;
  const settingsError =
    weightTarget.error !== null ||
    height.error !== null ||
    hydrationTarget.error !== null ||
    gamification.error !== null;

  const createExport = async (): Promise<void> => {
    if (settingsLoading || settingsError) return;
    setWorking(true);
    setError(false);
    setStatus(null);
    try {
      const nutritionPreferences = await readNutritionPreferenceSnapshot(
        isPersistentStorage(searchParams.toString()),
      );
      const favoriteFoodIds = await readFavoriteFoodIds(
        isPersistentStorage(searchParams.toString()),
      );
      const snapshotInput = await collectPortableSnapshotInput(
        data,
        {
          theme: theme.preference,
          gamificationVisible: gamification.visible,
          weightTarget: weightTarget.target,
          heightCm: height.heightCm,
          mealSlots: nutritionPreferences.mealSlots,
          macroTargets: nutritionPreferences.macroTargets,
          hydrationTargetMl: hydrationTarget.targetMilliliters,
          hydrationReminderTime: hydrationTarget.reminderTime,
          favoriteFoodIds,
        },
        isPersistentStorage(searchParams.toString()),
      );
      const json = serializePortableDataSnapshot(snapshotInput);
      const exportTimestamp = snapshotInput.exportedAt
        .replaceAll(":", "")
        .replace(/\.\d{3}Z$/u, "Z");
      const filename = `lifeos-vienti-${exportTimestamp}.json`;
      downloadJson(json, filename);
      setStatus(`JSON-vienti ladattu tiedostoon ${filename}.`);
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  };

  const content = (
    <>
      <p>
        {t(
          "Luo kannettava snapshot kaikista paikallisista merkinnöistäsi ja asetuksistasi. Se sisältää myös päiväkirjan ja terveystiedot.",
        )}
      </p>
      <Alert tone="warning" title={t("JSON-vienti on salaamaton tiedosto")}>
        {t(
          "Tiedosto sisältää yksityisiä tietoja. Säilytä se turvallisesti; tämä vienti ei ole salattu varmuuskopio.",
        )}
      </Alert>
      {settingsError ? (
        <Alert tone="danger" title={t("Asetuksia ei voitu lukea")}>
          {t(
            "Kaikkea snapshotin asetustietoa ei saada koottua. Yritä päivittää sivu ja tarkista asetusten tallennus.",
          )}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" title={t("JSON-vienti epäonnistui")}>
          {t(
            "Kaikkia paikallisia tietoja ei saatu luettua, joten osittaista tiedostoa ei ladattu.",
          )}
        </Alert>
      ) : null}
      {status !== null ? <p role="status">{status}</p> : null}
      <Button
        variant="secondary"
        disabled={working || settingsLoading || settingsError}
        loading={working}
        onClick={() => {
          void createExport();
        }}
      >
        {working ? t("Kootaan JSON-vientiä…") : t("Luo ja lataa koko datan JSON")}
      </Button>
    </>
  );

  return embedded ? (
    <div data-testid="full-json-export" data-ui="data-export-panel">
      {content}
    </div>
  ) : (
    <Card heading={t("Koko datan JSON-vienti")} data-testid="full-json-export">
      {content}
    </Card>
  );
}
