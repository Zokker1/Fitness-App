// T036: tallennustilan kortti. Näyttää käyttäjälle (§2 kohta 9, §48):
// - pysyvä vs best-effort -tila, backend-polku (laitetallennus/välimuisti)
//   ilman tuotenimimagiikkaa, quota-käyttöaste + varoitus, ohje backup/synkkaan.
// - "Pyydä pysyvää tallennusta" -nappi vain kun persisted === false.
// - Sivustodatan tyhjennys -riski eksplisiittisesti joka tilassa.
// - Saavutettava: role=status + aria-live, focus näkyvä (B01-kehys).
// Ei domain-dataa/PII:tä/terveyttä; pelkät tilaluvut.

import { t, tTemplate } from "../language.tsx";
import { Button, Card } from "@lifeos/ui";
import {
  formatBytesFi,
  formatRatioFi,
  getStorageGuidance,
  type StorageStatus,
} from "./lifecycle.ts";

export interface StorageStatusCardProps {
  readonly status: StorageStatus;
  readonly loading: boolean;
  readonly loadError: string | null;
  readonly requesting: boolean;
  readonly requestError: string | null;
  readonly requestGranted: boolean | null;
  readonly onRequestPersistence: () => void;
}

function persistenceLabel(status: StorageStatus): string {
  if (status.persisted === true) {
    return t("Pysyvä");
  }
  if (status.persisted === false) {
    return t("Best-effort (selain voi poistaa)");
  }
  return t("Tuntematon");
}

function backendLabel(backend: string): string {
  if (backend === "") {
    return "—";
  }
  if (backend === "memory") {
    return t("Välimuisti (ei säily)");
  }
  return tTemplate("Laitetallennus ({{0}})", [backend]);
}

export function StorageStatusCard({
  status,
  loading,
  loadError,
  requesting,
  requestError,
  requestGranted,
  onRequestPersistence,
}: StorageStatusCardProps): React.JSX.Element {
  const guidance = getStorageGuidance(status.warning);
  return (
    <Card heading={t("Tallennustila")}>
      <div data-testid="storage-status-content">
        {loading ? <p>{t("Tarkistetaan tallennustilaa…")}</p> : null}
        {loadError !== null && !loading ? <p>{t(loadError)}</p> : null}
        {!loading ? (
          <>
            {/* T042: data-ui-koukku storage-facts-tyyleille (jakajat, meta-ääni). */}
            <dl data-ui="storage-facts">
              <div>
                <dt>{t("Tila")}</dt>
                <dd>{persistenceLabel(status)}</dd>
              </div>
              <div>
                <dt>{t("Tietokanta")}</dt>
                <dd>
                  {status.dbOpen ? t("Auki") : t("Suljettu")} · {backendLabel(status.backend)}
                </dd>
              </div>
              <div>
                <dt>{t("Käytössä")}</dt>
                <dd>
                  {formatBytesFi(status.usageBytes)} / {formatBytesFi(status.quotaBytes)} (
                  {formatRatioFi(status.usageRatio)})
                </dd>
              </div>
              <div>
                <dt>{t("Laitetallennuksen tuki")}</dt>
                <dd>{status.opfsSupported ? t("Kyllä") : t("Ei / ei varmistettu")}</dd>
              </div>
            </dl>
            <p>
              <strong>{t(guidance.title)}</strong>
            </p>
            <p>{t(guidance.body)}</p>
            {status.canRequestPersistence ? (
              <p>
                <Button variant="primary" loading={requesting} onClick={onRequestPersistence}>
                  {t(guidance.primaryAction ?? "Pyydä pysyvää tallennusta")}
                </Button>
              </p>
            ) : null}
            {requestGranted === true ? <p>{t("Tallennus on nyt pysyvä.")}</p> : null}
            {requestGranted === false ? (
              <p>
                {t("Selain ei myöntänyt pysyvää tallennusta. Varmuuskopio on erityisen tärkeä.")}
              </p>
            ) : null}
            {requestError !== null ? <p>{t(requestError)}</p> : null}
            <p>
              {t(
                "Huom: selaimen sivustodatan tyhjennys tai profiilin poisto poistaa paikallisen kopion. Salattu varmuuskopio on erillinen turvakerros.",
              )}
            </p>
          </>
        ) : null}
      </div>
    </Card>
  );
}
