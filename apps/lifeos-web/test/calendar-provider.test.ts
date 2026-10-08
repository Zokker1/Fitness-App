// T137: CalendarProvider-adapterirajan smoke-testi.
// Oletusadapteri ei tee verkko-/OAuth-kutsuja eikä vuoda providerin virhettä
// domainiin; kaikki operaatiot päättyvät eksplisiittiseen unsupported-tilaan.
import { describe, expect, it } from "vitest";
import { createUnavailableCalendarProvider } from "../src/adapters/index.ts";

describe("CalendarProvider adapter boundary (T137)", () => {
  it("oletusadapteri pitää ulkoisen kalenterin pois local-first-polusta", async () => {
    const provider = createUnavailableCalendarProvider();
    const results = await Promise.all([
      provider.listCalendars(),
      provider.listEvents({
        calendarId: "external-calendar",
        fromUtc: "2026-09-21T00:00:00.000Z",
        toUtc: "2026-09-22T00:00:00.000Z",
      }),
      provider.createEvent("external-calendar", {
        title: "Ulkoinen",
        startsAtUtc: "2026-09-21T09:00:00.000Z",
        endsAtUtc: "2026-09-21T10:00:00.000Z",
      }),
      provider.updateEvent("external-calendar", "event-1", {}, "revision-1"),
      provider.deleteEvent("external-calendar", "event-1", "revision-1"),
    ]);

    expect(provider.providerId).toBe("unavailable");
    expect(results.every((result) => !result.ok)).toBe(true);
    expect(results.map((result) => (result.ok ? null : result.error.code))).toEqual([
      "unsupported",
      "unsupported",
      "unsupported",
      "unsupported",
      "unsupported",
    ]);
  });
});
