import type { InputHTMLAttributes, ReactNode } from "react";

export interface SwitchProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "role" | "children"
> {
  readonly children: ReactNode;
}

/** Natiivi checkbox switch-semantiikalla ja teemaan mukautuvalla kytkinnäkymällä. */
export function Switch({ children, disabled, ...rest }: SwitchProps): React.JSX.Element {
  return (
    <label data-ui="switch" data-disabled={disabled === true ? "true" : undefined}>
      <input type="checkbox" role="switch" disabled={disabled} {...rest} />
      <span data-ui="switch-track" aria-hidden="true">
        <span />
      </span>
      <span data-ui="switch-label">{children}</span>
    </label>
  );
}
