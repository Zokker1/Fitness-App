// T060: asetusten persistence-luotain (E2E, vain ?e2e=1&probe=persistenssi).
// Todistaa T060-kriteerin selaimessa: asetusrivi syntyy (ensure, v1),
// päivitys kasvattaa version (v2) ja arvo säilyy reloadissa (OPFS/SAH-pool —
// preview-build; dev-muistibackend ei säilytä reloadissa).
// Käyttää virallista data-kerrosta (ensurePreferences/updatePreferences) —
// ei protokollaa suoraan, ei testikoukkuja. Ei PII:tä.
import { t } from "../language.tsx";
import { useCallback, useState } from "react";
import { Button } from "@lifeos/ui";
import { ensurePreferences, updatePreferences } from "@lifeos/data";
import { ErrorCard } from "../errors/ErrorCard.tsx";
import { fromDataError, fromUnknown, type AppError } from "../errors/appError.ts";

function describePreferences(entity: {
  version: number;
  theme: string;
  dayStartHour: number;
}): string {
  return `v${String(entity.version)} ${entity.theme} t${String(entity.dayStartHour)}`;
}

function probeDeps(): { clock: { nowIso: () => string }; ids: { next: () => string } } {
  return {
    clock: { nowIso: () => new Date().toISOString() },
    ids: { next: () => crypto.randomUUID() },
  };
}

export function PreferencesProbe(): React.JSX.Element {
  const [status, setStatus] = useState("—");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const ensure = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await ensurePreferences(probeDeps());
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setStatus(describePreferences(result.value));
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setBusy(false);
    }
  }, []);

  const bumpHour = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const deps = probeDeps();
      const current = await ensurePreferences(deps);
      if (!current.ok) {
        setError(fromDataError(current.error));
        return;
      }
      const result = await updatePreferences(deps, {
        dayStartHour: (current.value.dayStartHour + 1) % 24,
      });
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setStatus(describePreferences(result.value));
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section data-testid="preferences-probe" aria-label={t("Asetusten persistenssi (E2E)")}>
      <h2>{t("Asetukset (T060)")}</h2>
      <p data-ui="meta">
        {t("Asetusrivi: versio, teema, päivän raja. Reload säilyttää arvot (versionoitava rivi).")}
      </p>
      <p data-testid="preferences-status">{status}</p>
      <p>
        <Button variant="primary" loading={busy} onClick={() => void ensure()}>
          {t("Varmista asetukset")}
        </Button>{" "}
        <Button variant="secondary" loading={busy} onClick={() => void bumpHour()}>
          {t("Siirrä päivän rajaa")}
        </Button>
      </p>
      {error !== null ? <ErrorCard error={error} /> : null}
    </section>
  );
}
