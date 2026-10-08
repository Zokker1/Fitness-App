// T047: lomakekenttien E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin ButtonProbe).
// Näyttää Input/NumberInput/Select/Combobox normaalina + virhetilassa jotta
// E2E todistaa label-sidonnan/touch-targetit/focuksen + kuvakaappaukset
// visuaaliseen hyväksyntään. Ei domain-dataa, ei verkkoa, ei PII:tä
// (synteettiset arvot).
// T048: + DatePicker/TimePicker/SegmentedControl (segmentti kontrolloituna
// paikallisella tilalla — probe on esittely, ei tuotantolomake).
import { useState } from "react";
import {
  Combobox,
  DatePicker,
  Input,
  NumberInput,
  SegmentedControl,
  Select,
  TimePicker,
} from "@lifeos/ui";

export function FormProbe(): React.JSX.Element {
  // Oletus vastaa vaihtoehtoa (ennen "normal" ei täsmännyt day/week/month
  // -arvoihin → mikään segmentti ei näkynyt valittuna kaappauksissa).
  const [period, setPeriod] = useState("week");
  return (
    <section data-testid="form-probe" aria-label="Lomakekentät (E2E)">
      <h2>Lomakekentät</h2>
      <Input label="Tehtävän nimi" hint="Lyhyt nimi riittää" placeholder="Esim. Osta maitoa" />
      {/* E2E-exact-syy: labeli ei saa olla toisen alimerkkijono ("Määrä" ⊂
          "Päivämäärä" rikkoi strict-moden) — siksi "Kappalemäärä". */}
      <NumberInput label="Kappalemäärä" hint="0–10" min={0} max={10} placeholder="0" />
      <Select
        label="Prioriteetti"
        placeholder="Valitse…"
        options={[
          { value: "low", label: "Matala" },
          { value: "normal", label: "Normaali" },
          { value: "high", label: "Korkea" },
        ]}
      />
      <Combobox label="Tagi" hint="Kirjoita tai valitse" suggestions={["koti", "työ", "terveys"]} />
      <DatePicker label="Päivämäärä" hint="ISO-muoto YYYY-MM-DD" />
      <TimePicker label="Kellonaika" hint="24h-muoto HH:MM" />
      <SegmentedControl
        label="Näkymä"
        hint="Valitse aikaväli"
        options={[
          { value: "day", label: "Päivä" },
          { value: "week", label: "Viikko" },
          { value: "month", label: "Kuukausi" },
        ]}
        value={period}
        onOptionChange={setPeriod}
      />
      <Input label="Sähköposti (virhe)" error="Sähköposti puuttuu" placeholder="nimi@example.fi" />
      <Select
        label="Tila (virhe)"
        error="Valitse tila"
        options={[{ value: "open", label: "Avoin" }]}
      />
    </section>
  );
}
