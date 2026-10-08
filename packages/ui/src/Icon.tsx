// T045: Icon-komponentti (koriste, aina labelin vieressä).
// data-ui="icon" (kontekstin kokoinen, 1.25rem oletus nav-tyyleistä) tai
// data-ui="icon-inline" (1em, tekstin seassa). Väri perii tekstin
// (currentColor). Ei interaktiivista nimeä yksin (§31).
import { iconAssetUrl, type IconKey } from "./icons.ts";

interface IconProps {
  readonly name: IconKey;
  readonly inline?: boolean;
}

export function Icon({ name, inline = false }: IconProps): React.JSX.Element {
  return (
    <span
      data-ui={inline ? "icon-inline" : "icon"}
      aria-hidden="true"
      style={{ "--lifeos-icon-mask": `url("${iconAssetUrl(name)}")` } as React.CSSProperties}
    />
  );
}

export type { IconKey };
