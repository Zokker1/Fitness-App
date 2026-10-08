// T058: typografia- ja ikoniosion näyteikkuna (kehitysnäkymä, vain ?e2e=1).
// Design systemin perusta yhdessä näkymässä (T058-kriteeri):
// - Typografian roolit (brief §3): Display (h1, näkymäotsikot),
//   SectionHeading (h2, osiot), HeroNumber (sankarinumero, tabular),
//   MetricValue (mittarinumero, tabular), Body (leipäteksti), Meta (pieni).
// - Koko ikoniperhe (Lucide, paikalliset SVG-maskit) labelilla — iconKeys aakkosissa
//   (ei hiljaista puutetta). Ei domain-dataa, ei PII:tä.
import {
  Body,
  Display,
  HeroNumber,
  Icon,
  Meta,
  MetricValue,
  SectionHeading,
  iconKeys,
} from "@lifeos/ui";

export function TypographyProbe(): React.JSX.Element {
  return (
    <section data-testid="typography-probe" aria-label="Typografia ja ikonit (E2E)">
      <h2>Typografia</h2>
      <Display>Tänään</Display>
      <SectionHeading>Osion otsikko</SectionHeading>
      <HeroNumber label="12 480 askeleen tänään">12 480</HeroNumber>
      <p data-ui="metric-inline">
        <MetricValue label="125 fokusminuuttia">125 min</MetricValue>
      </p>
      <Body>
        Leipäteksti rivivälillä 1.55 ja mitalla 68 merkkiä. Pituus pysyy luettavana molemmilla
        leveyksillä.
      </Body>
      <Meta>Pieni täydentävä teksti virkekoossa.</Meta>
      <h2>Ikonit</h2>
      <ul data-ui="icon-grid">
        {iconKeys.map((key) => (
          <li key={key} data-ui="icon-grid-item">
            <Icon name={key} />
            <span>{key}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
