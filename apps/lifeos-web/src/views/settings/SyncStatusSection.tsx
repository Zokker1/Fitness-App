import { useCallback, useEffect, useMemo, useState } from "react";
import type { ChangeEvent, SyntheticEvent } from "react";
import type { OAuthCapability, OAuthSession } from "@lifeos/capabilities";
import type { BrowserInstallation } from "@lifeos/domain";
import {
  createSyncCryptoAdapter,
  createKeyEnvelope,
  createWrappedDataKey,
  decodeKeyRecoveryBundle,
  encodeKeyRecoveryBundle,
  ensureInstallation,
  formatRecoveryKeyHex,
  generateRecoveryKey,
  listInstallations,
  listSyncOperations,
  markInstallationSynced,
  parseRecoveryKeyHex,
  renameInstallation,
  revokeOtherInstallation,
  syncReplica,
  systemClock,
  ulidLikeId,
  unlockDataKeySession,
} from "@lifeos/data";
import type {
  DataKeySession,
  KeyEnvelope,
  KeyRecoveryBundle,
  SyncCoordinatorError,
  SyncProvider,
  SyncReplicaSummary,
} from "@lifeos/data";
import { Button, Card } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";
import { ErrorCard } from "../../errors/ErrorCard.tsx";
import {
  fromCapabilityError,
  fromDataError,
  fromUnknown,
  toSafeDiagnosticCode,
} from "../../errors/appError.ts";
import type { AppError } from "../../errors/appError.ts";
import { t, useLanguage } from "../../language.tsx";
import { createBrowserKeyEnvelopeStore } from "../../security/indexedDbKeyEnvelopeStore.ts";
import { createAppSyncEntityStoreAdapter } from "../../sync/syncEntityStoreAdapter.ts";
import {
  activateSyncWriteKey,
  getActiveSyncWriteContext,
  isSyncWriteKeyActive,
  lockActiveSyncWriteKey,
  SYNC_KEY_STATE_EVENT,
} from "../../sync/syncRuntime.ts";
import "./sync-status.css";

const APP_VERSION = "0.0.0";

interface SyncStatusSnapshot {
  readonly lastSyncAt: string | null;
  readonly pendingOperations: number;
}

interface BrowserInstallationSnapshot {
  readonly installation: BrowserInstallation;
  readonly pendingOperations: number;
}

interface RecoveryReveal {
  readonly keyHex: string;
  readonly bundle: string;
}

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

function formatTimestamp(value: string | null, language: string): string {
  if (value === null || !Number.isFinite(Date.parse(value))) return t("Ei vielä synkronoitu");
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fi-FI", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(Date.parse(value));
}

function coordinatorError(error: SyncCoordinatorError): AppError {
  return {
    title: "Synkronointi epäonnistui",
    body:
      error.diagnosticCode === "data.sync.installation.revoked"
        ? "Tämän selaimen synkkausoikeus on peruttu. Parita selain uudelleen ennen synkronointia."
        : error.code === "unauthorized"
          ? "Google Drive -valtuutus puuttuu tai on vanhentunut. Yritä synkronointia uudelleen."
          : "Synkronointi ei onnistunut. Yritä uudelleen.",
    actionLabel: null,
    diagnosticCode: toSafeDiagnosticCode(error.diagnosticCode, "sync.operation.failed"),
    level: "error",
  };
}

function keyUnlockError(): AppError {
  return {
    title: "Avainta ei avattu",
    body: "Avainta ei avattu. Tarkista tunnuslause tai palautusavain.",
    actionLabel: null,
    diagnosticCode: "sync.key.unlock-failed",
    level: "warning",
  };
}

export function SyncStatusSection({
  oauth,
  createProvider,
}: {
  readonly oauth: OAuthCapability;
  readonly createProvider: (getSession: () => OAuthSession | null) => SyncProvider;
}): React.JSX.Element {
  const data = useData();
  const { language } = useLanguage();
  const cryptoAdapter = useMemo(() => createSyncCryptoAdapter(), []);
  const entityStore = useMemo(() => createAppSyncEntityStoreAdapter(data), [data]);
  const [status, setStatus] = useState<SyncStatusSnapshot | null>(null);
  const [browserInstallations, setBrowserInstallations] = useState<
    readonly BrowserInstallationSnapshot[]
  >([]);
  const [currentInstallationId, setCurrentInstallationId] = useState<string | null>(null);
  const [currentInstallationName, setCurrentInstallationName] = useState("");
  const [renamingInstallation, setRenamingInstallation] = useState(false);
  const [revocationConfirmationId, setRevocationConfirmationId] = useState<string | null>(null);
  const [revokingInstallationId, setRevokingInstallationId] = useState<string | null>(null);
  const [envelopes, setEnvelopes] = useState<readonly KeyEnvelope[]>([]);
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState("");
  const [credential, setCredential] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [newPassphraseConfirm, setNewPassphraseConfirm] = useState("");
  const [recoveryBundle, setRecoveryBundle] = useState<KeyRecoveryBundle | null>(null);
  const [recoveryFileName, setRecoveryFileName] = useState("");
  const [recoveryKeyInput, setRecoveryKeyInput] = useState("");
  const [importPassphrase, setImportPassphrase] = useState("");
  const [importPassphraseConfirm, setImportPassphraseConfirm] = useState("");
  const [recoveryReveal, setRecoveryReveal] = useState<RecoveryReveal | null>(null);
  const [recoveryKeySaved, setRecoveryKeySaved] = useState(false);
  const [recoveryBundleSaved, setRecoveryBundleSaved] = useState(false);
  const [recoveryLossAcknowledged, setRecoveryLossAcknowledged] = useState(false);
  const [keyManagementWorking, setKeyManagementWorking] = useState(false);
  const [keyManagementError, setKeyManagementError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [authorizationReady, setAuthorizationReady] = useState(false);
  const [authorizingPreparation, setAuthorizingPreparation] = useState(true);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [setupError, setSetupError] = useState<AppError | null>(null);
  const [syncError, setSyncError] = useState<AppError | null>(null);
  const [summary, setSummary] = useState<SyncReplicaSummary | null>(null);
  const [writeKeyActive, setWriteKeyActive] = useState(isSyncWriteKeyActive());

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [installation, operations, availableEnvelopes] = await Promise.all([
        ensureInstallation({ clock: systemClock(), ids: { next: secureId } }, APP_VERSION),
        listSyncOperations(),
        createBrowserKeyEnvelopeStore().list(),
      ]);
      if (!installation.ok) {
        setLoadError(fromDataError(installation.error));
        return;
      }
      if (!operations.ok) {
        setLoadError(fromDataError(operations.error));
        return;
      }
      const installations = await listInstallations();
      if (!installations.ok) {
        setLoadError(fromDataError(installations.error));
        return;
      }
      setEnvelopes(availableEnvelopes);
      setCurrentInstallationId(installation.value.installationId);
      setCurrentInstallationName(installation.value.installationName);
      setSelectedEnvelopeId((current) =>
        availableEnvelopes.some((envelope) => envelope.envelopeId === current)
          ? current
          : (availableEnvelopes[0]?.envelopeId ?? ""),
      );
      const localOperations = operations.value.filter(
        (operation) => operation.installationId === installation.value.installationId,
      );
      const lastSyncAt = installation.value.lastSyncAt;
      const lastSyncTime = lastSyncAt === null ? NaN : Date.parse(lastSyncAt);
      // The append-only outbox has no per-operation ACK; newer operations stand in for pending.
      setStatus({
        lastSyncAt,
        pendingOperations: localOperations.filter(
          (operation) =>
            !Number.isFinite(lastSyncTime) || Date.parse(operation.occurredAt) > lastSyncTime,
        ).length,
      });
      setBrowserInstallations(
        installations.value
          .map((registeredInstallation) => {
            const registeredLastSyncTime =
              registeredInstallation.lastSyncAt === null
                ? NaN
                : Date.parse(registeredInstallation.lastSyncAt);
            return {
              installation: registeredInstallation,
              pendingOperations: operations.value.filter(
                (operation) =>
                  operation.installationId === registeredInstallation.installationId &&
                  (!Number.isFinite(registeredLastSyncTime) ||
                    Date.parse(operation.occurredAt) > registeredLastSyncTime),
              ).length,
            };
          })
          .sort((first, second) => {
            const firstIsCurrent =
              first.installation.installationId === installation.value.installationId;
            const secondIsCurrent =
              second.installation.installationId === installation.value.installationId;
            return Number(secondIsCurrent) - Number(firstIsCurrent);
          }),
      );
    } catch (error) {
      setLoadError(fromUnknown(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const showKeyManagementError = (diagnosticCode: string, body: string): void => {
    setKeyManagementError({
      title: "Avaimen määritys ei onnistunut",
      body,
      actionLabel: null,
      diagnosticCode,
      level: "warning",
    });
  };

  const createLocalKey = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (keyManagementWorking || envelopes.length > 0) return;
    if (newPassphrase.length < 12 || newPassphrase !== newPassphraseConfirm) {
      showKeyManagementError(
        "sync.key.setup.passphrase-mismatch",
        "Tarkista tunnuslauseet ja yritä uudelleen.",
      );
      setNewPassphrase("");
      setNewPassphraseConfirm("");
      return;
    }

    setKeyManagementWorking(true);
    setKeyManagementError(null);
    let keySession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      const created = await createWrappedDataKey({
        kind: "passphrase",
        passphrase: newPassphrase,
      });
      if (!created.ok) throw new Error("sync.key.setup.envelope-failed");
      keySession = created.value.session;

      const generatedRecoveryKey = generateRecoveryKey();
      if (!generatedRecoveryKey.ok) throw new Error(generatedRecoveryKey.error.diagnosticCode);
      recoveryKey = generatedRecoveryKey.value;

      const wrappedRecovery = await keySession.withKey((dataKey) =>
        createKeyEnvelope({
          dataKey,
          credential: { kind: "recovery", recoveryKey: recoveryKey as Uint8Array },
          keyId: created.value.envelope.keyId,
        }),
      );
      if (!wrappedRecovery.ok) throw new Error("sync.key.setup.recovery-wrap-failed");
      const encodedBundle = encodeKeyRecoveryBundle(wrappedRecovery.value);
      const keyHex = formatRecoveryKeyHex(recoveryKey);
      if (!encodedBundle.ok || keyHex === null) throw new Error("sync.key.setup.bundle-failed");

      await createBrowserKeyEnvelopeStore().putMany([
        created.value.envelope,
        wrappedRecovery.value,
      ]);
      setRecoveryReveal({ keyHex, bundle: encodedBundle.value });
      setNewPassphrase("");
      setNewPassphraseConfirm("");
      await reload();
    } catch {
      showKeyManagementError(
        "sync.key.setup.failed",
        "Avainta ei voitu luoda tai tallentaa. Tarkista selaimen tallennustila ja yritä uudelleen.",
      );
    } finally {
      keySession?.lock();
      recoveryKey?.fill(0);
      setNewPassphrase("");
      setNewPassphraseConfirm("");
      setKeyManagementWorking(false);
    }
  };

  const readRecoveryBundle = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    setRecoveryBundle(null);
    setRecoveryFileName("");
    setKeyManagementError(null);
    if (file === undefined) return;
    if (file.size > 8 * 1024) {
      showKeyManagementError("sync.key.import.bundle-too-large", "Palautustiedosto ei kelpaa.");
      event.target.value = "";
      return;
    }
    try {
      const decoded = decodeKeyRecoveryBundle(await file.text());
      if (!decoded.ok) throw new Error(decoded.error.diagnosticCode);
      setRecoveryBundle(decoded.value);
      setRecoveryFileName(file.name);
    } catch {
      showKeyManagementError("sync.key.import.invalid-bundle", "Palautustiedosto ei kelpaa.");
      event.target.value = "";
    }
  };

  const importRecoveryKey = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (keyManagementWorking || recoveryBundle === null) return;
    if (importPassphrase.length < 12 || importPassphrase !== importPassphraseConfirm) {
      showKeyManagementError(
        "sync.key.import.passphrase-mismatch",
        "Tarkista tunnuslauseet ja yritä uudelleen.",
      );
      setImportPassphrase("");
      setImportPassphraseConfirm("");
      return;
    }
    if (envelopes.some((envelope) => envelope.keyId !== recoveryBundle.keyId)) {
      showKeyManagementError(
        "sync.key.import.different-key",
        "Tässä selaimessa on jo eri salausavain. Käytä tyhjää selainprofiilia.",
      );
      return;
    }

    const parsedRecoveryKey = parseRecoveryKeyHex(recoveryKeyInput.trim());
    if (parsedRecoveryKey === null) {
      showKeyManagementError(
        "sync.key.import.invalid-recovery-key",
        "Palautusavaimen muoto ei kelpaa.",
      );
      setRecoveryKeyInput("");
      return;
    }
    setRecoveryKeyInput("");

    setKeyManagementWorking(true);
    setKeyManagementError(null);
    let keySession: DataKeySession | null = null;
    try {
      const unlocked = await unlockDataKeySession({
        envelope: recoveryBundle.envelope,
        credential: { kind: "recovery", recoveryKey: parsedRecoveryKey },
      });
      if (!unlocked.ok) throw new Error("sync.key.import.unlock-failed");
      keySession = unlocked.value;
      const localEnvelope = await keySession.withKey((dataKey) =>
        createKeyEnvelope({
          dataKey,
          credential: { kind: "passphrase", passphrase: importPassphrase },
          keyId: recoveryBundle.keyId,
        }),
      );
      if (!localEnvelope.ok) throw new Error("sync.key.import.local-envelope-failed");

      const installation = await ensureInstallation(
        { clock: systemClock(), ids: { next: secureId } },
        APP_VERSION,
      );
      if (!installation.ok) throw new Error(installation.error.diagnosticCode);
      await createBrowserKeyEnvelopeStore().putMany([localEnvelope.value, recoveryBundle.envelope]);
      setRecoveryKeyInput("");
      setImportPassphrase("");
      setImportPassphraseConfirm("");
      setRecoveryBundle(null);
      setRecoveryFileName("");
      await reload();
    } catch {
      showKeyManagementError(
        "sync.key.import.failed",
        "Avainta ei voitu avata tai tallentaa. Tarkista palautusavain ja yritä uudelleen.",
      );
      setRecoveryKeyInput("");
      setImportPassphrase("");
      setImportPassphraseConfirm("");
    } finally {
      keySession?.lock();
      parsedRecoveryKey.fill(0);
      setKeyManagementWorking(false);
    }
  };

  const downloadBundleFile = (bundleText: string): void => {
    const blob = new Blob([bundleText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lifeos-key-recovery.json";
    anchor.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 0);
  };

  const downloadRecoveryBundle = (): void => {
    if (recoveryReveal === null) return;
    downloadBundleFile(recoveryReveal.bundle);
    setRecoveryBundleSaved(true);
  };

  const exportSavedRecoveryBundle = (): void => {
    const envelope = envelopes.find((item) => item.wrapping.kind === "recovery");
    if (envelope === undefined) return;
    const bundle = encodeKeyRecoveryBundle(envelope);
    if (!bundle.ok) {
      showKeyManagementError("sync.key.export.failed", "Palautustiedostoa ei voitu muodostaa.");
      return;
    }
    downloadBundleFile(bundle.value);
  };

  const finishRecoveryReveal = (): void => {
    setRecoveryReveal(null);
    setRecoveryKeySaved(false);
    setRecoveryBundleSaved(false);
    setRecoveryLossAcknowledged(false);
  };

  const unlockForTaskWrites = async (): Promise<void> => {
    const selectedEnvelope = envelopes.find((item) => item.envelopeId === selectedEnvelopeId);
    if (selectedEnvelope === undefined || keyManagementWorking || working) return;
    if (credential.length === 0) return;

    let keySession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    setKeyManagementWorking(true);
    setKeyManagementError(null);
    setSyncError(null);
    try {
      let keyCredential:
        | { readonly kind: "passphrase"; readonly passphrase: string }
        | { readonly kind: "recovery"; readonly recoveryKey: Uint8Array };
      if (selectedEnvelope.wrapping.kind === "passphrase") {
        keyCredential = { kind: "passphrase", passphrase: credential };
      } else {
        recoveryKey = parseRecoveryKeyHex(credential.trim());
        if (recoveryKey === null) {
          setSyncError({
            title: "Palautusavaimen muoto ei kelpaa",
            body: "Palautusavain (64 heksamerkkiä)",
            actionLabel: null,
            diagnosticCode: "sync.key.recovery-format-invalid",
            level: "warning",
          });
          return;
        }
        keyCredential = { kind: "recovery", recoveryKey };
      }

      const opened = await unlockDataKeySession({
        envelope: selectedEnvelope,
        credential: keyCredential,
      });
      if (!opened.ok) {
        setSyncError(keyUnlockError());
        return;
      }
      keySession = opened.value;
      const installation = await ensureInstallation(
        { clock: systemClock(), ids: { next: secureId } },
        APP_VERSION,
      );
      if (!installation.ok) {
        setSyncError(fromDataError(installation.error));
        return;
      }
      await activateSyncWriteKey({
        installationId: installation.value.installationId,
        keySession,
        crypto: cryptoAdapter,
      });
      keySession = null;
      setCredential("");
      await reload();
    } catch (error) {
      setSyncError(fromUnknown(error));
    } finally {
      keySession?.lock();
      recoveryKey?.fill(0);
      setCredential("");
      setKeyManagementWorking(false);
    }
  };

  useEffect(() => {
    void reload();
    const onDataChanged = (): void => {
      void reload();
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [reload]);

  useEffect(() => {
    const refreshKeyState = (): void => {
      setWriteKeyActive(isSyncWriteKeyActive());
    };
    window.addEventListener(SYNC_KEY_STATE_EVENT, refreshKeyState);
    return () => {
      window.removeEventListener(SYNC_KEY_STATE_EVENT, refreshKeyState);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void oauth
      .prepareAuthorization()
      .then((result) => {
        if (cancelled) return;
        setAuthorizingPreparation(false);
        if (result.ok) {
          setAuthorizationReady(true);
        } else {
          setSetupError(fromCapabilityError(result.error));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setAuthorizingPreparation(false);
        setSetupError(fromUnknown(error));
      });
    return () => {
      cancelled = true;
    };
  }, [oauth]);

  const syncNow = async (event: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const selectedEnvelope = envelopes.find((item) => item.envelopeId === selectedEnvelopeId);
    if (working || selectedEnvelope === undefined || !authorizationReady) return;

    let keyCredential:
      | { readonly kind: "passphrase"; readonly passphrase: string }
      | { readonly kind: "recovery"; readonly recoveryKey: Uint8Array };
    if (selectedEnvelope.wrapping.kind === "passphrase") {
      if (credential.length === 0) return;
      keyCredential = { kind: "passphrase", passphrase: credential };
    } else {
      const recoveryKey = parseRecoveryKeyHex(credential.trim());
      if (recoveryKey === null) {
        setSyncError({
          title: "Palautusavaimen muoto ei kelpaa",
          body: "Palautusavain (64 heksamerkkiä)",
          actionLabel: null,
          diagnosticCode: "sync.key.recovery-format-invalid",
          level: "warning",
        });
        return;
      }
      keyCredential = { kind: "recovery", recoveryKey };
    }

    setWorking(true);
    setSyncError(null);
    setSummary(null);
    let session: OAuthSession | null = null;
    let keySession: DataKeySession | null = null;
    try {
      // Start OAuth before the first await so the browser can open its popup.
      const authorization = oauth.beginAuthorization();
      const authorized = await authorization;
      if (!authorized.ok) {
        setSyncError(fromCapabilityError(authorized.error));
        return;
      }
      session = authorized.value;
      const opened = await unlockDataKeySession({
        envelope: selectedEnvelope,
        credential: keyCredential,
      });
      if (!opened.ok) {
        setSyncError(keyUnlockError());
        return;
      }
      keySession = opened.value;
      const installation = await ensureInstallation(
        { clock: systemClock(), ids: { next: secureId } },
        APP_VERSION,
      );
      if (!installation.ok) {
        setSyncError(fromDataError(installation.error));
        return;
      }

      const provider = createProvider(() => session);
      const result = await syncReplica({
        provider,
        installationId: installation.value.installationId,
        keySession,
        crypto: cryptoAdapter,
        entityStore,
      });
      if (!result.ok) {
        setSyncError(coordinatorError(result.error));
        return;
      }
      const marked = await markInstallationSynced(
        { clock: systemClock(), ids: { next: secureId } },
        systemClock().nowIso(),
      );
      if (!marked.ok) {
        setSyncError(fromDataError(marked.error));
        return;
      }
      setSummary(result.value);
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch (error) {
      setSyncError(fromUnknown(error));
    } finally {
      if (keyCredential.kind === "recovery") keyCredential.recoveryKey.fill(0);
      keySession?.lock();
      setCredential("");
      if (session !== null) {
        await oauth.revoke(session).catch(() => undefined);
      }
      setWorking(false);
    }
  };

  const renameCurrentInstallation = async (
    event: SyntheticEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    if (renamingInstallation || currentInstallationId === null) return;
    const context = getActiveSyncWriteContext();
    if (context === null) {
      setKeyManagementError({
        title: "Avaa salausavain ensin",
        body: "Avaa tämän selaimen synkkausavain ennen asennuksen nimen vaihtamista.",
        actionLabel: null,
        diagnosticCode: "installation.rename.key-locked",
        level: "warning",
      });
      return;
    }
    setRenamingInstallation(true);
    setKeyManagementError(null);
    try {
      const renamed = await renameInstallation({
        deps: { clock: systemClock(), ids: { next: secureId } },
        installationId: currentInstallationId,
        name: currentInstallationName,
        keySession: context.keySession,
        crypto: context.crypto,
      });
      if (!renamed.ok) {
        setKeyManagementError(fromDataError(renamed.error));
        return;
      }
      setCurrentInstallationName(renamed.value.installationName);
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch (error) {
      setKeyManagementError(fromUnknown(error));
    } finally {
      setRenamingInstallation(false);
    }
  };

  const revokeOtherBrowser = async (targetInstallationId: string): Promise<void> => {
    if (revokingInstallationId !== null || currentInstallationId === null) return;
    const context = getActiveSyncWriteContext();
    if (context === null) {
      setKeyManagementError({
        title: "Avaa salausavain ensin",
        body: "Avaa tämän selaimen synkkausavain ennen toisen asennuksen perumista.",
        actionLabel: null,
        diagnosticCode: "installation.revoke.key-locked",
        level: "warning",
      });
      return;
    }
    setRevokingInstallationId(targetInstallationId);
    setKeyManagementError(null);
    try {
      const revoked = await revokeOtherInstallation({
        deps: { clock: systemClock(), ids: { next: secureId } },
        actingInstallationId: currentInstallationId,
        targetInstallationId,
        keySession: context.keySession,
        crypto: context.crypto,
      });
      if (!revoked.ok) {
        setKeyManagementError(fromDataError(revoked.error));
        return;
      }
      setRevocationConfirmationId(null);
      window.dispatchEvent(new Event("lifeos:data-changed"));
    } catch (error) {
      setKeyManagementError(fromUnknown(error));
    } finally {
      setRevokingInstallationId(null);
    }
  };

  const selectedEnvelope = envelopes.find((item) => item.envelopeId === selectedEnvelopeId);
  const credentialLabel =
    selectedEnvelope?.wrapping.kind === "recovery"
      ? t("Palautusavain (64 heksamerkkiä)")
      : t("Tunnuslause");

  return (
    <Card heading={t("Synkronointi")} data-testid="sync-status">
      <p>{t("Synkronoi tämän selaimen tiedot salatusti Google Driven kautta.")}</p>
      <dl data-ui="sync-status-metrics">
        <div>
          <dt>{t("Viimeisin onnistunut synkronointi")}</dt>
          <dd>
            {loading
              ? t("Ladataan…")
              : status === null
                ? "—"
                : formatTimestamp(status.lastSyncAt, language)}
          </dd>
        </div>
        <div>
          <dt>{t("Odottaa synkronointia")}</dt>
          <dd>{loading ? t("Ladataan…") : (status?.pendingOperations ?? "—")}</dd>
        </div>
      </dl>
      <section data-ui="browser-installations" aria-labelledby="browser-installations-heading">
        <h3 id="browser-installations-heading">{t("Selaininstanssit")}</h3>
        <p>{t("Tässä profiilissa tunnetut synkka-asennukset.")}</p>
        {loading && browserInstallations.length === 0 ? (
          <p role="status">{t("Ladataan selaininstansseja…")}</p>
        ) : browserInstallations.length === 0 ? (
          <p>{t("Selaininstansseja ei löytynyt.")}</p>
        ) : (
          <ul data-ui="browser-installation-list">
            {browserInstallations.map(({ installation, pendingOperations }) => {
              const isCurrent = installation.installationId === currentInstallationId;
              const health =
                installation.revokedAt !== null
                  ? t("Käyttö estetty")
                  : isCurrent && syncError !== null
                    ? t("Synkronointi vaatii huomiota")
                    : installation.lastSyncAt === null
                      ? t("Ei vielä synkronoitu")
                      : pendingOperations > 0
                        ? t("Odottaa synkronointia")
                        : t("Viimeisin synkka onnistui");
              return (
                <li key={installation.id} data-ui="browser-installation">
                  <div data-ui="browser-installation-title">
                    <h4>{installation.installationName || t("Nimeämätön selain")}</h4>
                    {isCurrent ? <span>{t("Tämä selain")}</span> : null}
                  </div>
                  <dl>
                    <div>
                      <dt>{t("Sovellusversio")}</dt>
                      <dd>{installation.lastSeenAppVersion || t("Tuntematon")}</dd>
                    </div>
                    <div>
                      <dt>{t("Viimeisin synkronointi")}</dt>
                      <dd>{formatTimestamp(installation.lastSyncAt, language)}</dd>
                    </div>
                    <div>
                      <dt>{t("Synkan terveystila")}</dt>
                      <dd data-ui="browser-installation-health">{health}</dd>
                    </div>
                  </dl>
                  {isCurrent && installation.revokedAt === null ? (
                    <form
                      data-ui="browser-installation-rename-form"
                      onSubmit={(event) => void renameCurrentInstallation(event)}
                    >
                      <label htmlFor="browser-installation-name">{t("Asennuksen nimi")}</label>
                      <input
                        id="browser-installation-name"
                        type="text"
                        minLength={1}
                        maxLength={60}
                        required
                        value={currentInstallationName}
                        onChange={(event) => {
                          setCurrentInstallationName(event.target.value);
                        }}
                        disabled={!writeKeyActive || renamingInstallation}
                      />
                      <Button
                        type="submit"
                        variant="secondary"
                        loading={renamingInstallation}
                        disabled={!writeKeyActive || renamingInstallation}
                      >
                        {t("Tallenna nimi")}
                      </Button>
                      {!writeKeyActive ? (
                        <p>{t("Avaa synkkausavain ennen nimen muuttamista.")}</p>
                      ) : null}
                    </form>
                  ) : null}
                  {isCurrent && installation.revokedAt !== null ? (
                    <p>{t("Parita tämä selain uudelleen ennen synkronointia.")}</p>
                  ) : null}
                  {!isCurrent && installation.revokedAt === null ? (
                    <div data-ui="browser-installation-revoke">
                      {revocationConfirmationId === installation.installationId ? (
                        <>
                          <p>{t("Peruutus estää selainta synkkaamasta tämän profiilin kanssa.")}</p>
                          <Button
                            type="button"
                            variant="danger"
                            loading={revokingInstallationId === installation.installationId}
                            disabled={!writeKeyActive || revokingInstallationId !== null}
                            onClick={() => {
                              void revokeOtherBrowser(installation.installationId);
                            }}
                          >
                            {t("Vahvista peruminen")}
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={revokingInstallationId !== null}
                            onClick={() => {
                              setRevocationConfirmationId(null);
                            }}
                          >
                            {t("Pidä käyttö")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="danger"
                          disabled={!writeKeyActive || revokingInstallationId !== null}
                          onClick={() => {
                            setRevocationConfirmationId(installation.installationId);
                          }}
                        >
                          {t("Peru synkkausoikeus")}
                        </Button>
                      )}
                      {!writeKeyActive ? <p>{t("Avaa synkkausavain ennen perumista.")}</p> : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {loading && status === null ? (
        <p role="status">{t("Ladataan synkronoinnin tilaa…")}</p>
      ) : null}
      {loadError !== null ? <ErrorCard error={loadError} onRetry={() => void reload()} /> : null}
      {setupError !== null ? <ErrorCard error={setupError} /> : null}
      {keyManagementError !== null ? <ErrorCard error={keyManagementError} /> : null}
      {syncError !== null ? <ErrorCard error={syncError} /> : null}
      {summary !== null ? (
        <p role="status" data-ui="sync-status-success">
          {t("Synkronointi valmis")}: {summary.uploadedOperations}{" "}
          {t("synkronointiin sisällytettyä muutosta")}, {summary.mergedEntities}{" "}
          {t("vastaanotettua tietuetta päivitetty")}.
        </p>
      ) : null}
      {recoveryReveal !== null ? (
        <section data-ui="sync-recovery-reveal" role="alert">
          <h3>{t("Tallenna palautustiedot nyt")}</h3>
          <p>{t("Palautusavain ja palautustiedosto on säilytettävä eri paikoissa.")}</p>
          <label htmlFor="sync-recovery-key-once">{t("Palautusavain näytetään vain nyt")}</label>
          <output id="sync-recovery-key-once" data-ui="sync-recovery-key">
            {recoveryReveal.keyHex}
          </output>
          <Button type="button" variant="secondary" onClick={downloadRecoveryBundle}>
            {recoveryBundleSaved
              ? t("Lataa palautustiedosto uudelleen")
              : t("Lataa palautustiedosto")}
          </Button>
          <label className="sync-recovery-ack">
            <input
              type="checkbox"
              checked={recoveryKeySaved}
              onChange={(event) => {
                setRecoveryKeySaved(event.target.checked);
              }}
            />
            {t("Olen tallentanut palautusavaimen erilleen tiedostosta.")}
          </label>
          <label className="sync-recovery-ack">
            <input
              type="checkbox"
              checked={recoveryLossAcknowledged}
              onChange={(event) => {
                setRecoveryLossAcknowledged(event.target.checked);
              }}
            />
            {t(
              "Ymmärrän, että palautusavaimen ja kaikkien avattujen selainten menetys tekee synkatusta datasta palautumattoman.",
            )}
          </label>
          <Button
            type="button"
            variant="primary"
            disabled={!recoveryBundleSaved || !recoveryKeySaved || !recoveryLossAcknowledged}
            onClick={finishRecoveryReveal}
          >
            {t("Valmis")}
          </Button>
        </section>
      ) : null}
      {envelopes.length === 0 && recoveryReveal === null ? (
        <details className="sync-key-section" open>
          <summary>{t("Luo salausavain tälle selaimelle")}</summary>
          <p>
            {t("Valitse tunnuslause ja tallenna palautusavain sekä palautustiedosto erikseen.")}
          </p>
          <form data-ui="sync-key-create-form" onSubmit={(event) => void createLocalKey(event)}>
            <label htmlFor="sync-new-passphrase">{t("Uusi tunnuslause")}</label>
            <input
              id="sync-new-passphrase"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={newPassphrase}
              onChange={(event) => {
                setNewPassphrase(event.target.value);
              }}
              disabled={keyManagementWorking}
            />
            <label htmlFor="sync-new-passphrase-confirm">{t("Vahvista tunnuslause")}</label>
            <input
              id="sync-new-passphrase-confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={newPassphraseConfirm}
              onChange={(event) => {
                setNewPassphraseConfirm(event.target.value);
              }}
              disabled={keyManagementWorking}
            />
            <Button type="submit" variant="secondary" loading={keyManagementWorking}>
              {t("Luo avainkuoret")}
            </Button>
          </form>
        </details>
      ) : null}
      {recoveryReveal === null ? (
        <details className="sync-key-section">
          <summary>{t("Lisää tämä selain palautustiedostosta")}</summary>
          <p>
            {t("Tuo palautustiedosto ja anna erikseen talteen otettu 64-merkkinen palautusavain.")}
          </p>
          <form data-ui="sync-key-import-form" onSubmit={(event) => void importRecoveryKey(event)}>
            <label htmlFor="sync-recovery-bundle">{t("Palautustiedosto")}</label>
            <input
              id="sync-recovery-bundle"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                void readRecoveryBundle(event);
              }}
              disabled={keyManagementWorking}
              required
            />
            {recoveryBundle !== null ? (
              <p role="status">
                {t("Valittu tiedosto")}: {recoveryFileName}
              </p>
            ) : null}
            <label htmlFor="sync-import-recovery-key">{t("Palautusavain (64 heksamerkkiä)")}</label>
            <input
              id="sync-import-recovery-key"
              type="password"
              autoComplete="off"
              maxLength={64}
              required
              value={recoveryKeyInput}
              onChange={(event) => {
                setRecoveryKeyInput(event.target.value);
              }}
              disabled={keyManagementWorking}
            />
            <label htmlFor="sync-import-passphrase">{t("Uusi paikallinen tunnuslause")}</label>
            <input
              id="sync-import-passphrase"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={importPassphrase}
              onChange={(event) => {
                setImportPassphrase(event.target.value);
              }}
              disabled={keyManagementWorking}
            />
            <label htmlFor="sync-import-passphrase-confirm">{t("Vahvista tunnuslause")}</label>
            <input
              id="sync-import-passphrase-confirm"
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={1024}
              required
              value={importPassphraseConfirm}
              onChange={(event) => {
                setImportPassphraseConfirm(event.target.value);
              }}
              disabled={keyManagementWorking}
            />
            <Button
              type="submit"
              variant="secondary"
              loading={keyManagementWorking}
              disabled={recoveryBundle === null}
            >
              {t("Avaa palautus ja lisää selain")}
            </Button>
          </form>
        </details>
      ) : null}
      {recoveryReveal === null &&
      envelopes.some((envelope) => envelope.wrapping.kind === "recovery") ? (
        <div data-ui="sync-recovery-export">
          <p>
            {t(
              "Palautustiedosto sisältää vain käärittyä avainta; palautusavain ei ole siinä mukana.",
            )}
          </p>
          <Button type="button" variant="secondary" onClick={exportSavedRecoveryBundle}>
            {t("Lataa palautustiedosto")}
          </Button>
        </div>
      ) : null}
      <form data-ui="sync-status-form" onSubmit={(event) => void syncNow(event)}>
        {envelopes.length === 0 ? (
          <p>{t("Tallenna tai tuo avainkuori ennen synkronointia.")}</p>
        ) : (
          <>
            {envelopes.length > 1 ? (
              <>
                <label htmlFor="sync-key-envelope">{t("Avaimen avaus")}</label>
                <select
                  id="sync-key-envelope"
                  value={selectedEnvelopeId}
                  onChange={(event) => {
                    setSelectedEnvelopeId(event.target.value);
                  }}
                  disabled={working}
                >
                  {envelopes.map((envelope, index) => (
                    <option key={envelope.envelopeId} value={envelope.envelopeId}>
                      {t("Avainkuori")} {index + 1} ·{" "}
                      {envelope.wrapping.kind === "passphrase"
                        ? t("tunnuslause")
                        : t("palautusavain")}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <label htmlFor="sync-key-credential">{credentialLabel}</label>
            <input
              id="sync-key-credential"
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
            <div data-ui="sync-write-key-state">
              {writeKeyActive ? (
                <>
                  <p role="status">
                    {t(
                      "Tehtävien, projektien, tunnisteiden ja muistilistojen muutokset lisätään salattuun synkronointijonoon, kun avain on avattu tässä välilehdessä.",
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={lockActiveSyncWriteKey}
                    disabled={working || keyManagementWorking}
                  >
                    {t("Lukitse avain tässä välilehdessä")}
                  </Button>
                </>
              ) : (
                <>
                  <p>
                    {t(
                      "Kun avain on lukittu, näiden tietojen muutokset jäävät vain tähän selaimeen.",
                    )}
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void unlockForTaskWrites()}
                    disabled={
                      working ||
                      keyManagementWorking ||
                      selectedEnvelope === undefined ||
                      credential.length === 0
                    }
                    loading={keyManagementWorking}
                  >
                    {t("Avaa avain tehtävien synkronointiin")}
                  </Button>
                </>
              )}
            </div>
          </>
        )}
        <Button
          type="submit"
          variant="primary"
          loading={working}
          disabled={
            loading ||
            working ||
            !authorizationReady ||
            selectedEnvelope === undefined ||
            credential.length === 0
          }
        >
          {working ? t("Synkronoidaan…") : t("Synkronoi nyt")}
        </Button>
        {authorizingPreparation ? (
          <p role="status">{t("Valmistellaan Google Drive -yhteyttä…")}</p>
        ) : null}
      </form>
    </Card>
  );
}
