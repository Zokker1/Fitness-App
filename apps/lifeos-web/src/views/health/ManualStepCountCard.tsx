// T245: käyttäjän itse kirjaamat askeleet ilman wearable-yhteyttä.
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useMemo, useState } from "react";
import { createManualStepCountService, MANUAL_STEP_COUNT_UNIT, systemClock } from "@lifeos/data";
import type { EntityRepository } from "@lifeos/data";
import type { Measurement } from "@lifeos/domain";
import { Button, Card, EmptyState, FieldShell, Meta, NumberInput } from "@lifeos/ui";
import "./manual-step-count.css";

function localDateTimeValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function dateTimeToUtc(value: string): string | null {
  if (value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || localDateTimeValue(date) !== value) return null;
  return date.toISOString();
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatSteps(value: number): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 0 }).format(value);
}

function StepCountForm({
  measurements,
  onSaved,
  onCancel,
}: {
  readonly measurements: EntityRepository<Measurement>;
  readonly onSaved: () => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [measuredAt, setMeasuredAt] = useState(() => localDateTimeValue(new Date()));
  const [steps, setSteps] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const at = dateTimeToUtc(measuredAt);
    const normalizedSteps = steps.trim();
    const parsedSteps = normalizedSteps === "" ? Number.NaN : Number(normalizedSteps);
    if (at === null) {
      setError("Tarkista mittauksen paikallinen aika.");
      return;
    }
    if (!Number.isSafeInteger(parsedSteps) || parsedSteps < 0) {
      setError(t("Anna askelmääräksi nolla tai sitä suurempi kokonaisluku."));
      return;
    }
    setError("");
    setSaving(true);
    try {
      const result = await createManualStepCountService(
        { clock: systemClock(), measurements },
        { steps: parsedSteps, measuredAt: at, note },
      );
      if (!result.ok) {
        setError(result.error.userMessage);
        return;
      }
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      onSaved();
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : t("Askelmäärää ei voitu tallentaa."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      id="health-step-count-form"
      data-testid="health-step-count-form"
      aria-label={t("Kirjaa askelmäärä")}
      noValidate
      onSubmit={(event) => void save(event)}
    >
      <div data-ui="health-step-count-fields">
        <NumberInput
          id="health-step-count-value"
          label={tTemplate("Askeleet ({{0}})", [MANUAL_STEP_COUNT_UNIT])}
          placeholder={t("Esim. 8400")}
          min={0}
          step={1}
          value={steps}
          disabled={saving}
          onChange={(event) => {
            setSteps(event.target.value);
            setError("");
          }}
        />
        <FieldShell id="health-step-count-at" label={t("Ajankohta")}>
          <input
            id="health-step-count-at"
            type="datetime-local"
            data-ui="input"
            value={measuredAt}
            disabled={saving}
            onChange={(event) => {
              setMeasuredAt(event.target.value);
              setError("");
            }}
          />
        </FieldShell>
      </div>
      <FieldShell id="health-step-count-note" label={t("Muistiinpano (valinnainen)")}>
        <textarea
          id="health-step-count-note"
          data-ui="input"
          rows={2}
          maxLength={500}
          value={note}
          disabled={saving}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </FieldShell>
      <Meta>
        {t("Kirjaus tallentuu laitteen paikallisajassa. Askelmäärää ei haeta laitteesta.")}
      </Meta>
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <p data-ui="health-step-count-form-actions">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna askeleet")}
        </Button>{" "}
        <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
          {t("Peruuta")}
        </Button>
      </p>
    </form>
  );
}

export function ManualStepCountCard({
  entries,
  measurements,
}: {
  readonly entries: readonly Measurement[];
  readonly measurements: EntityRepository<Measurement>;
}): React.JSX.Element {
  const [formOpen, setFormOpen] = useState(false);
  const orderedEntries = useMemo(
    () => entries.slice().sort((left, right) => right.measuredAt.localeCompare(left.measuredAt)),
    [entries],
  );
  const latest = orderedEntries[0];
  const previous = orderedEntries.slice(1, 6);

  return (
    <Card heading={t("Askelmäärä")} data-testid="health-step-count">
      <div data-ui="health-step-count-intro">
        <Meta>{t("Manuaalinen mittaus · ei laiteyhteyttä")}</Meta>
        <Button
          type="button"
          variant="secondary"
          aria-expanded={formOpen}
          aria-controls="health-step-count-form"
          onClick={() => {
            setFormOpen((open) => !open);
          }}
        >
          {formOpen
            ? t("Sulje lomake")
            : entries.length === 0
              ? t("Kirjaa ensimmäiset askeleet")
              : t("Kirjaa askeleet")}
        </Button>
      </div>
      {formOpen ? (
        <div data-ui="health-step-count-editor">
          <StepCountForm
            measurements={measurements}
            onSaved={() => {
              setFormOpen(false);
            }}
            onCancel={() => {
              setFormOpen(false);
            }}
          />
        </div>
      ) : null}
      {latest === undefined ? (
        <EmptyState
          title={t("Ei askelmerkintöjä vielä")}
          hint={
            formOpen
              ? t("Tallenna päiväarvo, niin se näkyy tässä.")
              : t("Kirjaa päivän askelmäärä itse ilman laitetta.")
          }
        />
      ) : (
        <>
          <dl data-ui="health-step-count-latest">
            <div>
              <dt>{t("Viimeisin kirjaus")}</dt>
              <dd>
                {formatSteps(latest.value)} {MANUAL_STEP_COUNT_UNIT}
              </dd>
            </div>
            <Meta>{formatDateTime(latest.measuredAt)}</Meta>
            {latest.note !== null ? <p>{latest.note}</p> : null}
          </dl>
          {previous.length > 0 ? (
            <section data-ui="health-step-count-history" aria-label={t("Aiemmat askelmerkinnät")}>
              <h3>{t("Aiemmat kirjaukset")}</h3>
              <ol>
                {previous.map((entry) => (
                  <li key={entry.id}>
                    <time dateTime={entry.measuredAt}>{formatDateTime(entry.measuredAt)}</time>
                    <strong>
                      {formatSteps(entry.value)} {MANUAL_STEP_COUNT_UNIT}
                    </strong>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </Card>
  );
}
