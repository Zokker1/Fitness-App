// T048: SegmentedControl (§28). Radioryhmä (fieldset+legend) segmentoituna
// valitsimena: täysi keyboard-tuki (nuolinäppäimet natiivisti), screen
// reader -semantiikka ilmaiseksi (radiogroup), ei roving-tabindex-JS:ää.
// - Yksi valinta kerrallaan (name sidottu ryhmään, pakollinen).
// - Aktiivinen kertoo muodolla + pinnalla (aria-checked natiivista;
//   ei pelkkä väri, §31). Chevron/ikoneita ei tarvita (tekstivaihtoehdot).
// - Hint/error samalla mallilla kuin Field (describedby + role=alert).
// - Touch-targetit 44px per segmentti; segmenttejä 2–5 (enemmän → Select).
// Korvaa T043:n teemaradioryhmän ilmeen sovelluksessa (rakenne säilyy).

import { useId } from "react";
import type { InputHTMLAttributes } from "react";
import { Icon } from "./Icon.tsx";

export interface SegmentedOption {
  readonly value: string;
  readonly label: string;
}

export interface SegmentedControlProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "value" | "checked"
> {
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly options: readonly SegmentedOption[];
  readonly value: string;
  readonly onOptionChange: (value: string) => void;
  /** Ryhmän nimi (radio-sidonta); oletus generoidaan. */
  readonly name?: string | undefined;
}

export function SegmentedControl({
  label,
  hint,
  error,
  options,
  value,
  onOptionChange,
  name: nameProp,
  disabled,
  ...rest
}: SegmentedControlProps): React.JSX.Element {
  const fallbackId = useId();
  const groupId = `lifeos-segmented-${fallbackId}`;
  const name = nameProp ?? groupId;
  const hintId = hint !== undefined ? `${groupId}-hint` : undefined;
  const errorId = error !== undefined ? `${groupId}-error` : undefined;
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ") || undefined;
  return (
    <fieldset
      data-ui="segmented"
      data-invalid={error !== undefined ? "true" : undefined}
      aria-describedby={describedBy}
    >
      <legend data-ui="field-label">{label}</legend>
      <div data-ui="segmented-options" role="presentation">
        {options.map((option) => {
          const checked = option.value === value;
          return (
            <label
              key={option.value}
              data-ui="segmented-option"
              data-checked={checked ? "true" : undefined}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={checked}
                disabled={disabled}
                aria-invalid={error !== undefined ? true : undefined}
                onChange={() => {
                  onOptionChange(option.value);
                }}
                {...rest}
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      {hint !== undefined ? (
        <p data-ui="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p data-ui="field-error" id={errorId} role="alert">
          <Icon name="alert" inline />
          <span>{error}</span>
        </p>
      ) : null}
    </fieldset>
  );
}
