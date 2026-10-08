// T049: korttiperheet briefin (T040 §4) mukaan — anti-harmaa-laatikko:
// perhe erottuu RAKENTEESTA, ei väristä (SKILL.md: ei identtisiä kortteja,
// ei samaa varjoa kaikkialla, ei gradienttikoristelua). Neljä perhettä:
// - ActionCard (Toiminta): 1 kpl / näkymä, solidaarinen Kuusi-pinta,
//   sankarinumero + toiminto. Korvaa card-hero-divin (T042) komponentilla.
// - MetricCard (Edistyminen): numero (tabular) + palkki/rengas + muutoslause.
//   ProgressBar on natiivi <progress> (a11y ilmaiseksi); muutos AINA sanallinen
//   lause (ei "A · B · C" -metajonoa, ei pelkkää väriä, §31).
// - LogCard (Loki): rivit (otsikko + meta + arvo), jakajat informaationa
//   (storage-facts-malli T042:sta, nyt yleisenä RowListinä).
// - QuietCard (Hiljainen): reunaton pinta, ei varjoa — toissijainen sisältö.
// Card (primitives.tsx) säilyy neutraalina kehyksenä (sovellus + EmptyState).
// Terveysneutraalius (periaate 4): trendi ≠ diagnoosi — MetricStatuksen sävyt
// ovat neutraaleja huomioita (info/warning), eivät hälytyksiä; epätavallinen
// arvo saa kehotteen tarkistaa mittaus, ei diagnoositekstiä.

import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { Body, Meta, MetricValue, SectionHeading } from "./typography.tsx";

interface ActionCardProps extends HTMLAttributes<HTMLElement> {
  readonly heading: ReactNode;
  readonly value: ReactNode;
  /** Saavutettava nimi arvolle (yksikkö/konteksti HeroNumberille). */
  readonly valueLabel: string;
  readonly children: ReactNode;
}

/** Toiminta-kortti: yksi solidaarinen sankari / näkymä (brief §4). */
export function ActionCard({ heading, value, valueLabel, children, ...rest }: ActionCardProps) {
  return (
    <section data-ui="card-action" {...rest}>
      <SectionHeading>{heading}</SectionHeading>
      <p data-ui="display-hero" role="img" aria-label={valueLabel}>
        {value}
      </p>
      <div data-ui="card-action-body">{children}</div>
    </section>
  );
}

export type MetricTone = "neutral" | "info" | "warning" | "success";

interface MetricCardProps extends HTMLAttributes<HTMLElement> {
  readonly heading: ReactNode;
  readonly value: ReactNode;
  /** Saavutettava nimi arvolle (yksikkö/konteksti MetricValuelle). */
  readonly valueLabel: string;
  /** Edistyminen 0–100 (rengas/palkki + tekstivastine). */
  readonly progress?: number | undefined;
  /** Muutos SANALLISENA lauseena (pakollinen jos trendi näytetään). */
  readonly changeText?: string | undefined;
  readonly tone?: MetricTone | undefined;
  readonly children?: ReactNode | undefined;
}

/** Edistyminen-kortti: numero + natiivi progress + sanallinen muutos. */
export function MetricCard({
  heading,
  value,
  valueLabel,
  progress,
  changeText,
  tone = "neutral",
  children,
  ...rest
}: MetricCardProps) {
  const clamped = progress === undefined ? undefined : Math.min(100, Math.max(0, progress));
  return (
    <section data-ui="card-metric" data-tone={tone} {...rest}>
      <SectionHeading>{heading}</SectionHeading>
      <p data-ui="card-metric-value">
        <MetricValue label={valueLabel}>{value}</MetricValue>
      </p>
      {clamped !== undefined ? (
        <progress data-ui="card-progress" value={clamped} max={100}>
          {clamped} prosenttia
        </progress>
      ) : null}
      {changeText !== undefined ? (
        <p data-ui="card-metric-change">
          <Icon
            name={tone === "warning" ? "alert" : tone === "success" ? "check" : "info"}
            inline
          />
          <span>{changeText}</span>
        </p>
      ) : null}
      {children !== undefined ? <div data-ui="card-metric-body">{children}</div> : null}
    </section>
  );
}

export interface LogRow {
  readonly title: string;
  readonly meta?: string | undefined;
  readonly value?: string | undefined;
}

interface LogCardProps extends HTMLAttributes<HTMLElement> {
  readonly heading: ReactNode;
  readonly rows: readonly LogRow[];
  /** Tyhjän listan suunniteltu teksti (§29: tyhjä data on suunniteltu tila). */
  readonly emptyText: string;
}

/** Loki-kortti: rivit jakajilla (storage-facts-malli yleisenä). */
export function LogCard({ heading, rows, emptyText, ...rest }: LogCardProps) {
  return (
    <section data-ui="card-log" {...rest}>
      <SectionHeading>{heading}</SectionHeading>
      {rows.length === 0 ? (
        <Meta>{emptyText}</Meta>
      ) : (
        <ul data-ui="card-log-list">
          {rows.map((row) => (
            <li key={row.title} data-ui="card-log-row">
              <div>
                <Body>
                  <strong>{row.title}</strong>
                </Body>
                {row.meta !== undefined ? <Meta>{row.meta}</Meta> : null}
              </div>
              {row.value !== undefined ? <span data-ui="card-log-value">{row.value}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface QuietCardProps extends HTMLAttributes<HTMLElement> {
  readonly heading?: ReactNode | undefined;
  readonly children: ReactNode;
}

/** Hiljainen kortti: reunaton, varjoton — toissijainen sisältö. */
export function QuietCard({ heading, children, ...rest }: QuietCardProps) {
  return (
    <section data-ui="card-quiet" {...rest}>
      {heading !== undefined ? <SectionHeading>{heading}</SectionHeading> : null}
      {children}
    </section>
  );
}

export type StatusTone = "info" | "success" | "warning" | "danger";

interface StatusCardProps extends HTMLAttributes<HTMLElement> {
  readonly tone: StatusTone;
  readonly heading: ReactNode;
  readonly children: ReactNode;
}

const STATUS_ICON = {
  info: "info",
  success: "check",
  warning: "alert",
  danger: "alert",
} as const;

/** Status-kortti: semanttinen kolmikko + ikoni + otsikko (ei pelkkä väri). */
export function StatusCard({ tone, heading, children, ...rest }: StatusCardProps) {
  return (
    <section data-ui="card-status" data-tone={tone} role="status" {...rest}>
      <div data-ui="card-status-head">
        <Icon name={STATUS_ICON[tone]} />
        <SectionHeading>{heading}</SectionHeading>
      </div>
      <div data-ui="card-status-body">{children}</div>
    </section>
  );
}
