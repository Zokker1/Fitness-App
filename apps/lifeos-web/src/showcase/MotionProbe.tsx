// T054: motion systemin E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin ChartProbe).
// Näyttää kaikki presetit kertaluontoisina sisääntuloina + OS:n
// reduced-motion-tilan sanallisesti (ei pelkkä väri, §31) + Toista-napin
// joka remounttaa demot (liike vastaa käyttäjän tekoa, §30). Ei domain-
// dataa, ei verkkoa, ei PII:tä.
import { useState } from "react";
import { motionPresetStates, useReducedMotion, type MotionPreset } from "@lifeos/ui";

const PRESETS: readonly MotionPreset[] = ["rise-in", "fade-in", "pop", "slide-up"];

const PRESET_LABEL: Record<MotionPreset, string> = {
  "rise-in": "Sisältö saapuu (rise-in)",
  "fade-in": "Hiljainen ilmestyminen (fade-in)",
  pop: "Valmis (pop)",
  "slide-up": "Pinta saapuu (slide-up)",
};

export function MotionProbe(): React.JSX.Element {
  const [run, setRun] = useState(0);
  const reduced = useReducedMotion();
  return (
    <section data-testid="motion-probe" aria-label="Motion system (E2E)">
      <h2>Liike</h2>
      <p data-ui="meta">
        Jokainen liike kertoo tilan (§30); hillityssä liikkeessä kaikki täyttyvät
        opacity-only-vastineeseensa.
      </p>
      <p data-ui="meta" data-testid="motion-mode">
        Järjestelmän liike-asetus: {reduced ? "hillitty (opacity-only)" : "täysi"}
      </p>
      <button
        type="button"
        onClick={() => {
          setRun((value) => value + 1);
        }}
      >
        Toista liikkeet
      </button>
      {/* run avaimena: remount toistaa kertaluontoiset sisääntulot. */}
      <div key={run} data-testid="motion-demos">
        {PRESETS.map((preset) => (
          <div key={preset} data-motion={preset} data-testid={`motion-${preset}`}>
            <div data-ui="motion-demo">
              <strong>{PRESET_LABEL[preset]}</strong>
              <p data-ui="meta">{motionPresetStates[preset]}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
