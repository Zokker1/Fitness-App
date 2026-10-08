// T086: health summary -kooste (pure data-funktio, ei IO:ta).
// Kriteeri: käyttäjän AKTIVOIMAT terveysluvut näkyvät MINIMIDATALLA.
// "Aktivoitu" = käyttäjällä on vähintään yksi rivi kyseistä lajia (ei
// erillistä asetuskytkintä vielä — B13 tuo hienosäädön; tyhjät lajit eivät
// tuota rivejä, UI näyttää yhden tyhjätilan).
// Terveysneutraalius (periaate 4, §52): ei diagnooseja, ei hälytyksiä —
// rivit ovat neutraaleja toteamuksia ("Uni 7 h 30 min", "Mieliala 4/5").
// Yksiköt tulevat datasta (unit-kenttä), eivät kovakoodista.
//
// RIVIT (vain kun dataa on): uni (viimeisin päättyneistä, kesto + laatu),
// mieliala (viimeisin check-in), lisäravinteet (ottamatta tänään / kaikki
// otettu), neste (päivän ml). Paino kulkee jo projektion latestWeightinä
// (T080) — tätä korttia varten ei tarvita.
//
// Huom: sleepEnd puuttuu kesken olevasta unesta — vain PÄÄTTYNEET unet
// lasketaan (kesken oleva uni ei ole "viimeisin uni").
import type {
  HydrationEntry,
  MoodCheckin,
  SleepEntry,
  Supplement,
  SupplementLog,
  UtcTimestamp,
} from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import { summarizeHydrationDay } from "./hydration-service.ts";
import { getSupplementLogActivityAt, getSupplementLogStatus } from "./supplement-log-service.ts";

export interface TodayHealthRow {
  readonly label: string;
  readonly value: string;
}

export interface TodayHealthSummary {
  readonly rows: readonly TodayHealthRow[];
}

export interface TodayHealthInput {
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
  readonly now?: UtcTimestamp | undefined;
  readonly hydrationTargetMl?: number | null | undefined;
  readonly sleepEntries: readonly SleepEntry[];
  readonly moodCheckins: readonly MoodCheckin[];
  readonly supplements: readonly Supplement[];
  readonly supplementLogs: readonly SupplementLog[];
  readonly hydrationEntries: readonly HydrationEntry[];
}

function isAlive(deletedAt: UtcTimestamp | null): boolean {
  return deletedAt === null;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) {
    return `${String(rest)} min`;
  }
  if (rest === 0) {
    return `${String(hours)} h`;
  }
  return `${String(hours)} h ${String(rest)} min`;
}

/**
 * Kokoaa terveysrivilistan. Vain lajit joissa dataa — tyhjä lista tarkoittaa
 * ettei käyttäjä ole aktivoinut yhtäkään (UI: yksi tyhjätila).
 */
export function summarizeTodayHealth(input: TodayHealthInput): TodayHealthSummary {
  const rows: TodayHealthRow[] = [];

  // Uni: viimeisin päättynyt (sleepEnd <= nyt implisiittisesti: end olemassa
  // ja alku ennen loppua; kesken olevia ei mallinneta erikseen).
  const finishedSleep = input.sleepEntries
    .filter((entry) => isAlive(entry.deletedAt) && entry.sleepEnd >= entry.sleepStart)
    .sort((a, b) => (a.sleepEnd < b.sleepEnd ? 1 : -1));
  const latest = finishedSleep[0];
  if (latest !== undefined) {
    const minutes = Math.round(
      (Date.parse(latest.sleepEnd) - Date.parse(latest.sleepStart)) / 60_000,
    );
    rows.push({
      label: "Uni",
      value:
        latest.quality === null
          ? formatDuration(minutes)
          : `${formatDuration(minutes)}, laatu ${String(latest.quality)}/5`,
    });
  }

  // Mieliala: viimeisin check-in (checkedAt-järjestyksessä).
  const latestMood = [...input.moodCheckins].sort((a, b) =>
    a.checkedAt < b.checkedAt ? 1 : -1,
  )[0];
  if (latestMood !== undefined) {
    rows.push({
      label: "Mieliala",
      value:
        latestMood.energy === null
          ? `${String(latestMood.mood)}/5`
          : `${String(latestMood.mood)}/5, energia ${String(latestMood.energy)}/5`,
    });
  }

  // Lisäravinteet: paikallispäivän lokit näytetään kirjattuine tiloineen.
  const active = input.supplements.filter((supplement) => isAlive(supplement.deletedAt));
  if (active.length > 0) {
    const dailyLogs = input.supplementLogs.filter(
      (log) =>
        active.some((supplement) => supplement.id === log.supplementId) &&
        toLocalDateKey(getSupplementLogActivityAt(log), input.timezoneOffsetMinutes) ===
          input.localDate,
    );
    const hasExplicitStatus = dailyLogs.some((log) => log.status !== undefined);
    if (!hasExplicitStatus) {
      const takenIds = new Set(dailyLogs.map((log) => log.supplementId));
      const missing = active.filter((supplement) => !takenIds.has(supplement.id));
      rows.push({
        label: "Lisäravinteet",
        value:
          missing.length === 0
            ? "Kaikki otettu tänään"
            : `Ottamatta: ${missing.map((supplement) => supplement.name).join(", ")}`,
      });
    } else {
      const namesFor = (status: "taken" | "skipped" | "pending"): string => {
        const ids = new Set(
          dailyLogs
            .filter((log) => getSupplementLogStatus(log) === status)
            .map((log) => log.supplementId),
        );
        return active
          .filter((supplement) => ids.has(supplement.id))
          .map((supplement) => supplement.name)
          .join(", ");
      };
      const loggedIds = new Set(dailyLogs.map((log) => log.supplementId));
      const unlogged = active
        .filter((supplement) => !loggedIds.has(supplement.id))
        .map((supplement) => supplement.name)
        .join(", ");
      const statusLabels = [
        namesFor("taken") ? `Otettu: ${namesFor("taken")}` : "",
        namesFor("skipped") ? `Ohitettu: ${namesFor("skipped")}` : "",
        namesFor("pending") ? `Odottaa: ${namesFor("pending")}` : "",
        unlogged ? `Ei kirjattu: ${unlogged}` : "",
      ].filter((value) => value.length > 0);
      rows.push({
        label: "Lisäravinteet",
        value: statusLabels.join(" · "),
      });
    }
  }

  // Neste: päivän millilitrat (vain jos kirjauksia tänään).
  const hydrationToday = summarizeHydrationDay({
    entries: input.hydrationEntries,
    localDate: input.localDate,
    timezoneOffsetMinutes: input.timezoneOffsetMinutes,
    targetMilliliters: input.hydrationTargetMl,
    ...(input.now !== undefined ? { now: input.now } : {}),
  });
  if (hydrationToday.milliliters > 0 || hydrationToday.targetMilliliters !== null) {
    const targetLabel =
      hydrationToday.targetMilliliters === null
        ? ""
        : ` / ${String(hydrationToday.targetMilliliters)} ml (${String(hydrationToday.progressPercent)} %)`;
    rows.push({
      label: "Neste",
      value: `${String(hydrationToday.milliliters)} ml tänään${targetLabel}`,
    });
  }

  return { rows };
}
