// T314: review conflicting encrypted sync versions and resolve through a new operation.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConflictRecord } from "@lifeos/domain";
import {
  createEncryptedSyncOperation,
  createSyncCryptoAdapter,
  ensureInstallation,
  listConflictRecords,
  parseRecoveryKeyHex,
  readConflictVersionValues,
  resolveSyncConflict,
  systemClock,
  unlockDataKeySession,
  ulidLikeId,
} from "@lifeos/data";
import type {
  DataKeySession,
  KeyEnvelope,
  SyncConflictVersionValues,
  SyncPayloadEntity,
  SyncPayloadJsonValue,
} from "@lifeos/data";
import { Button, Card, EmptyState } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";
import type { LifeosDataServices } from "../../dataContext.tsx";
import { fromDataError, fromUnknown } from "../../errors/appError.ts";
import type { AppError } from "../../errors/appError.ts";
import { t, useLanguage } from "../../language.tsx";
import { createBrowserKeyEnvelopeStore } from "../../security/indexedDbKeyEnvelopeStore.ts";
import { ErrorCard } from "../../errors/ErrorCard.tsx";
import "./conflict-resolution.css";

type ConflictSide = "local" | "remote" | "manual";

interface ConflictRepository {
  getById(id: string): Promise<
    | {
        readonly ok: true;
        readonly value: SyncPayloadEntity;
      }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly userMessage: string;
          readonly diagnosticCode: string;
        };
      }
  >;
  update(
    id: string,
    patch: Partial<SyncPayloadEntity>,
  ): Promise<
    | {
        readonly ok: true;
        readonly value: SyncPayloadEntity;
      }
    | {
        readonly ok: false;
        readonly error: {
          readonly code: string;
          readonly userMessage: string;
          readonly diagnosticCode: string;
        };
      }
  >;
}

const ENTITY_REPOSITORIES: Readonly<Record<string, keyof LifeosDataServices>> = {
  project: "projects",
  tag: "tags",
  task: "tasks",
  "task-checklist-item": "taskChecklistItems",
  "calendar-block": "calendarBlocks",
  "focus-session": "focusSessions",
  distraction: "distractions",
  routine: "routines",
  "routine-step": "routineSteps",
  "routine-schedule": "routineSchedules",
  "routine-run": "routineRuns",
  "routine-step-run": "routineStepRuns",
  goal: "goals",
  "goal-day": "goalDays",
  "habit-rule": "habitRules",
  "sleep-entry": "sleepEntries",
  "breathing-session": "breathingSessions",
  "activity-entry": "activityEntries",
  "mood-checkin": "moodCheckins",
  reminder: "reminders",
  "notification-state": "notificationStates",
  supplement: "supplements",
  "supplement-log": "supplementLogs",
  "hydration-entry": "hydrationEntries",
  journal: "journalEntries",
  food: "foods",
  recipe: "recipes",
  "nutrition-entry": "nutritionEntries",
  "level-state": "levelStates",
  quest: "quests",
  "quest-progress": "questProgress",
  achievement: "achievements",
  collectible: "collectibles",
  "vault-reward": "vaultRewards",
};

function repositoryFor(data: LifeosDataServices, entityType: string): ConflictRepository | null {
  const property = ENTITY_REPOSITORIES[entityType];
  return property === undefined ? null : (data[property] as unknown as ConflictRepository);
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

function entityLabel(entityType: string): string {
  const labels: Readonly<Record<string, string>> = {
    project: "Projekti",
    tag: "Tunniste",
    task: "Tehtävä",
    "task-checklist-item": "Tehtävän alikohta",
    "calendar-block": "Kalenterimerkintä",
    "focus-session": "Fokusjakso",
    distraction: "Häiriömerkintä",
    routine: "Rutiini",
    goal: "Tavoite",
    "goal-day": "Tavoitepäivä",
    "sleep-entry": "Unimerkintä",
    "activity-entry": "Aktiivisuusmerkintä",
    "mood-checkin": "Mielialamerkintä",
    journal: "Päiväkirjamerkintä",
    measurement: "Mittaus",
    food: "Ruoka",
    recipe: "Resepti",
    "nutrition-entry": "Ravintomerkintä",
  };
  return t(labels[entityType] ?? entityType.replaceAll("-", " "));
}

function fieldLabel(field: string): string {
  if (field === "$entity") return t("Koko tietue");
  const readable = field
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ");
  return readable.charAt(0).toLocaleUpperCase() + readable.slice(1);
}

function ConflictValue({
  value,
  language,
}: {
  readonly value: SyncPayloadJsonValue | undefined;
  readonly language: string;
}): React.JSX.Element {
  if (value === undefined) return <span>{t("Kenttä on poistettu")}</span>;
  if (value === null) return <span>{t("Ei arvoa")}</span>;
  if (typeof value === "boolean") return <span>{value ? t("Kyllä") : t("Ei")}</span>;
  if (typeof value === "number") {
    return (
      <span>{new Intl.NumberFormat(language === "en" ? "en-GB" : "fi-FI").format(value)}</span>
    );
  }
  if (typeof value === "string") {
    const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/u.test(value) ? Date.parse(value) : NaN;
    return (
      <span>
        {Number.isFinite(timestamp)
          ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fi-FI", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(timestamp)
          : value}
      </span>
    );
  }
  if (Array.isArray(value)) {
    const entries = value as readonly SyncPayloadJsonValue[];
    return (
      <ul data-ui="conflict-value-list">
        {entries.map((entry, index) => (
          <li key={index}>
            <ConflictValue value={entry} language={language} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl data-ui="conflict-value-fields">
      {Object.entries(value).map(([key, entry]) => (
        <div key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd>
            <ConflictValue value={entry} language={language} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function formatDate(value: string, language: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    ? new Intl.DateTimeFormat(language === "en" ? "en-GB" : "fi-FI", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(timestamp)
    : t("Ajankohta ei ole tiedossa");
}

export function ConflictResolutionSection(): React.JSX.Element {
  const data = useData();
  const { language } = useLanguage();
  const cryptoAdapter = useMemo(() => createSyncCryptoAdapter(), []);
  const [records, setRecords] = useState<readonly ConflictRecord[]>([]);
  const [versions, setVersions] = useState<Readonly<Record<string, SyncConflictVersionValues>>>({});
  const [envelopes, setEnvelopes] = useState<readonly KeyEnvelope[]>([]);
  const [selectedEnvelopeId, setSelectedEnvelopeId] = useState("");
  const [credential, setCredential] = useState("");
  const [keySession, setKeySession] = useState<DataKeySession | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, ConflictSide>>>({});
  const [manualValues, setManualValues] = useState<Readonly<Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [unlockMessage, setUnlockMessage] = useState<string | null>(null);
  const [resolutionMessage, setResolutionMessage] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await listConflictRecords();
      if (!result.ok) {
        setError(fromDataError(result.error));
        return;
      }
      setRecords(result.value);
      if (result.value.some((record) => record.status === "open")) {
        const availableEnvelopes = await createBrowserKeyEnvelopeStore().list();
        setEnvelopes(availableEnvelopes);
        setSelectedEnvelopeId((current) =>
          availableEnvelopes.some((envelope) => envelope.envelopeId === current)
            ? current
            : (availableEnvelopes[0]?.envelopeId ?? ""),
        );
      } else {
        setEnvelopes([]);
      }
      if (keySession?.isUnlocked) {
        const opened: Record<string, SyncConflictVersionValues> = {};
        for (const conflict of result.value) {
          if (conflict.status !== "open") continue;
          const values = await readConflictVersionValues({
            conflict,
            keySession,
            crypto: cryptoAdapter,
          });
          if (!values.ok) {
            setError(fromDataError(values.error));
            setVersions({});
            return;
          }
          opened[conflict.id] = values.value;
        }
        setVersions(opened);
      } else {
        setVersions({});
      }
    } catch (error_) {
      setError(fromUnknown(error_));
    } finally {
      setLoading(false);
    }
  }, [cryptoAdapter, keySession]);

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

  useEffect(
    () => () => {
      keySession?.lock();
    },
    [keySession],
  );

  const openKey = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setUnlockMessage(null);
    const envelope = envelopes.find((item) => item.envelopeId === selectedEnvelopeId);
    if (envelope === undefined) {
      setUnlockMessage(
        t("Tältä selaimelta ei löytynyt konfliktien avaamiseen tarvittavaa avainkuorta."),
      );
      return;
    }
    const wrapping = envelope.wrapping;
    let keyCredential:
      | { readonly kind: "passphrase"; readonly passphrase: string }
      | {
          readonly kind: "recovery";
          readonly recoveryKey: Uint8Array;
        };
    if (wrapping.kind === "passphrase") {
      keyCredential = { kind: "passphrase", passphrase: credential };
    } else {
      const recoveryKey = parseRecoveryKeyHex(credential.trim());
      if (recoveryKey === null) {
        setUnlockMessage(t("Palautusavaimen muoto ei kelpaa."));
        return;
      }
      keyCredential = { kind: "recovery", recoveryKey };
    }
    setWorking(true);
    try {
      const opened = await unlockDataKeySession({ envelope, credential: keyCredential });
      if (!opened.ok) {
        setUnlockMessage(t("Avainta ei avattu. Tarkista tunnuslause tai palautusavain."));
        return;
      }
      keySession?.lock();
      setKeySession(opened.value);
      setCredential("");
    } catch {
      setUnlockMessage(t("Avainta ei avattu. Tarkista tunnuslause tai palautusavain."));
    } finally {
      if (keyCredential.kind === "recovery") keyCredential.recoveryKey.fill(0);
      setWorking(false);
    }
  };

  const lockKey = (): void => {
    keySession?.lock();
    setKeySession(null);
    setVersions({});
    setChoices({});
    setManualValues({});
  };

  const resolve = async (conflict: ConflictRecord): Promise<void> => {
    const version = versions[conflict.id];
    const side = choices[conflict.id];
    if (version === undefined || side === undefined || keySession === null) return;
    const repository = repositoryFor(data, conflict.entityType);
    if (repository === null || version.field === "$entity") {
      setResolutionMessage(t("Tämän tietuetyypin ratkaisua ei voi vielä tallentaa."));
      return;
    }
    const nextValue =
      side === "local"
        ? version.localValue
        : side === "remote"
          ? version.remoteValue
          : manualValues[conflict.id];
    if (nextValue === undefined) {
      setResolutionMessage(t("Poistetun kentän palauttaminen ei ole tuettu tässä ratkaisussa."));
      return;
    }
    setResolvingId(conflict.id);
    setResolutionMessage(null);
    try {
      const installation = await ensureInstallation(
        { clock: systemClock(), ids: { next: secureId } },
        "web",
      );
      if (!installation.ok) {
        setResolutionMessage(installation.error.userMessage);
        return;
      }
      const existing = await repository.getById(conflict.entityId);
      if (!existing.ok) {
        setResolutionMessage(existing.error.userMessage);
        return;
      }
      const restorePreviousValue = async (): Promise<boolean> => {
        if (!Object.hasOwn(existing.value, version.field)) return false;
        const previousValue = existing.value[version.field];
        if (previousValue === undefined) return false;
        const restored = await repository.update(conflict.entityId, {
          [version.field]: previousValue,
        });
        return restored.ok;
      };
      const changed = await repository.update(conflict.entityId, {
        [version.field]: nextValue,
      });
      if (!changed.ok) {
        setResolutionMessage(changed.error.userMessage);
        return;
      }
      const operation = await createEncryptedSyncOperation({
        operationId: secureId(),
        installationId: installation.value.installationId,
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        operation: "resolve",
        entityVersion: changed.value.version as number,
        occurredAt: changed.value.updatedAt as string,
        createdAt: changed.value.createdAt as string,
        entity: changed.value,
        changedFields: [version.field],
        keySession,
        crypto: cryptoAdapter,
      });
      if (!operation.ok) {
        const restored = await restorePreviousValue();
        setResolutionMessage(
          restored
            ? t(
                "Ratkaisua ei voitu tallentaa. Paikallinen arvo palautettiin ja konflikti on yhä avoin.",
              )
            : t(
                "Valittu arvo tallentui tällä laitteella, mutta synkronointiratkaisua ei voitu luoda. Konflikti on yhä avoin.",
              ),
        );
        return;
      }
      const saved = await resolveSyncConflict(conflict.id, operation.value);
      if (!saved.ok) {
        const restored = await restorePreviousValue();
        setResolutionMessage(
          restored
            ? t(
                "Ratkaisua ei voitu tallentaa. Paikallinen arvo palautettiin ja konflikti on yhä avoin.",
              )
            : t(
                "Valittu arvo tallentui tällä laitteella, mutta synkronointiratkaisua ei voitu viimeistellä. Konflikti on yhä avoin.",
              ),
        );
        return;
      }
      window.dispatchEvent(new Event("lifeos:data-changed"));
      setResolutionMessage(t("Ristiriita ratkaistiin ja valinta lisättiin synkronointijonoon."));
      setChoices((current) => {
        const next = { ...current };
        Reflect.deleteProperty(next, conflict.id);
        return next;
      });
      await reload();
    } catch {
      setResolutionMessage(
        t("Ratkaisua ei voitu tallentaa. Konflikti on yhä avoin; voit yrittää uudelleen."),
      );
    } finally {
      setResolvingId(null);
    }
  };

  const openRecords = records.filter((record) => record.status === "open");
  const resolvedCount = records.length - openRecords.length;

  return (
    <Card heading={t("Synkronointiristiriidat")} data-testid="conflict-resolution">
      <p>{t("Tarkastele eri laitteilla muuttuneita arvoja ja valitse, mitä käytetään.")}</p>
      {loading ? <p role="status">{t("Ladataan ristiriitoja…")}</p> : null}
      {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
      {!loading && error === null && openRecords.length === 0 ? (
        <EmptyState
          title={t("Ei avoimia synkronointiristiriitoja")}
          hint={
            resolvedCount > 0
              ? t("Aiemmat ratkaisut säilyvät synkronointihistoriassa.")
              : t("Jos saman tiedon muutokset eivät sovi yhteen, ne näkyvät täällä.")
          }
        />
      ) : null}
      {!loading && error === null && openRecords.length > 0 && keySession === null ? (
        <form data-ui="conflict-unlock" onSubmit={(event) => void openKey(event)}>
          <label htmlFor="conflict-envelope">{t("Avaimen avaus")}</label>
          <select
            id="conflict-envelope"
            value={selectedEnvelopeId}
            onChange={(event) => {
              setSelectedEnvelopeId(event.target.value);
            }}
            disabled={working || envelopes.length === 0}
          >
            {envelopes.map((envelope, index) => (
              <option key={envelope.envelopeId} value={envelope.envelopeId}>
                {t("Avainkuori")} {index + 1} ·{" "}
                {envelope.wrapping.kind === "passphrase" ? t("tunnuslause") : t("palautusavain")}
              </option>
            ))}
          </select>
          <label htmlFor="conflict-credential">
            {envelopes.find((envelope) => envelope.envelopeId === selectedEnvelopeId)?.wrapping
              .kind === "recovery"
              ? t("Palautusavain (64 heksamerkkiä)")
              : t("Tunnuslause")}
          </label>
          <input
            id="conflict-credential"
            type="password"
            autoComplete="current-password"
            maxLength={1024}
            value={credential}
            onChange={(event) => {
              setCredential(event.target.value);
            }}
            disabled={working || envelopes.length === 0}
            required
          />
          {envelopes.length === 0 ? (
            <p>
              {t(
                "Tältä selaimelta ei löytynyt avainkuorta. Synkronointiarvojen näyttäminen vaatii saman salausavaimen.",
              )}
            </p>
          ) : null}
          {unlockMessage !== null ? <p role="alert">{unlockMessage}</p> : null}
          <Button
            type="submit"
            disabled={working || envelopes.length === 0 || credential.length === 0}
          >
            {working ? t("Avataan…") : t("Avaa ristiriitojen arvot")}
          </Button>
        </form>
      ) : null}
      {keySession !== null ? (
        <div data-ui="conflict-unlocked-tools">
          <p>
            {t("Arvot avataan vain tässä näkymässä eikä avainta tallenneta tunnuslauseen jälkeen.")}
          </p>
          <Button variant="secondary" onClick={lockKey}>
            {t("Lukitse avain")}
          </Button>
        </div>
      ) : null}
      {resolutionMessage !== null ? <p role="status">{resolutionMessage}</p> : null}
      {keySession !== null && !loading && error === null ? (
        <ul data-ui="conflict-list">
          {openRecords.map((conflict) => {
            const version = versions[conflict.id];
            const repository = repositoryFor(data, conflict.entityType);
            const side = choices[conflict.id];
            const manualAllowed =
              typeof version?.localValue === "string" && typeof version.remoteValue === "string";
            const selectedValue =
              version === undefined || side === undefined
                ? undefined
                : side === "local"
                  ? version.localValue
                  : side === "remote"
                    ? version.remoteValue
                    : (manualValues[conflict.id] ?? (version.localValue as string));
            const requiresEntityChoice = version?.field === "$entity";
            const canResolve =
              version !== undefined &&
              repository !== null &&
              !requiresEntityChoice &&
              side !== undefined &&
              selectedValue !== undefined &&
              (side !== "manual" || manualAllowed);
            return (
              <li key={conflict.id} data-ui="conflict-row">
                <article aria-labelledby={`conflict-title-${conflict.id}`}>
                  <header>
                    <h3 id={`conflict-title-${conflict.id}`}>
                      {entityLabel(conflict.entityType)} · {fieldLabel(version?.field ?? "")}
                    </h3>
                    <time dateTime={conflict.createdAt}>
                      {formatDate(conflict.createdAt, language)}
                    </time>
                  </header>
                  {version === undefined ? (
                    <p role="status">{t("Avataan arvoja…")}</p>
                  ) : (
                    <>
                      <div data-ui="conflict-comparison">
                        <section aria-label={t("Tämän selaimen versio")}>
                          <h4>{t("Tämän selaimen versio")}</h4>
                          <ConflictValue value={version.localValue} language={language} />
                        </section>
                        <section aria-label={t("Toisen laitteen versio")}>
                          <h4>{t("Toisen laitteen versio")}</h4>
                          <ConflictValue value={version.remoteValue} language={language} />
                        </section>
                      </div>
                      {requiresEntityChoice ? (
                        <p>
                          {t(
                            "Tämä on append-only-tietueiden tunnisteristiriita. Arvoja säilytetään, mutta automaattista yhdistämistä ei voi tehdä.",
                          )}
                        </p>
                      ) : repository === null ? (
                        <p>{t("Tämän tietuetyypin ratkaisua ei voi vielä tallentaa.")}</p>
                      ) : (
                        <fieldset data-ui="conflict-choice">
                          <legend>{t("Valitse käytettävä arvo")}</legend>
                          <label>
                            <input
                              type="radio"
                              name={`conflict-choice-${conflict.id}`}
                              checked={side === "local"}
                              onChange={() => {
                                setChoices((current) => ({ ...current, [conflict.id]: "local" }));
                              }}
                            />
                            {t("Käytä tämän selaimen arvoa")}
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`conflict-choice-${conflict.id}`}
                              checked={side === "remote"}
                              onChange={() => {
                                setChoices((current) => ({ ...current, [conflict.id]: "remote" }));
                              }}
                            />
                            {t("Käytä toisen laitteen arvoa")}
                          </label>
                          {manualAllowed ? (
                            <label>
                              <input
                                type="radio"
                                name={`conflict-choice-${conflict.id}`}
                                checked={side === "manual"}
                                onChange={() => {
                                  setChoices((current) => ({
                                    ...current,
                                    [conflict.id]: "manual",
                                  }));
                                }}
                              />
                              {t("Yhdistä teksti itse")}
                            </label>
                          ) : null}
                          {side === "manual" && manualAllowed ? (
                            <label>
                              {t("Yhdistetty teksti")}
                              <textarea
                                rows={4}
                                value={
                                  manualValues[conflict.id] ??
                                  (typeof version.localValue === "string" ? version.localValue : "")
                                }
                                onChange={(event) => {
                                  setManualValues((current) => ({
                                    ...current,
                                    [conflict.id]: event.target.value,
                                  }));
                                }}
                              />
                            </label>
                          ) : null}
                          {selectedValue === undefined ? (
                            <p>
                              {t("Poistetun kentän palauttaminen ei ole tuettu tässä ratkaisussa.")}
                            </p>
                          ) : null}
                          <Button
                            disabled={!canResolve || resolvingId !== null}
                            onClick={() => void resolve(conflict)}
                          >
                            {resolvingId === conflict.id
                              ? t("Tallennetaan…")
                              : t("Ratkaise ristiriita")}
                          </Button>
                        </fieldset>
                      )}
                    </>
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
  );
}
