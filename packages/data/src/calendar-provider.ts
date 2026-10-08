// T137: ulkoisen kalenterin provider-portti.
// Tämä moduuli ei tunne CalendarBlockia, Taskia, repositoryja, selainta tai
// palveluntarjoajan HTTP/OAuth-mallia. Adapteri muuntaa oman API-mallinsa
// näihin provider-neutraaleihin DTO:ihin ennen kuin raja ylitetään.

export type CalendarProviderErrorCode =
  | "unsupported"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "rate-limited"
  | "invalid-input"
  | "transient-failure";

export interface CalendarProviderError {
  readonly code: CalendarProviderErrorCode;
  /** Käyttäjälle näytettävä viesti ilman providerin raakaa virherakennetta. */
  readonly userMessage: string;
  /** Adapterin diagnostiikkakoodi; ei tokeneita, event-sisältöä tai PII:tä. */
  readonly diagnosticCode: string;
  /** Valinnainen palveluntarjoajan antama retry-ikkuna sekunteina. */
  readonly retryAfterSeconds?: number;
}

export type CalendarProviderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: CalendarProviderError };

/** Ulkoisen providerin kalenterin opaque-tunniste ja käyttäjänimi. */
export interface CalendarProviderCalendar {
  readonly id: string;
  readonly name: string;
  readonly readOnly: boolean;
}

/** Puolikas avoin UTC-aikaväli, [fromUtc, toUtc). */
export interface CalendarProviderEventRange {
  readonly calendarId: string;
  readonly fromUtc: string;
  readonly toUtc: string;
}

/** Provider-neutraali ulkoinen tapahtuma; ei paikallisen domainin entity. */
export interface CalendarProviderEvent {
  readonly id: string;
  readonly calendarId: string;
  readonly title: string;
  readonly startsAtUtc: string;
  readonly endsAtUtc: string;
  readonly description: string | null;
  readonly location: string | null;
  readonly updatedAtUtc: string | null;
  /** Opaque etag/version providerin optimistic concurrency -tarkistukseen. */
  readonly revision: string | null;
}

export interface CalendarProviderEventInput {
  readonly title: string;
  readonly startsAtUtc: string;
  readonly endsAtUtc: string;
  readonly description?: string | null;
  readonly location?: string | null;
}

export interface CalendarProviderEventPatch {
  readonly title?: string;
  readonly startsAtUtc?: string;
  readonly endsAtUtc?: string;
  readonly description?: string | null;
  readonly location?: string | null;
}

/**
 * Ulkoisen kalenterin portti.
 *
 * Adapteri omistaa autentikoinnin, HTTP:n, providerin sivutusmallin,
 * provider-id:t ja event-id:t. Paikallinen CalendarBlock-linkitys,
 * repository-kirjoitukset ja sync/conflict-päätökset jäävät tämän portin
 * ulkopuolelle kutsujan erilliseen orchestration-kerrokseen.
 */
export interface CalendarProvider {
  readonly providerId: string;
  readonly displayName: string;
  listCalendars(): Promise<CalendarProviderResult<readonly CalendarProviderCalendar[]>>;
  listEvents(
    range: CalendarProviderEventRange,
  ): Promise<CalendarProviderResult<readonly CalendarProviderEvent[]>>;
  createEvent(
    calendarId: string,
    input: CalendarProviderEventInput,
  ): Promise<CalendarProviderResult<CalendarProviderEvent>>;
  updateEvent(
    calendarId: string,
    eventId: string,
    patch: CalendarProviderEventPatch,
    revision: string | null,
  ): Promise<CalendarProviderResult<CalendarProviderEvent>>;
  deleteEvent(
    calendarId: string,
    eventId: string,
    revision: string | null,
  ): Promise<CalendarProviderResult<boolean>>;
}
