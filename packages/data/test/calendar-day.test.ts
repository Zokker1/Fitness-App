// T121: päiväkalenterin layout-unit-testit (data-paketti).
// Kriteeri: tunnit, nykyhetki ja blockit (päällekkäisyydet näkyvät kaistoina).
import { describe, expect, it } from "vitest";
import type { CalendarBlock } from "@lifeos/domain";
import {
  blockUtcFromLocal,
  blocksOnDay,
  layoutDayBlocks,
  nowMinutesLocal,
  shiftBlockUtc,
} from "@lifeos/data";

const DATE = "2026-09-18"; // perjantai
const OFFSET = 180;

function block(
  id: string,
  startUtc: string,
  endUtc: string,
  overrides: Partial<CalendarBlock> = {},
): CalendarBlock {
  return {
    id,
    createdAt: "2026-09-17T08:00:00.000Z",
    updatedAt: "2026-09-17T08:00:00.000Z",
    version: 1,
    kind: "event",
    title: id,
    startsAt: startUtc,
    endsAt: endUtc,
    linkedTaskId: null,
    linkedRoutineId: null,
    deletedAt: null,
    ...overrides,
  };
}

describe("layoutDayBlocks (T121)", () => {
  it("yksi block: prosenttipositio ikkunassa + tuntirivit", () => {
    // 09:00–10:00 paikallista (+180) = 06:00–07:00Z.
    const layout = layoutDayBlocks({
      blocks: [block("b1", "2026-09-18T06:00:00.000Z", "2026-09-18T07:00:00.000Z")],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(layout.totalMinutes).toBe(16 * 60);
    expect(layout.blocks).toHaveLength(1);
    const position = layout.blocks[0];
    if (position === undefined) {
      throw new Error("puuttuu");
    }
    // Ikkuna 06:00–22:00 paikallista; block 09–10 → top (180/960)*100.
    expect(position.topPercent).toBeCloseTo((3 / 16) * 100, 5);
    expect(position.heightPercent).toBeCloseTo((1 / 16) * 100, 5);
    expect(position.lanes).toBe(1);
    expect(position.lane).toBe(0);
    expect(layout.hourTicks).toHaveLength(16);
    expect(layout.hourTicks[0]?.hour).toBe(6);
    expect(layout.hourTicks[0]?.topPercent).toBe(0);
  });

  it("päällekkäiset blockit jaetaan kaistoiksi (näkyvät rinnakkain)", () => {
    const layout = layoutDayBlocks({
      blocks: [
        block("a", "2026-09-18T07:00:00.000Z", "2026-09-18T08:30:00.000Z"),
        block("b", "2026-09-18T08:00:00.000Z", "2026-09-18T09:00:00.000Z"),
      ],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(layout.blocks).toHaveLength(2);
    const a = layout.blocks.find((position) => position.block.id === "a");
    const b = layout.blocks.find((position) => position.block.id === "b");
    expect(a?.lanes).toBe(2);
    expect(b?.lanes).toBe(2);
    expect(a?.lane).toBe(0);
    expect(b?.lane).toBe(1);
  });

  it("T130: 4 samanaikaista → 3 kaistaa + 1 piilotettu (indikaattori)", () => {
    const make = (id: string): CalendarBlock =>
      block(id, "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z");
    const layout = layoutDayBlocks({
      blocks: [make("a"), make("b"), make("c"), make("d")],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    // 4 samanaikaista → 4 kaistaa → tiivistys 3:een + indikaattori.
    expect(layout.blocks).toHaveLength(3);
    expect(layout.blocks.map((position) => position.lane)).toEqual([0, 1, 2]);
    expect(layout.blocks.every((position) => position.lanes === 3)).toBe(true);
    expect(layout.overflowGroups).toHaveLength(1);
    expect(layout.overflowGroups[0]).toMatchObject({ total: 4, shown: 3, hidden: 1 });
  });

  it("T130: 3 samanaikaista mahtuu ilman tiivistystä", () => {
    const make = (id: string): CalendarBlock =>
      block(id, "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z");
    const layout = layoutDayBlocks({
      blocks: [make("a"), make("b"), make("c")],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(layout.blocks).toHaveLength(3);
    expect(layout.overflowGroups).toHaveLength(0);
  });

  it("T130: laajennettu ryhmä näyttää KAIKKI jäsenet täydellä kaistamäärällä", () => {
    const make = (id: string): CalendarBlock =>
      block(id, "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z");
    const blocks = [make("a"), make("b"), make("c"), make("d")];
    // Ryhmän avain saadaan tiivistetyltä ajolta (deterministinen id@aika).
    const collapsed = layoutDayBlocks({
      blocks,
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    const key = collapsed.overflowGroups[0]?.key;
    expect(key).toBeDefined();
    const expanded = layoutDayBlocks({
      blocks,
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
      expandedGroupKeys: [key as string],
    });
    // Kaikki 4 näkyvät, kaistat 0..3 (kapeampi mutta ei peittyvä, §6).
    expect(expanded.blocks).toHaveLength(4);
    expect(expanded.blocks.map((position) => position.lane)).toEqual([0, 1, 2, 3]);
    expect(expanded.blocks.every((position) => position.lanes === 4)).toBe(true);
    // Indikaattori pysyy (nappi näyttää "Piilota") ja kertoo täyden tiedon.
    expect(expanded.overflowGroups).toHaveLength(1);
    expect(expanded.overflowGroups[0]).toMatchObject({ total: 4, shown: 3, hidden: 1 });
  });

  it("peräkkäiset (ei päällekkäiset) blockit täydessä leveydessä", () => {
    const layout = layoutDayBlocks({
      blocks: [
        block("a", "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z"),
        block("b", "2026-09-18T08:00:00.000Z", "2026-09-18T09:00:00.000Z"),
      ],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(layout.blocks.every((position) => position.lanes === 1)).toBe(true);
  });

  it("muulle päivälle osuvat ja tombstonetut jätetään pois", () => {
    const layout = layoutDayBlocks({
      blocks: [
        block("toinen-paiva", "2026-09-19T07:00:00.000Z", "2026-09-19T08:00:00.000Z"),
        block("tombstone", "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z", {
          deletedAt: "2026-09-18T09:00:00.000Z",
        }),
        block("ok", "2026-09-18T10:00:00.000Z", "2026-09-18T11:00:00.000Z"),
      ],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
    });
    expect(layout.blocks).toHaveLength(1);
    expect(layout.blocks[0]?.block.id).toBe("ok");
  });

  it("yöblockin häntä clamppautuu ikkunan alkuun (00:00–07:00 → näkyy 06–07)", () => {
    const layout = layoutDayBlocks({
      blocks: [block("yö", "2026-09-17T21:00:00.000Z", "2026-09-18T04:00:00.000Z")],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
      startHour: 6,
      endHour: 22,
    });
    // Block paikallisesti 18.9. 00:00–07:00 → näkyy ikkunan ensimmäinen tunti.
    expect(layout.blocks).toHaveLength(1);
    const position = layout.blocks[0];
    if (position === undefined) {
      throw new Error("puuttuu");
    }
    expect(position.topPercent).toBe(0);
    expect(position.heightPercent).toBeCloseTo((60 / 960) * 100, 5);
  });

  it("T133: Europe/Helsinki kesä- ja talviajan offsetit säilyvät paikallisena kellonaikana", () => {
    const summer = blockUtcFromLocal("2026-07-01", "10:00", 60, 180);
    const winter = blockUtcFromLocal("2026-01-15", "10:00", 60, 120);
    expect(summer).toEqual({
      startsAt: "2026-07-01T07:00:00.000Z",
      endsAt: "2026-07-01T08:00:00.000Z",
    });
    expect(winter).toEqual({
      startsAt: "2026-01-15T08:00:00.000Z",
      endsAt: "2026-01-15T09:00:00.000Z",
    });

    const summerLayout = layoutDayBlocks({
      blocks: [block("kesä", summer?.startsAt ?? "", summer?.endsAt ?? "")],
      dateKey: "2026-07-01",
      timezoneOffsetMinutes: 180,
    });
    const winterLayout = layoutDayBlocks({
      blocks: [block("talvi", winter?.startsAt ?? "", winter?.endsAt ?? "")],
      dateKey: "2026-01-15",
      timezoneOffsetMinutes: 120,
    });
    expect(summerLayout.blocks[0]?.startMinutes).toBe(600);
    expect(winterLayout.blocks[0]?.startMinutes).toBe(600);
  });

  it("T133: yön yli jatkuva block ei katoa, vaan jatkuu alkupäivällä keskiyön yli", () => {
    const overnight = blockUtcFromLocal(DATE, "21:00", 240, OFFSET);
    expect(overnight).toEqual({
      startsAt: "2026-09-18T18:00:00.000Z",
      endsAt: "2026-09-18T22:00:00.000Z",
    });
    const layout = layoutDayBlocks({
      blocks: [block("yli-yön", overnight?.startsAt ?? "", overnight?.endsAt ?? "")],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
      startHour: 6,
      endHour: 22,
    });
    const position = layout.blocks[0];
    expect(position).toBeDefined();
    expect(position?.startMinutes).toBe(21 * 60);
    expect(position?.endMinutes).toBe(25 * 60);
    expect(position?.topPercent).toBeCloseTo((15 / 16) * 100, 5);
    expect(position?.heightPercent).toBeCloseTo((60 / 960) * 100, 5);
  });

  it("kokonaan ikkunan ulkopuolella oleva block jätetään pois", () => {
    // 04:00–05:00 paikallista (= 01:00–02:00Z) — ennen ikkunaa 06:00.
    const layout = layoutDayBlocks({
      blocks: [block("aamu", "2026-09-18T01:00:00.000Z", "2026-09-18T02:00:00.000Z")],
      dateKey: DATE,
      timezoneOffsetMinutes: OFFSET,
      startHour: 6,
      endHour: 22,
    });
    expect(layout.blocks).toHaveLength(0);
  });
});

describe("blocksOnDay (T122)", () => {
  it("leikkaa päivän blockit paikallispäivällä ja järjestää aloitusajalla", () => {
    const rows = blocksOnDay(
      [
        // 19:05Z = 22:05 paikallista (+180) — yhä perjantaina (muu tunti).
        block("iltapaiva", "2026-09-18T16:05:00.000Z", "2026-09-18T17:05:00.000Z"),
        // 05:00Z = 08:00 paikallista.
        block("aamu", "2026-09-18T05:00:00.000Z", "2026-09-18T06:00:00.000Z"),
        block("tombstone", "2026-09-18T09:00:00.000Z", "2026-09-18T10:00:00.000Z", {
          deletedAt: "2026-09-18T11:00:00.000Z",
        }),
        // Lauantaina: eri paikallispäivä → pois.
        block("lauantai", "2026-09-19T06:00:00.000Z", "2026-09-19T07:00:00.000Z"),
      ],
      DATE,
      OFFSET,
    );
    expect(rows.map((row) => row.id)).toEqual(["aamu", "iltapaiva"]);
  });

  it("tyhjä päivä → tyhjä lista", () => {
    expect(blocksOnDay([], DATE, OFFSET)).toEqual([]);
  });
});

describe("shiftBlockUtc (T128 drag)", () => {
  it("siirtää molemmat reunat samalla deltalla (deterministinen UTC-matematiikka)", () => {
    const shifted = shiftBlockUtc(
      block("b", "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z"),
      30,
    );
    expect(shifted).toEqual({
      startsAt: "2026-09-18T07:30:00.000Z",
      endsAt: "2026-09-18T08:30:00.000Z",
    });
  });

  it("negatiivinen delta siirtää taaksepäin", () => {
    const shifted = shiftBlockUtc(
      block("b", "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z"),
      -60,
    );
    expect(shifted).toEqual({
      startsAt: "2026-09-18T06:00:00.000Z",
      endsAt: "2026-09-18T07:00:00.000Z",
    });
  });

  it("epävalidi blockki tai ei-kokonainen delta → null", () => {
    expect(shiftBlockUtc(block("b", "ei-hetki", "2026-09-18T08:00:00.000Z"), 30)).toBeNull();
    expect(
      shiftBlockUtc(block("b", "2026-09-18T08:00:00.000Z", "2026-09-18T07:00:00.000Z"), 30),
    ).toBeNull();
    expect(
      shiftBlockUtc(block("b", "2026-09-18T07:00:00.000Z", "2026-09-18T08:00:00.000Z"), 2.5),
    ).toBeNull();
  });
});

describe("nowMinutesLocal + blockUtcFromLocal (T121)", () => {
  it("nykyhetki paikallisminuutteina", () => {
    // 09:15Z + 180 = 12:15 paikallista = 735 min.
    expect(nowMinutesLocal("2026-09-18T09:15:00.000Z", 180)).toBe(735);
  });

  it("paikallinen aloitus + kesto → UTC-hetket (tasurakaisu)", () => {
    const utc = blockUtcFromLocal(DATE, "10:00", 45, OFFSET);
    expect(utc).toEqual({
      startsAt: "2026-09-18T07:00:00.000Z",
      endsAt: "2026-09-18T07:45:00.000Z",
    });
  });

  it("epävalidi syöte → null", () => {
    expect(blockUtcFromLocal(DATE, "ei-aikaa", 30, OFFSET)).toBeNull();
    expect(blockUtcFromLocal(DATE, "10:00", 3, OFFSET)).toBeNull();
  });
});
