// T161: oletuspresetit ja custom-työ/tauko-asetusten rajat.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_POMODORO_PRESET,
  POMODORO_PRESETS,
  createCustomPomodoroPreset,
  getPomodoroPreset,
} from "../src/index.ts";

describe("Pomodoro-presets", () => {
  it("tarjoaa pienet oletuspresetit ja klassisen oletuksen", () => {
    expect(POMODORO_PRESETS.map((preset) => preset.id)).toEqual(["classic", "short", "deep"]);
    expect(DEFAULT_POMODORO_PRESET).toEqual({
      id: "classic",
      label: "Klassinen",
      workSeconds: 1500,
      breakSeconds: 300,
    });
    expect(getPomodoroPreset("deep")).toEqual({
      id: "deep",
      label: "Syvä fokus",
      workSeconds: 3000,
      breakSeconds: 600,
    });
  });

  it("muuntaa validin custom-presetin sekunneiksi", () => {
    const result = createCustomPomodoroPreset({ workMinutes: 40, breakMinutes: 8 });
    expect(result).toEqual({
      ok: true,
      value: {
        id: "custom",
        label: "Mukautettu",
        workSeconds: 2400,
        breakSeconds: 480,
      },
    });
  });

  it("hylkää desimaalit, nollan ja liian suuret ajat", () => {
    expect(createCustomPomodoroPreset({ workMinutes: 0, breakMinutes: 5 }).ok).toBe(false);
    expect(createCustomPomodoroPreset({ workMinutes: 25, breakMinutes: 0 }).ok).toBe(false);
    expect(createCustomPomodoroPreset({ workMinutes: 25.5, breakMinutes: 5 }).ok).toBe(false);
    expect(createCustomPomodoroPreset({ workMinutes: 121, breakMinutes: 5 }).ok).toBe(false);
    expect(createCustomPomodoroPreset({ workMinutes: 25, breakMinutes: 61 }).ok).toBe(false);
  });

  it("palauttaa koneellisen virhekoodin väärästä kentästä", () => {
    const result = createCustomPomodoroPreset({ workMinutes: 25, breakMinutes: 61 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnosticCode).toBe("data.focus.pomodoro.validation.breakMinutes");
    }
  });
});
