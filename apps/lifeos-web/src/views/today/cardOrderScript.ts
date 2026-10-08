// T043-malli: localStorage-adapteri erikseen (testattava, ei Reactia).
// Avain versioitu (v1) jotta muotoa voi vaihtaa rikkomatta vanhaa dataa —
// resolveCardOrder hoitaa tuntemattomat/puuttuvat joka tapauksessa.
import { resolveCardOrder, type CardOrderState } from "./cardOrder.ts";

const STORAGE_KEY = "lifeos.today-cards.v1";

export function readCardOrder(): CardOrderState {
  try {
    if (typeof localStorage === "undefined") {
      return resolveCardOrder(null);
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return resolveCardOrder(null);
    }
    return resolveCardOrder(JSON.parse(raw) as unknown);
  } catch {
    return resolveCardOrder(null);
  }
}

export function storeCardOrder(state: CardOrderState): void {
  try {
    if (typeof localStorage === "undefined") {
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Tallennusvirhe (quota/privatemode) ei kaada näkymää — muutos elää
    // session ajan muistissa.
  }
}
