import { describe, expect, it } from "vitest";
import { parseHealthCsv, previewHealthCsvImport } from "../src/index.ts";

const AT = "2026-10-03T12:00:00.000Z";

describe("untrusted health CSV input", () => {
  it("keeps markup-looking imported text as literal data for the React preview", () => {
    const payload = "<img src=x onerror=alert(1)>";
    const table = parseHealthCsv(`measuredAt,value,unit,note\n${AT},72.4,kg,${payload}`);
    const preview = previewHealthCsvImport(table, "weight", {
      measuredAt: 0,
      value: 1,
      unit: 2,
      note: 3,
    });

    expect(table.fatalError).toBeNull();
    expect(preview.validCount).toBe(1);
    expect(preview.rows[0]?.sourceValues[3]).toBe(payload);
    const importedValue = preview.rows[0]?.value;
    expect(importedValue?.kind).toBe("weight");
    if (importedValue?.kind === "weight") expect(importedValue.entity.note).toBe(payload);
  });

  it("rejects unbalanced CSV quoting and files above the parser size limit", () => {
    const malformed = parseHealthCsv(`measuredAt,value,unit,note\n${AT},72.4,kg,"unfinished`);
    expect(malformed.fatalError).toMatch(/lainausmerkki ei täsmää/u);

    const oversized = parseHealthCsv("x".repeat(12_000_001));
    expect(oversized).toMatchObject({
      headers: [],
      rows: [],
      fatalError: "Tiedosto on liian suuri.",
    });
  });
});
