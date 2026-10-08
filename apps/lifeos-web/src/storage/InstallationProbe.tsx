// T061: asennuksen persistence-luotain (E2E, vain ?e2e=1&probe=persistenssi).
// Todistaa kriteerin selaimessa: pysyvä installationId (sama lyhenne reloadin
// yli), vain turvallinen metadata näkyvissä (versio + id-etuliite), revokaatio
// estää myöhemmät tilansiirrot. Käyttää virallista data-kerrosta.
import { t } from "../language.tsx";
import { useCallback, useState } from "react";
import { Button } from "@lifeos/ui";
import { ensureInstallation, revokeInstallationService } from "@lifeos/data";
import { ErrorCard } from "../errors/ErrorCard.tsx";
import { fromDataError, fromUnknown, type AppError } from "../errors/appError.ts";

const PROBE_APP_VERSION = "0.0.0";

function probeDeps(): { clock: { nowIso: () => string }; ids: { next: () => string } } {
  return {
    clock: { nowIso: () => new Date().toISOString() },
    ids: { next: () => crypto.randomUUID() },
  };
}

function describeInstallation(entity: {
  version: number;
  installationId: string;
  revokedAt: string | null;
}): string {
  const prefix = entity.installationId.slice(0, 8);
  if (entity.revokedAt !== null) {
    return `v${String(entity.version)} ${prefix} revoked`;
  }
  return `v${String(entity.version)} ${prefix} aktiivinen`;
}

export function InstallationProbe(): React.JSX.Element {
  const [status, setStatus] = useState("—");
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  const ensure = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await ensureInstallation(probeDeps(), PROBE_APP_VERSION);
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setStatus(describeInstallation(result.value));
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setBusy(false);
    }
  }, []);

  const revoke = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await revokeInstallationService(probeDeps());
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setStatus(describeInstallation(result.value));
    } catch (error_: unknown) {
      setError(fromUnknown(error_));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section data-testid="installation-probe" aria-label={t("Asennuksen persistenssi (E2E)")}>
      <h2>{t("Asennus (T061)")}</h2>
      <p data-ui="meta">
        {t(
          "Pysyvä installationId (satunnainen, ei fingerprintingia) + vain turvallinen metadata. Reload säilyttää id:n ja tilan.",
        )}
      </p>
      <p data-testid="installation-status">{status}</p>
      <p>
        <Button variant="primary" loading={busy} onClick={() => void ensure()}>
          {t("Varmista asennus")}
        </Button>{" "}
        <Button variant="secondary" loading={busy} onClick={() => void revoke()}>
          {t("Revokoi asennus")}
        </Button>
      </p>
      {error !== null ? <ErrorCard error={error} /> : null}
    </section>
  );
}
