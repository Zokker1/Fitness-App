// T089: Today-korttien järjestys+piilotus — PURE ydin (ei IO:ta, ei Reactia).
// Käyttäjä voi järjestää ja piilottaa kortteja PYSYVÄSTI (localStorage,
// sama talletusmalli kuin teema T043 — UI-asetus, ei entiteetti; varsinainen
// preferenssirepo tulee B13:ssa). Korttiavain on suljettu unioni — tuntematon
// avain tallennuksessa ohitetaan (ei kaada näkymää), puuttuvat avaimet
// täydennetään oletusjärjestykseen loppuun. Migraatio: uusi kortti (T090+)
// ilmestyy automaattisesti oletuspaikalleen ilman käyttäjän datan nollausta.
export const TODAY_CARD_IDS = [
  "next-up",
  "tasks",
  "routines",
  "goals",
  "health",
  "focus",
  "gamification",
] as const;

export type TodayCardId = (typeof TODAY_CARD_IDS)[number];

export interface CardOrderState {
  /** Näkyvät kortit järjestyksessä. */
  readonly visible: readonly TodayCardId[];
  /** Piilotetut kortit (järjestyksellä ei väliä UI:ssa). */
  readonly hidden: readonly TodayCardId[];
}

function isCardId(value: unknown): value is TodayCardId {
  return typeof value === "string" && (TODAY_CARD_IDS as readonly string[]).includes(value);
}

function uniqueIds(values: readonly unknown[]): TodayCardId[] {
  const seen = new Set<TodayCardId>();
  const result: TodayCardId[] = [];
  for (const value of values) {
    if (isCardId(value) && !seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result;
}

/** Oletus: kaikki näkyvissä T082→T088-kytkentäjärjestyksessä. */
export function defaultCardOrder(): CardOrderState {
  return { visible: [...TODAY_CARD_IDS], hidden: [] };
}

/**
 * Totuus tallennuksesta: validoi, poistaa tuplat/tuntemattomat ja täydentää
 * puuttuvat kortit. HUOM: Näitä kortteja ei hylätä koskaan kokonaan.
 */
export function resolveCardOrder(stored: unknown): CardOrderState {
  if (typeof stored !== "object" || stored === null) {
    return defaultCardOrder();
  }
  const record = stored as Record<string, unknown>;
  const visible = uniqueIds(Array.isArray(record.visible) ? record.visible : []);
  const hidden = uniqueIds(Array.isArray(record.hidden) ? record.hidden : []).filter(
    (id) => !visible.includes(id),
  );
  const missing = TODAY_CARD_IDS.filter((id) => !visible.includes(id) && !hidden.includes(id));
  return { visible: [...visible, ...missing], hidden };
}

export function moveCardUp(state: CardOrderState, id: TodayCardId): CardOrderState {
  const index = state.visible.indexOf(id);
  if (index <= 0) {
    return state;
  }
  const visible = [...state.visible];
  const previous = visible[index - 1];
  if (previous === undefined) {
    return state;
  }
  visible[index - 1] = id;
  visible[index] = previous;
  return { visible, hidden: state.hidden };
}

export function moveCardDown(state: CardOrderState, id: TodayCardId): CardOrderState {
  const index = state.visible.indexOf(id);
  if (index < 0 || index >= state.visible.length - 1) {
    return state;
  }
  const visible = [...state.visible];
  const next = visible[index + 1];
  if (next === undefined) {
    return state;
  }
  visible[index + 1] = id;
  visible[index] = next;
  return { visible, hidden: state.hidden };
}

export function hideCard(state: CardOrderState, id: TodayCardId): CardOrderState {
  if (!state.visible.includes(id)) {
    return state;
  }
  return {
    visible: state.visible.filter((card) => card !== id),
    hidden: [...state.hidden.filter((card) => card !== id), id],
  };
}

export function showCard(state: CardOrderState, id: TodayCardId): CardOrderState {
  if (!state.hidden.includes(id)) {
    return state;
  }
  return {
    visible: [...state.visible, id],
    hidden: state.hidden.filter((card) => card !== id),
  };
}

/** Kortin suomenkielinen nimi editointilistalle (ei kovakoodia komponentissa). */
export const TODAY_CARD_LABELS: Readonly<Record<TodayCardId, string>> = {
  "next-up": "Mitä seuraavaksi",
  tasks: "Päivän tehtävät",
  routines: "Päivän rutiinit",
  goals: "Päivän tavoitteet",
  health: "Terveys tänään",
  focus: "Päivän fokus",
  gamification: "Edistyminen",
};
