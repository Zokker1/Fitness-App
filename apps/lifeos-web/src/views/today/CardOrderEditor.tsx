// T089: korttien muokkausnäkymä (edit-mode). Ei drag-and-dropia (epätarkka
// kosketuksella + hankala ruudunlukijalla, §31) — tavalliset napit per kortti:
// ylös/alas/piilota + piilotetuille näytä. Joka toiminto on nimetty
// (aria-label kortin nimellä), tila päivittyy heti + persistoidaan.
// Ei domain/data-kytkentää — puhdas UI-tila useCardOrder-hookista.
import { t, tTemplate } from "../../language.tsx";
import { Button } from "@lifeos/ui";
import { TODAY_CARD_LABELS, type CardOrderState, type TodayCardId } from "./cardOrder.ts";

export interface CardOrderEditorProps {
  readonly order: CardOrderState;
  readonly onMoveUp: (id: TodayCardId) => void;
  readonly onMoveDown: (id: TodayCardId) => void;
  readonly onHide: (id: TodayCardId) => void;
  readonly onShow: (id: TodayCardId) => void;
  readonly onDone: () => void;
}

export function CardOrderEditor({
  order,
  onMoveUp,
  onMoveDown,
  onHide,
  onShow,
  onDone,
}: CardOrderEditorProps): React.JSX.Element {
  return (
    <section
      data-ui="card-order-editor"
      data-testid="card-order-editor"
      aria-label={t("Muokkaa kortteja")}
    >
      <h2>{t("Muokkaa kortteja")}</h2>
      <ol>
        {order.visible.map((id, index) => (
          <li key={id} data-testid={`card-order-row-${id}`}>
            <span>{t(TODAY_CARD_LABELS[id])}</span>{" "}
            <Button
              variant="secondary"
              disabled={index === 0}
              onClick={() => {
                onMoveUp(id);
              }}
              aria-label={tTemplate("Siirrä {{0}} ylös", [t(TODAY_CARD_LABELS[id])])}
            >
              ↑
            </Button>{" "}
            <Button
              variant="secondary"
              disabled={index === order.visible.length - 1}
              onClick={() => {
                onMoveDown(id);
              }}
              aria-label={tTemplate("Siirrä {{0}} alas", [t(TODAY_CARD_LABELS[id])])}
            >
              ↓
            </Button>{" "}
            <Button
              variant="secondary"
              onClick={() => {
                onHide(id);
              }}
              aria-label={tTemplate("Piilota {{0}}", [t(TODAY_CARD_LABELS[id])])}
            >
              {t("Piilota")}
            </Button>
          </li>
        ))}
      </ol>
      {order.hidden.length > 0 ? (
        <>
          <h3>{t("Piilotetut")}</h3>
          <ul>
            {order.hidden.map((id) => (
              <li key={id} data-testid={`card-order-hidden-${id}`}>
                <span>{t(TODAY_CARD_LABELS[id])}</span>{" "}
                <Button
                  variant="secondary"
                  onClick={() => {
                    onShow(id);
                  }}
                  aria-label={tTemplate("Näytä {{0}}", [t(TODAY_CARD_LABELS[id])])}
                >
                  {t("Näytä")}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p>
        <Button
          variant="primary"
          onClick={() => {
            onDone();
          }}
        >
          {t("Valmis")}
        </Button>
      </p>
    </section>
  );
}
