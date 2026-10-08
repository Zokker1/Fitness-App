// T053: chart frame -perusta (brief §4 + §29 graafit + §31 saavutettavuus).
// EI chart-kirjastoa (§29: ei vaarallista HTML-injektiota, ei epäselvää
// dependency-ketjua; §54-repo: ei omaa chart-rendereriä jos ylläpidetty
// saavutettava ratkaisu täyttää vaatimukset — joten EI rendereriä tässä,
// vaan saavutettava KEHYS jonka sisään rendererit kytketään B03+:ssa).
// - ChartFrame: otsikko (SectionHeading h2) + yksikkö + aikaväli + range-
//   control (SegmentedControl radioryhmä, 2–5 vaihtoehtoa) + tekstivastine
//   (<details> taulukkona: trendi ja raakadata erotettavissa, ruudunlukija
//   + touch-tarkastelu ilman hoveria) + empty-tila (EmptyState, tyhjä data
//   on suunniteltu tila §29). Lataus = Skeleton, virhe = Alert — ei omia
//   tilapintoja (T051-perhe uudelleenkäyttöön).
// - StatChip: yksittäinen tunnusluku (arvo tabular + sanallinen label, ei
//   pelkkä väri; trendi aina sanallinen lause, trendi ≠ diagnoosi §52).
// - Ei katkaistuja akseleita ilman perustetta: baseline on nolla ellei
//   kutsuja anna min/max-perustetta (baselineNote); huomautus näytetään.
// Terveysneutraalius (periaate 4, §52): ei diagnoosivärejä, ei hälytyskieltä;
// arvo + yksikkö + neutraali sanallinen yhteenveto.

import type { ReactNode } from "react";
import { SegmentedControl } from "./segmented.tsx";
import { EmptyState, Skeleton } from "./states.tsx";
import { MetricValue, SectionHeading } from "./typography.tsx";

export interface ChartRangeOption {
  readonly value: string;
  readonly label: string;
}

export interface ChartSeriesPoint {
  /** X-akselin label (esim. päivämäärä "12.9."). */
  readonly x: string;
  /** Y-arvo numerona (yksikkö tulee framesta). */
  readonly y: number;
}

export interface ChartFrameSeries {
  /** Sarjan nimi tekstivastineessa (esim. "Systolinen"). */
  readonly label: string;
  readonly points: readonly ChartSeriesPoint[];
}

export interface ChartFrameProps {
  /** Graafin otsikko (h2, pakollinen §29). */
  readonly title: string;
  /** Näkyvä otsikko, jos se sisältää esimerkiksi sovelluksen kuvakkeen. */
  readonly heading?: ReactNode | undefined;
  /** Yksikkö (esim. "min", "kg" — näytetään otsikon yhteydessä + vastineessa). */
  readonly unit: string;
  /** Aikavälivaihtoehdot (2–5; SegmentedControl-raja). */
  readonly ranges: readonly ChartRangeOption[];
  /** Valittu aikaväli (value). */
  readonly range: string;
  readonly onRangeChange: (value: string) => void;
  /** Raakadata (pisteet) tekstivastinetta varten. */
  readonly points?: readonly ChartSeriesPoint[] | undefined;
  /** Usean sarjan raakadata tekstivastinetta varten. Ohittaa points-propin. */
  readonly series?: readonly ChartFrameSeries[] | undefined;
  /** Piilota aikavälivalinta, kun useampi kehys jakaa saman ulkoisen valinnan. */
  readonly showRangeControl?: boolean | undefined;
  /** Sanallinen yhteenveto (trendi lauseena, esim. "Nouseva: +12 min viime viikosta"). */
  readonly summary?: string | undefined;
  /** Tyhjän datan suunniteltu teksti (§29). */
  readonly emptyText: string;
  /** Lataustila (Skeleton, ei omaa pintaa). */
  readonly loading?: boolean | undefined;
  /**
   * Akselin min/max-peruste. Baseline on nolla; jos renderer katkaisee
   * akselin, peruste näytetään tässä (ei harhaanjohtavaa katkaisua §29).
   */
  readonly baselineNote?: string | undefined;
  /** Rendererin piirtoalue (B03+: datavisualisointi; tässä kehys + vastine). */
  readonly children?: ReactNode | undefined;
}

/** Graafikehys: otsikko + yksikkö + range + renderer-slotti + tekstivastine. */
export function ChartFrame({
  title,
  heading,
  unit,
  ranges,
  range,
  onRangeChange,
  points = [],
  series,
  showRangeControl = true,
  summary,
  emptyText,
  loading = false,
  baselineNote,
  children,
}: ChartFrameProps): React.JSX.Element {
  const summaryId = `lifeos-chart-summary-${title}`;
  const tableSeries = series ?? [{ label: "Arvo", points }];
  const xValues = [...new Set(tableSeries.flatMap((item) => item.points.map((point) => point.x)))];
  const seriesValueMaps = tableSeries.map(
    (item) => new Map(item.points.map((point) => [point.x, point.y])),
  );
  return (
    <section data-ui="chart-frame" aria-labelledby={summaryId}>
      <SectionHeading id={summaryId}>{heading ?? title}</SectionHeading>
      <p data-ui="chart-unit">Yksikkö: {unit}</p>
      {showRangeControl ? (
        <SegmentedControl
          label="Aikaväli"
          options={ranges}
          value={range}
          onOptionChange={onRangeChange}
        />
      ) : null}
      {loading ? (
        <Skeleton lines={3} />
      ) : xValues.length === 0 ? (
        <EmptyState title={emptyText} hint={summary} />
      ) : (
        <>
          {children !== undefined ? <div data-ui="chart-canvas">{children}</div> : null}
          {baselineNote !== undefined ? <p data-ui="chart-baseline">{baselineNote}</p> : null}
          <details data-ui="chart-summary">
            <summary>Tekstivastine taulukkona</summary>
            {summary !== undefined ? <p>{summary}</p> : null}
            <table>
              <caption>
                {title} ({unit})
              </caption>
              <thead>
                <tr>
                  <th scope="col">Ajankohta</th>
                  {tableSeries.map((item) => (
                    <th key={item.label} scope="col">
                      {item.label} ({unit})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {xValues.map((x) => (
                  <tr key={x}>
                    <th scope="row">{x}</th>
                    {tableSeries.map((item, index) => {
                      const value = seriesValueMaps[index]?.get(x);
                      return <td key={item.label}>{value === undefined ? "—" : value}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

export interface StatChipProps {
  /** Tunnusluvun arvo (tabular-numero). */
  readonly value: ReactNode;
  /** Saavutettava nimi (yksikkö/konteksti). */
  readonly valueLabel: string;
  /** Sanallinen label (esim. "Viikon fokus"). */
  readonly label: string;
  /** Valinnainen sanallinen trendi (aina lause, ei pelkkä väri/nuoli). */
  readonly trendText?: string | undefined;
}

/** Tunnuslukusiru: arvo + label + valinnainen sanallinen trendi. */
export function StatChip({
  value,
  valueLabel,
  label,
  trendText,
}: StatChipProps): React.JSX.Element {
  return (
    <div data-ui="stat-chip">
      <MetricValue label={valueLabel}>{value}</MetricValue>
      <span data-ui="stat-chip-label">{label}</span>
      {trendText !== undefined ? <span data-ui="stat-chip-trend">{trendText}</span> : null}
    </div>
  );
}
