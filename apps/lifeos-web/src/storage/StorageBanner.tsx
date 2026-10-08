// T036: storage-banneri. Näkyy vain kun taso vaatii toimia
// (huomio/kriittinen) — ok/alkulataus/tuntematon eivät peitä näkymää.
// Linkkaa asetusten tallennusosioon; ei PII:tä; role=alert jotta
// ruudunlukija huomaa kriittisen (huomio: status riittää, ei alertia).
import { t } from "../language.tsx";
import { Link } from "react-router";
import { getStorageGuidance, type StorageStatus } from "./lifecycle.ts";

export function StorageBanner({
  status,
}: {
  readonly status: StorageStatus;
}): React.JSX.Element | null {
  if (status.level !== "huomio" && status.level !== "kriittinen") {
    return null;
  }
  const guidance = getStorageGuidance(status.warning);
  if (status.level === "kriittinen") {
    return (
      <p role="alert" data-ui="storage-banner" data-level="kriittinen">
        <strong>{t(guidance.title)}.</strong>{" "}
        <Link to="/settings">{t("Avaa tallennusasetukset")}</Link>
      </p>
    );
  }
  return (
    <p
      role="status"
      aria-label={t("Tallennustila vaatii huomiota")}
      data-ui="storage-banner"
      data-level="huomio"
    >
      <strong>{t(guidance.title)}.</strong>{" "}
      <Link to="/settings">{t("Avaa tallennusasetukset")}</Link>
    </p>
  );
}
