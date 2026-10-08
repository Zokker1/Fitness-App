import type { InputHTMLAttributes, ReactNode } from "react";

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "children"
> {
  readonly children: ReactNode;
}

/** Natiivi, teemaan mukautuva valintaruutu, jonka koko label on kosketusalue. */
export function Checkbox({ children, disabled, ...rest }: CheckboxProps): React.JSX.Element {
  return (
    <label data-ui="checkbox" data-disabled={disabled === true ? "true" : undefined}>
      <input type="checkbox" disabled={disabled} {...rest} />
      <span data-ui="checkbox-label">{children}</span>
    </label>
  );
}
