// T137: selainappin oletusadapteri ulkoisen kalenterin portille.
// Varsinaista Google/iCal-provideria ei ole vielä kytketty. Tämä adapteri
// palauttaa hallitun tuettomuuden eikä tee verkko-, OAuth- tai selainkutsuja.
import type { CalendarProvider, CalendarProviderError, CalendarProviderResult } from "@lifeos/data";

const unavailableError: CalendarProviderError = {
  code: "unsupported",
  userMessage: "Ulkoista kalenteria ei ole yhdistetty tässä versiossa.",
  diagnosticCode: "calendar-provider.unavailable",
};

function unavailable<T>(): Promise<CalendarProviderResult<T>> {
  return Promise.resolve({ ok: false, error: unavailableError });
}

/** Placeholder-adapteri pitää ulkoisen kalenterin poissa paikallisesta domainista. */
export function createUnavailableCalendarProvider(): CalendarProvider {
  return {
    providerId: "unavailable",
    displayName: "Ulkoinen kalenteri",
    listCalendars: () => unavailable(),
    listEvents: () => unavailable(),
    createEvent: () => unavailable(),
    updateEvent: () => unavailable(),
    deleteEvent: () => unavailable(),
  };
}
