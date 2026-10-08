// T274: paikallisten terveyskirjausten moduulikohtainen CSV-vienti.
import { t, tTemplate } from "../../language.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Skeleton } from "@lifeos/ui";
import {
  createHealthCsvExport,
  HEALTH_CSV_EXPORT_DEFINITIONS,
  type HealthCsvExportInput,
  type HealthCsvExportKind,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { downloadCsv } from "../../utils/downloadCsv.ts";
import "./health-data-exports.css";

const EXPORT_LABELS: Readonly<Record<HealthCsvExportKind, string>> = {
  weight: "Vie painohistoria CSV",
  "blood-pressure": "Vie verenpainehistoria CSV",
  "other-measurements": "Vie muut mittaukset CSV",
  hydration: "Vie nesteytyshistoria CSV",
  nutrition: "Vie ravintohistoria CSV",
  sleep: "Vie unihistoria CSV",
  activity: "Vie aktiivisuushistoria CSV",
  mood: "Vie mielialahistoria CSV",
  supplements: "Vie lisäravinnehistoria CSV",
  breathing: "Vie hengityshistoria CSV",
};

export function HealthDataExports({
  embedded = false,
}: {
  readonly embedded?: boolean;
}): React.JSX.Element {
  const {
    measurements,
    hydrationEntries,
    nutritionEntries,
    sleepEntries,
    activityEntries,
    moodCheckins,
    supplements,
    supplementLogs,
    breathingSessions,
  } = useData();
  const [sources, setSources] = useState<HealthCsvExportInput | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const latestRequest = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequest.current;
    setLoading(true);
    setLoadError(false);
    try {
      const [
        measurementsResult,
        hydrationResult,
        nutritionResult,
        sleepResult,
        activityResult,
        moodResult,
        supplementsResult,
        supplementLogsResult,
        breathingResult,
      ] = await Promise.all([
        measurements.list(),
        hydrationEntries.list(),
        nutritionEntries.list(),
        sleepEntries.list(),
        activityEntries.list(),
        moodCheckins.list(),
        supplements.list(),
        supplementLogs.list(),
        breathingSessions.list(),
      ]);
      if (requestId !== latestRequest.current) return;
      if (
        !measurementsResult.ok ||
        !hydrationResult.ok ||
        !nutritionResult.ok ||
        !sleepResult.ok ||
        !activityResult.ok ||
        !moodResult.ok ||
        !supplementsResult.ok ||
        !supplementLogsResult.ok ||
        !breathingResult.ok
      ) {
        setSources(null);
        setLoadError(true);
        return;
      }
      setSources({
        measurements: measurementsResult.value,
        hydrationEntries: hydrationResult.value,
        nutritionEntries: nutritionResult.value,
        sleepEntries: sleepResult.value,
        activityEntries: activityResult.value,
        moodCheckins: moodResult.value,
        supplements: supplementsResult.value,
        supplementLogs: supplementLogsResult.value,
        breathingSessions: breathingResult.value,
      });
      setExportMessage(null);
    } catch {
      if (requestId === latestRequest.current) {
        setSources(null);
        setLoadError(true);
      }
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [
    activityEntries,
    breathingSessions,
    hydrationEntries,
    measurements,
    moodCheckins,
    nutritionEntries,
    sleepEntries,
    supplementLogs,
    supplements,
  ]);

  useEffect(() => {
    const onDataChanged = (): void => {
      void refresh();
    };
    void refresh();
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      latestRequest.current += 1;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const exportData = (kind: HealthCsvExportKind): void => {
    if (sources === null) return;
    try {
      const file = createHealthCsvExport(kind, sources);
      if (file.rowCount === 0) {
        setExportMessage(t("Valitussa historiassa ei ole vietäviä merkintöjä."));
        return;
      }
      downloadCsv(file.content, file.filename);
      setExportMessage(
        tTemplate("{{0}} merkintää valmisteltu tiedostoon {{1}}.", [
          String(file.rowCount),
          file.filename,
        ]),
      );
    } catch {
      setExportMessage(t("CSV-tiedoston muodostaminen epäonnistui."));
    }
  };

  const content = (
    <>
      <p data-ui="health-data-exports-description">
        {t(
          "Lataa omat paikalliset merkintäsi erillisinä CSV-tiedostoina. Pehmeästi poistetut ravinto-, uni- ja aktiviteettimerkinnät ohitetaan.",
        )}
      </p>
      {loading && sources === null ? (
        <Skeleton lines={2} label={t("Valmistellaan terveystietojen vientiä…")} />
      ) : null}
      {loadError ? (
        <Alert tone="warning" title={t("Terveysdataa ei voitu ladata")}>
          <p>
            {t(
              "Vientitiedostoa ei muodosteta ennen kuin kaikki paikalliset historiat on saatu luettua.",
            )}
          </p>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t("Yritä uudelleen")}
          </Button>
        </Alert>
      ) : null}
      {sources !== null ? (
        <>
          <ul data-ui="health-data-export-actions" aria-label={t("Terveystietojen CSV-viennit")}>
            {HEALTH_CSV_EXPORT_DEFINITIONS.map(({ kind }) => (
              <li key={kind}>
                <Button
                  variant="secondary"
                  disabled={loading}
                  onClick={() => {
                    exportData(kind);
                  }}
                >
                  {t(EXPORT_LABELS[kind])}
                </Button>
              </li>
            ))}
          </ul>
          {exportMessage !== null ? <p role="status">{exportMessage}</p> : null}
        </>
      ) : null}
    </>
  );

  return embedded ? (
    <div data-testid="health-data-exports" data-ui="data-export-panel">
      {content}
    </div>
  ) : (
    <Card heading={t("Vie terveystiedot")} data-testid="health-data-exports">
      {content}
    </Card>
  );
}
