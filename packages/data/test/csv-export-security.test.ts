import { describe, expect, it } from "vitest";
import { serializeCsv } from "../src/index.ts";

describe("spreadsheet-safe CSV export", () => {
  it("neutralizes formula-like text while preserving numeric values", () => {
    const csv = serializeCsv(
      [
        { value: "=1+1" },
        { value: " +SUM(A1:A2)" },
        { value: "@SUM(A1:A2)" },
        { value: "-cmd|' /C calc'!A0" },
        { value: -72.4 },
      ],
      { id: "security-csv", version: 1, columns: [{ key: "value", value: (row) => row.value }] },
    );

    expect(csv).toBe(
      '"value"\n"\'=1+1"\n"\' +SUM(A1:A2)"\n"\'@SUM(A1:A2)"\n"\'-cmd|\' /C calc\'!A0"\n"-72.4"',
    );
  });

  it("catches leading control characters before formula markers", () => {
    const csv = serializeCsv([{ value: '\t=HYPERLINK("https://evil.example")' }], {
      id: "security-csv",
      version: 1,
      columns: [{ key: "value", value: (row) => row.value }],
    });

    expect(csv).toContain('"\'\t=HYPERLINK(""https://evil.example"")"');
  });
});
