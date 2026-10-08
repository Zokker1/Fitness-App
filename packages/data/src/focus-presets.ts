// T161: Pomodoro-presets (puhdas datafunktio, ei ajastinta eikä IO:ta).
// Preset määrittää työ- ja taukovaiheen; countdown ja visibility-resume
// kuuluvat seuraaviin tehtäviin (T162–T163).

import { type DataResult, invalidInput } from "./errors.ts";

export type PomodoroPresetId = "classic" | "short" | "deep" | "custom";

export interface PomodoroPreset {
  readonly id: PomodoroPresetId;
  readonly label: string;
  /** Työvaiheen pituus kokonaisina sekunteina. */
  readonly workSeconds: number;
  /** Taukovaiheen pituus kokonaisina sekunteina. */
  readonly breakSeconds: number;
}

export interface CustomPomodoroInput {
  /** Työvaihe minuutteina, 1–120. */
  readonly workMinutes: number;
  /** Tauko minuutteina, 1–60. */
  readonly breakMinutes: number;
}

export const POMODORO_LIMITS = {
  workMinutes: { min: 1, max: 120 },
  breakMinutes: { min: 1, max: 60 },
} as const;

/** T169: lyhyt, yhdellä painalluksella käynnistyvä fokusjakso. */
export const FIVE_MINUTE_START_SECONDS = 5 * 60;

const CLASSIC_POMODORO: PomodoroPreset = {
  id: "classic",
  label: "Klassinen",
  workSeconds: 25 * 60,
  breakSeconds: 5 * 60,
};

/** Valmiit, tarkoituksella pieneksi rajatut vaihtoehdot (§8: matala kynnys). */
export const POMODORO_PRESETS: readonly PomodoroPreset[] = [
  CLASSIC_POMODORO,
  {
    id: "short",
    label: "Lyhyt",
    workSeconds: 15 * 60,
    breakSeconds: 3 * 60,
  },
  {
    id: "deep",
    label: "Syvä fokus",
    workSeconds: 50 * 60,
    breakSeconds: 10 * 60,
  },
] as const;

export const DEFAULT_POMODORO_PRESET: PomodoroPreset = CLASSIC_POMODORO;

export function getPomodoroPreset(id: Exclude<PomodoroPresetId, "custom">): PomodoroPreset {
  return POMODORO_PRESETS.find((preset) => preset.id === id) ?? DEFAULT_POMODORO_PRESET;
}

function invalidDuration(
  field: "workMinutes" | "breakMinutes",
  value: number,
): DataResult<PomodoroPreset> {
  const limits = POMODORO_LIMITS[field];
  const name = field === "workMinutes" ? "työajan" : "taukoajan";
  const shownValue = Number.isFinite(value) ? String(value) : "epäkelvon arvon";
  return {
    ok: false,
    error: invalidInput(
      `data.focus.pomodoro.validation.${field}`,
      `${name} on oltava kokonaisluku ${String(limits.min)}–${String(limits.max)} minuuttia (sait ${shownValue}).`,
    ),
  };
}

function isValidMinutes(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

/** Luo käyttäjän mukautetun presetin ilman piilotettua ajastinlogiikkaa. */
export function createCustomPomodoroPreset(input: CustomPomodoroInput): DataResult<PomodoroPreset> {
  if (
    !isValidMinutes(
      input.workMinutes,
      POMODORO_LIMITS.workMinutes.min,
      POMODORO_LIMITS.workMinutes.max,
    )
  ) {
    return invalidDuration("workMinutes", input.workMinutes);
  }
  if (
    !isValidMinutes(
      input.breakMinutes,
      POMODORO_LIMITS.breakMinutes.min,
      POMODORO_LIMITS.breakMinutes.max,
    )
  ) {
    return invalidDuration("breakMinutes", input.breakMinutes);
  }
  return {
    ok: true,
    value: {
      id: "custom",
      label: "Mukautettu",
      workSeconds: input.workMinutes * 60,
      breakSeconds: input.breakMinutes * 60,
    },
  };
}
