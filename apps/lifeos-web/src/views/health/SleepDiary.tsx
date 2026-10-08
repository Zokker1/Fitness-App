// T241: yöunet ja päiväunet samassa paikalliseen päivään ryhmitellyssä aikajanassa.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useMemo, useState } from "react";
import { Button, Card, EmptyState, FieldShell, Meta, SegmentedControl, Select } from "@lifeos/ui";
import { calculateSleepDurationMinutes, createSleepEntryService, systemClock } from "@lifeos/data";
import type { EntityRepository } from "@lifeos/data";
import type { SleepEntry } from "@lifeos/domain";
import "./sleep-diary.css";

const SLEEP_KIND_OPTIONS = [
  { value: "night", label: "Yöuni" },
  { value: "nap", label: "Päiväunet" },
] as const;

const QUALITY_OPTIONS = [
  { value: "", label: "Ei arviota" },
  { value: "1", label: "1 — heikko" },
  { value: "2", label: "2 — välttävä" },
  { value: "3", label: "3 — kohtalainen" },
  { value: "4", label: "4 — hyvä" },
  { value: "5", label: "5 — erinomainen" },
] as const;

interface SleepDiaryGroup {
  readonly dateKey: string;
  readonly entries: readonly SleepEntry[];
}

function localDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dateTimeToUtc(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateTimeValue(date) !== value) return null;
  return date.toISOString();
}

function initialTimes(): { readonly start: string; readonly end: string } {
  const end = new Date();
  if (end.getHours() >= 7) {
    end.setHours(7, 0, 0, 0);
  } else {
    end.setSeconds(0, 0);
  }
  const start = new Date(end.getTime() - 8 * 60 * 60_000);
  return { start: localDateTimeValue(start), end: localDateTimeValue(end) };
}

function formatDay(dateKey: string): string {
  const [yearValue, monthValue, dayValue] = dateKey.split("-");
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  const date = new Date(year, month - 1, day, 12);
  const label = new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
  return `${label.slice(0, 1).toLocaleUpperCase(getIntlLocale())}${label.slice(1)}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function formatDuration(entry: SleepEntry): string {
  const minutes = Math.max(0, Math.round(calculateSleepDurationMinutes(entry)));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${String(rest)} min`;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

function formatInterval(entry: SleepEntry): string {
  const start = new Date(entry.sleepStart);
  const end = new Date(entry.sleepEnd);
  const crossesLocalDay = localDateKey(start) !== localDateKey(end);
  return tTemplate("{{0}}–{{1}}{{2}}", [
    formatTime(entry.sleepStart),
    formatTime(entry.sleepEnd),
    crossesLocalDay ? t(" · päättyi seuraavana päivänä") : "",
  ]);
}

function groupEntries(entries: readonly SleepEntry[]): readonly SleepDiaryGroup[] {
  const groups = new Map<string, SleepEntry[]>();
  for (const entry of entries) {
    const key = localDateKey(new Date(entry.sleepStart));
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([dateKey, groupedEntries]) => ({
    dateKey,
    entries: groupedEntries,
  }));
}

function DateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled: boolean;
}): React.JSX.Element {
  return (
    <FieldShell id={id} label={label}>
      <input
        id={id}
        type="datetime-local"
        data-ui="input"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </FieldShell>
  );
}

function SleepEntryForm({
  sleepEntries,
  onSaved,
  onCancel,
}: {
  readonly sleepEntries: EntityRepository<SleepEntry>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const initial = useMemo(initialTimes, []);
  const [sleepStart, setSleepStart] = useState(initial.start);
  const [sleepEnd, setSleepEnd] = useState(initial.end);
  const [kind, setKind] = useState<(typeof SLEEP_KIND_OPTIONS)[number]["value"]>("night");
  const [quality, setQuality] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const start = dateTimeToUtc(sleepStart);
    const end = dateTimeToUtc(sleepEnd);
    if (start === null || end === null) {
      setError(t("Tarkista alkamis- ja päättymisaika."));
      return;
    }
    if (Date.parse(end) <= Date.parse(start)) {
      setError(t("Päättymisajan pitää olla aloitusajan jälkeen."));
      return;
    }

    setError("");
    setSaving(true);
    try {
      const result = await createSleepEntryService(
        { clock: systemClock(), sleepEntries },
        {
          sleepStart: start,
          sleepEnd: end,
          quality: quality === "" ? null : Number(quality),
          isNap: kind === "nap",
        },
      );
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      onSaved();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : t("Unimerkinnän tallennus epäonnistui."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      id="health-sleep-form"
      data-testid="health-sleep-form"
      aria-label={t("Lisää unimerkintä")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <div data-ui="health-sleep-fields">
        <DateTimeField
          id="health-sleep-start"
          label={t("Alkaa")}
          value={sleepStart}
          disabled={saving}
          onChange={(value) => {
            setSleepStart(value);
            setError("");
          }}
        />
        <DateTimeField
          id="health-sleep-end"
          label={t("Päättyy")}
          value={sleepEnd}
          disabled={saving}
          onChange={(value) => {
            setSleepEnd(value);
            setError("");
          }}
        />
        <SegmentedControl
          label={t("Unen tyyppi")}
          options={tOptions(SLEEP_KIND_OPTIONS)}
          value={kind}
          disabled={saving}
          onOptionChange={(value) => {
            setKind(value as (typeof SLEEP_KIND_OPTIONS)[number]["value"]);
            setError("");
          }}
        />
        <Select
          label={t("Unen laatu")}
          options={tOptions([...QUALITY_OPTIONS])}
          value={quality}
          disabled={saving}
          onChange={(event) => {
            setQuality(event.target.value);
          }}
        />
      </div>
      <Meta>{t("Aika näytetään laitteen paikallisajassa.")}</Meta>
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <p data-ui="health-sleep-form-actions">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna uni")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function SleepDiary({
  entries,
  sleepEntries,
}: {
  readonly entries: readonly SleepEntry[];
  readonly sleepEntries: EntityRepository<SleepEntry>;
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const orderedEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.deletedAt === null)
        .slice()
        .sort((left, right) => Date.parse(right.sleepStart) - Date.parse(left.sleepStart)),
    [entries],
  );
  const groups = useMemo(() => groupEntries(orderedEntries), [orderedEntries]);

  return (
    <Card heading={t("Unipäiväkirja")} data-testid="health-sleep-diary">
      <div data-ui="health-sleep-intro">
        <Meta>{t("Uusimmat ensin · päivä ryhmitellään unen aloituksen mukaan")}</Meta>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={formOpen}
          aria-controls="health-sleep-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          {formOpen
            ? t("Sulje lomake")
            : orderedEntries.length === 0
              ? t("Kirjaa ensimmäinen uni")
              : t("Lisää uni")}
        </Button>
      </div>
      {formOpen ? (
        <div data-ui="health-sleep-editor">
          <SleepEntryForm
            sleepEntries={sleepEntries}
            onSaved={() => {
              setFormOpen(false);
            }}
            onCancel={() => {
              setFormOpen(false);
            }}
          />
        </div>
      ) : null}
      {groups.length === 0 ? (
        <EmptyState
          title={t("Ei unitietoja vielä")}
          hint={
            formOpen
              ? t("Tallenna ensimmäinen merkintä, niin se ilmestyy päiväkirjaan.")
              : t("Kirjaa yöuni tai päiväuni. Merkinnät näkyvät täällä aloituspäivän mukaan.")
          }
        />
      ) : (
        <div data-ui="health-sleep-days">
          {groups.map((group) => (
            <section key={group.dateKey} aria-label={formatDay(group.dateKey)}>
              <h3>{formatDay(group.dateKey)}</h3>
              <ol
                aria-label={tTemplate("{{0}}: {{1}} unitietoa", [
                  formatDay(group.dateKey),
                  String(group.entries.length),
                ])}
              >
                {group.entries.map((entry) => {
                  const isNap = entry.isNap === true;
                  return (
                    <li key={entry.id} data-sleep-kind={isNap ? "nap" : "night"}>
                      <time dateTime={entry.sleepStart}>{formatTime(entry.sleepStart)}</time>
                      <div data-ui="health-sleep-entry-copy">
                        <div data-ui="health-sleep-entry-heading">
                          <strong>{isNap ? t("Päiväunet") : t("Yöuni")}</strong>
                          <span data-ui="health-sleep-duration">{formatDuration(entry)}</span>
                        </div>
                        <span>{formatInterval(entry)}</span>
                        {entry.quality === null ? null : (
                          <span>
                            {t("Oma laatuarvio ")}
                            {String(entry.quality)}/5
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
