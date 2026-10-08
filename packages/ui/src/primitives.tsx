// T028: B01-primitiivit. Täysi §28-katalogi (40+ komponenttia) rakennetaan
// B02:ssa design-tokenien päälle; tässä vain se minimi jolla AppShell ja
// reittiplaceholderit toimivat saavutettavasti molemmilla leveyksillä:
// - Button: states/disabled/focus/touch-target (§28 vaatimuslista).
// - Card: neutraali sisältökehys (B02 eriyttää Metric/Task/Goal-kortit).
//   T045: heading renderöidään SectionHeading-typografialla (display-section).
// - EmptyState: T051 siirsi states.tsx:ään (ikoni + toiminto); re-export
//   säilyttää vanhat importit.
// Ei väri-/typografia-päätöksiä tässä — ne lukitaan T040–T043:ssa.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { SectionHeading } from "./typography.tsx";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly loading?: boolean;
}

export function Button({
  variant = "primary",
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  const isDisabled = disabled === true || loading;
  return (
    <button
      type={rest.type ?? "button"}
      data-variant={variant}
      data-loading={loading ? "true" : undefined}
      disabled={isDisabled}
      aria-busy={loading ? true : undefined}
      {...rest}
    >
      {loading ? "Ladataan…" : children}
    </button>
  );
}

interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly heading?: ReactNode;
  readonly children: ReactNode;
}

export function Card({ heading, children, ...rest }: CardProps): React.JSX.Element {
  return (
    <section data-ui="card" {...rest}>
      {heading !== undefined ? <SectionHeading>{heading}</SectionHeading> : null}
      {children}
    </section>
  );
}

export { EmptyState } from "./states.tsx";
export type { EmptyStateProps } from "./states.tsx";
