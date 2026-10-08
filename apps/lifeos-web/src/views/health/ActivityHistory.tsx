// T244: aktiviteetit uusimmat ensin ja kevyt 7 päivän kirjausfrekvenssi.
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useMemo, useState } from "react";
import { createActivityEntryService, systemClock } from "@lifeos/data";
import type { ActivityEntryServiceDeps, EntityRepository } from "@lifeos/data";
import { Button, Card, EmptyState, FieldShell, Input, Meta, NumberInput } from "@lifeos/ui";
import type { ActivityEntry } from "@lifeos/domain";
import "./activity-history.css";

const NOTE_MAX_LENGTH = 500;

interface ActivityDayGroup {
  readonly dateKey: string;
  readonly entries: readonly ActivityEntry[];
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

function formatDay(dateKey: string): string {
  const [yearValue, monthValue, dayValue] = dateKey.split("-");
  const date = new Date(Number(yearValue), Number(monthValue) - 1, Number(dayValue), 12);
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

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "Kestoa ei kirjattu";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${String(remainder)} min`;
  return remainder === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(remainder)} min`;
}

function groupEntries(entries: readonly ActivityEntry[]): readonly ActivityDayGroup[] {
  const groups = new Map<string, ActivityEntry[]>();
  for (const entry of entries) {
    const key = localDateKey(new Date(entry.activityAt));
    const group = groups.get(key) ?? [];
    group.push(entry);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([dateKey, groupedEntries]) => ({ dateKey, entries: groupedEntries }))
    .sort((left, right) => right.dateKey.localeCompare(left.dateKey));
}

function summarizeRecentFrequency(entries: readonly ActivityEntry[], now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(date.getDate() - index);
    return localDateKey(date);
  });
  const daySet = new Set(days);
  const recentEntries = entries.filter((entry) =>
    daySet.has(localDateKey(new Date(entry.activityAt))),
  );
  const activeDays = new Set(recentEntries.map((entry) => localDateKey(new Date(entry.activityAt))))
    .size;
  return tTemplate("{{0}} kirjausta · {{1}}/7 aktiivista päivää", [
    String(recentEntries.length),
    String(activeDays),
  ]);
}

function ActivityEntryForm({
  activities,
  onSaved,
  onCancel,
}: {
  readonly activities: EntityRepository<ActivityEntry>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [activityAt, setActivityAt] = useState(() => localDateTimeValue(new Date()));
  const [kind, setKind] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const at = dateTimeToUtc(activityAt);
    const normalizedDuration = durationMinutes.trim().replace(",", ".");
    const parsedDuration = normalizedDuration === "" ? null : Number(normalizedDuration);
    if (at === null) {
      setError("Tarkista aktiviteetin paikallinen aika.");
      return;
    }
    if (
      parsedDuration !== null &&
      (!Number.isInteger(parsedDuration) || !Number.isFinite(parsedDuration) || parsedDuration < 0)
    ) {
      setError(t("Anna kestoksi nolla tai sitä suurempi kokonaisluku minuutteina."));
      return;
    }

    setError("");
    setSaving(true);
    try {
      const deps: ActivityEntryServiceDeps = { clock: systemClock(), activities };
      const result = await createActivityEntryService(deps, {
        activityAt: at,
        kind,
        durationSeconds: parsedDuration === null ? null : parsedDuration * 60,
        distanceMeters: null,
        note,
      });
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      onSaved();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : t("Aktiviteetin tallennus epäonnistui."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      id="health-activity-form"
      data-testid="health-activity-form"
      aria-label={t("Lisää aktiviteetti")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <div data-ui="health-activity-fields">
        <Input
          id="health-activity-kind"
          label={t("Aktiviteetti")}
          placeholder={t("Esim. kävely")}
          value={kind}
          maxLength={60}
          required
          disabled={saving}
          onChange={(event) => {
            setKind(event.target.value);
            setError("");
          }}
        />
        <FieldShell id="health-activity-at" label={t("Ajankohta")}>
          <input
            id="health-activity-at"
            type="datetime-local"
            data-ui="input"
            value={activityAt}
            disabled={saving}
            onChange={(event) => {
              setActivityAt(event.target.value);
              setError("");
            }}
          />
        </FieldShell>
        <NumberInput
          id="health-activity-duration"
          label={t("Kesto (min)")}
          hint={t("Voi jättää tyhjäksi.")}
          min={0}
          step={1}
          value={durationMinutes}
          disabled={saving}
          onChange={(event) => {
            setDurationMinutes(event.target.value);
            setError("");
          }}
        />
        <FieldShell
          id="health-activity-note"
          label={t("Muistiinpano")}
          hint={tTemplate("Enintään {{0}} merkkiä.", [String(NOTE_MAX_LENGTH)])}
        >
          <textarea
            id="health-activity-note"
            data-ui="input"
            rows={3}
            maxLength={NOTE_MAX_LENGTH}
            aria-describedby="health-activity-note-hint"
            value={note}
            disabled={saving}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </FieldShell>
      </div>
      <Meta>{t("Aika näytetään laitteen paikallisajassa.")}</Meta>
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <p data-ui="health-activity-form-actions">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna aktiviteetti")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function ActivityHistory({
  entries,
  activities,
}: {
  readonly entries: readonly ActivityEntry[];
  readonly activities: EntityRepository<ActivityEntry>;
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const activeEntries = useMemo(
    () =>
      entries
        .filter((entry) => entry.deletedAt === null)
        .slice()
        .sort((left, right) => Date.parse(right.activityAt) - Date.parse(left.activityAt)),
    [entries],
  );
  const groups = useMemo(() => groupEntries(activeEntries), [activeEntries]);
  const frequency = summarizeRecentFrequency(activeEntries, new Date());

  return (
    <Card heading={t("Aktiivisuushistoria")} data-testid="health-activity-history">
      <div data-ui="health-activity-intro">
        <Meta>{t("Uusimmat ensin · paikallinen aika")}</Meta>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={formOpen}
          aria-controls="health-activity-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          {formOpen
            ? t("Sulje lomake")
            : activeEntries.length === 0
              ? t("Kirjaa ensimmäinen aktiviteetti")
              : t("Kirjaa aktiviteetti")}
        </Button>
      </div>
      <dl data-ui="health-activity-frequency" aria-label={t("Aktiviteettien frekvenssi")}>
        <div>
          <dt>{t("Viimeiset 7 päivää")}</dt>
          <dd>{frequency}</dd>
        </div>
      </dl>
      {formOpen ? (
        <div data-ui="health-activity-editor">
          <ActivityEntryForm
            activities={activities}
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
          title={t("Ei aktiviteettimerkintöjä vielä")}
          hint={
            formOpen
              ? t("Tallenna ensimmäinen aktiviteetti, niin se ilmestyy historiaan.")
              : "Kirjaa liikkuminen, kesto ja halutessasi muistiinpano."
          }
        />
      ) : (
        <div data-ui="health-activity-days">
          {groups.map((group) => (
            <section key={group.dateKey} aria-label={formatDay(group.dateKey)}>
              <h3>{formatDay(group.dateKey)}</h3>
              <ol
                aria-label={tTemplate("{{0}}: {{1}} merkintää", [
                  formatDay(group.dateKey),
                  String(group.entries.length),
                ])}
              >
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <time dateTime={entry.activityAt}>{formatTime(entry.activityAt)}</time>
                    <div data-ui="health-activity-entry-copy">
                      <strong>{entry.kind}</strong>
                      <Meta>{formatDuration(entry.durationSeconds)}</Meta>
                      {entry.note === undefined || entry.note === null ? null : <p>{entry.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
