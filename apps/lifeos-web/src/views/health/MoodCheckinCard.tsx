// T249: nopeasti täytettävä, neutraali hyvinvoinnin check-in.
import { t, tOptions } from "../../language.tsx";
import { useState } from "react";
import {
  createCustomSymptomMetricService,
  createMoodCheckinService,
  systemClock,
  type EntityRepository,
} from "@lifeos/data";
import type { Measurement, MoodCheckin } from "@lifeos/domain";
import { Button, Card, Input, SegmentedControl, Select } from "@lifeos/ui";

const SCALE_VALUES = ["1", "2", "3", "4", "5"] as const;
const OPTIONAL_SCALE_OPTIONS = [
  { value: "", label: "–" },
  ...SCALE_VALUES.map((value) => ({ value, label: value })),
];
const REQUIRED_SCALE_OPTIONS = SCALE_VALUES.map((value) => ({ value, label: value }));
const NEW_SYMPTOM_KEY = "__new_symptom__";

type OptionalScaleKey = "stress" | "energy" | "motivation" | "focus";
type OptionalScaleState = Record<OptionalScaleKey, string>;

function nullableScore(value: string): number | null {
  return value === "" ? null : Number(value);
}

export interface MoodCheckinCardProps {
  readonly moodCheckins: EntityRepository<MoodCheckin>;
  readonly measurements: EntityRepository<Measurement>;
  readonly symptomMetricNames: readonly string[];
}

export function MoodCheckinCard({
  moodCheckins,
  measurements,
  symptomMetricNames,
}: MoodCheckinCardProps): React.JSX.Element {
  const [mood, setMood] = useState("");
  const [optionalScales, setOptionalScales] = useState<OptionalScaleState>({
    stress: "",
    energy: "",
    motivation: "",
    focus: "",
  });
  const [symptomKey, setSymptomKey] = useState(NEW_SYMPTOM_KEY);
  const [symptomName, setSymptomName] = useState("");
  const [symptomValue, setSymptomValue] = useState("");
  const [checkinError, setCheckinError] = useState("");
  const [symptomError, setSymptomError] = useState("");
  const [checkinSaved, setCheckinSaved] = useState(false);
  const [symptomSaved, setSymptomSaved] = useState(false);
  const [savingCheckin, setSavingCheckin] = useState(false);
  const [savingSymptom, setSavingSymptom] = useState(false);

  const saveCheckin = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (savingCheckin) return;
    if (mood === "") {
      setCheckinError("Valitse mielialalle arvo 1–5.");
      return;
    }
    setSavingCheckin(true);
    setCheckinError("");
    setCheckinSaved(false);
    try {
      const result = await createMoodCheckinService(
        { moodCheckins },
        {
          checkedAt: systemClock().nowIso(),
          mood: Number(mood),
          stress: nullableScore(optionalScales.stress),
          energy: nullableScore(optionalScales.energy),
          motivation: nullableScore(optionalScales.motivation),
          focus: nullableScore(optionalScales.focus),
          note: null,
        },
      );
      if (!result.ok) {
        setCheckinError(result.error.userMessage);
        return;
      }
      setMood("");
      setOptionalScales({ stress: "", energy: "", motivation: "", focus: "" });
      setCheckinSaved(true);
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } catch {
      setCheckinError(t("Check-inia ei voitu tallentaa. Yritä uudelleen."));
    } finally {
      setSavingCheckin(false);
    }
  };

  const saveSymptom = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (savingSymptom) return;
    const selectedName = symptomMetricNames.find((name) => name === symptomKey);
    const metricName = selectedName ?? symptomName;
    if (metricName.trim() === "") {
      setSymptomError("Anna oireelle nimi.");
      return;
    }
    if (symptomValue === "") {
      setSymptomError("Valitse oirearvolle arvo 1–5.");
      return;
    }
    setSavingSymptom(true);
    setSymptomError("");
    setSymptomSaved(false);
    try {
      const result = await createCustomSymptomMetricService(
        { clock: systemClock(), measurements },
        { metricName, value: Number(symptomValue) },
      );
      if (!result.ok) {
        setSymptomError(result.error.userMessage);
        return;
      }
      setSymptomValue("");
      setSymptomSaved(true);
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } catch {
      setSymptomError(t("Oirearviota ei voitu tallentaa. Yritä uudelleen."));
    } finally {
      setSavingSymptom(false);
    }
  };

  const symptomOptions = [
    { value: NEW_SYMPTOM_KEY, label: "Lisää uusi oireasteikko" },
    ...symptomMetricNames.map((name) => ({ value: name, label: name })),
  ];

  return (
    <Card heading={t("Miten voit juuri nyt?")} data-testid="health-mood-checkin">
      <p data-ui="health-checkin-intro">
        {t("Valitse mielialalle numero. Muut arviot ovat vapaaehtoisia.")}
      </p>
      <form data-ui="health-checkin-form" onSubmit={(event) => void saveCheckin(event)}>
        <SegmentedControl
          label={t("Mieliala")}
          hint={t("Asteikko 1–5")}
          options={tOptions(REQUIRED_SCALE_OPTIONS)}
          value={mood}
          disabled={savingCheckin}
          onOptionChange={(value) => {
            setMood(value);
            setCheckinError("");
            setCheckinSaved(false);
          }}
        />
        <details data-ui="health-checkin-more">
          <summary>{t("Lisää muita arvioita")}</summary>
          <div data-ui="health-checkin-optional-scales">
            {(
              [
                ["stress", "Stressi"],
                ["energy", "Energia"],
                ["motivation", "Motivaatio"],
                ["focus", "Keskittyminen"],
              ] as const
            ).map(([key, label]) => (
              <SegmentedControl
                key={key}
                label={label}
                hint={t("Valinnainen · asteikko 1–5")}
                options={tOptions(OPTIONAL_SCALE_OPTIONS)}
                value={optionalScales[key]}
                disabled={savingCheckin}
                onOptionChange={(value) => {
                  setOptionalScales((current) => ({ ...current, [key]: value }));
                  setCheckinError("");
                  setCheckinSaved(false);
                }}
              />
            ))}
          </div>
        </details>
        {checkinError !== "" ? (
          <p data-ui="field-error" role="alert">
            {t(checkinError)}
          </p>
        ) : null}
        {checkinSaved ? <p role="status">{t("Check-in tallennettu.")}</p> : null}
        <Button type="submit" variant="primary" loading={savingCheckin} disabled={savingCheckin}>
          {t("Tallenna check-in")}
        </Button>
      </form>
      <details data-ui="health-checkin-symptom">
        <summary>{t("Lisää oma oirearvio")}</summary>
        <form data-ui="health-checkin-symptom-form" onSubmit={(event) => void saveSymptom(event)}>
          {symptomMetricNames.length > 0 ? (
            <Select
              label={t("Oireasteikko")}
              options={tOptions(symptomOptions)}
              value={symptomKey}
              disabled={savingSymptom}
              onChange={(event) => {
                setSymptomKey(event.target.value);
                setSymptomError("");
                setSymptomSaved(false);
              }}
            />
          ) : null}
          {symptomKey === NEW_SYMPTOM_KEY ? (
            <Input
              label={t("Oireen nimi")}
              placeholder={t("Esim. päänsärky")}
              maxLength={40}
              value={symptomName}
              disabled={savingSymptom}
              onChange={(event) => {
                setSymptomName(event.target.value);
                setSymptomError("");
                setSymptomSaved(false);
              }}
            />
          ) : null}
          <SegmentedControl
            label={t("Oirearvio")}
            hint={t("Asteikko 1–5")}
            options={tOptions(REQUIRED_SCALE_OPTIONS)}
            value={symptomValue}
            disabled={savingSymptom}
            onOptionChange={(value) => {
              setSymptomValue(value);
              setSymptomError("");
              setSymptomSaved(false);
            }}
          />
          {symptomError !== "" ? (
            <p data-ui="field-error" role="alert">
              {t(symptomError)}
            </p>
          ) : null}
          {symptomSaved ? <p role="status">{t("Oirearvio tallennettu.")}</p> : null}
          <Button
            type="submit"
            variant="secondary"
            loading={savingSymptom}
            disabled={savingSymptom}
          >
            {t("Tallenna oirearvio")}
          </Button>
        </form>
      </details>
    </Card>
  );
}
