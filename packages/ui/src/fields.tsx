// T047: lomakekentät (§28: Input, NumberInput, Select, Combobox).
// T048: + DatePicker/TimePicker/SegmentedControl (sama Field-kääre).
// Yhteinen Field-kääre + natiivit kontrollit (ei custom-dropdownia):
// - Field: label (aina näkyvä, ei placeholder-labelia) + hint + error.
//   Virhe sidotaan kenttään aria-describedby:lla (id-pohjainen, §31) ja
//   error-tilassa aria-invalid + data-invalid-tyyli. Kentällä on vakaa id
//   (käyttäjän antama tai useId-fallback — SSR-turvallinen).
// - Input: tekstikenttä (type/inpuMode välittyvät; autocomplete sallittu).
// - NumberInput: type=number + inputMode=decimal; askellus natiivi.
// - Select: natiivi <select> + chevron-koriste (appearance:none, ei custom-
//   listaa → mobiilin natiivi valitsin + täysi keyboard-tuki ilmaiseksi).
// - Combobox: tekstikenttä + datalist-ehdotukset (natiivi suodatus +
//   keyboard; ei JS-hakua). Ehdotukset id:llä kenttään (list-attribuutti).
// Kaikki: states (focus/disabled/loading? — lataus ei kuulu kenttiin, vain
// nappeihin; error), touch-target (min 44px korkeus), dark/light tokeneista,
// a11y-semantiikka (label/for, kuvattu virhe, ei pelkkää väriä: virheessä
// myös ikoni + teksti). Ei ulkoista lomakekirjastoa (B02: kontrolloimaton
// oletus, value/onChange välittyvät suoraan).

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { Icon } from "./Icon.tsx";

interface FieldShellProps {
  readonly id: string;
  readonly label: string;
  // exactOptionalPropertyTypes: kutsuja välittää string | undefined —
  // siksi undefined eksplisiittisesti sallittu (sama malli kuin
  // DescribedProps alla).
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly children: ReactNode;
}

/** Jaettu label+hint+error-kääre (id-sidonta kutsujalta). T048 vie ulos
    (SegmentedControl käyttää legend-ryhmää mutta samaa hint/error-mallia). */
export function FieldShell({
  id,
  label,
  hint,
  error,
  children,
}: FieldShellProps): React.JSX.Element {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter((part) => part !== undefined).join(" ") || undefined;
  return (
    <div data-ui="field" data-invalid={error !== undefined ? "true" : undefined}>
      <label data-ui="field-label" htmlFor={id}>
        {label}
      </label>
      <div data-ui="field-control" data-described={describedBy}>
        {children}
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
    </div>
  );
}

interface DescribedProps {
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}

/** Hint/error-idt aria-describedby:hen (T048 vie ulos Segmentedille). */
export function describedIds(id: string, { hint, error }: DescribedProps): string | undefined {
  const parts = [
    hint !== undefined ? `${id}-hint` : undefined,
    error !== undefined ? `${id}-error` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join(" ") : undefined;
}

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}

/** Tekstikenttä (kontrolloi itse tai jätä kontrolloimattomaksi). */
export function Input({
  id: idProp,
  label,
  hint,
  error,
  ...rest
}: TextFieldProps): React.JSX.Element {
  const fallbackId = useId();
  const id = idProp ?? `lifeos-input-${fallbackId}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="text"
        data-ui="input"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedIds(id, { hint, error })}
        {...rest}
      />
    </FieldShell>
  );
}

export interface NumberFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type"
> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}

/** Numerokenttä (natiivi askellus + desimaalinäppäimistö mobiilissa). */
export function NumberInput({
  id: idProp,
  label,
  hint,
  error,
  ...rest
}: NumberFieldProps): React.JSX.Element {
  const fallbackId = useId();
  const id = idProp ?? `lifeos-number-${fallbackId}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        data-ui="input"
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedIds(id, { hint, error })}
        {...rest}
      />
    </FieldShell>
  );
}

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "id" | "children"
> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly options: readonly SelectOption[];
  readonly placeholder?: string;
}

/** Natiivi valitsin (mobiilin natiivivalikko + keyboard ilmaiseksi). */
export function Select({
  id: idProp,
  label,
  hint,
  error,
  options,
  placeholder,
  ...rest
}: SelectProps): React.JSX.Element {
  const fallbackId = useId();
  const id = idProp ?? `lifeos-select-${fallbackId}`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <span data-ui="select-wrap">
        <select
          id={id}
          data-ui="input"
          aria-invalid={error !== undefined ? true : undefined}
          aria-describedby={describedIds(id, { hint, error })}
          {...rest}
        >
          {placeholder !== undefined ? (
            <option value="" disabled={rest.required === true}>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevron" />
      </span>
    </FieldShell>
  );
}

export interface ComboboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "type" | "list"
> {
  readonly id?: string;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
  readonly suggestions: readonly string[];
}

/** Hakukenttä datalist-ehdotuksilla (natiivi suodatus + keyboard). */
export function Combobox({
  id: idProp,
  label,
  hint,
  error,
  suggestions,
  ...rest
}: ComboboxProps): React.JSX.Element {
  const fallbackId = useId();
  const id = idProp ?? `lifeos-combo-${fallbackId}`;
  const listId = `${id}-suggestions`;
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-expanded="false"
        aria-autocomplete="list"
        aria-controls={listId}
        autoComplete="off"
        data-ui="input"
        list={listId}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedIds(id, { hint, error })}
        {...rest}
      />
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
    </FieldShell>
  );
}
