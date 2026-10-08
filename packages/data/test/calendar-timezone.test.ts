import { describe, expect, it } from "vitest";
import { timezoneOffsetMinutesAtInstant, timezoneOffsetMinutesAtLocalDateTime } from "@lifeos/data";

describe("calendar timezone offset (T133)", () => {
  it("resolves the Helsinki offset from the date instead of now", () => {
    expect(timezoneOffsetMinutesAtLocalDateTime("2026-01-15", "10:00", "Europe/Helsinki")).toBe(
      120,
    );
    expect(timezoneOffsetMinutesAtLocalDateTime("2026-07-01", "10:00", "Europe/Helsinki")).toBe(
      180,
    );
  });

  it("resolves an instant offset on both sides of the seasonal change", () => {
    expect(timezoneOffsetMinutesAtInstant("2026-01-15T08:00:00.000Z", "Europe/Helsinki")).toBe(120);
    expect(timezoneOffsetMinutesAtInstant("2026-07-01T07:00:00.000Z", "Europe/Helsinki")).toBe(180);
  });
});
