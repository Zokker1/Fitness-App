// T133: aikavyöhykkeen offset ratkaistaan kyseisestä päivämäärästä ja
// hetkestä. Nykyhetken offset ei päde toisella vuodenajalla.

function dateTimePartsAtInstant(
  instantMillis: number,
  timeZone: string,
): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
} | null {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instantMillis));
  const values = new Map(parts.map((part) => [part.type, part.value]));
  const year = Number(values.get("year"));
  const month = Number(values.get("month"));
  const day = Number(values.get("day"));
  const hour = Number(values.get("hour"));
  const minute = Number(values.get("minute"));
  const second = Number(values.get("second"));
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

/** Offset minuutteina annetulla UTC-hetkellä (esim. Helsinki +120/+180). */
export function timezoneOffsetMinutesAtInstant(
  instantIso: string,
  timeZone: string,
): number | null {
  const instantMillis = Date.parse(instantIso);
  if (Number.isNaN(instantMillis) || timeZone.trim() === "") {
    return null;
  }
  const parts = dateTimePartsAtInstant(instantMillis, timeZone);
  if (parts === null) {
    return null;
  }
  const localAsUtcMillis = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((localAsUtcMillis - instantMillis) / 60_000);
}

/**
 * Offset paikalliselle päivälle ja kellonajalle.
 *
 * Iterointi ratkaisee ensin UTC-arvauksen ja käyttää sen jälkeen kyseisen
 * hetken todellista IANA-aikavyöhykeoffsetia. Tavallisilla paikallisajoilla
 * kaksi kierrosta riittää myös DST-vaihdoksen molemmin puolin.
 */
export function timezoneOffsetMinutesAtLocalDateTime(
  dateKey: string,
  time: string,
  timeZone: string,
): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null || dateMatch === null || timeZone.trim() === "") {
    return null;
  }
  const localAsUtcMillis = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(match[1]),
    Number(match[2]),
  );
  if (Number.isNaN(localAsUtcMillis)) {
    return null;
  }
  let candidate = localAsUtcMillis;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = timezoneOffsetMinutesAtInstant(new Date(candidate).toISOString(), timeZone);
    if (offset === null) {
      return null;
    }
    const next = localAsUtcMillis - offset * 60_000;
    if (next === candidate) {
      return offset;
    }
    candidate = next;
  }
  return timezoneOffsetMinutesAtInstant(new Date(candidate).toISOString(), timeZone);
}
