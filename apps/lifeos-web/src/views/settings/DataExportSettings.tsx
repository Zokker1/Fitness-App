// Paikallisten tietojen viennit yhdellä vientitavan valinnalla.
import { t, tOptions } from "../../language.tsx";
import { useState } from "react";
import { Alert, Card, SegmentedControl } from "@lifeos/ui";
import { HealthDataExports } from "../health/HealthDataExports.tsx";
import { EncryptedBackupExport } from "./EncryptedBackupExport.tsx";
import { FullJsonExport } from "./FullJsonExport.tsx";

type ExportMode = "json" | "csv" | "backup";

const EXPORT_OPTIONS = [
  { value: "json", label: "Koko data (JSON)" },
  { value: "csv", label: "Yksittäiset CSV:t" },
  { value: "backup", label: "Salattu varmuuskopio" },
] as const;

export function DataExportSettings(): React.JSX.Element {
  const [mode, setMode] = useState<ExportMode>("csv");

  return (
    <Card heading={t("Tietojen vienti")} data-testid="data-export-settings">
      <SegmentedControl
        label={t("Vientitapa")}
        name="data-export-mode"
        options={tOptions(EXPORT_OPTIONS)}
        value={mode}
        onOptionChange={(value) => {
          if (value === "json" || value === "csv" || value === "backup") setMode(value);
        }}
      />
      <section data-testid="deletion-retention-guidance">
        <Alert tone="warning" title={t("Merkinnän poistaminen ei ole turvallinen ylikirjoitus")}>
          <p>
            {t(
              "Poista-toiminto piilottaa merkinnän ja säilyttää tombstonen synkkaa varten. Sisältö jää paikalliseen kantaan ja aiemmin tehtyihin varmuuskopioihin; luo uusi salattu kopio poiston jälkeen.",
            )}
          </p>
          <p>
            {t(
              "Tämän selaimen paikallisen kopion poistat selaimen sivustodatan asetuksista. LifeOSissa ei ole erillistä kaikkien paikallisten tietojen tyhjennyspainiketta.",
            )}
          </p>
          <p>
            {t(
              "Sivustodatan tyhjennys poistaa tämän originin tietokannan, avainkuoret ja selaimen kiertokopiot. Se ei poista ladattuja tiedostoja, palautusavainta tai Driveen jo synkattua dataa; poista ne erikseen omista sijainneistaan.",
            )}
          </p>
          <p>
            {t(
              "Selain ja tallennuslaite eivät takaa fyysistä ylikirjoitusta. Tyhjennys on paikallisen origin-datan looginen poisto.",
            )}
          </p>
        </Alert>
      </section>
      {mode === "json" ? (
        <FullJsonExport embedded />
      ) : mode === "backup" ? (
        <EncryptedBackupExport />
      ) : (
        <HealthDataExports embedded />
      )}
    </Card>
  );
}
