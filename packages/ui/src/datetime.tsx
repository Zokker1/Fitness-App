// T048: päivä/aika-valinnat (§28: DatePicker, TimePicker).
// Natiivit <input type="date|time"> saman Field-kääreen sisällä (ei custom-
// kalenteria): mobiilin natiivivalitsin + täysi keyboard-tuki ilmaiseksi,
// kosketus toimii ilman JS-eletunnistusta (§27: virtual keyboard ei peitä
// kriittisiä kontrolleja — natiivi picker hoitaa). Arvo ISO-muodossa
// (YYYY-MM-DD / HH:MM, 24h); validointi/domain-muunnos kuuluu kutsujalle
// (B03+; UI ei tunne domain-skeemaa). color-scheme (tokens.css) tummuttaa
// myös natiivin kalenteri-indikaattorin dark-teemassa.

import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { FieldShell, describedIds } from "./fields.tsx";

export interface DateFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

/** Päivävalitsin (natiivi; ISO YYYY-MM-DD). */
export function DatePicker({
  id: idProp,
  label,
  hint,
  error,
  ...rest
}: DateFieldProps): React.JSX.Element {
  const fallbackId = useId();
  const id = idProp ?? `lifeos-date-${fallbackId}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="date"
        data-ui="input"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedIds(id, { hint, error })}
        {...rest}
      />
    </FieldShell>
  );
}

export interface TimeFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
}

/** Aikavalitsin (natiivi; 24h HH:MM). */
export function TimePicker({
  id: idProp,
  label,
  hint,
  error,
  ...rest
}: TimeFieldProps): React.JSX.Element {
  const fallbackId = useId();
  const id = idProp ?? `lifeos-time-${fallbackId}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="time"
        data-ui="input"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedIds(id, { hint, error })}
        {...rest}
      />
    </FieldShell>
  );
}
