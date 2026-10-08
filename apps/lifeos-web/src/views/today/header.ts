import { getIntlLocale } from "../../language.tsx";
// T081: Today-headerin puhat apurit (ei IO:ta, ei Reactia — testattavat).
// - formatTodayDate: pitkä suomenkielinen päivämäärä paikallisessa
//   aikavyöhykkeessä (offset siirretään hetkeen, Intl lukkee UTC-kentät —
//   deterministinen testeissäkin).
// - greetingForPhase: hillitty tervehdys projektion phase-mukaan.
// - syncIndicator: tallennus-/offline-tila yhdelle riville (§4: sync/offline-
//   indikaattori); tone kertoo värin (ei pelkkä teksti, §31).

export type SyncTone = "ok" | "varoitus" | "offline";

export interface SyncIndicator {
  readonly label: string;
  readonly tone: SyncTone;
}

export function formatTodayDate(nowIso: string, timezoneOffsetMinutes: number): string {
  const shifted = Date.parse(nowIso) + timezoneOffsetMinutes * 60_000;
  return new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(shifted));
}

export function greetingForPhase(phase: "aamu" | "paiva" | "ilta" | "yo"): string {
  switch (phase) {
    case "aamu":
      return "Hyvää huomenta";
    case "paiva":
      return "Hyvää päivää";
    case "ilta":
      return "Hyvää iltaa";
    case "yo":
      return "Yö jatkuu";
  }
}

export function syncIndicator(online: boolean, backend: string): SyncIndicator {
  if (!online) {
    return { label: "Offline — toimii ilman verkkoa", tone: "offline" };
  }
  if (backend === "memory") {
    return { label: "Välimuistissa", tone: "varoitus" };
  }
  return { label: "Tallennettu laitteella", tone: "ok" };
}
