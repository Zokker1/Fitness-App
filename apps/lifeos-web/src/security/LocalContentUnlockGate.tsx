import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, SyntheticEvent } from "react";
import {
  createSyncCryptoAdapter,
  createKeyEnvelope,
  createWrappedDataKey,
  decodeKeyRecoveryBundle,
  encodeKeyRecoveryBundle,
  ensureInstallation,
  formatRecoveryKeyHex,
  generateRecoveryKey,
  systemClock,
  ulidLikeId,
  unlockDataKeySession,
} from "@lifeos/data";
import type { DataKeySession, KeyEnvelope, KeyRecoveryBundle } from "@lifeos/data";
import { Button, Checkbox } from "@lifeos/ui";
import { createBrowserKeyEnvelopeStore } from "./indexedDbKeyEnvelopeStore.ts";
import { migrateLegacyLocalPreferences } from "./legacyPreferenceMigration.ts";
import { lockActiveSyncWriteKey, activateSyncWriteKey } from "../sync/syncRuntime.ts";
import { t } from "../language.tsx";
import "./local-content-lock.css";

const APP_VERSION = "0.0.0";

function secureId(): string {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    throw new Error("secure random unavailable");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  try {
    return ulidLikeId(Date.now(), bytes);
  } finally {
    bytes.fill(0);
  }
}

export function LocalContentUnlockGate(): React.JSX.Element {
  const crypto = useMemo(() => createSyncCryptoAdapter(), []);
  const pendingKeySession = useRef<DataKeySession | null>(null);
  const [envelopes, setEnvelopes] = useState<readonly KeyEnvelope[]>([]);
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState("");
  const [recoveryBundle, setRecoveryBundle] = useState<KeyRecoveryBundle | null>(null);
  const [credential, setCredential] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPassphrase, setNewPassphrase] = useState("");
  const [newPassphraseConfirm, setNewPassphraseConfirm] = useState("");
  const [preparedSetup, setPreparedSetup] = useState<{
    readonly passphraseEnvelope: KeyEnvelope;
    readonly recoveryEnvelope: KeyEnvelope;
    readonly recoveryKeyHex: string;
    readonly recoveryBundleText: string;
  } | null>(null);
  const [recoveryFileDownloaded, setRecoveryFileDownloaded] = useState(false);
  const [recoverySaved, setRecoverySaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void createBrowserKeyEnvelopeStore()
      .list()
      .then((available) => {
        if (cancelled) return;
        setEnvelopes(available);
        setSelectedEnvelopeId(available[0]?.envelopeId ?? "");
      })
      .catch(() => {
        if (!cancelled) setError(t("Tallennettuja avainkuoria ei voitu lukea."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      pendingKeySession.current?.lock();
      pendingKeySession.current = null;
    },
    [],
  );

  const selectedEnvelope =
    recoveryBundle?.envelope ?? envelopes.find((item) => item.envelopeId === selectedEnvelopeId);
  const credentialLabel =
    selectedEnvelope?.wrapping.kind === "recovery"
      ? t("Palautusavain (64 heksamerkkiä)")
      : t("Tunnuslause");

  const readRecoveryBundle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    setRecoveryBundle(null);
    setCredential("");
    setError(null);
    const file = event.target.files?.[0];
    if (file === undefined) return;
    if (file.size > 8 * 1024) {
      setError(t("Palautustiedosto ei kelpaa."));
      event.target.value = "";
      return;
    }
    try {
      const decoded = decodeKeyRecoveryBundle(await file.text());
      if (!decoded.ok) throw new Error("invalid-recovery-bundle");
      if (envelopes.some((envelope) => envelope.keyId !== decoded.value.keyId)) {
        setError(t("Palautustiedosto sisältää eri paikallisen salausavaimen."));
        event.target.value = "";
        return;
      }
      setRecoveryBundle(decoded.value);
    } catch {
      setError(t("Palautustiedosto ei kelpaa."));
      event.target.value = "";
    }
  };

  const prepareLocalKey = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (working || envelopes.length > 0) return;
    if (newPassphrase.length < 12 || newPassphrase !== newPassphraseConfirm) {
      setError(t("Tunnuslauseiden tulee täsmätä ja olla vähintään 12 merkkiä."));
      setNewPassphrase("");
      setNewPassphraseConfirm("");
      return;
    }
    setWorking(true);
    setError(null);
    let createdSession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      const created = await createWrappedDataKey({ kind: "passphrase", passphrase: newPassphrase });
      if (!created.ok) throw new Error(created.error.diagnosticCode);
      createdSession = created.value.session;

      const generatedRecoveryKey = generateRecoveryKey();
      if (!generatedRecoveryKey.ok) throw new Error(generatedRecoveryKey.error.diagnosticCode);
      recoveryKey = generatedRecoveryKey.value;

      const recovery = await createdSession.withKey((dataKey) =>
        createKeyEnvelope({
          dataKey,
          credential: { kind: "recovery", recoveryKey: recoveryKey as Uint8Array },
          keyId: created.value.envelope.keyId,
        }),
      );
      if (!recovery.ok) throw new Error(recovery.error.diagnosticCode);
      const bundleText = encodeKeyRecoveryBundle(recovery.value);
      const recoveryKeyHex = formatRecoveryKeyHex(recoveryKey);
      if (!bundleText.ok || recoveryKeyHex === null) {
        throw new Error("local-content.setup.recovery-failed");
      }

      pendingKeySession.current = createdSession;
      createdSession = null;
      setPreparedSetup({
        passphraseEnvelope: created.value.envelope,
        recoveryEnvelope: recovery.value,
        recoveryKeyHex,
        recoveryBundleText: bundleText.value,
      });
      setNewPassphrase("");
      setNewPassphraseConfirm("");
    } catch {
      setError(
        t("Salausavainta ei voitu luoda. Tarkista selaimen tallennustila ja yritä uudelleen."),
      );
    } finally {
      createdSession?.lock();
      recoveryKey?.fill(0);
      setNewPassphrase("");
      setNewPassphraseConfirm("");
      setWorking(false);
    }
  };

  const downloadRecoveryBundle = (): void => {
    if (preparedSetup === null) return;
    const blob = new Blob([preparedSetup.recoveryBundleText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lifeos-key-recovery.json";
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
    setRecoveryFileDownloaded(true);
  };

  const completeLocalKeySetup = async (): Promise<void> => {
    if (
      working ||
      preparedSetup === null ||
      pendingKeySession.current === null ||
      !recoveryFileDownloaded ||
      !recoverySaved
    ) {
      return;
    }
    setWorking(true);
    setError(null);
    const keySession = pendingKeySession.current;
    const store = createBrowserKeyEnvelopeStore();
    let envelopesSaved = false;
    const keyAcceptance = { accepted: false };
    try {
      const installation = await ensureInstallation(
        { clock: systemClock(), ids: { next: secureId } },
        APP_VERSION,
      );
      if (!installation.ok) throw new Error(installation.error.diagnosticCode);
      await store.putMany([preparedSetup.passphraseEnvelope, preparedSetup.recoveryEnvelope]);
      envelopesSaved = true;
      await activateSyncWriteKey(
        {
          installationId: installation.value.installationId,
          keySession,
          crypto,
        },
        async () => {
          keyAcceptance.accepted = true;
          await migrateLegacyLocalPreferences();
        },
      );
      pendingKeySession.current = null;
      setCredential("");
    } catch {
      if (envelopesSaved && !keyAcceptance.accepted) {
        await Promise.all([
          store.delete(preparedSetup.passphraseEnvelope.envelopeId).catch(() => undefined),
          store.delete(preparedSetup.recoveryEnvelope.envelopeId).catch(() => undefined),
        ]);
      }
      setError(t("Salausta ei voitu ottaa käyttöön. Paikallisia tietoja ei avattu."));
    } finally {
      setWorking(false);
    }
  };

  const unlock = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (working || selectedEnvelope === undefined || credential.length === 0) return;
    setWorking(true);
    setError(null);
    let keySession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      const keyCredential =
        selectedEnvelope.wrapping.kind === "passphrase"
          ? ({ kind: "passphrase", passphrase: credential } as const)
          : (() => {
              const normalized = credential.trim();
              if (!/^(?:[0-9a-fA-F]{2}){32}$/.test(normalized)) return null;
              recoveryKey = Uint8Array.from(normalized.match(/.{2}/gu) ?? [], (byte) =>
                Number.parseInt(byte, 16),
              );
              return { kind: "recovery", recoveryKey } as const;
            })();
      if (keyCredential === null) {
        setError(t("Palautusavaimen muoto ei kelpaa."));
        return;
      }
      const opened = await unlockDataKeySession({
        envelope: selectedEnvelope,
        credential: keyCredential,
      });
      if (!opened.ok) {
        setError(t("Avainta ei voitu avata. Tarkista tunnuslause tai palautusavain."));
        return;
      }
      keySession = opened.value;
      const installation = await ensureInstallation(
        { clock: systemClock(), ids: { next: secureId } },
        APP_VERSION,
      );
      if (!installation.ok) throw new Error(installation.error.diagnosticCode);
      await activateSyncWriteKey(
        {
          installationId: installation.value.installationId,
          keySession,
          crypto,
        },
        migrateLegacyLocalPreferences,
      );
      keySession = null;
      if (recoveryBundle !== null) {
        await createBrowserKeyEnvelopeStore().put(recoveryBundle.envelope);
      }
      setCredential("");
    } catch {
      lockActiveSyncWriteKey();
      setError(t("Avainta ei voitu vahvistaa tai paikallista tietoa avata."));
    } finally {
      keySession?.lock();
      recoveryKey?.fill(0);
      setCredential("");
      setWorking(false);
    }
  };

  return (
    <main className="local-content-lock-screen" data-testid="local-content-lock-screen">
      <section className="local-content-lock-card" aria-labelledby="local-content-lock-title">
        <h1 id="local-content-lock-title">{t("Paikalliset tiedot ovat lukittuina")}</h1>
        <p>{t("Avaa salausavain, jotta voit käyttää tämän selaimen tietoja.")}</p>
        {loading ? (
          <p role="status">{t("Ladataan avainkuoria…")}</p>
        ) : preparedSetup !== null ? (
          <section aria-labelledby="local-content-recovery-title">
            <h2 id="local-content-recovery-title">
              {t("Tallenna paikallisen salauksen palautustiedot")}
            </h2>
            <p>{t("Tallenna palautustiedosto ja alla oleva palautusavain eri paikkoihin.")}</p>
            <Button type="button" variant="secondary" onClick={downloadRecoveryBundle}>
              {t("Lataa palautustiedosto")}
            </Button>
            <label htmlFor="local-content-recovery-key">{t("Palautusavain")}</label>
            <textarea
              id="local-content-recovery-key"
              readOnly
              rows={3}
              value={preparedSetup.recoveryKeyHex}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Checkbox
              checked={recoverySaved}
              onChange={(event) => {
                setRecoverySaved(event.currentTarget.checked);
              }}
              disabled={working || !recoveryFileDownloaded}
            >
              {t("Olen tallentanut palautustiedoston ja palautusavaimen.")}
            </Checkbox>
            <Button
              type="button"
              loading={working}
              disabled={working || !recoveryFileDownloaded || !recoverySaved}
              onClick={() => {
                void completeLocalKeySetup();
              }}
            >
              {t("Salaa paikalliset tiedot ja jatka")}
            </Button>
          </section>
        ) : envelopes.length === 0 && recoveryBundle === null ? (
          <form
            onSubmit={(event) => {
              void prepareLocalKey(event);
            }}
          >
            <p>{t("Luo tunnuslause, jolla tämän selaimen paikalliset tiedot salataan.")}</p>
            <label htmlFor="local-content-new-passphrase">{t("Uusi tunnuslause")}</label>
            <input
              id="local-content-new-passphrase"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              value={newPassphrase}
              onChange={(event) => {
                setNewPassphrase(event.target.value);
              }}
              disabled={working}
              required
            />
            <label htmlFor="local-content-new-passphrase-confirm">
              {t("Vahvista tunnuslause")}
            </label>
            <input
              id="local-content-new-passphrase-confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              value={newPassphraseConfirm}
              onChange={(event) => {
                setNewPassphraseConfirm(event.target.value);
              }}
              disabled={working}
              required
            />
            <Button
              type="submit"
              loading={working}
              disabled={working || newPassphrase.length < 12 || newPassphraseConfirm.length < 12}
            >
              {t("Luo paikallisen sisällön salaus")}
            </Button>
            <label htmlFor="local-key-recovery-file">{t("Palautustiedosto")}</label>
            <input
              id="local-key-recovery-file"
              type="file"
              accept="application/json,.json"
              disabled={working}
              onChange={(event) => {
                void readRecoveryBundle(event);
              }}
            />
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              void unlock(event);
            }}
          >
            {envelopes.length > 1 && recoveryBundle === null ? (
              <>
                <label htmlFor="local-key-envelope">{t("Avaimen avaus")}</label>
                <select
                  id="local-key-envelope"
                  value={selectedEnvelopeId}
                  onChange={(event) => {
                    setSelectedEnvelopeId(event.target.value);
                  }}
                  disabled={working}
                >
                  {envelopes.map((envelope, index) => (
                    <option key={envelope.envelopeId} value={envelope.envelopeId}>
                      {t("Avainkuori")} {index + 1} · {t(envelope.wrapping.kind)}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            {selectedEnvelope !== undefined ? (
              <>
                <label htmlFor="local-key-credential">{credentialLabel}</label>
                <input
                  id="local-key-credential"
                  type="password"
                  autoComplete="current-password"
                  maxLength={1024}
                  value={credential}
                  onChange={(event) => {
                    setCredential(event.target.value);
                  }}
                  disabled={working}
                  required
                />
                <Button
                  type="submit"
                  loading={working}
                  disabled={working || credential.length === 0}
                >
                  {t("Avaa paikalliset tiedot")}
                </Button>
              </>
            ) : (
              <p>
                {t("Valitse palautustiedosto tai tarkista, että selaimen avainkuori on tallessa.")}
              </p>
            )}
            {recoveryBundle !== null ? (
              <Button
                type="button"
                variant="secondary"
                disabled={working}
                onClick={() => {
                  setRecoveryBundle(null);
                  setCredential("");
                }}
              >
                {t("Käytä selaimeen tallennettua avainta")}
              </Button>
            ) : null}
            <label htmlFor="local-key-recovery-file">{t("Palautustiedosto")}</label>
            <input
              id="local-key-recovery-file"
              type="file"
              accept="application/json,.json"
              disabled={working}
              onChange={(event) => {
                void readRecoveryBundle(event);
              }}
            />
          </form>
        )}
        {error !== null ? <p role="alert">{error}</p> : null}
      </section>
    </main>
  );
}
