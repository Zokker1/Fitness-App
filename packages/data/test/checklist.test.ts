// T108: checklist-logiikan unit-testit (data-paketti).
// Kriteeri: alitehtävät järjestettävissä + completion-logiikka testattu.
import { describe, expect, it } from "vitest";
import type { TaskChecklistItem } from "@lifeos/domain";
import {
  checklistProgress,
  moveChecklistItem,
  nextChecklistSortOrder,
  parseStepTitles,
  reorderChecklistItems,
  sortChecklistItems,
} from "@lifeos/data";

function item(
  id: string,
  sortOrder: number,
  overrides: Partial<TaskChecklistItem> = {},
): TaskChecklistItem {
  return {
    id,
    createdAt: `2026-09-10T08:00:0${String(sortOrder).padStart(2, "0")}.000Z`,
    updatedAt: "1970-01-01T00:00:00.000Z",
    version: 1,
    taskId: "t1",
    title: id,
    done: false,
    sortOrder,
    deletedAt: null,
    ...overrides,
  };
}

describe("sortChecklistItems (T108)", () => {
  it("järjestää sortOrderin mukaan, tasatilanteessa createdAt", () => {
    const sorted = sortChecklistItems([
      item("kaksi", 2),
      item("yksi", 1),
      item("nolla-b", 0, { createdAt: "2026-09-10T09:00:00.000Z" }),
      item("nolla-a", 0, { createdAt: "2026-09-10T08:00:00.000Z" }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual(["nolla-a", "nolla-b", "yksi", "kaksi"]);
  });
});

describe("moveChecklistItem (T108)", () => {
  const items = [item("a", 0), item("b", 1), item("c", 2)];

  it("ylös: naapurien sortOrderit vaihtuvat", () => {
    const result = moveChecklistItem(items, "b", "up");
    expect(result).toEqual({
      ok: true,
      updates: [
        { id: "b", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
      ],
    });
  });

  it("alas: naapurien sortOrderit vaihtuvat", () => {
    const result = moveChecklistItem(items, "b", "down");
    expect(result).toEqual({
      ok: true,
      updates: [
        { id: "b", sortOrder: 2 },
        { id: "c", sortOrder: 1 },
      ],
    });
  });

  it("ensimmäinen ei nouse, viimeinen ei laske (boundary)", () => {
    expect(moveChecklistItem(items, "a", "up")).toEqual({ ok: false, error: "boundary" });
    expect(moveChecklistItem(items, "c", "down")).toEqual({ ok: false, error: "boundary" });
  });

  it("tuntematon id → not-found", () => {
    expect(moveChecklistItem(items, "x", "up")).toEqual({ ok: false, error: "not-found" });
  });

  it("toimii duplikaatti-sortOrderilla (vertailu createdAt-tasapelillä)", () => {
    const duplicated = [item("a", 0), item("b", 0), item("c", 0)];
    const result = moveChecklistItem(duplicated, "c", "up");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // c:n naapuri on b (createdAt-järjestyksessä keskimmäinen).
      expect(result.updates).toEqual([
        { id: "c", sortOrder: 0 },
        { id: "b", sortOrder: 0 },
      ]);
    }
  });
});

describe("reorderChecklistItems (T113 raahaus)", () => {
  const rows = [item("a", 0), item("b", 1), item("c", 2)];

  it(" keskimmäinen ylimmäksi: kaikki sortOrderit numeroitu uudelleen", () => {
    const result = reorderChecklistItems(rows, "c", 0);
    expect(result).toEqual({
      ok: true,
      updates: [
        { id: "c", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
        { id: "b", sortOrder: 2 },
      ],
    });
  });

  it("samaan indeksiin → ei päivityksiä", () => {
    const result = reorderChecklistItems(rows, "b", 1);
    expect(result).toEqual({ ok: true, updates: [] });
  });

  it("toIndex clamppaillaan alueelle [0, n-1]", () => {
    const result = reorderChecklistItems(rows, "a", 99);
    expect(result).toEqual({
      ok: true,
      updates: [
        { id: "b", sortOrder: 0 },
        { id: "c", sortOrder: 1 },
        { id: "a", sortOrder: 2 },
      ],
    });
    expect(reorderChecklistItems(rows, "c", -5)).toEqual({
      ok: true,
      updates: [
        { id: "c", sortOrder: 0 },
        { id: "a", sortOrder: 1 },
        { id: "b", sortOrder: 2 },
      ],
    });
  });

  it("tuntematon id → not-found", () => {
    expect(reorderChecklistItems(rows, "x", 0)).toEqual({ ok: false, error: "not-found" });
  });
});

describe("parseStepTitles (T116 pilkkominen)", () => {
  it("pilkku JA rivinvaihto erottimina; trim + dedupe case-insensitiivisesti", () => {
    expect(parseStepTitles("mittaa,\ntilaa , ASIA\nasia")).toEqual(["mittaa", "tilaa", "ASIA"]);
    expect(parseStepTitles("")).toEqual([]);
    expect(parseStepTitles(" , ,\n")).toEqual([]);
  });

  it("rajat: enintään 12 vaihetta, 80 merkkiä per vaihe", () => {
    const long = "x".repeat(81);
    expect(parseStepTitles(`${long}, lyhyt`)).toEqual(["lyhyt"]);
    const many = Array.from({ length: 15 }, (_, index) => `v${String(index)}`).join(", ");
    expect(parseStepTitles(many)).toHaveLength(12);
  });
});

describe("checklistProgress + nextChecklistSortOrder (T108)", () => {
  it("progress laskee valmiit rehellisesti", () => {
    const rows = [item("a", 0, { done: true }), item("b", 1), item("c", 2, { done: true })];
    expect(checklistProgress(rows)).toEqual({ done: 2, total: 3 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0 });
  });

  it("seuraava vapaa sortOrder = max + 1; tyhjä → 0", () => {
    expect(nextChecklistSortOrder([item("a", 0), item("b", 3)])).toBe(4);
    expect(nextChecklistSortOrder([])).toBe(0);
  });
});
