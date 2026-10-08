// T166: fokusvaiheen valinnaiset äänipalautteet. Web Audio alustetaan vasta
// käyttäjän käynnistämän cue-kutsun yhteydessä; ilman selaintukea tämä on
// hallittu no-op eikä estä fokuslogiikkaa.

export type FocusCue = "start" | "pause" | "resume" | "complete" | "finish" | "cancel";

interface AudioWindow extends Window {
  readonly AudioContext?: typeof AudioContext;
  readonly webkitAudioContext?: typeof AudioContext;
}

let audioContext: AudioContext | null = null;

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const audioWindow = window as AudioWindow;
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

export function isFocusAudioSupported(): boolean {
  return audioContextConstructor() !== null;
}

function frequencyFor(cue: FocusCue): number {
  if (cue === "complete") {
    return 880;
  }
  if (cue === "finish" || cue === "resume") {
    return 660;
  }
  if (cue === "cancel") {
    return 220;
  }
  return cue === "pause" ? 330 : 520;
}

function durationFor(cue: FocusCue): number {
  return cue === "complete" ? 0.22 : 0.12;
}

/** Toistaa lyhyen, ei-puheenomaisen vaihesignaalin best-effort-periaatteella. */
export function playFocusCue(cue: FocusCue): void {
  const Constructor = audioContextConstructor();
  if (Constructor === null) {
    return;
  }
  try {
    audioContext ??= new Constructor();
    const context = audioContext;
    const start = context.currentTime;
    const duration = durationFor(cue);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequencyFor(cue), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.055, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
    void context.resume().catch(() => undefined);
  } catch {
    // Selain voi estää audiokontekstin tai Web Audio voi puuttua osittain.
    // Palaute ei saa koskaan rikkoa fokuksen käyttöä.
  }
}
