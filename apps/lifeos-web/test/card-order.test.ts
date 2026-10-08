// T089: cardOrder-puren unit-testit (web-paketti, happy-dom — ei IO:ta
// testeissä, store-kutsut kulkevat cardOrderScriptin kautta erikseen).
import { describe, expect, it } from "vitest";
import {
  TODAY_CARD_IDS,
  defaultCardOrder,
  hideCard,
  moveCardDown,
  moveCardUp,
  resolveCardOrder,
  showCard,
} from "../src/views/today/cardOrder.ts";

describe("defaultCardOrder", () => {
  it("kaikki 7 korttia näkyvissä kytkentäjärjestyksessä", () => {
    expect(defaultCardOrder()).toEqual({ visible: [...TODAY_CARD_IDS], hidden: [] });
  });
});

describe("resolveCardOrder", () => {
  it("null/tyhjä → oletus", () => {
    expect(resolveCardOrder(null)).toEqual(defaultCardOrder());
    expect(resolveCardOrder({})).toEqual(defaultCardOrder());
  });

  it("tuntemattomat avaimet ohitetaan, tuplat poistetaan", () => {
    expect(
      resolveCardOrder({ visible: ["tasks", "tasks", "tuleva-kortti", "focus"], hidden: [] }),
    ).toEqual({
      visible: ["tasks", "focus", "next-up", "routines", "goals", "health", "gamification"],
      hidden: [],
    });
  });

  it("piilotetut säilyvät, puuttuvat täydentyvät loppuun", () => {
    expect(resolveCardOrder({ visible: ["tasks"], hidden: ["focus"] })).toEqual({
      visible: ["tasks", "next-up", "routines", "goals", "health", "gamification"],
      hidden: ["focus"],
    });
  });

  it("sama avain molemmissa → näkyvä voittaa", () => {
    const resolved = resolveCardOrder({ visible: ["tasks"], hidden: ["tasks", "focus"] });
    expect(resolved.visible).toContain("tasks");
    expect(resolved.hidden).toEqual(["focus"]);
  });
});

describe("move/hide/show", () => {
  it("ylös/alas vaihtavat paikkaa, reunat no-op", () => {
    const base = defaultCardOrder();
    const up = moveCardUp(base, "tasks");
    expect(up.visible.slice(0, 2)).toEqual(["tasks", "next-up"]);
    expect(moveCardUp(base, "next-up")).toBe(base);
    const down = moveCardDown(base, "next-up");
    expect(down.visible.slice(0, 2)).toEqual(["tasks", "next-up"]);
    expect(moveCardDown(base, "gamification")).toBe(base);
    expect(moveCardUp(base, "tuntematon" as never)).toBe(base);
  });

  it("hide/show siirtävät listojen välillä (idempotentti)", () => {
    const base = defaultCardOrder();
    const hidden = hideCard(base, "focus");
    expect(hidden.visible).not.toContain("focus");
    expect(hidden.hidden).toEqual(["focus"]);
    expect(hideCard(hidden, "focus")).toEqual(hidden);
    const shown = showCard(hidden, "focus");
    expect(shown.visible.at(-1)).toBe("focus");
    expect(shown.hidden).toEqual([]);
    expect(showCard(shown, "focus")).toEqual(shown);
  });
});
