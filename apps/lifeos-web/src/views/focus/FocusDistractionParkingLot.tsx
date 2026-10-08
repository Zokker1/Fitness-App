import { t, getIntlLocale } from "../../language.tsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Distraction, FocusSession } from "@lifeos/domain";
import { recordFocusDistraction, systemClock } from "@lifeos/data";
import { Button, Icon } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";

interface FocusDistractionParkingLotProps {
  readonly session: FocusSession;
}

function formatNotedAt(timestamp: string): string {
  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(getIntlLocale(), {
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function FocusDistractionParkingLot({
  session,
}: FocusDistractionParkingLotProps): React.JSX.Element {
  const { distractions, focusSessions } = useData();
  const [entries, setEntries] = useState<readonly Distraction[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const panelId = useId();
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void distractions
      .list()
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setEntries([]);
          setLoadError(result.error.userMessage);
          return;
        }
        setEntries(result.value.filter((entry) => entry.focusSessionId === session.id));
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setLoadError(t("Tähän fokusistuntoon kirjattuja ajatuksia ei voitu ladata."));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [distractions, session.id]);

  const sortedEntries = useMemo(
    () => [...entries].sort((left, right) => right.notedAt.localeCompare(left.notedAt)),
    [entries],
  );

  const submit = async (event: React.SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving || draft.trim().length === 0) {
      return;
    }
    setSaving(true);
    setActionError(null);
    setAnnouncement("");
    try {
      const result = await recordFocusDistraction(
        { clock: systemClock(), sessions: focusSessions, distractions },
        { focusSessionId: session.id, note: draft },
      );
      if (!result.ok) {
        setActionError(result.error.userMessage);
        return;
      }
      setEntries((current) => [result.value, ...current]);
      setLoadError(null);
      setDraft("");
      setAnnouncement("Ajatus kirjattu. Fokus jatkuu.");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      }
    } catch {
      setActionError(t("Ajatusta ei voitu tallentaa. Voit yrittää uudelleen."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section data-ui="focus-distraction" data-testid="focus-distraction">
      <Button
        variant="ghost"
        data-ui="focus-distraction-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((current) => !current);
          setActionError(null);
        }}
      >
        <Icon name={open ? "close" : "add"} />
        {open ? t("Sulje ajatukset") : t("Kirjaa ajatus")}
        {entries.length > 0 ? (
          <span data-ui="focus-distraction-count">{entries.length}</span>
        ) : null}
      </Button>
      <div id={panelId} data-ui="focus-distraction-panel" hidden={!open}>
        <p data-ui="focus-distraction-intro">
          {t("Kirjaa mieleen tullut asia sivuun. Fokusistunto jatkuu taustalla.")}
        </p>
        <form
          data-ui="focus-distraction-form"
          aria-busy={saving}
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor={inputId}>{t("Ajatus")}</label>
          <textarea
            ref={inputRef}
            id={inputId}
            data-ui="input"
            rows={2}
            value={draft}
            placeholder={t("Kirjoita lyhyt muistutus…")}
            onChange={(event) => {
              setDraft(event.target.value);
              setAnnouncement("");
              setActionError(null);
            }}
          />
          <div data-ui="focus-distraction-actions">
            <Button variant="primary" type="submit" disabled={saving || draft.trim().length === 0}>
              {saving ? t("Tallennetaan…") : t("Tallenna ajatus")}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => {
                setOpen(false);
                setActionError(null);
              }}
            >
              {t("Sulje")}
            </Button>
          </div>
        </form>
        {announcement.length > 0 ? (
          <p data-ui="focus-distraction-status" role="status" aria-live="polite">
            {announcement}
          </p>
        ) : null}
        {loadError !== null ? (
          <p data-ui="focus-distraction-error" role="alert">
            {t(loadError)}
          </p>
        ) : null}
        {actionError !== null ? (
          <p data-ui="focus-distraction-error" role="alert">
            {t(actionError)}
          </p>
        ) : null}
        <div data-ui="focus-distraction-list" aria-labelledby={`${panelId}-heading`}>
          <h3 id={`${panelId}-heading`}>{t("Kirjatut ajatukset")}</h3>
          {loading ? <p data-ui="focus-distraction-empty">{t("Ladataan kirjauksia…")}</p> : null}
          {!loading && loadError === null && sortedEntries.length === 0 ? (
            <p data-ui="focus-distraction-empty">{t("Ei vielä kirjattuja ajatuksia.")}</p>
          ) : null}
          {!loading && sortedEntries.length > 0 ? (
            <ul>
              {sortedEntries.map((entry) => (
                <li key={entry.id}>
                  <span>{entry.note}</span>
                  <time dateTime={entry.notedAt}>{formatNotedAt(entry.notedAt)}</time>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
