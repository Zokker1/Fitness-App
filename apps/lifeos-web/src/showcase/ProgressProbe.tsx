// T052: progress-komponenttien E2E-luotain (näyteikkuna). Renderöityy vain
// kun URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin StateProbe).
// Näyttää ProgressBar-koot + ProgressRing-arvot + StreakDots-tilat +
// GoalProgress-koosteen niin että E2E todistaa rakenteen + kuvakaappaukset
// visuaaliseen hyväksyntään. Ei domain-dataa, ei verkkoa, ei PII:tä
// (synteettiset arvot).
import { GoalProgress, ProgressBar, ProgressRing, StreakDots } from "@lifeos/ui";

export function ProgressProbe(): React.JSX.Element {
  return (
    <section data-testid="progress-probe" aria-label="Progress-komponentit (E2E)">
      <h2>Edistyminen</h2>
      <ProgressBar value={62} label="Viikon fokus 62 prosenttia" />
      <ProgressBar value={25} label="Päivän vesi 25 prosenttia" size="sm" />
      <ProgressRing value={62} label="Viikon fokus 62 prosenttia" />
      <StreakDots
        days={["done", "done", "partial", "done", "open", "open", "open"]}
        label="4/7 päivää tehty"
      />
      <GoalProgress
        value={71}
        label="Vesi 5/7 päivää"
        current="5/7 päivää"
        target="tavoite 7 päivää"
        statusText="Jatkuu — 2 päivää jäljellä"
      />
    </section>
  );
}
