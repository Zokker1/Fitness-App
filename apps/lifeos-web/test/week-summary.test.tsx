// T122: viikkonäkymäkomposiitin unit-testit (web-paketti, happy-dom).
// - summarizeWeek: 7 riviä ma–su, urgency per päivä, lohkolaskenta;
// - summarizeWeekBlocks: first impression kiireellisyysjärjestyksessä
//   (overdue > tänään > tuleva), rajaus N kappaleeseen.
import { describe, expect, it } from "vitest";
import type { CalendarBlock } from "@lifeos/domain";
import { summarizeWeek, summarizeWeekBlocks } from "../src/views/calendar/WeekSummary.tsx";

function block(id: string, startsAt: string, endsAt: string): CalendarBlock {
  return {
    id,
    createdAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-14T08:00:00.000Z",
    version: 1,
    kind: "event",
    title: id,
    startsAt,
    endsAt,
    linkedTaskId: null,
    linkedRoutineId: null,
    deletedAt: null,
  };
}

describe("summarizeWeek (T122)", () => {
  it("7 riviä ma–su, urgency overdue/tänään/tuleva, blockit päivissä", () => {
    const rows = summarizeWeek(
      "2026-09-14",
      "2026-09-16",
      [
        // 16.9. klo 07:00Z = 10:00 paikallista (+180).
        block("tänään", "2026-09-16T07:00:00.000Z", "2026-09-16T08:00:00.000Z"),
        block("mennyt", "2026-09-14T07:00:00.000Z", "2026-09-14T08:00:00.000Z"),
        block("tuleva", "2026-09-20T07:00:00.000Z", "2026-09-20T08:00:00.000Z"),
      ],
      180,
    ).rows;
    expect(rows).toHaveLength(7);
    expect(rows.map((row) => row.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows[0]?.urgency).toBe("overdue");
    expect(rows[2]?.urgency).toBe("today");
    expect(rows[6]?.urgency).toBe("future");
    expect(rows[0]?.blocks.map((timebox) => timebox.id)).toEqual(["mennyt"]);
    expect(rows[2]?.blocks.map((timebox) => timebox.id)).toEqual(["tänään"]);
    expect(rows[6]?.blocks.map((timebox) => timebox.id)).toEqual(["tuleva"]);
  });
});

describe("summarizeWeekBlocks (T122)", () => {
  it("first impression: myöhässä ensin, sitten tänään, sitten tuleva", () => {
    const { rows } = summarizeWeek(
      "2026-09-14",
      "2026-09-16",
      [
        block("tuleva", "2026-09-20T07:00:00.000Z", "2026-09-20T08:00:00.000Z"),
        block("tänään", "2026-09-16T07:00:00.000Z", "2026-09-16T08:00:00.000Z"),
        block("mennyt", "2026-09-14T07:00:00.000Z", "2026-09-14T08:00:00.000Z"),
      ],
      180,
    );
    const first = summarizeWeekBlocks(rows, 180, 5);
    expect(first.map((entry) => entry.title)).toEqual(["mennyt", "tänään", "tuleva"]);
    expect(first[0]?.dayLabel).toBe("Maanantai 2026-09-14");
  });

  it("rajaa määrään (limit)", () => {
    const { rows } = summarizeWeek(
      "2026-09-14",
      "2026-09-16",
      [block("a", "2026-09-16T07:00:00.000Z", "2026-09-16T08:00:00.000Z")],
      180,
    );
    expect(summarizeWeekBlocks(rows, 180, 0)).toHaveLength(0);
  });
});
