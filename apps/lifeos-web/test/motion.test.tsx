// T054: motion systemin unit-testit (happy-dom).
// - Puhas ydin: preset-rekisteri suljettu + merkitykset täydelliset,
//   isMotionPreset-kaidatin rajat, motionPresetFor reduced → fade-in.
// - useReducedMotion: palauttaa booleanin ilman selainta (false = liike
//   sallitaan) eikä kaadu; ympäristöluku injektoimaton kuten hapticsissa,
//   joten selainta simuloidaan stubilla readSystemReducedMotionin kautta.
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  REDUCED_MOTION_QUERY,
  isMotionPreset,
  motionPresetFor,
  motionPresetStates,
  motionPresets,
  readSystemReducedMotion,
  useReducedMotion,
} from "@lifeos/ui";

describe("motion core", () => {
  it("presettilista on suljettu ja jokaisella on merkitys (§30)", () => {
    expect(motionPresets).toEqual(["rise-in", "fade-in", "pop", "slide-up"]);
    expect(Object.keys(motionPresetStates).sort()).toEqual([...motionPresets].sort());
    for (const state of Object.values(motionPresetStates)) {
      expect(state.length).toBeGreaterThan(0);
    }
  });

  it("isMotionPreset hyväksyy vain rekisterin arvot", () => {
    for (const preset of motionPresets) {
      expect(isMotionPreset(preset)).toBe(true);
    }
    expect(isMotionPreset("spin")).toBe(false);
    expect(isMotionPreset(42)).toBe(false);
    expect(isMotionPreset(undefined)).toBe(false);
  });

  it("motionPresetFor: täysi liike palauttaa presetin, hillitty fade-inin", () => {
    expect(motionPresetFor("pop", false)).toBe("pop");
    expect(motionPresetFor("slide-up", false)).toBe("slide-up");
    expect(motionPresetFor("pop", true)).toBe("fade-in");
    expect(motionPresetFor("rise-in", true)).toBe("fade-in");
  });

  it("REDUCED_MOTION_QUERY on kanoninen matchMedia-ehto", () => {
    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
  });
});

describe("useReducedMotion", () => {
  it("palauttaa booleanin ilman selainta (false = liike sallitaan)", () => {
    const { result } = renderHook(() => useReducedMotion());
    expect(typeof result.current).toBe("boolean");
    expect(result.current).toBe(false);
    act(() => {});
    expect(result.current).toBe(false);
  });

  it("readSystemReducedMotion: false ilman matchMediaa", () => {
    expect(readSystemReducedMotion()).toBe(false);
  });
});
