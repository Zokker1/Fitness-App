// T082: Mitä seuraavaksi -kortti (§4). Yksi ehdotus kerrallaan + syy,
// linkki kohteeseen. Tyhjätila sanoo että suunnitelma on vapaa (ei harmaa
// "ei dataa" -laatikko vaan rauhallinen toteamus). Kortti on StatusCard-
// perhettä (selite + tila), ei sankarikortti — se ei huuda.
//
// TIEDOT: data tulee TodayView'n syöttämästä NextUpItemistä (valinta on jo
// tehty selectNextUp:ssa); kortti ei laske, ei hae, ei auto-suorita.
import { t } from "../../language.tsx";
import { Link } from "react-router";
import { StatusCard, Meta } from "@lifeos/ui";
import type { NextUpItem } from "@lifeos/data";

export function NextUpCard({
  item,
}: {
  readonly item?: NextUpItem | undefined;
}): React.JSX.Element {
  if (item === undefined) {
    return (
      <StatusCard tone="info" heading={t("Mitä seuraavaksi")} data-testid="next-up-empty">
        <Meta>
          {t("Ei aikataulutettua eikä avoinna olevaa — päivä on vapaa suunniteltavaksi.")}
        </Meta>
      </StatusCard>
    );
  }
  const target =
    item.kind === "timebox-now" || item.kind === "timebox-next" ? "/calendar" : "/tasks";
  return (
    <StatusCard tone="info" heading={t("Mitä seuraavaksi")} data-testid="next-up-card">
      <Meta>{item.reason}</Meta>
      <p>
        <Link to={target} data-testid="next-up-link">
          {item.kind === "timebox-now" || item.kind === "timebox-next"
            ? t("Avaa kalenteri")
            : t("Avaa tehtävät")}
        </Link>
      </p>
    </StatusCard>
  );
}
