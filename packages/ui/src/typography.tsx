// T045: typografiahierarkia briefin (T040 §3) mukaan. Yksi perhe (Hanken
// Grotesk, tokenit) kolmella roolilla — ei serif-displaytä, ei toista
// perhettä, ei ALL-CAPS-eyebrowta (SKILL.md):
// - Display: näkymäotsikot + sankarinumerot (700, tiivis kirjainväli).
//   Tasot: page (h1, näkymän otsikko, yksi per näkymä) / section (h2,
//   kortti-/osiotason otsikko) / hero (sankarinumero, ei otsikkotagi).
// - Body: leipäteksti (400–500, riviväli 1.55, mitta 68ch CSS:stä).
// - Meta: pieni täydentävä teksti (500, normaali kirjainkoko, virkekoko).
// Numerot mittareissa: tabular-nums samalla perheellä (ei monospacea).
// data-ui-koukut (display/page/section/hero/body/meta/metric-value) elävät
// styles.css:ssä; tämä antaa vain semantiikan + oletustyylin ilman
// luokkariippuvuutta. Polymorfiaa ei tarvita (B02: kiinteät tagit riittävät).

import type { ReactNode } from "react";

interface TextProps {
  readonly children: ReactNode;
  // T050: valinnainen id (dialogien aria-labelledby ym. label-sidonnat).
  readonly id?: string | undefined;
}

/** Näkymän pääotsikko (h1, yksi per näkymä). */
export function Display({ children, id }: TextProps): React.JSX.Element {
  return (
    <h1 data-ui="display-page" id={id}>
      {children}
    </h1>
  );
}

/** Osio-/korttitason otsikko (h2). */
export function SectionHeading({ children, id }: TextProps): React.JSX.Element {
  return (
    <h2 data-ui="display-section" id={id}>
      {children}
    </h2>
  );
}

interface HeroNumberProps {
  readonly children: ReactNode;
  /** Saavutettava nimi numerolle (yksikkö/konteksti, esim. "avointa tehtävää"). */
  readonly label: string;
}

/** Sankarinumero (Display-paino, tabular; rooli img+aria-label = yksi luettava). */
export function HeroNumber({ children, label }: HeroNumberProps): React.JSX.Element {
  return (
    <p data-ui="display-hero" role="img" aria-label={label}>
      {children}
    </p>
  );
}

/** Leipäteksti (riviväli + mitta CSS:stä). */
export function Body({ children }: TextProps): React.JSX.Element {
  return <p data-ui="body">{children}</p>;
}

/** Pieni täydentävä teksti (virkekoko, ei ALL-CAPS). */
export function Meta({ children }: TextProps): React.JSX.Element {
  return <p data-ui="meta">{children}</p>;
}

interface MetricValueProps {
  readonly children: ReactNode;
  /** Saavutettava nimi mittarille (yksikkö/konteksti). */
  readonly label: string;
}

/** Mittarinumero (tabular, ei monospacea; rooli img+aria-label). */
export function MetricValue({ children, label }: MetricValueProps): React.JSX.Element {
  return (
    <span data-ui="metric-value" role="img" aria-label={label}>
      {children}
    </span>
  );
}
