// T255: valmiit ja itse määritellyt protokollat käyttävät samaa ajastinta.
import { getIntlLocale, t, tOptions, tTemplate } from "../../language.tsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { systemClock, type EntityRepository } from "@lifeos/data";
import type {
  BreathingPhaseKind,
  BreathingProtocol,
  BreathingProtocolPhase,
  BreathingSession,
} from "@lifeos/domain";
import {
  BREATHING_PHASE_BREATH_MIN_SECONDS,
  BREATHING_PHASE_DURATION_MAX_SECONDS,
  BREATHING_PHASE_DURATION_MIN_SECONDS,
  BREATHING_PHASE_HOLD_MAX_SECONDS,
  BREATHING_PROTOCOL_MAX_PHASES,
  BREATHING_PROTOCOL_NAME_MAX_LENGTH,
  BREATHING_PROTOCOL_ROUNDS_MAX,
  BREATHING_PROTOCOL_ROUNDS_MIN,
  validateBreathingProtocol,
} from "@lifeos/domain";
import {
  Button,
  Card,
  Checkbox,
  Input,
  Meta,
  NumberInput,
  Select,
  useHaptics,
  useReducedMotion,
} from "@lifeos/ui";
import { isBreathingAudioSupported, playBreathingCue } from "./breathingFeedback.ts";

function defineProtocol(protocol: BreathingProtocol): BreathingProtocol {
  const result = validateBreathingProtocol(protocol);
  if (!result.ok) {
    throw new Error(tTemplate("Hengitysprotokollan {{0}} määritys ei kelpaa.", [protocol.key]));
  }
  return result.value;
}

const RISKY_BREATHING_CONTEXTS = ["water", "driving", "standing", "operating-machinery"] as const;
const BREATH_HOLD_WARNING =
  "Harjoitus sisältää hengityksenpidätyksen. Tee se istuen tai makuulla. Älä harjoittele vedessä tai suihkussa, ajaessa, seisten tai koneita käyttäessä. Keskeytä heti, jos huimaa tai olosi tuntuu huonolta.";

const BREATHING_PROTOCOLS = {
  "box-breathing": defineProtocol({
    key: "box-breathing",
    name: "Box Breathing",
    phases: [
      { kind: "inhale", durationSeconds: 4 },
      { kind: "hold", durationSeconds: 4 },
      { kind: "exhale", durationSeconds: 4 },
      { kind: "hold", durationSeconds: 4 },
    ],
    rounds: 4,
    safety: {
      risks: ["breath-hold"],
      warning: BREATH_HOLD_WARNING,
      avoidContexts: RISKY_BREATHING_CONTEXTS,
    },
  }),
  "4-7-8": defineProtocol({
    key: "4-7-8",
    name: "4–7–8-hengitys",
    phases: [
      { kind: "inhale", durationSeconds: 4 },
      { kind: "hold", durationSeconds: 7 },
      { kind: "exhale", durationSeconds: 8 },
    ],
    rounds: 4,
    safety: {
      risks: ["breath-hold"],
      warning: BREATH_HOLD_WARNING,
      avoidContexts: RISKY_BREATHING_CONTEXTS,
    },
  }),
  "equal-breathing": defineProtocol({
    key: "equal-breathing",
    name: "Tasainen hengitys",
    phases: [
      { kind: "inhale", durationSeconds: 4 },
      { kind: "exhale", durationSeconds: 4 },
    ],
    rounds: 6,
    safety: {
      risks: [],
      warning: null,
      avoidContexts: [],
    },
  }),
} as const;

const CUSTOM_PROTOCOL_KEY = "custom-breathing" as const;

type BreathingProtocolKey = keyof typeof BREATHING_PROTOCOLS;
type ProtocolSelectionKey = BreathingProtocolKey | typeof CUSTOM_PROTOCOL_KEY;

interface CustomBreathingPhaseDraft {
  readonly kind: BreathingPhaseKind;
  readonly durationSeconds: string;
}

interface CustomBreathingDraft {
  readonly name: string;
  readonly rounds: string;
  readonly phases: readonly CustomBreathingPhaseDraft[];
}

interface CustomProtocolResult {
  readonly protocol: BreathingProtocol | undefined;
  readonly error: string;
}

const DEFAULT_CUSTOM_DRAFT: CustomBreathingDraft = {
  name: "Oma hengitysharjoitus",
  rounds: "4",
  phases: [
    { kind: "inhale", durationSeconds: "4" },
    { kind: "exhale", durationSeconds: "4" },
  ],
};

const PROTOCOL_OPTIONS = [
  { value: "box-breathing", label: "Box Breathing" },
  { value: "4-7-8", label: "4–7–8-hengitys" },
  { value: "equal-breathing", label: "Tasainen hengitys" },
  { value: CUSTOM_PROTOCOL_KEY, label: "Oma harjoitus" },
] as const;

const PHASE_LABELS = {
  inhale: "Hengitä sisään",
  hold: "Pidätä hengitystä",
  exhale: "Hengitä ulos",
  rest: "Lepää",
} as const;

const PHASE_OPTIONS = [
  { value: "inhale", label: "Hengitä sisään" },
  { value: "hold", label: "Pidätä hengitystä" },
  { value: "exhale", label: "Hengitä ulos" },
  { value: "rest", label: "Lepää" },
] as const;

function vibrationPatternForPhase(kind: BreathingPhaseKind): number | number[] {
  if (kind === "hold") return [10, 25, 10];
  if (kind === "exhale") return 35;
  if (kind === "rest") return 10;
  return 20;
}

function restingScaleForPhase(
  phases: readonly BreathingProtocolPhase[],
  phaseIndex: number,
): "expanded" | "compact" {
  for (let offset = 1; offset <= phases.length; offset += 1) {
    const previousIndex = (phaseIndex - offset + phases.length) % phases.length;
    const previousPhase = phases[previousIndex];
    if (previousPhase?.kind === "inhale") return "expanded";
    if (previousPhase?.kind === "exhale") return "compact";
  }
  return "compact";
}

function buildCustomProtocol(draft: CustomBreathingDraft): CustomProtocolResult {
  const name = draft.name.trim();
  const rounds = Number(draft.rounds);
  if (name.length === 0 || name.length > BREATHING_PROTOCOL_NAME_MAX_LENGTH) {
    return {
      protocol: undefined,
      error: tTemplate("Anna harjoitukselle nimi (enintään {{0}} merkkiä).", [
        String(BREATHING_PROTOCOL_NAME_MAX_LENGTH),
      ]),
    };
  }
  if (
    !Number.isInteger(rounds) ||
    rounds < BREATHING_PROTOCOL_ROUNDS_MIN ||
    rounds > BREATHING_PROTOCOL_ROUNDS_MAX
  ) {
    return {
      protocol: undefined,
      error: `Kierroksia voi olla ${String(BREATHING_PROTOCOL_ROUNDS_MIN)}–${String(BREATHING_PROTOCOL_ROUNDS_MAX)}.`,
    };
  }
  if (draft.phases.length < 2 || draft.phases.length > BREATHING_PROTOCOL_MAX_PHASES) {
    return {
      protocol: undefined,
      error: tTemplate("Harjoituksessa pitää olla 2–{{0}} vaihetta.", [
        String(BREATHING_PROTOCOL_MAX_PHASES),
      ]),
    };
  }
  if (draft.phases[0]?.kind !== "inhale") {
    return { protocol: undefined, error: "Harjoituksen pitää alkaa sisäänhengityksellä." };
  }

  const phases: BreathingProtocolPhase[] = [];
  for (const [index, phase] of draft.phases.entries()) {
    const durationSeconds = Number(phase.durationSeconds);
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < BREATHING_PHASE_DURATION_MIN_SECONDS ||
      durationSeconds > BREATHING_PHASE_DURATION_MAX_SECONDS
    ) {
      return {
        protocol: undefined,
        error: tTemplate("Vaiheen {{0}} keston pitää olla {{1}}–{{2}} sekuntia.", [
          String(index + 1),
          String(BREATHING_PHASE_DURATION_MIN_SECONDS),
          String(BREATHING_PHASE_DURATION_MAX_SECONDS),
        ]),
      };
    }
    if (
      (phase.kind === "inhale" || phase.kind === "exhale") &&
      durationSeconds < BREATHING_PHASE_BREATH_MIN_SECONDS
    ) {
      return {
        protocol: undefined,
        error: tTemplate("Sisään- ja uloshengityksen pitää kestää vähintään {{0}} sekuntia.", [
          String(BREATHING_PHASE_BREATH_MIN_SECONDS),
        ]),
      };
    }
    if (phase.kind === "hold" && durationSeconds > BREATHING_PHASE_HOLD_MAX_SECONDS) {
      return {
        protocol: undefined,
        error: tTemplate("Oman harjoituksen pidätys voi kestää enintään {{0}} sekuntia.", [
          String(BREATHING_PHASE_HOLD_MAX_SECONDS),
        ]),
      };
    }
    if (index > 0 && phase.kind === "hold" && draft.phases[index - 1]?.kind === "hold") {
      return { protocol: undefined, error: "Peräkkäiset pidätysvaiheet eivät ole sallittuja." };
    }
    phases.push({ kind: phase.kind, durationSeconds });
  }

  if (!phases.some((phase) => phase.kind === "inhale")) {
    return { protocol: undefined, error: "Lisää vähintään yksi sisäänhengitysvaihe." };
  }
  if (!phases.some((phase) => phase.kind === "exhale")) {
    return { protocol: undefined, error: "Lisää vähintään yksi uloshengitysvaihe." };
  }

  const includesHold = phases.some((phase) => phase.kind === "hold");
  const candidate: BreathingProtocol = {
    key: CUSTOM_PROTOCOL_KEY,
    name,
    phases,
    rounds,
    safety: {
      risks: includesHold ? ["breath-hold"] : [],
      warning: includesHold ? BREATH_HOLD_WARNING : null,
      avoidContexts: includesHold ? RISKY_BREATHING_CONTEXTS : [],
    },
  };
  const result = validateBreathingProtocol(candidate);
  return result.ok
    ? { protocol: result.value, error: "" }
    : { protocol: undefined, error: result.error.message };
}

interface CustomProtocolEditorProps {
  readonly draft: CustomBreathingDraft;
  readonly disabled: boolean;
  readonly error: string;
  readonly onChange: (draft: CustomBreathingDraft) => void;
}

function CustomProtocolEditor({
  draft,
  disabled,
  error,
  onChange,
}: CustomProtocolEditorProps): React.JSX.Element {
  const updatePhase = (index: number, patch: Partial<CustomBreathingPhaseDraft>): void => {
    onChange({
      ...draft,
      phases: draft.phases.map((phase, phaseIndex) =>
        phaseIndex === index ? { ...phase, ...patch } : phase,
      ),
    });
  };

  return (
    <div data-ui="health-breathing-custom-editor">
      <Input
        label={t("Harjoituksen nimi")}
        maxLength={BREATHING_PROTOCOL_NAME_MAX_LENGTH}
        value={draft.name}
        disabled={disabled}
        onChange={(event) => {
          onChange({ ...draft, name: event.currentTarget.value });
        }}
      />
      <NumberInput
        label={t("Kierroksia")}
        min={BREATHING_PROTOCOL_ROUNDS_MIN}
        max={BREATHING_PROTOCOL_ROUNDS_MAX}
        step={1}
        value={draft.rounds}
        disabled={disabled}
        onChange={(event) => {
          onChange({ ...draft, rounds: event.currentTarget.value });
        }}
      />
      <div data-ui="health-breathing-custom-phases" aria-label={t("Harjoituksen vaiheet")}>
        {draft.phases.map((phase, index) => (
          <div data-ui="health-breathing-custom-phase" key={index}>
            <Select
              label={tTemplate("Vaihe {{0}}", [String(index + 1)])}
              options={tOptions(PHASE_OPTIONS)}
              value={phase.kind}
              disabled={disabled}
              onChange={(event) => {
                updatePhase(index, { kind: event.currentTarget.value as BreathingPhaseKind });
              }}
            />
            <NumberInput
              label={t("Kesto (s)")}
              min={BREATHING_PHASE_DURATION_MIN_SECONDS}
              max={BREATHING_PHASE_DURATION_MAX_SECONDS}
              step={1}
              value={phase.durationSeconds}
              disabled={disabled}
              onChange={(event) => {
                updatePhase(index, { durationSeconds: event.currentTarget.value });
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={disabled || draft.phases.length <= 2}
              onClick={() => {
                onChange({
                  ...draft,
                  phases: draft.phases.filter((_, phaseIndex) => phaseIndex !== index),
                });
              }}
            >
              {t("Poista vaihe")}
              {String(index + 1)}
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || draft.phases.length >= BREATHING_PROTOCOL_MAX_PHASES}
        onClick={() => {
          onChange({
            ...draft,
            phases: [...draft.phases, { kind: "rest", durationSeconds: "4" }],
          });
        }}
      >
        {t("Lisää vaihe")}
      </Button>
      <Meta>
        2–{String(BREATHING_PROTOCOL_MAX_PHASES)} {t(" vaihetta, enintään")}{" "}
        {String(BREATHING_PROTOCOL_ROUNDS_MAX)}{" "}
        {t("kierrosta ja 60 minuutin kokonaiskesto. Sisään- ja uloshengitys kestävät vähintään")}
        {String(BREATHING_PHASE_BREATH_MIN_SECONDS)} {t("s; pidätys enintään")}
        {String(BREATHING_PHASE_HOLD_MAX_SECONDS)} {t("s. Nopea hengitys ei ole tuettu.")}
      </Meta>
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
    </div>
  );
}

export interface BreathingExerciseCardProps {
  readonly breathingSessions: EntityRepository<BreathingSession>;
}

export function BreathingExerciseCard({
  breathingSessions,
}: BreathingExerciseCardProps): React.JSX.Element {
  const [protocolKey, setProtocolKey] = useState<ProtocolSelectionKey>("box-breathing");
  const [customDraft, setCustomDraft] = useState<CustomBreathingDraft>(DEFAULT_CUSTOM_DRAFT);
  const isCustom = protocolKey === CUSTOM_PROTOCOL_KEY;
  const customResult = useMemo(() => buildCustomProtocol(customDraft), [customDraft]);
  const protocol = isCustom
    ? (customResult.protocol ?? BREATHING_PROTOCOLS["equal-breathing"])
    : BREATHING_PROTOCOLS[protocolKey];
  const canStart = !isCustom || customResult.protocol !== undefined;
  const firstPhaseDuration = protocol.phases[0]?.durationSeconds ?? 0;
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [secondsLeft, setSecondsLeft] = useState(firstPhaseDuration);
  const [saveError, setSaveError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(false);
  const startedAtMonotonic = useRef<number | null>(null);
  const startedAtIso = useRef<string | null>(null);
  const lastCueKey = useRef("");
  const haptics = useHaptics();
  const reducedMotion = useReducedMotion();
  const soundSupported = useMemo(() => isBreathingAudioSupported(), []);

  useEffect(() => {
    if (!running) return;
    const roundDurationSeconds = protocol.phases.reduce(
      (total, phase) => total + phase.durationSeconds,
      0,
    );
    const totalDurationSeconds = roundDurationSeconds * protocol.rounds;
    const interval = window.setInterval(() => {
      const beganAt = startedAtMonotonic.current;
      if (beganAt === null) return;
      const elapsedSeconds = Math.floor((performance.now() - beganAt) / 1000);
      if (elapsedSeconds >= totalDurationSeconds) {
        const sessionStartedAt = startedAtIso.current;
        const sessionEndedAt = systemClock().nowIso();
        setRunning(false);
        setCompleted(true);
        setPhaseIndex(0);
        setRound(protocol.rounds);
        setSecondsLeft(0);
        startedAtMonotonic.current = null;
        startedAtIso.current = null;
        if (sessionStartedAt === null) return;
        setSaving(true);
        void (async () => {
          try {
            const result = await breathingSessions.create({
              startedAt: sessionStartedAt,
              endedAt: sessionEndedAt,
              patternKey: protocol.key,
            });
            if (!result.ok) {
              setSaveError(result.error.userMessage);
              return;
            }
            setSaveMessage("Harjoitus tallennettu.");
            window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
          } catch {
            setSaveError(t("Harjoitusta ei voitu tallentaa. Yritä uudelleen myöhemmin."));
          } finally {
            setSaving(false);
          }
        })();
        return;
      }

      const elapsedInRound = elapsedSeconds % roundDurationSeconds;
      let phaseOffset = elapsedInRound;
      for (let index = 0; index < protocol.phases.length; index += 1) {
        const phase = protocol.phases[index];
        if (phase === undefined) continue;
        if (phaseOffset < phase.durationSeconds) {
          const nextRound = Math.floor(elapsedSeconds / roundDurationSeconds) + 1;
          const cueKey = `${protocol.key}:${String(nextRound)}:${String(index)}`;
          if (lastCueKey.current !== cueKey) {
            lastCueKey.current = cueKey;
            if (soundEnabled) playBreathingCue(phase.kind);
            if (vibrationEnabled && phase.kind !== "rest") {
              haptics(vibrationPatternForPhase(phase.kind));
            }
          }
          setPhaseIndex(index);
          setRound(nextRound);
          setSecondsLeft(phase.durationSeconds - phaseOffset);
          return;
        }
        phaseOffset -= phase.durationSeconds;
      }
    }, 200);
    return () => {
      window.clearInterval(interval);
    };
  }, [breathingSessions, haptics, protocol, running, soundEnabled, vibrationEnabled]);

  const selectProtocol = (value: string): void => {
    if (!PROTOCOL_OPTIONS.some((option) => option.value === value)) return;
    const nextKey = value as ProtocolSelectionKey;
    const nextProtocol =
      nextKey === CUSTOM_PROTOCOL_KEY
        ? (customResult.protocol ?? BREATHING_PROTOCOLS["equal-breathing"])
        : BREATHING_PROTOCOLS[nextKey];
    setProtocolKey(nextKey);
    setPhaseIndex(0);
    setRound(1);
    setSecondsLeft(nextProtocol.phases[0]?.durationSeconds ?? 0);
    setCompleted(false);
    setSaveError("");
    setSaveMessage("");
  };

  const start = (): void => {
    if (!canStart) return;
    startedAtMonotonic.current = performance.now();
    startedAtIso.current = systemClock().nowIso();
    lastCueKey.current = `${protocol.key}:1:0`;
    const initialPhase = protocol.phases[0];
    if (initialPhase !== undefined) {
      if (soundEnabled) playBreathingCue(initialPhase.kind);
      if (vibrationEnabled && initialPhase.kind !== "rest") {
        haptics(vibrationPatternForPhase(initialPhase.kind));
      }
    }
    setPhaseIndex(0);
    setRound(1);
    setSecondsLeft(firstPhaseDuration);
    setCompleted(false);
    setSaveError("");
    setSaveMessage("");
    setRunning(true);
  };

  const stop = (): void => {
    startedAtMonotonic.current = null;
    startedAtIso.current = null;
    setRunning(false);
    setCompleted(false);
    setPhaseIndex(0);
    setRound(1);
    setSecondsLeft(firstPhaseDuration);
    setSaveError("");
    setSaveMessage(t("Harjoitus lopetettu. Keskeneräistä harjoitusta ei tallennettu."));
  };

  const currentPhase = protocol.phases[phaseIndex];
  const phaseLabel =
    running && currentPhase !== undefined
      ? t(PHASE_LABELS[currentPhase.kind])
      : completed
        ? t("Harjoitus valmis")
        : t("Valmis");
  const phaseSummary = protocol.phases
    .map(
      (phase) =>
        `${String(phase.durationSeconds)} s ${t(PHASE_LABELS[phase.kind]).toLocaleLowerCase(getIntlLocale())}`,
    )
    .join(" · ");
  const safetyWarning = isCustom
    ? customDraft.phases.some((phase) => phase.kind === "hold")
      ? BREATH_HOLD_WARNING
      : null
    : protocol.safety.warning;
  const restingScale = restingScaleForPhase(protocol.phases, phaseIndex);
  const targetScale = !running
    ? "compact"
    : currentPhase?.kind === "inhale"
      ? "expanded"
      : currentPhase?.kind === "exhale"
        ? "compact"
        : restingScale;

  return (
    <Card heading={t("Hengitysharjoitus")} data-testid="health-breathing-exercise">
      <div data-ui="health-breathing-controls">
        <Select
          label={t("Harjoitus")}
          value={protocolKey}
          options={tOptions(PROTOCOL_OPTIONS)}
          disabled={running || saving}
          onChange={(event) => {
            selectProtocol(event.currentTarget.value);
          }}
        />
      </div>
      {isCustom ? (
        <CustomProtocolEditor
          draft={customDraft}
          disabled={running || saving}
          error={t(customResult.error)}
          onChange={(nextDraft) => {
            setCustomDraft(nextDraft);
            const nextResult = buildCustomProtocol(nextDraft);
            const nextProtocol = nextResult.protocol ?? BREATHING_PROTOCOLS["equal-breathing"];
            setPhaseIndex(0);
            setRound(1);
            setSecondsLeft(nextProtocol.phases[0]?.durationSeconds ?? 0);
            setCompleted(false);
            setSaveError("");
            setSaveMessage("");
          }}
        />
      ) : null}
      <p data-ui="health-breathing-description">
        {canStart
          ? `${phaseSummary}. ${String(protocol.rounds)} kierrosta. Voit lopettaa milloin tahansa.`
          : t("Täydennä oman harjoituksen tiedot ennen aloitusta.")}
      </p>
      <p data-ui="health-breathing-safety" role="note">
        {t(
          "Ajastin ohjaa rauhallista rytmitystä; nopeat tai voimakkaat hengityssarjat eivät ole tuettuja.",
        )}
      </p>
      {safetyWarning !== null ? (
        <p data-ui="health-breathing-warning" role="note">
          {safetyWarning}
        </p>
      ) : null}
      <details data-ui="health-breathing-feedback">
        <summary>{t("Ääni ja värinä")}</summary>
        <div data-ui="health-breathing-feedback-options">
          <Checkbox
            checked={soundEnabled}
            disabled={!soundSupported || running || saving}
            onChange={(event) => {
              setSoundEnabled(event.currentTarget.checked);
            }}
          >
            {t("Äänimerkki vaiheen vaihtuessa")}
          </Checkbox>
          <Checkbox
            checked={vibrationEnabled}
            disabled={running || saving}
            onChange={(event) => {
              setVibrationEnabled(event.currentTarget.checked);
            }}
          >
            {t("Värinä, jos selain tukee sitä")}
          </Checkbox>
          <Meta>
            {t("Palaute on oletuksena pois.")}
            {soundSupported ? "" : t("Ääntä ei tueta tässä selaimessa. ")}
            {reducedMotion
              ? t("Liikkeen vähennys on käytössä; ajastin vaihtaa vaihetta ilman animaatiota.")
              : t("Ajastimen animaatio seuraa käyttöjärjestelmän liikeasetusta.")}
          </Meta>
        </div>
      </details>
      {canStart ? (
        <div data-ui="health-breathing-timer" aria-label={t("Hengitysharjoituksen ajastin")}>
          <div data-ui="health-breathing-orb-track" aria-hidden="true">
            <div
              key={`${protocol.key}:${String(round)}:${String(phaseIndex)}`}
              data-ui="health-breathing-orb"
              data-phase-kind={currentPhase?.kind ?? "rest"}
              data-running={running ? "true" : "false"}
              data-reduced-motion={reducedMotion ? "true" : "false"}
              data-static-scale={restingScale}
              data-target-scale={targetScale}
              style={{
                animationDuration: `${String(currentPhase?.durationSeconds ?? firstPhaseDuration)}s`,
              }}
            />
          </div>
          <p data-ui="health-breathing-phase" aria-live="polite">
            {phaseLabel}
          </p>
          <p
            data-ui="health-breathing-seconds"
            role="timer"
            aria-live="off"
            aria-label={tTemplate("{{0}} sekuntia jäljellä", [String(secondsLeft)])}
          >
            {String(secondsLeft)} {t("s")}
          </p>
          <Meta>
            {t("Kierros")}
            {String(round)} / {String(protocol.rounds)}
          </Meta>
        </div>
      ) : null}
      <div data-ui="health-breathing-actions">
        {running ? (
          <Button type="button" variant="secondary" onClick={stop}>
            {t("Lopeta harjoitus")}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={saving || !canStart}
            onClick={start}
          >
            {completed ? t("Aloita uudelleen") : t("Aloita harjoitus")}
          </Button>
        )}
      </div>
      {saveError !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(saveError)}
        </p>
      ) : null}
      {saveMessage !== "" ? (
        <p data-ui="health-breathing-status" role="status">
          {saveMessage}
        </p>
      ) : null}
    </Card>
  );
}
