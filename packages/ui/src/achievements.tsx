// T189: AchievementCard (§54 yhteiskomponentti; §9 galleria, §31 tila muodolla
// + sanalla, §51/§57.14 ei häpeäkieltä).
// - Listamerkki (Loki-perheen rivirytmi): merkki | teksti | status.
// - Merkki on TILAN muoto: ansaittu = täytetty Sammal-ympyrä + valkoinen
//   check; odottava = ääriviivaympyrä (kuten StreakDot "open"). Kumpikin
//   sanallinen status mukana — ei pelkkää väriä eikä lukkoa/häpeää.
// - Otsikko pysyy täysivoimaisena molemmilla tiloilla; odottava ei ole
//   rankaisu vaan kutsu ("Ei vielä avattu" §57.14).
// Kutsuja antaa valmiit tekstit (LogCard-malli) — komponentti ei muotoile
// eikä tunne domainia.

import type { HTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon.tsx";
import { Body, Meta } from "./typography.tsx";

export type AchievementState = "earned" | "locked";

export interface AchievementCardProps extends HTMLAttributes<HTMLLIElement> {
  readonly title: string;
  readonly description?: string | undefined;
  /** Tila näkyy merkin muotona JA status-sana ei pelkkänä värinä (§31). */
  readonly state: AchievementState;
  /** Statusrivi (esim. "Avattu 12.9.2026" / "Ei vielä avattu"). */
  readonly status: string;
  readonly children?: ReactNode | undefined;
}

/** Saavutusmerkki listassa: rivi, ei laatikkopakkaa (brief §4). */
export function AchievementCard({
  title,
  description,
  state,
  status,
  children,
  ...rest
}: AchievementCardProps): React.JSX.Element {
  return (
    <li data-ui="achievement-card" data-state={state} {...rest}>
      <span data-ui="achievement-mark" data-state={state} aria-hidden="true">
        {state === "earned" ? <Icon name="check" inline /> : null}
      </span>
      <div data-ui="achievement-body">
        <Body>
          <strong>{title}</strong>
        </Body>
        {description !== undefined ? <Meta>{description}</Meta> : null}
        <Meta>
          <span data-ui="achievement-status">{status}</span>
        </Meta>
        {children}
      </div>
    </li>
  );
}
