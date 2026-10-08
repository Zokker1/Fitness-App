// T251: vapaaehtoinen päiväkirja ja iltareflektio.
import { t, getIntlLocale } from "../../language.tsx";
import { useEffect, useState } from "react";
import { createJournalEntryService, systemClock, type EntityRepository } from "@lifeos/data";
import type { JournalEntry } from "@lifeos/domain";
import { Button, Card, FieldShell, Meta } from "@lifeos/ui";

interface ReflectionDraft {
  readonly body: string;
  readonly success: string;
  readonly difficult: string;
  readonly tomorrow: string;
}

const EMPTY_DRAFT: ReflectionDraft = { body: "", success: "", difficult: "", tomorrow: "" };

function formatWrittenAt(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export interface EveningReflectionCardProps {
  readonly journalEntries: EntityRepository<JournalEntry>;
}

export function EveningReflectionCard({
  journalEntries,
}: EveningReflectionCardProps): React.JSX.Element {
  const [draft, setDraft] = useState<ReflectionDraft>(EMPTY_DRAFT);
  const [entries, setEntries] = useState<readonly JournalEntry[]>([]);
  const [loadError, setLoadError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async (): Promise<void> => {
      try {
        const result = await journalEntries.list();
        if (!active) return;
        if (!result.ok) {
          setLoadError(result.error.userMessage);
          return;
        }
        setEntries(
          result.value
            .filter((entry) => entry.deletedAt === null)
            .slice()
            .sort((left, right) =>
              left.writtenAt === right.writtenAt
                ? right.id.localeCompare(left.id)
                : right.writtenAt.localeCompare(left.writtenAt),
            )
            .slice(0, 5),
        );
        setLoadError("");
      } catch {
        if (active) setLoadError(t("Päiväkirjamerkintöjä ei voitu ladata."));
      }
    };
    const onDataChanged = (): void => {
      void refresh();
    };
    void refresh();
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      active = false;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [journalEntries]);

  const updateDraft = (field: keyof ReflectionDraft, value: string): void => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaveError("");
    setSaved(false);
  };

  const saveReflection = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    if (
      [draft.body, draft.success, draft.difficult, draft.tomorrow].every(
        (value) => value.trim() === "",
      )
    ) {
      setSaveError(t("Täytä vapaa muistiinpano tai jokin vapaaehtoinen reflektiokenttä."));
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaved(false);
    try {
      const result = await createJournalEntryService(
        { clock: systemClock(), journalEntries },
        {
          body: draft.body,
          reflectionSuccess: draft.success,
          reflectionDifficult: draft.difficult,
          reflectionTomorrow: draft.tomorrow,
        },
      );
      if (!result.ok) {
        setSaveError(result.error.userMessage);
        return;
      }
      setDraft(EMPTY_DRAFT);
      setSaved(true);
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } catch {
      setSaveError(t("Päiväkirjamerkintää ei voitu tallentaa. Yritä uudelleen."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card heading={t("Päiväkirja ja iltareflektio")} data-testid="health-evening-reflection">
      <p data-ui="health-reflection-intro">
        {t("Kirjaa vapaasti tai vastaa haluamiisi kysymyksiin. Kaikki kentät ovat vapaaehtoisia.")}
      </p>
      <form data-ui="health-reflection-form" onSubmit={(event) => void saveReflection(event)}>
        <FieldShell
          id="health-journal-body"
          label={t("Vapaa muistiinpano")}
          hint={t("Voit kirjoittaa vain tähän kenttään.")}
        >
          <textarea
            id="health-journal-body"
            data-ui="input"
            rows={3}
            aria-describedby="health-journal-body-hint"
            value={draft.body}
            disabled={saving}
            onChange={(event) => {
              updateDraft("body", event.target.value);
            }}
          />
        </FieldShell>
        <details data-ui="health-reflection-prompts">
          <summary>{t("Ohjatut kysymykset")}</summary>
          <div data-ui="health-reflection-fields">
            <FieldShell id="health-reflection-success" label={t("Mikä onnistui tänään?")}>
              <textarea
                id="health-reflection-success"
                data-ui="input"
                rows={2}
                maxLength={2000}
                value={draft.success}
                disabled={saving}
                onChange={(event) => {
                  updateDraft("success", event.target.value);
                }}
              />
            </FieldShell>
            <FieldShell id="health-reflection-difficult" label={t("Mikä tuntui vaikealta?")}>
              <textarea
                id="health-reflection-difficult"
                data-ui="input"
                rows={2}
                maxLength={2000}
                value={draft.difficult}
                disabled={saving}
                onChange={(event) => {
                  updateDraft("difficult", event.target.value);
                }}
              />
            </FieldShell>
            <FieldShell id="health-reflection-tomorrow" label={t("Mitä haluat tehdä huomenna?")}>
              <textarea
                id="health-reflection-tomorrow"
                data-ui="input"
                rows={2}
                maxLength={2000}
                value={draft.tomorrow}
                disabled={saving}
                onChange={(event) => {
                  updateDraft("tomorrow", event.target.value);
                }}
              />
            </FieldShell>
          </div>
        </details>
        <Meta>{t("Tallenna vain se, minkä haluat kirjata.")}</Meta>
        {saveError !== "" ? (
          <p data-ui="field-error" role="alert">
            {t(saveError)}
          </p>
        ) : null}
        {saved ? <p role="status">{t("Merkintä tallennettu.")}</p> : null}
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna merkintä")}
        </Button>
      </form>
      {loadError !== "" ? (
        <p data-ui="field-error" role="status">
          {t(loadError)}
        </p>
      ) : null}
      {entries.length > 0 ? (
        <section
          data-ui="health-reflection-recent"
          aria-label={t("Viimeisimmät päiväkirjamerkinnät")}
        >
          <h3>{t("Viimeisimmät merkinnät")}</h3>
          <ol>
            {entries.map((entry) => (
              <li key={entry.id}>
                <time dateTime={entry.writtenAt}>{formatWrittenAt(entry.writtenAt)}</time>
                {entry.body.trim() !== "" ? <p>{entry.body}</p> : null}
                {entry.reflectionSuccess !== null ? (
                  <p>
                    <strong>{t("Onnistui:")}</strong> {entry.reflectionSuccess}
                  </p>
                ) : null}
                {entry.reflectionDifficult !== null ? (
                  <p>
                    <strong>{t("Vaikeaa:")}</strong> {entry.reflectionDifficult}
                  </p>
                ) : null}
                {entry.reflectionTomorrow !== null ? (
                  <p>
                    <strong>{t("Huomenna:")}</strong> {entry.reflectionTomorrow}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </Card>
  );
}
