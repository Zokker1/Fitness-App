// T286: kellonaikaan sidottu esiintymä ratkaistaan aktiivisessa IANA-vyöhykkeessä.

export interface LocalReminderTime {
  readonly date: string;
  readonly time: string;
  readonly timezoneOffsetMinutes: number;
  readonly timeZone: string;
}

interface ZonedDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const DST_GAP_MAXIMUM_MINUTES = 180;

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached !== undefined) return cached;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    calendar: "iso8601",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  formatters.set(timeZone, formatter);
  return formatter;
}

function partsAt(instantMillis: number, timeZone: string): ZonedDateTimeParts | null {
  if (!Number.isFinite(instantMillis)) return null;
  try {
    const parts = getFormatter(timeZone).formatToParts(new Date(instantMillis));
    const values = new Map(parts.map((part) => [part.type, part.value]));
    const year = Number(values.get("year"));
    const month = Number(values.get("month"));
    const day = Number(values.get("day"));
    const hour = Number(values.get("hour"));
    const minute = Number(values.get("minute"));
    const second = Number(values.get("second"));
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function partsToWallClockMillis(parts: ZonedDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function formatDate(parts: ZonedDateTimeParts): string {
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function formatTime(parts: ZonedDateTimeParts): string {
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

/** Aikavyöhyke tarkistetaan joka kerta, jotta järjestelmän vyöhykkeen vaihto huomioituu. */
export function currentLocalReminderTime(now: Date): LocalReminderTime {
  let timeZone = "UTC";
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof detected === "string" && detected.trim().length > 0) {
      getFormatter(detected);
      timeZone = detected;
    }
  } catch {
    // UTC on deterministinen varavyöhyke, jos ympäristö ei tarjoa IANA-aikavyöhykettä.
  }

  const parts = partsAt(now.getTime(), timeZone);
  if (parts === null) {
    const iso = now.toISOString();
    return {
      date: iso.slice(0, 10),
      time: `${iso.slice(11, 13)}:${iso.slice(14, 16)}`,
      timezoneOffsetMinutes: 0,
      timeZone: "UTC",
    };
  }
  const wallClockMillis = partsToWallClockMillis(parts);
  return {
    date: formatDate(parts),
    time: formatTime(parts),
    timezoneOffsetMinutes: Math.round(
      (wallClockMillis - Math.floor(now.getTime() / 1000) * 1000) / 60_000,
    ),
    timeZone,
  };
}

/**
 * Muuntaa kelluvan paikallisajan UTC-hetkeksi. Päällekkäisessä DST-tunnissa
 * valitaan ensimmäinen esiintymä. DST-aukon läpi siirretään minuuttiosuus
 * eteenpäin (esim. 03:30 → 04:30); yli kolmen tunnin aukot ohitetaan.
 */
export function resolveLocalReminderOccurrence(
  localDate: string,
  localTime: string,
  timeZone: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime);
  if (dateMatch === null || timeMatch === null) return null;
  const wallClockMillis = Date.UTC(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
  );
  const checkedDate = new Date(wallClockMillis);
  if (
    checkedDate.toISOString().slice(0, 10) !== localDate ||
    `${String(checkedDate.getUTCHours()).padStart(2, "0")}:${String(checkedDate.getUTCMinutes()).padStart(2, "0")}` !==
      localTime
  ) {
    return null;
  }

  const offsets = new Set<number>();
  for (const offsetProbe of [-36, 0, 36]) {
    const parts = partsAt(wallClockMillis + offsetProbe * 60 * 60_000, timeZone);
    if (parts === null) return null;
    const offsetMinutes = Math.round(
      (partsToWallClockMillis(parts) - (wallClockMillis + offsetProbe * 60 * 60_000)) / 60_000,
    );
    offsets.add(offsetMinutes);
  }

  const exactMatches: number[] = [];
  const forwardMatches: { readonly millis: number; readonly deltaMinutes: number }[] = [];
  for (const offsetMinutes of offsets) {
    const candidate = wallClockMillis - offsetMinutes * 60_000;
    const actualParts = partsAt(candidate, timeZone);
    if (actualParts === null) return null;
    const deltaMinutes = Math.round(
      (partsToWallClockMillis(actualParts) - wallClockMillis) / 60_000,
    );
    if (deltaMinutes === 0) exactMatches.push(candidate);
    else if (deltaMinutes > 0 && deltaMinutes <= DST_GAP_MAXIMUM_MINUTES) {
      forwardMatches.push({ millis: candidate, deltaMinutes });
    }
  }

  if (exactMatches.length > 0) return new Date(Math.min(...exactMatches)).toISOString();
  const firstAfterGap = [...forwardMatches].sort(
    (left, right) => left.deltaMinutes - right.deltaMinutes || left.millis - right.millis,
  )[0];
  return firstAfterGap === undefined ? null : new Date(firstAfterGap.millis).toISOString();
}
