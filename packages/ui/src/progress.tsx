// T052: progress-komponentit (brief §4 Edistyminen-perhe + §9/§51 reiluus,
// §57.14 palkinto-ei-rangaistus).
// - ProgressBar: lineaarinen edistyminen. Natiivi <progress> (a11y ilmaiseksi:
//   role=progressbar + arvo + tekstivastine), koko sm/md, accent-täyttö,
//   bg-ura (sama kuin MetricCardin palkki — yhtenäinen ilme).
// - ProgressRing: rengas samaan arvoon. SVG circle + stroke-dasharray
//   (ei conic-gradientia: toimii ilman mask-tukea); role=img + aria-label
//   (yksi luettava, HeroNumber-malli); keskellä slottisisältö (vakiona
//   prosentti tabular-numeroina). Koko vakio 3.5rem (ei layout-hyppyä),
//   viivanleveys skaalautuu.
// - StreakDots: jatkuvuus 7/14 päivän pisteinä (momentum §9: liukuva
//   suoritusaste; yksi huono päivä ei nollaa kaikkea). Pisteet ovat LISTA
//   (ul/li, ruudunlukija kuulee "4/7 päivää"), tila muodolla + sanalla —
//   ei pelkällä värillä (§31), ei häpeäkieltä (§51, §57.14): tyhjä päivä on
//   "tuleva/ei vaadittu", ei "epäonnistunut". Tulevia päiviä ei merkitä
//   tehdyiksi (§50: näkymä ei rastita tulevaisuutta).
// - GoalProgress: tavoitteen kooste (rengas + luvut + sanallinen tila).
//   Terveysneutraali (periaate 4, §52): trendi ≠ diagnoosi; muutos aina
//   sanallinen lause (MetricCard-malli, ei värikoodia yksin). Katkennut
//   putki ei nollaa visuaalista motivaatiota (§57.14): tila on jatkumo
//   ("3/5 tällä viikolla — jatkuu"), ei rankaisuprosentti.
// Ei domain-laskentaa tässä — kutsuja antaa arvot (laskenta B03+:ssa).
// Ei uusia värejä: accent + semanttiset kolmikot + border (mitatut, AA).

import type { ReactNode } from "react";

function clampPercent(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(value)));
}

export interface ProgressBarProps {
  /** Edistyminen 0–100 (clampataan, pyöristetään). */
  readonly value: number;
  /** Saavutettava nimi (konteksti, esim. "Viikon fokus 62 prosenttia"). */
  readonly label: string;
  readonly size?: "sm" | "md" | undefined;
  /**
   * Koriste isomman kokonaisuuden sisällä (GoalProgress): piilottaa tämän
   * apuvälineteknologialta — ulkokääre ilmoittaa arvon kerran.
   */
  readonly decorative?: boolean | undefined;
}

/** Lineaarinen edistymispalkki (natiivi progress, tekstivastine mukana). */
export function ProgressBar({
  value,
  label,
  size = "md",
  decorative = false,
}: ProgressBarProps): React.JSX.Element {
  const clamped = clampPercent(value);
  return (
    <progress
      data-ui="progress-bar"
      data-size={size}
      value={clamped}
      max={100}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      {`${String(clamped)} prosenttia`}
    </progress>
  );
}

const RING_SIZE = 56;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface ProgressRingProps {
  /** Edistyminen 0–100 (clampataan, pyöristetään). */
  readonly value: number;
  /** Saavutettava nimi (konteksti, esim. "Tavoite 3/5 päivää"). */
  readonly label: string;
  /** Keskisisältö; vakiona prosentti tabular-numeroina. */
  readonly children?: ReactNode | undefined;
  /**
   * Koriste isomman kokonaisuuden sisällä (GoalProgress): piilottaa tämän
   * apuvälineteknologialta — ulkokääre ilmoittaa arvon kerran.
   */
  readonly decorative?: boolean | undefined;
}

/** Rengas samaan arvoon (SVG, keskellä prosentti tai kutsujan sisältö). */
export function ProgressRing({
  value,
  label,
  children,
  decorative = false,
}: ProgressRingProps): React.JSX.Element {
  const clamped = clampPercent(value);
  const filled = (RING_CIRCUMFERENCE * clamped) / 100;
  const half = RING_SIZE / 2;
  return (
    <div
      data-ui="progress-ring"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
    >
      <svg
        data-ui="progress-ring-svg"
        viewBox={`0 0 ${String(RING_SIZE)} ${String(RING_SIZE)}`}
        aria-hidden="true"
        focusable="false"
      >
        <circle data-ui="progress-ring-track" cx={half} cy={half} r={RING_RADIUS} />
        {filled > 0 ? (
          <circle
            data-ui="progress-ring-fill"
            cx={half}
            cy={half}
            r={RING_RADIUS}
            strokeDasharray={`${String(filled)} ${String(RING_CIRCUMFERENCE)}`}
            transform={`rotate(-90 ${String(half)} ${String(half)})`}
          />
        ) : null}
      </svg>
      <span data-ui="progress-ring-center">
        {children ?? (
          <span data-ui="metric-value" aria-hidden="true">{`${String(clamped)} %`}</span>
        )}
      </span>
    </div>
  );
}

export type StreakDayState = "done" | "partial" | "open";

export interface StreakDotsProps {
  /** Päivätilat järjestyksessä (7 tai 14; §9 liukuva ikkuna). */
  readonly days: readonly StreakDayState[];
  /** Saavutettava yhteenveto (esim. "4/7 päivää tehty"). */
  readonly label: string;
}

const STREAK_LABEL: Record<StreakDayState, string> = {
  done: "tehty",
  partial: "osittain",
  open: "tuleva",
};

/** Jatkuvuuspisteet listana (tila muodolla, ei värillä yksin). */
export function StreakDots({ days, label }: StreakDotsProps): React.JSX.Element {
  return (
    <ul data-ui="streak-dots" aria-label={label}>
      {days.map((state, index) => (
        <li key={index} data-ui="streak-dot" data-state={state} title={STREAK_LABEL[state]}>
          <span data-ui="streak-dot-sr">{STREAK_LABEL[state]}</span>
        </li>
      ))}
    </ul>
  );
}

export interface GoalProgressProps {
  /** Edistyminen 0–100 (rengas + palkki jakavat saman arvon). */
  readonly value: number;
  /** Saavutettava nimi (konteksti, esim. "Vesi 5/7 päivää"). */
  readonly label: string;
  /** Nykyinen luku (esim. "5/7 päivää"). */
  readonly current: ReactNode;
  /** Tavoiteluku (esim. "tavoite 7 päivää"). */
  readonly target: ReactNode;
  /** Sanallinen tila (jatkumo, ei rankaisu — esim. "Jatkuu — 2 päivää jäljellä"). */
  readonly statusText: string;
}

/** Tavoitteen kooste: rengas + luvut + sanallinen jatkumotila. */
export function GoalProgress({
  value,
  label,
  current,
  target,
  statusText,
}: GoalProgressProps): React.JSX.Element {
  // Yksi luettava kokonaisuus: ulkokääre on img+label (rengas + palkki
  // jakavat saman nimen mutta ovat aria-hidden — ei kaksoisilmoitusta).
  // Numerot ovat visuaalisia (tabular); tila on sanallinen jatkumo.
  return (
    <div data-ui="goal-progress" role="img" aria-label={label}>
      <ProgressRing value={value} label={label} decorative />
      <div data-ui="goal-progress-body">
        <p data-ui="goal-progress-numbers">
          <span data-ui="metric-value" aria-hidden="true">
            {current}
          </span>
          <span data-ui="goal-progress-target">{target}</span>
        </p>
        <ProgressBar value={value} label={label} size="sm" decorative />
        <p data-ui="goal-progress-status">{statusText}</p>
      </div>
    </div>
  );
}

export interface LevelProgressProps {
  /** Nykyinen taso (näkyy renkaan keskellä sankarinumerona). */
  readonly level: number;
  /** Etenemä tason sisällä 0–100 (rengas + palkki). */
  readonly value: number;
  /** Saavutettava yhteenveto (esim. "Taso 3, 150 / 300 XP, 150 XP seuraavaan tasoon"). */
  readonly label: string;
  /** Nykyinen luku (esim. "150 / 300 XP"). */
  readonly current: ReactNode;
  /** Seuraava raja (esim. "Taso 4 alkaa 600 XP:stä."). */
  readonly target: ReactNode;
  /** Sanallinen jatkumo (esim. "150 XP seuraavaan tasoon."). */
  readonly statusText: string;
}

/**
 * Tason etenemä (T183): rengas keskellä tasonumero + "taso"-alaotsikko,
 * rungot samalla rakenteella kuin GoalProgress (Edistyminen-perhe).
 * §51: tila on neutraali jatkumo, ei rankaisu.
 */
export function LevelProgress({
  level,
  value,
  label,
  current,
  target,
  statusText,
}: LevelProgressProps): React.JSX.Element {
  return (
    <div data-ui="level-progress" role="img" aria-label={label}>
      <ProgressRing value={value} label={label} decorative>
        <span data-ui="level-progress-badge">
          <span data-ui="level-progress-level" aria-hidden="true">
            {String(level)}
          </span>
          <span data-ui="level-progress-caption" aria-hidden="true">
            taso
          </span>
        </span>
      </ProgressRing>
      <div data-ui="level-progress-body">
        <p data-ui="level-progress-numbers">
          <span data-ui="metric-value" aria-hidden="true">
            {current}
          </span>
          <span data-ui="level-progress-target">{target}</span>
        </p>
        <ProgressBar value={value} label={label} size="sm" decorative />
        <p data-ui="level-progress-status">{statusText}</p>
      </div>
    </div>
  );
}
