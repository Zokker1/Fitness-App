// T049: korttiperheiden E2E-luotain (näyteikkuna). Renderöityy vain kun
// URL:ssa ?e2e=1 (tuotannossa piilossa, sama malli kuin ButtonProbe).
// Näyttää 4 perhettä + Status-sävyt + tyhjän login jotta E2E todistaa
// rakenteen + kuvakaappaukset visuaaliseen hyväksyntään. Ei domain-dataa,
// ei verkkoa, ei PII:tä (synteettiset arvot).
import { ActionCard, Button, LogCard, MetricCard, QuietCard, StatusCard } from "@lifeos/ui";

export function CardProbe(): React.JSX.Element {
  return (
    <section data-testid="card-probe" aria-label="Korttiperheet (E2E)">
      <h2>Korttiperheet</h2>
      <ActionCard heading="Mitä seuraavaksi" value="Osta maitoa" valueLabel="yksi avoin tehtävä">
        <p>
          <Button variant="secondary">Avaa tehtävät</Button>
        </p>
      </ActionCard>
      <MetricCard
        heading="Viikon fokus"
        valueLabel="125 fokusminuuttia tällä viikolla"
        value="125 min"
        progress={62}
        changeText="12 minuuttia enemmän kuin viime viikolla"
        tone="success"
      />
      <LogCard
        heading="Päivän virta"
        emptyText="Ei merkintöjä vielä"
        rows={[
          { title: "Aamulenkki", meta: "Terveys, kello 7.30", value: "30 min" },
          { title: "Lounas", meta: "Ravinto, kello 11.45", value: "650 kcal" },
        ]}
      />
      <LogCard
        heading="Tyhjä virta"
        emptyText="Ei merkintöjä vielä — suunniteltu tyhjä tila"
        rows={[]}
      />
      <QuietCard heading="Huomio">
        <p>Tämä on hiljainen täydennys ilman reunaa tai varjoa.</p>
      </QuietCard>
      <StatusCard heading="Synkronoitu" tone="success">
        <p>Kaikki muutokset ovat laitteella tallessa.</p>
      </StatusCard>
      <StatusCard heading="Tarkista mittaus" tone="warning">
        <p>Arvo poikkeaa tavallisesta. Tarkista mittaus ennen kuin jatkat.</p>
      </StatusCard>
    </section>
  );
}
