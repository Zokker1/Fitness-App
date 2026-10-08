// T321: create and download a complete encrypted local backup on demand.
import { useCallback, useEffect, useState } from "react";
import { Alert, Button } from "@lifeos/ui";
import {
  createEncryptedBackup,
  dryRunEncryptedBackupRestore,
  MAX_ENCRYPTED_BACKUP_FILE_BYTES,
  parseEncryptedBackup,
  parseRecoveryKeyHex,
  restoreEncryptedBackup,
  serializeEncryptedBackup,
  systemClock,
  unlockDataKeySession,
  verifyEncryptedBackupIntegrity,
} from "@lifeos/data";
import type { DataKeySession, KeyEnvelope } from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { t } from "../../language.tsx";
import {
  readFavoriteFoodIds,
  writeFavoriteFoodIds,
} from "../../preferences/favorite-foods-storage.ts";
import { writeLocalMacroTargets } from "../../preferences/macro-targets-storage.ts";
import { writeLocalMealSlots } from "../../preferences/meal-slots-storage.ts";
import { readNutritionPreferenceSnapshot } from "../../preferences/nutritionPreferenceSnapshot.ts";
import { useGamificationVisibility } from "../../preferences/GamificationVisibilityContext.tsx";
import { useHeight } from "../../preferences/HeightContext.tsx";
import { useHydrationTarget } from "../../preferences/HydrationTargetContext.tsx";
import { useWeightTarget } from "../../preferences/WeightTargetContext.tsx";
import {
  BACKUP_ROTATION_STATE_EVENT,
  createBrowserEncryptedBackupRotationStore,
} from "../../security/indexedDbEncryptedBackupStore.ts";
import type { EncryptedBackupRotationEntry } from "../../security/indexedDbEncryptedBackupStore.ts";
import {
  createBrowserKeyEnvelopeStore,
  KEY_ENVELOPE_STORE_CHANGED_EVENT,
} from "../../security/indexedDbKeyEnvelopeStore.ts";
import { getActiveSyncWriteContext, SYNC_KEY_STATE_EVENT } from "../../sync/syncRuntime.ts";
import { isPersistentStorage } from "../../storage/persistenceMode.ts";
import { useTheme } from "../../theme/ThemeContext.tsx";
import { downloadJson } from "../../utils/downloadJson.ts";
import { collectPortableSnapshotInput } from "./collectPortableSnapshotInput.ts";
import "./encrypted-backup.css";

function dateFileStamp(at = new Date()): string {
  return at
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/u, "Z");
}

export function EncryptedBackupExport(): React.JSX.Element {
  const data = useData();
  const theme = useTheme();
  const weightTarget = useWeightTarget();
  const height = useHeight();
  const hydrationTarget = useHydrationTarget();
  const gamification = useGamificationVisibility();
  const [envelopes, setEnvelopes] = useState<readonly KeyEnvelope[]>([]);
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState("");
  const [credential, setCredential] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [keyStoreError, setKeyStoreError] = useState(false);
  const [writeKeyActive, setWriteKeyActive] = useState(() => getActiveSyncWriteContext() !== null);
  const [working, setWorking] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [dryRunWorking, setDryRunWorking] = useState(false);
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [error, setError] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [backupFile, setBackupFile] = useState<File | null>(null);
  const [integrityError, setIntegrityError] = useState<string | null>(null);
  const [integrityStatus, setIntegrityStatus] = useState<string | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunStatus, setDryRunStatus] = useState<string | null>(null);
  const [restoreAcknowledged, setRestoreAcknowledged] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<string | null>(null);
  const [restoreCompleted, setRestoreCompleted] = useState(false);
  const [rotationEntries, setRotationEntries] = useState<readonly EncryptedBackupRotationEntry[]>(
    [],
  );
  const [rotationStoreError, setRotationStoreError] = useState(false);
  const [rotationFailure, setRotationFailure] = useState(false);

  const reloadRotationEntries = useCallback(async (): Promise<void> => {
    try {
      const entries = await createBrowserEncryptedBackupRotationStore().list();
      setRotationEntries(entries);
      setRotationStoreError(false);
    } catch {
      setRotationStoreError(true);
    }
  }, []);

  const reloadEnvelopes = useCallback(async (): Promise<void> => {
    setLoadingKeys(true);
    setKeyStoreError(false);
    try {
      const nextEnvelopes = await createBrowserKeyEnvelopeStore().list();
      setEnvelopes(nextEnvelopes);
      setSelectedEnvelopeId((current) =>
        nextEnvelopes.some((envelope) => envelope.envelopeId === current)
          ? current
          : (nextEnvelopes[0]?.envelopeId ?? ""),
      );
    } catch {
      setKeyStoreError(true);
    } finally {
      setLoadingKeys(false);
    }
  }, []);

  useEffect(() => {
    void reloadEnvelopes();
    const reload = (): void => {
      void reloadEnvelopes();
    };
    const refreshKeyState = (): void => {
      setWriteKeyActive(getActiveSyncWriteContext() !== null);
    };
    window.addEventListener(KEY_ENVELOPE_STORE_CHANGED_EVENT, reload);
    window.addEventListener(SYNC_KEY_STATE_EVENT, refreshKeyState);
    return () => {
      window.removeEventListener(KEY_ENVELOPE_STORE_CHANGED_EVENT, reload);
      window.removeEventListener(SYNC_KEY_STATE_EVENT, refreshKeyState);
    };
  }, [reloadEnvelopes]);

  useEffect(() => {
    if (writeKeyActive) setCredential("");
  }, [writeKeyActive]);

  useEffect(() => {
    void reloadRotationEntries();
    const onRotationState = (event: Event): void => {
      const detail = (event as CustomEvent<{ readonly status?: string }>).detail;
      setRotationFailure(detail.status === "error");
      void reloadRotationEntries();
    };
    window.addEventListener(BACKUP_ROTATION_STATE_EVENT, onRotationState);
    return () => {
      window.removeEventListener(BACKUP_ROTATION_STATE_EVENT, onRotationState);
    };
  }, [reloadRotationEntries]);

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
  const selectedEnvelope = envelopes.find((envelope) => envelope.envelopeId === selectedEnvelopeId);
  const latestRotation = rotationEntries[0];
  const credentialLabel =
    selectedEnvelope?.wrapping.kind === "recovery"
      ? t("Palautusavain (64 heksamerkkiä)")
      : t("Tunnuslause");

  const createBackup = async (): Promise<void> => {
    if (
      working ||
      verifying ||
      dryRunWorking ||
      restoreWorking ||
      settingsLoading ||
      settingsError ||
      keyStoreError
    )
      return;
    setWorking(true);
    setError(false);
    setStatus(null);

    let ownedSession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      let keySession = getActiveSyncWriteContext()?.keySession ?? null;
      if (keySession === null) {
        const latestEnvelopes = await createBrowserKeyEnvelopeStore().list();
        setEnvelopes(latestEnvelopes);
        const envelope = latestEnvelopes.find((item) => item.envelopeId === selectedEnvelopeId);
        if (envelope === undefined || credential.length === 0) {
          throw new Error("encrypted-backup.key-required");
        }

        const keyCredential =
          envelope.wrapping.kind === "passphrase"
            ? { kind: "passphrase" as const, passphrase: credential }
            : (() => {
                recoveryKey = parseRecoveryKeyHex(credential.trim());
                return recoveryKey === null ? null : { kind: "recovery" as const, recoveryKey };
              })();
        if (keyCredential === null) throw new Error("encrypted-backup.invalid-key");

        const opened = await unlockDataKeySession({ envelope, credential: keyCredential });
        if (!opened.ok) throw new Error("encrypted-backup.unlock-failed");
        keySession = opened.value;
        ownedSession = opened.value;
      }

      const nutritionPreferences = await readNutritionPreferenceSnapshot(
        isPersistentStorage(window.location.search),
      );
      const favoriteFoodIds = await readFavoriteFoodIds(
        isPersistentStorage(window.location.search),
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
        isPersistentStorage(window.location.search),
      );
      const encrypted = await createEncryptedBackup(snapshotInput, keySession);
      if (!encrypted.ok) throw new Error(encrypted.error.diagnosticCode);
      const serialized = serializeEncryptedBackup(encrypted.value);
      if (!serialized.ok) throw new Error(serialized.error.diagnosticCode);

      const filename = `lifeos-backup-${dateFileStamp()}.json`;
      downloadJson(serialized.value, filename);
      setStatus(t("Salattu varmuuskopio ladattiin."));
    } catch {
      setError(true);
    } finally {
      ownedSession?.lock();
      recoveryKey?.fill(0);
      setCredential("");
      setWorking(false);
    }
  };

  const verifyBackup = async (): Promise<void> => {
    if (
      verifying ||
      dryRunWorking ||
      restoreWorking ||
      working ||
      backupFile === null ||
      (!writeKeyActive && (loadingKeys || keyStoreError))
    ) {
      return;
    }
    setVerifying(true);
    setIntegrityError(null);
    setIntegrityStatus(null);

    let ownedSession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      if (backupFile.size > MAX_ENCRYPTED_BACKUP_FILE_BYTES) {
        setIntegrityError(t("Varmuuskopiotiedosto on liian suuri tarkistettavaksi."));
        return;
      }
      const parsed = parseEncryptedBackup(await backupFile.text());
      if (!parsed.ok) {
        setIntegrityError(
          parsed.error.code === "unsupported-version"
            ? t("Varmuuskopiotiedoston versiota ei tueta tässä sovellusversiossa.")
            : t("Varmuuskopiotiedosto on virheellinen tai keskeneräinen."),
        );
        return;
      }

      let keySession = getActiveSyncWriteContext()?.keySession ?? null;
      if (keySession === null) {
        const latestEnvelopes = await createBrowserKeyEnvelopeStore().list();
        setEnvelopes(latestEnvelopes);
        const envelope = latestEnvelopes.find((item) => item.envelopeId === selectedEnvelopeId);
        if (envelope === undefined || credential.length === 0) {
          setIntegrityError(t("Avaa avain tai anna sen avauskeino tarkistusta varten."));
          return;
        }

        const keyCredential =
          envelope.wrapping.kind === "passphrase"
            ? { kind: "passphrase" as const, passphrase: credential }
            : (() => {
                recoveryKey = parseRecoveryKeyHex(credential.trim());
                return recoveryKey === null ? null : { kind: "recovery" as const, recoveryKey };
              })();
        if (keyCredential === null) {
          setIntegrityError(t("Avauskeino ei ole kelvollinen."));
          return;
        }

        const opened = await unlockDataKeySession({ envelope, credential: keyCredential });
        if (!opened.ok) {
          setIntegrityError(t("Avainta ei voitu avata tällä avauskeinolla."));
          return;
        }
        keySession = opened.value;
        ownedSession = opened.value;
      }

      const verified = await verifyEncryptedBackupIntegrity(parsed.value, keySession);
      if (!verified.ok) {
        setIntegrityError(
          verified.error.code === "unsupported-version"
            ? t("Varmuuskopiotiedoston versiota ei tueta tässä sovellusversiossa.")
            : verified.error.code === "authentication-failed"
              ? t("Varmuuskopion eheyttä ei voitu todentaa tällä avaimella.")
              : t("Varmuuskopion sisältö ei vastaa sen manifestia."),
        );
        return;
      }
      setIntegrityStatus(
        `${t("Varmuuskopion eheys tarkistettu.")} ${new Date(
          verified.value.manifest.createdAt,
        ).toLocaleString()}`,
      );
    } catch {
      setIntegrityError(t("Varmuuskopiotiedoston tarkistus epäonnistui."));
    } finally {
      ownedSession?.lock();
      recoveryKey?.fill(0);
      setCredential("");
      setVerifying(false);
    }
  };

  const dryRunRestore = async (): Promise<void> => {
    if (
      working ||
      verifying ||
      dryRunWorking ||
      restoreWorking ||
      backupFile === null ||
      (!writeKeyActive && (loadingKeys || keyStoreError))
    ) {
      return;
    }
    setDryRunWorking(true);
    setDryRunError(null);
    setDryRunStatus(null);
    setRestoreAcknowledged(false);
    setRestoreError(null);
    setRestoreStatus(null);
    setRestoreCompleted(false);

    let ownedSession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      if (backupFile.size > MAX_ENCRYPTED_BACKUP_FILE_BYTES) {
        setDryRunError(t("Varmuuskopiotiedosto on liian suuri tarkistettavaksi."));
        return;
      }
      const parsed = parseEncryptedBackup(await backupFile.text());
      if (!parsed.ok) {
        setDryRunError(
          parsed.error.code === "unsupported-version"
            ? t("Varmuuskopiotiedoston versiota ei tueta tässä sovellusversiossa.")
            : t("Varmuuskopiotiedosto on virheellinen tai keskeneräinen."),
        );
        return;
      }

      let keySession = getActiveSyncWriteContext()?.keySession ?? null;
      if (keySession === null) {
        const latestEnvelopes = await createBrowserKeyEnvelopeStore().list();
        setEnvelopes(latestEnvelopes);
        const envelope = latestEnvelopes.find((item) => item.envelopeId === selectedEnvelopeId);
        if (envelope === undefined || credential.length === 0) {
          setDryRunError(t("Avaa avain tai anna sen avauskeino tarkistusta varten."));
          return;
        }

        const keyCredential =
          envelope.wrapping.kind === "passphrase"
            ? { kind: "passphrase" as const, passphrase: credential }
            : (() => {
                recoveryKey = parseRecoveryKeyHex(credential.trim());
                return recoveryKey === null ? null : { kind: "recovery" as const, recoveryKey };
              })();
        if (keyCredential === null) {
          setDryRunError(t("Avauskeino ei ole kelvollinen."));
          return;
        }

        const opened = await unlockDataKeySession({ envelope, credential: keyCredential });
        if (!opened.ok) {
          setDryRunError(t("Avainta ei voitu avata tällä avauskeinolla."));
          return;
        }
        keySession = opened.value;
        ownedSession = opened.value;
      }

      const result = await dryRunEncryptedBackupRestore(parsed.value, keySession);
      if (!result.ok) {
        setDryRunError(
          result.error.code === "unsupported-version"
            ? t("Varmuuskopiotiedoston versiota ei tueta tässä sovellusversiossa.")
            : result.error.code === "authentication-failed"
              ? t("Varmuuskopion eheyttä ei voitu todentaa tällä avaimella.")
              : t("Varmuuskopion tiedot eivät sovellu palautukseen."),
        );
        return;
      }
      setDryRunStatus(
        `${t("Dry-run onnistui. Tarkistettuja tietueita:")} ${String(result.value.checkedRecordCount)} · ${t("kokoelmia:")} ${String(result.value.checkedCollectionCount)}. ${t("Nykyisiä tietoja ei muutettu.")}`,
      );
    } catch {
      setDryRunError(t("Varmuuskopiotiedoston tarkistus epäonnistui."));
    } finally {
      ownedSession?.lock();
      recoveryKey?.fill(0);
      setCredential("");
      setDryRunWorking(false);
    }
  };

  const restoreBackup = async (): Promise<void> => {
    if (
      working ||
      verifying ||
      dryRunWorking ||
      restoreWorking ||
      !restoreAcknowledged ||
      dryRunStatus === null ||
      backupFile === null ||
      (!writeKeyActive && (loadingKeys || keyStoreError))
    ) {
      return;
    }
    setRestoreWorking(true);
    setRestoreError(null);
    setRestoreStatus(null);
    setRestoreCompleted(false);
    setRestoreAcknowledged(false);

    let ownedSession: DataKeySession | null = null;
    let recoveryKey: Uint8Array | null = null;
    try {
      if (backupFile.size > MAX_ENCRYPTED_BACKUP_FILE_BYTES) {
        setRestoreError(t("Varmuuskopiotiedosto on liian suuri palautettavaksi."));
        return;
      }
      const parsed = parseEncryptedBackup(await backupFile.text());
      if (!parsed.ok) {
        setRestoreError(
          parsed.error.code === "unsupported-version"
            ? t("Varmuuskopiotiedoston versiota ei tueta tässä sovellusversiossa.")
            : t("Varmuuskopiotiedosto on virheellinen tai keskeneräinen."),
        );
        return;
      }

      let keySession = getActiveSyncWriteContext()?.keySession ?? null;
      if (keySession === null) {
        const latestEnvelopes = await createBrowserKeyEnvelopeStore().list();
        setEnvelopes(latestEnvelopes);
        const envelope = latestEnvelopes.find((item) => item.envelopeId === selectedEnvelopeId);
        if (envelope === undefined || credential.length === 0) {
          setRestoreError(t("Avaa avain tai anna sen avauskeino palautusta varten."));
          return;
        }

        const keyCredential =
          envelope.wrapping.kind === "passphrase"
            ? { kind: "passphrase" as const, passphrase: credential }
            : (() => {
                recoveryKey = parseRecoveryKeyHex(credential.trim());
                return recoveryKey === null ? null : { kind: "recovery" as const, recoveryKey };
              })();
        if (keyCredential === null) {
          setRestoreError(t("Avauskeino ei ole kelvollinen."));
          return;
        }

        const opened = await unlockDataKeySession({ envelope, credential: keyCredential });
        if (!opened.ok) {
          setRestoreError(t("Avainta ei voitu avata tällä avauskeinolla."));
          return;
        }
        keySession = opened.value;
        ownedSession = opened.value;
      }

      const result = await restoreEncryptedBackup(parsed.value, keySession, {
        clock: systemClock(),
        ids: { next: () => crypto.randomUUID() },
      });
      if (!result.ok) {
        setRestoreError(
          result.error.code === "unsupported-version"
            ? t("Varmuuskopiotiedoston versiota ei tueta tässä sovellusversiossa.")
            : result.error.code === "authentication-failed"
              ? t("Varmuuskopion eheyttä ei voitu todentaa tällä avaimella.")
              : t("Palautusta ei voitu vahvistaa. Tarkista paikallisen tietokannan tila."),
        );
        return;
      }

      setRestoreCompleted(true);
      try {
        await writeFavoriteFoodIds(
          result.value.settings.favoriteFoodIds,
          isPersistentStorage(window.location.search),
        );
        if (!isPersistentStorage(window.location.search)) {
          writeLocalMacroTargets(result.value.settings.macroTargets);
          writeLocalMealSlots(result.value.settings.mealSlots);
        }
        theme.setPreference(result.value.settings.theme);
        setRestoreStatus(
          `${t("Palautus tallennettiin yhteen tietokantatransaktioon.")} ${String(result.value.restoredRecordCount)} ${t("tietuetta käsiteltiin; varmuuskopion ulkopuoliset paikalliset tietueet säilyivät. Lataa sovellus uudelleen, jotta näkymät lukevat palautetut tiedot.")}`,
        );
      } catch {
        setRestoreStatus(
          t(
            "Tietokantapalautus onnistui. Osa selaimeen tallennetuista asetuksista ei päivittynyt; lataa sovellus uudelleen ja tarkista asetukset.",
          ),
        );
      }
    } catch {
      setRestoreError(t("Palautus epäonnistui. Tietokantaa ei muutettu."));
    } finally {
      ownedSession?.lock();
      recoveryKey?.fill(0);
      setCredential("");
      setRestoreWorking(false);
    }
  };

  const downloadLatestRotatedBackup = (): void => {
    if (latestRotation === undefined) return;
    const serialized = serializeEncryptedBackup(latestRotation.backup);
    if (!serialized.ok) {
      setRotationFailure(true);
      return;
    }
    downloadJson(
      serialized.value,
      `lifeos-backup-auto-${dateFileStamp(new Date(latestRotation.createdAt))}.json`,
    );
  };

  return (
    <div data-testid="encrypted-backup-export" data-ui="encrypted-backup-export">
      <p>
        {t(
          "Luo manuaalinen salattu tiedosto kaikista paikallisista merkinnöistäsi ja asetuksistasi.",
        )}
      </p>
      <Alert tone="warning" title={t("Säilytä varmuuskopio ja sen avauskeino turvallisesti")}>
        {t(
          "Tiedosto ei sisällä avainta. Palautukseen tarvitaan sama avain tai palautusmenetelmä; tiedostoa ei lähetetä palvelimelle.",
        )}
      </Alert>
      <section
        data-ui="backup-integrity-check"
        aria-label={t("Varmuuskopion tarkistus ja palautettavuuden arvio")}
      >
        <p>
          {t(
            "Tarkista varmuuskopion salaus ja sisältö ennen palautuksen käyttöönottoa. Tarkistus ei muuta paikallisia tietoja.",
          )}
        </p>
        <label htmlFor="encrypted-backup-integrity-file">{t("Varmuuskopiotiedosto")}</label>
        <input
          id="encrypted-backup-integrity-file"
          type="file"
          accept="application/json,.json"
          disabled={working || verifying || dryRunWorking || restoreWorking}
          onChange={(event) => {
            setBackupFile(event.target.files?.[0] ?? null);
            setIntegrityError(null);
            setIntegrityStatus(null);
            setDryRunError(null);
            setDryRunStatus(null);
            setRestoreAcknowledged(false);
            setRestoreError(null);
            setRestoreStatus(null);
            setRestoreCompleted(false);
          }}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={
            working ||
            verifying ||
            dryRunWorking ||
            restoreWorking ||
            backupFile === null ||
            (!writeKeyActive &&
              (loadingKeys ||
                keyStoreError ||
                selectedEnvelope === undefined ||
                credential.length === 0))
          }
          loading={verifying}
          onClick={() => void verifyBackup()}
        >
          {verifying ? t("Tarkistetaan varmuuskopiota…") : t("Tarkista varmuuskopion eheys")}
        </Button>
        {integrityError !== null ? <p role="alert">{integrityError}</p> : null}
        {integrityStatus !== null ? <p role="status">{integrityStatus}</p> : null}
        <p>
          {t(
            "Dry-run avaa tiedot vain väliaikaiseen muistialueeseen ja tarkistaa tietueet sekä niiden viitteet. Nykyistä kantaa ei muuteta.",
          )}
        </p>
        <Button
          type="button"
          variant="secondary"
          disabled={
            working ||
            verifying ||
            dryRunWorking ||
            restoreWorking ||
            backupFile === null ||
            (!writeKeyActive &&
              (loadingKeys ||
                keyStoreError ||
                selectedEnvelope === undefined ||
                credential.length === 0))
          }
          loading={dryRunWorking}
          onClick={() => void dryRunRestore()}
        >
          {dryRunWorking ? t("Tarkistetaan palautettavuutta…") : t("Tee palautuksen dry-run")}
        </Button>
        {dryRunError !== null ? <p role="alert">{dryRunError}</p> : null}
        {dryRunStatus !== null ? <p role="status">{dryRunStatus}</p> : null}
        <div data-ui="encrypted-backup-restore">
          <p>
            {t(
              "Palautus yhdistää tiedot nykyiseen paikalliseen kantaan: sama tunniste päivitetään, ja vain nykyisessä kannassa olevat tietueet säilyvät. Tämä ei luo synkronointitapahtumia.",
            )}
          </p>
          <p>
            {t(
              "Selaimeen rinnakkaistallennetut asetukset, kuten suosikit, päivitetään tietokantatransaktion jälkeen.",
            )}
          </p>
          <label>
            <input
              type="checkbox"
              checked={restoreAcknowledged}
              disabled={
                working || verifying || dryRunWorking || restoreWorking || dryRunStatus === null
              }
              onChange={(event) => {
                setRestoreAcknowledged(event.target.checked);
                setRestoreError(null);
              }}
            />
            {t("Vahvistan palautuksen tähän paikalliseen tietokantaan.")}
          </label>
          <Button
            type="button"
            variant="secondary"
            disabled={
              working ||
              verifying ||
              dryRunWorking ||
              restoreWorking ||
              backupFile === null ||
              dryRunStatus === null ||
              !restoreAcknowledged ||
              (!writeKeyActive &&
                (loadingKeys ||
                  keyStoreError ||
                  selectedEnvelope === undefined ||
                  credential.length === 0))
            }
            loading={restoreWorking}
            onClick={() => void restoreBackup()}
          >
            {restoreWorking ? t("Palautetaan tietoja…") : t("Palauta salatusta varmuuskopiosta")}
          </Button>
          {restoreError !== null ? <p role="alert">{restoreError}</p> : null}
          {restoreStatus !== null ? <p role="status">{restoreStatus}</p> : null}
          {restoreCompleted ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                window.location.reload();
              }}
            >
              {t("Lataa sovellus uudelleen")}
            </Button>
          ) : null}
        </div>
      </section>
      <section data-ui="backup-rotation-status" aria-label={t("Automaattinen backup-kierto")}>
        <p>
          {t(
            "Automaattinen kierto tallentaa salattuja kopioita, kun sovellus on näkyvissä ja avain on avattu.",
          )}
        </p>
        <p>{t("Säilytys: 7 päivittäistä, 4 viikoittaista ja 12 kuukausittaista kopiota.")}</p>
        <p>
          {t(
            "Kiertokopiot säilyvät tässä selainprofiilissa. Sivustodatan tyhjennys poistaa ne. Lataa kopio erikseen, jos haluat säilyttää sen selaimen ulkopuolella.",
          )}
        </p>
        {!isPersistentStorage(window.location.search) ? (
          <p>{t("Automaattinen kierto ei ole käytössä muistipohjaisessa tilassa.")}</p>
        ) : latestRotation !== undefined ? (
          <>
            <p role="status">
              {t("Selaimeen tallennettuja salattuja kiertokopioita:")} {rotationEntries.length} ·{" "}
              {t("Viimeisin:")} {new Date(latestRotation.createdAt).toLocaleString()}
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={
                working || verifying || dryRunWorking || restoreWorking || rotationStoreError
              }
              onClick={downloadLatestRotatedBackup}
            >
              {t("Lataa viimeisin kiertokopio")}
            </Button>
          </>
        ) : (
          <p role="status">{t("Automaattista kiertokopiota ei ole vielä luotu.")}</p>
        )}
        {rotationStoreError ? (
          <p role="alert">{t("Kiertokopioiden säilytystilaa ei voitu lukea.")}</p>
        ) : null}
        {rotationFailure ? (
          <p role="alert">
            {t("Automaattisen kiertokopion luonti epäonnistui. Vanhoja kopioita ei poistettu.")}
          </p>
        ) : null}
      </section>
      {settingsError ? (
        <Alert tone="danger" title={t("Asetuksia ei voitu lukea")}>
          {t("Varmuuskopiota ei luotu, koska kaikkia asetuksia ei saatu luettua.")}
        </Alert>
      ) : null}
      {keyStoreError ? (
        <Alert tone="danger" title={t("Avainta ei voitu lukea")}>
          {t("Tarkista selaimen tallennustilan käyttö ja yritä uudelleen.")}
        </Alert>
      ) : null}
      {envelopes.length === 0 && !loadingKeys && !writeKeyActive ? (
        <p>{t("Määritä ensin salausavain Synkronointi-osiossa.")}</p>
      ) : null}
      {writeKeyActive ? (
        <p role="status">{t("Käytetään tässä välilehdessä avattua salausavainta.")}</p>
      ) : selectedEnvelope !== undefined ? (
        <div data-ui="encrypted-backup-key">
          <label htmlFor="encrypted-backup-envelope">{t("Avaimen avaus")}</label>
          <select
            id="encrypted-backup-envelope"
            value={selectedEnvelopeId}
            onChange={(event) => {
              setSelectedEnvelopeId(event.target.value);
            }}
            disabled={working || verifying || dryRunWorking || restoreWorking || loadingKeys}
          >
            {envelopes.map((envelope, index) => (
              <option key={envelope.envelopeId} value={envelope.envelopeId}>
                {t("Avainkuori")} {index + 1} ·{" "}
                {t(envelope.wrapping.kind === "passphrase" ? "tunnuslause" : "palautusavain")}
              </option>
            ))}
          </select>
          <label htmlFor="encrypted-backup-credential">{credentialLabel}</label>
          <input
            id="encrypted-backup-credential"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            value={credential}
            onChange={(event) => {
              setCredential(event.target.value);
            }}
            disabled={working || verifying || dryRunWorking || restoreWorking}
          />
        </div>
      ) : null}
      {error ? (
        <Alert tone="danger" title={t("Salatun varmuuskopion luonti epäonnistui")}>
          {t(
            "Kaikkia paikallisia tietoja ei saatu luettua tai avainta ei voitu avata. Varmuuskopiotiedostoa ei luotu.",
          )}
        </Alert>
      ) : null}
      {status !== null ? <p role="status">{status}</p> : null}
      <Button
        variant="secondary"
        disabled={
          working ||
          verifying ||
          dryRunWorking ||
          restoreWorking ||
          loadingKeys ||
          keyStoreError ||
          settingsLoading ||
          settingsError ||
          (!writeKeyActive && (selectedEnvelope === undefined || credential.length === 0))
        }
        loading={working}
        onClick={() => void createBackup()}
      >
        {working
          ? t("Valmistellaan salattua varmuuskopiota…")
          : t("Luo ja lataa salattu varmuuskopio")}
      </Button>
    </div>
  );
}
