// T051: ydintilat (§28: EmptyState, Skeleton, Alert, Toast; §58 DoD:
// jokaisella ominaisuudella on empty/error/loading-tila).
// Yhteinen laadukas toteutus kaikille ydintiloille:
// - EmptyState: suunniteltu tyhjä tila (§29) — ikoni + otsikko + vihje +
//   toiminto, keskitetty (brief §4: keskitys vain tyhjille tiloille).
//   Ilman ikonia sama rakenne kuin T028:ssa (taaksepäinyhteensopiva
//   placeholderien kanssa; primitives.tsx re-exportoi tämän).
// - Skeleton: latauspaikkamerkki (opacity-pulssi, ei layout-hyppyä;
//   reduced-motion sammuttaa pulssin globaalilla säännöllä). Viivat
//   aria-hidden, ruudunlukijalle "Ladataan…" (role=status).
// - Alert: kompakti inline-ilmoitus (info/success/warning/danger,
//   semanttinen kolmikko + ikoni + sanallinen otsikko, ei pelkkä väri
//   §31). Kevyempi kuin StatusCard (control-radius 10 vs. card 14, ei
//   h2:ta — otsikko on vahvennus, ei kilpaile kortin otsikon kanssa).
// - Toast (+ ToastViewport): ohimenevä palaute käyttäjän tekoon (§30:
//   palaute vain teon vastauksena). Kiinteä alareuna safe-arealla,
//   mobiilissa navin+FABin yläpuolella; tausta pysyy klikattavana
//   (pointer-events vain toastissa). danger → role=alert, muut status.
//   T054: sisääntulo slide-up (liike vastaa tekoa; reduced → fade-in).
// Terveysneutraalius (periaate 4): sävyt ovat neutraaleja huomioita.
// Sovelluksen AppError/ErrorCard-polku (T037) säilyy — Alert on jaettu
// inline-pinta, ei virhekäännös.

import { useEffect } from "react";
import type { ReactNode } from "react";
import { IconButton } from "./buttons.tsx";
import type { StatusTone } from "./cards.tsx";
import { Icon } from "./Icon.tsx";
import type { IconKey } from "./icons.ts";
import type { MotionPreset } from "./motion.ts";
import { Body, Meta } from "./typography.tsx";

export interface EmptyStateProps {
  readonly title: string;
  readonly hint?: string | undefined;
  readonly icon?: IconKey | undefined;
  readonly action?: ReactNode;
}

export function EmptyState({ title, hint, icon, action }: EmptyStateProps): React.JSX.Element {
  // Hierarkia Cardin sisällä: Card-heading on osion h2 (display-section);
  // tyhjän tilan otsikko on alempi (body-vahvennus), ei toinen h2 joka
  // kilpailisi kortin otsikon kanssa. Hint on Meta-ääni (virkekoko).
  return (
    <div data-ui="empty-state" role="status">
      {icon !== undefined ? (
        <div data-ui="empty-icon">
          <Icon name={icon} />
        </div>
      ) : null}
      <Body>
        <strong>{title}</strong>
      </Body>
      {hint !== undefined ? <Meta>{hint}</Meta> : null}
      {action === undefined || action === null ? null : <div data-ui="empty-action">{action}</div>}
    </div>
  );
}

const SKELETON_MIN_LINES = 1;
const SKELETON_MAX_LINES = 6;

export interface SkeletonProps {
  readonly lines?: number | undefined;
  readonly label?: string | undefined;
}

/** Latauspaikkamerkki: n riviä (1–6, oletus 3), ei layout-hyppyä. */
export function Skeleton({ lines = 3, label = "Ladataan…" }: SkeletonProps): React.JSX.Element {
  const clamped = Math.min(SKELETON_MAX_LINES, Math.max(SKELETON_MIN_LINES, Math.floor(lines)));
  return (
    <div data-ui="skeleton" role="status">
      <span data-ui="skeleton-sr">{label}</span>
      <div data-ui="skeleton-lines" aria-hidden="true">
        {Array.from({ length: clamped }, (_, index) => (
          <div key={index} data-ui="skeleton-line" />
        ))}
      </div>
    </div>
  );
}

const TONE_ICON: Record<StatusTone, IconKey> = {
  info: "info",
  success: "check",
  warning: "warning",
  danger: "alert",
};

export interface AlertProps {
  readonly tone: StatusTone;
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly action?: ReactNode;
  readonly onDismiss?: (() => void) | undefined;
  readonly dismissLabel?: string | undefined;
}

/** Inline-ilmoitus: ikoni + otsikko + teksti + valinnainen toiminto/sulku. */
export function Alert({
  tone,
  title,
  children,
  action,
  onDismiss,
  dismissLabel = "Sulje ilmoitus",
}: AlertProps): React.JSX.Element {
  const role = tone === "danger" ? "alert" : "status";
  return (
    <div data-ui="alert" data-tone={tone} role={role}>
      <span data-ui="alert-icon">
        <Icon name={TONE_ICON[tone]} />
      </span>
      <div data-ui="alert-body">
        {title === undefined || title === null ? null : <p data-ui="alert-title">{title}</p>}
        <div data-ui="alert-text">{children}</div>
        {action === undefined || action === null ? null : (
          <div data-ui="alert-action">{action}</div>
        )}
      </div>
      {onDismiss !== undefined ? (
        <IconButton icon="close" label={dismissLabel} onClick={onDismiss} />
      ) : null}
    </div>
  );
}

export interface ToastProps {
  readonly tone?: StatusTone | undefined;
  readonly title: string;
  readonly body?: string | undefined;
  readonly action?: ReactNode;
  readonly onDismiss?: (() => void) | undefined;
  /** Fired only for the user's close-button action, never for auto-dismiss. */
  readonly onManualDismiss?: (() => void) | undefined;
  readonly dismissLabel?: string | undefined;
  /** Sisääntulo; slide-up oletuksena, pop sopii yksittäiseen onnistumiseen. */
  readonly motion?: MotionPreset | undefined;
  /**
   * Automaattisulku ms:ssa. Oletus ei sulkeudu itsestään — ajastin kuuluu
   * kutsujalle ellei tätä anneta (§31: ajastin ei saa estää apuvälinekäyttöä;
   * sulkunappi on aina mukana kun onDismiss on annettu).
   */
  readonly duration?: number | undefined;
}

/** Ohimenevä palaute ToastViewportin sisään (kutsuja omistaa näkyvyyden). */
export function Toast({
  tone = "info",
  title,
  body,
  action,
  onDismiss,
  onManualDismiss,
  dismissLabel = "Sulje ilmoitus",
  motion = "slide-up",
  duration,
}: ToastProps): React.JSX.Element {
  useEffect(() => {
    if (duration === undefined || onDismiss === undefined) {
      return;
    }
    const timer = setTimeout(onDismiss, duration);
    return () => {
      clearTimeout(timer);
    };
  }, [duration, onDismiss]);
  const role = tone === "danger" ? "alert" : "status";
  return (
    <div data-ui="toast" data-tone={tone} data-motion={motion} role={role}>
      <span data-ui="toast-icon">
        <Icon name={TONE_ICON[tone]} />
      </span>
      <div data-ui="toast-body">
        <p data-ui="toast-title">
          <strong>{title}</strong>
        </p>
        {body !== undefined ? <p data-ui="toast-text">{body}</p> : null}
        {action === undefined || action === null ? null : (
          <div data-ui="toast-action">{action}</div>
        )}
      </div>
      {onDismiss !== undefined ? (
        <IconButton
          icon="close"
          label={dismissLabel}
          onClick={() => {
            onManualDismiss?.();
            onDismiss();
          }}
        />
      ) : null}
    </div>
  );
}

export function ToastViewport({ children }: { readonly children?: ReactNode }): React.JSX.Element {
  return <div data-ui="toast-viewport">{children}</div>;
}
