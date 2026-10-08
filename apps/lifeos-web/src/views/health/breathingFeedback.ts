// T256: valinnaiset hengitysvaiheen äänimerkit, oletuksena pois.
import type { BreathingPhaseKind } from "@lifeos/domain";

let audioContext: AudioContext | null = null;

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const audioWindow = window as unknown as Record<string, unknown>;
  const candidate = audioWindow["AudioContext"] ?? audioWindow["webkitAudioContext"];
  return typeof candidate === "function" ? (candidate as typeof AudioContext) : null;
}

export function isBreathingAudioSupported(): boolean {
  return audioContextConstructor() !== null;
}

function frequencyForPhase(kind: BreathingPhaseKind): number {
  if (kind === "inhale") return 523;
  if (kind === "hold") return 440;
  if (kind === "exhale") return 349;
  return 294;
}

/** Toistaa hiljaisen vaihemerkin best-effort-periaatteella. */
export function playBreathingCue(kind: BreathingPhaseKind): void {
  const Constructor = audioContextConstructor();
  if (Constructor === null) return;
  try {
    audioContext ??= new Constructor();
    const context = audioContext;
    const start = context.currentTime;
    const duration = 0.1;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequencyForPhase(kind), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.035, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    void context.resume().catch(() => undefined);
  } catch {
    // Selaimen äänituki on valinnainen, eikä virhe saa keskeyttää harjoitusta.
  }
}
