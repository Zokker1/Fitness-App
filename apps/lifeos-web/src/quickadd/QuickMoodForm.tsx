// T094: Quick Mood -lomake. Mieliala 1–5 (pakollinen, segmented) +
// VALINNAINEN energia 1–5 (segmented, oletus "ei valintaa") + VALINNAINEN
// vapaa muistiinpano (max 500 merkkiä). Yksinkertainen asteikko, ei
// sanallisia ankkureita ("hyvä/huono" olisi tulkintaa — numerot neutraaleja).
// EI TULKINTAA (§52/§56): onnistuminen sulkee sheetin, ei arvioita.
// Tallenus: 1 mood-checkin-rivi; onSaved(row) → kutsuja (QuickAdd) dispatchaa
// eventin. checkedAt = nyt (QuickAdd-lomakkeet kirjaavat aina nykyhetkeen).
import { t, tOptions } from "../language.tsx";
import { useState } from "react";
import { Button, Input, SegmentedControl } from "@lifeos/ui";
import { createMoodCheckinService, systemClock, type EntityRepository } from "@lifeos/data";
import type { MoodCheckin, UtcTimestamp } from "@lifeos/domain";

export interface QuickMoodFormProps {
  readonly moodCheckins: EntityRepository<MoodCheckin>;
  readonly now?: UtcTimestamp | undefined;
  readonly onSaved: (row: MoodCheckin) => void;
  readonly onCancel?: (() => void) | undefined;
}

const MOOD_OPTIONS = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
] as const;

const ENERGY_OPTIONS = [
  { value: "", label: "Ei valintaa" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
] as const;

export function QuickMoodForm({
  moodCheckins,
  now,
  onSaved,
  onCancel,
}: QuickMoodFormProps): React.JSX.Element {
  const [mood, setMood] = useState("3");
  const [energy, setEnergy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = (): void => {
    if (saving) {
      return;
    }
    const moodValue = Number(mood);
    if (!Number.isInteger(moodValue) || moodValue < 1 || moodValue > 5) {
      setError("Valitse mieliala 1–5.");
      return;
    }
    const energyValue = energy === "" ? null : Number(energy);
    if (
      energyValue !== null &&
      (!Number.isInteger(energyValue) || energyValue < 1 || energyValue > 5)
    ) {
      setError(t("Valitse energia 1–5 tai jätä valitsematta."));
      return;
    }
    const trimmedNote = note.trim();
    if (trimmedNote.length > 500) {
      setError(t("Muistiinpano on liian pitkä (max 500 merkkiä)."));
      return;
    }
    setSaving(true);
    setError("");
    const checkedAt = now ?? systemClock().nowIso();
    void createMoodCheckinService(
      { moodCheckins },
      {
        checkedAt,
        mood: moodValue,
        stress: null,
        energy: energyValue,
        motivation: null,
        focus: null,
        note: trimmedNote === "" ? null : trimmedNote,
      },
    )
      .then((result) => {
        if (!result.ok) {
          setError(result.error.userMessage);
          return;
        }
        onSaved(result.value);
      })
      .catch(() => {
        setError(t("Tallennus epäonnistui. Yritä uudelleen."));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  return (
    <form
      data-testid="quick-mood-form"
      aria-label={t("Kirjaa mieliala")}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <SegmentedControl
        label={t("Mieliala")}
        hint={t("Asteikko 1–5")}
        options={tOptions([...MOOD_OPTIONS])}
        value={mood}
        onOptionChange={(value) => {
          setMood(value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <SegmentedControl
        label={t("Energia (valinnainen)")}
        options={tOptions([...ENERGY_OPTIONS])}
        value={energy}
        onOptionChange={(value) => {
          setEnergy(value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      <Input
        label={t("Muistiinpano (valinnainen)")}
        placeholder={t("Vapaa sana tilanteesta")}
        value={note}
        disabled={saving}
        onChange={(event) => {
          setNote(event.target.value);
          if (error !== "") {
            setError("");
          }
        }}
      />
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <p>
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {t("Tallenna mieliala")}
        </Button>{" "}
        {onCancel !== undefined ? (
          <Button
            type="button"
            variant="secondary"
            disabled={saving}
            onClick={() => {
              onCancel();
            }}
          >
            {t("Peruuta")}
          </Button>
        ) : null}
      </p>
    </form>
  );
}
