// T038: persistence-luotain (E2E-diagnostiikka). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa). Käyttää virallista data-kerrosta
// (openDatabase/writeMeta/readMeta) — ei testikoukkuja windowissa, ei
// raakaa SQL:ää, ei worker-protokollaa suoraan (T032/T036-raja).
// Virheet kulkevat AppError-kerroksen kautta (T037).
import { t } from "../language.tsx";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@lifeos/ui";
import { closeDatabase, openDatabase, readMeta, writeMeta } from "@lifeos/data";
import { ErrorCard } from "../errors/ErrorCard.tsx";
import { fromDataError, fromUnknown, type AppError } from "../errors/appError.ts";

const PROBE_KEY = "e2e-t038-probe";

export function PersistenceProbe(): React.JSX.Element {
  const [dbStatus, setDbStatus] = useState("avataan…");
  const [backend, setBackend] = useState("");
  const [poolInfo, setPoolInfo] = useState("");
  const [value, setValue] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<AppError | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // cancelled-ref: cleanup asettaa true; async-jatko lukee. Lintin
    // staattinen analyysi ei seuraa sulkeumaa — luetaan funktion kautta
    // (sama malli kuin fixtures.tsx) jotta ehto ei näytä kuolleelta.
    const guard = { cancelled: false };
    const shouldStop = (): boolean => guard.cancelled;
    void (async () => {
      try {
        const health = await openDatabase();
        if (shouldStop()) {
          return;
        }
        if (!health.ok) {
          setError(fromDataError(health.error));
          setDbStatus("virhe");
          return;
        }
        setBackend(health.value.backend);
        setPoolInfo(
          `pool:${String(health.value.poolCapacity ?? "?")}/${String(health.value.poolFileCount ?? "?")}/hasDb=${String(health.value.poolHasDb ?? "?")}`,
        );
        setDbStatus(`ready:${health.value.backend}:${String(health.value.schemaVersion)}`);
      } catch (error: unknown) {
        if (!shouldStop()) {
          setError(fromUnknown(error));
          setDbStatus("virhe");
        }
      }
    })();
    return () => {
      guard.cancelled = true;
    };
  }, []);

  const write = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = `t038-${String(Date.now())}`;
      const result = await writeMeta(PROBE_KEY, next);
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setValue(next);
    } catch (error: unknown) {
      setError(fromUnknown(error));
    } finally {
      setBusy(false);
    }
  }, []);

  const read = useCallback(async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await readMeta(PROBE_KEY);
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setValue(result.value);
    } catch (error: unknown) {
      setError(fromUnknown(error));
    } finally {
      setBusy(false);
    }
  }, []);

  // T038-diagnostiikka: eksplisiittinen sulku (vapauttaa poolin lukot
  // deterministisesti — ei nojata pagehideen). Näkyy vain ?e2e=1:ssä.
  const close = useCallback(async (): Promise<void> => {
    setBusy(true);
    try {
      await closeDatabase();
      setClosed(true);
      setDbStatus("suljettu");
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section data-testid="persistence-probe" aria-label={t("Persistence-luotain (E2E)")}>
      <h2>{t("Persistence-luotain")}</h2>
      <p data-testid="persistence-status">{dbStatus}</p>
      <p data-testid="persistence-backend">
        {t("backend:")}
        {backend === "" ? "—" : backend}
      </p>
      <p data-testid="persistence-pool">{poolInfo === "" ? t("pool:—") : poolInfo}</p>
      <p data-testid="persistence-value">{value ?? "—"}</p>
      <p data-testid="persistence-closed">{closed ? t("suljettu") : t("auki")}</p>
      <p>
        <Button variant="primary" loading={busy} onClick={() => void write()}>
          {t("Kirjoita testientiteetti")}
        </Button>{" "}
        <Button variant="secondary" loading={busy} onClick={() => void read()}>
          {t("Lue testientiteetti")}
        </Button>{" "}
        <Button variant="secondary" loading={busy} onClick={() => void close()}>
          {t("Sulje tietokanta")}
        </Button>
      </p>
      {error !== null ? <ErrorCard error={error} /> : null}
    </section>
  );
}
