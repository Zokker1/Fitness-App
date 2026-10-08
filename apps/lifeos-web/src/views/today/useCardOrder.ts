// T089: korttijärjestyksen hook. Omistaa CardOrderState-tilan + persistoinnin
// (localStorage-adapteri erikseen; UI-asetus, ei entiteetti). Ei domain/data-
// kytkentää — puhdas UI-tila.
import { useCallback, useState } from "react";
import {
  hideCard,
  moveCardDown,
  moveCardUp,
  showCard,
  type CardOrderState,
  type TodayCardId,
} from "./cardOrder.ts";
import { readCardOrder, storeCardOrder } from "./cardOrderScript.ts";

export interface CardOrderActions {
  readonly order: CardOrderState;
  readonly moveUp: (id: TodayCardId) => void;
  readonly moveDown: (id: TodayCardId) => void;
  readonly hide: (id: TodayCardId) => void;
  readonly show: (id: TodayCardId) => void;
}

export function useCardOrder(): CardOrderActions {
  const [order, setOrder] = useState<CardOrderState>(() => readCardOrder());
  const moveUp = useCallback((id: TodayCardId) => {
    setOrder((previous) => {
      const next = moveCardUp(previous, id);
      if (next !== previous) {
        storeCardOrder(next);
      }
      return next;
    });
  }, []);
  const moveDown = useCallback((id: TodayCardId) => {
    setOrder((previous) => {
      const next = moveCardDown(previous, id);
      if (next !== previous) {
        storeCardOrder(next);
      }
      return next;
    });
  }, []);
  const hide = useCallback((id: TodayCardId) => {
    setOrder((previous) => {
      const next = hideCard(previous, id);
      if (next !== previous) {
        storeCardOrder(next);
      }
      return next;
    });
  }, []);
  const show = useCallback((id: TodayCardId) => {
    setOrder((previous) => {
      const next = showCard(previous, id);
      if (next !== previous) {
        storeCardOrder(next);
      }
      return next;
    });
  }, []);
  return { order, moveUp, moveDown, hide, show };
}
