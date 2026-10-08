// T053: chart-framen E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin ProgressProbe).
// Näyttää datallisen framen (range + tekstivastine) + tyhjän + lataavan +
// StatChipin niin että E2E todistaa rakenteen + kuvakaappaukset
// visuaaliseen hyväksyntään. Ei domain-dataa, ei verkkoa, ei PII:tä
// (synteettiset arvot; renderer-slotissa kevyt placeholder-palkisto).
import { useState } from "react";
import { ChartFrame, StatChip } from "@lifeos/ui";

const RANGES = [
  { value: "7d", label: "7 pv" },
  { value: "30d", label: "30 pv" },
] as const;

const POINTS = [
  { x: "10.9.", y: 20 },
  { x: "11.9.", y: 35 },
  { x: "12.9.", y: 30 },
  { x: "13.9.", y: 45 },
  { x: "14.9.", y: 40 },
  { x: "15.9.", y: 55 },
  { x: "16.9.", y: 50 },
] as const;

export function ChartProbe(): React.JSX.Element {
  const [range, setRange] = useState<string>("7d");
  return (
    <section data-testid="chart-probe" aria-label="Chart frame (E2E)">
      <h2>Graafikehys</h2>
      <StatChip
        value="125 min"
        valueLabel="125 fokusminuuttia"
        label="Viikon fokus"
        trendText="12 minuuttia enemmän kuin viime viikolla"
      />
      <ChartFrame
        title="Viikon fokus"
        unit="min"
        ranges={RANGES}
        range={range}
        onRangeChange={setRange}
        points={POINTS}
        summary="Nouseva: 30 minuuttia enemmän kuin jakson alussa."
        emptyText="Ei mittauksia vielä"
      >
        <div data-ui="chart-canvas" aria-hidden="true">
          {POINTS.map((point) => (
            <div
              key={point.x}
              data-ui="chart-demo-bar"
              style={{ blockSize: `${String(point.y * 2)}px` }}
            />
          ))}
        </div>
      </ChartFrame>
      <ChartFrame
        title="Tyhjä graafi"
        unit="kg"
        ranges={RANGES}
        range={range}
        onRangeChange={setRange}
        points={[]}
        emptyText="Ei mittauksia vielä"
        summary="Kun kirjaat ensimmäisen mittauksen, graafi piirtyy tähän."
      />
      <ChartFrame
        title="Lataava graafi"
        unit="min"
        ranges={RANGES}
        range={range}
        onRangeChange={setRange}
        loading
        emptyText="Ei mittauksia vielä"
      />
    </section>
  );
}
