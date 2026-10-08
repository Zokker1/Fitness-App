// T121: päiväkalenterin layout-malli (pure data-funktio, ei IO:taa).
// Kriteeri: "Tunnit, nykyhetki ja blockit näkyvät touch- ja
// mouse/keyboard-ystävällisesti responsiivisessa selaimessa." (§6)
// - Aikaikkuna: startHour..endHour (oletus 6–22); minuuttipohjaiset
//   prosenttipositiot → responsiivinen CSS (ei pikseleitä).
// - PÄÄLLEKKÄISYYDET NÄKYVÄT (§6): limittyvät blockit ryhmitetään
//   komponenteiksi ja jaetaan kaistoiksi (lane) start-ajan mukaan —
//   jokainen block näkyy, ei peittyviä.
// - Aikavyöhyke: blockin startsAt/endsAt muunnetaan paikallisminuuteiksi
//   kutsujan offsetilla (§50); alkupäivän yli jatkuva osa saa jatkua yli
//   keskiyön, mutta päiväruudukon näkyvä ikkuna rajaa sen tarvittaessa.
// - Nykyhetki: nowMinutes-parametri (paikalliset minuutit vuorokaudesta) —
//   näkymä ei arvaa kelloa (§50).
import type { CalendarBlock } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";

export interface DayBlockPosition {
  readonly block: CalendarBlock;
  /** Prosentti ikkunan yläreunasta (0–100). */
  readonly topPercent: number;
  /** Korkeus prosentteina (vähintään 1). */
  readonly heightPercent: number;
  /** Kaista päällekkäisyysryhmässä (0 = vasen). */
  readonly lane: number;
  /** Kaistojen lukumäärä ryhmässä (1 = ei päällekkäisyyttä). */
  readonly lanes: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface DayLayout {
  readonly startHour: number;
  readonly endHour: number;
  /** Ikkunan pituus minuutteina. */
  readonly totalMinutes: number;
  readonly blocks: readonly DayBlockPosition[];
  /** T130: tiivistetyt päällekkäisyysryhmät ("N lisää" -indikaattoreille). */
  readonly overflowGroups: readonly OverlapSummary[];
  /** Tuntirivit: aloitustunti..lopputunti-1 (label = "06", "07", …). */
  readonly hourTicks: readonly { readonly hour: number; readonly topPercent: number }[];
}

// T130: overlap-raja — tätä useamman samanaikaisen blockin ryhmää ei
// skaalata kapeammaksi (epäselvyysraja §6); ylijäävät kootaan
// "N lisää" -indikaattorin alle.
export const MAX_OVERLAP_LANES = 3;

export interface OverlapSummary {
  /** Kaistaryhmän tunniste (ryhmän aikaisin aloitushetki + jäsenten id:t). */
  readonly key: string;
  /** Ryhmän samanaikaisten blockkien määrä (kaikki, myös piilotetut). */
  readonly total: number;
  /** Näytettyjen blockkien määrä (<= MAX_OVERLAP_LANES). */
  readonly shown: number;
  /** Piilotettujen lukumäärä (0 = kaikki mahtuvat). */
  readonly hidden: number;
}

/** T130: tiivistä ryhmä max 3 kaistaan; palauta indikaattoritiedot. */
export function summarizeOverlap(group: readonly DayBlockPosition[]): {
  readonly lanes: readonly DayBlockPosition[];
  readonly summary: OverlapSummary;
} {
  const sorted = [...group].sort((a, b) => {
    if (a.startMinutes !== b.startMinutes) {
      return a.startMinutes < b.startMinutes ? -1 : 1;
    }
    if (a.endMinutes !== b.endMinutes) {
      return a.endMinutes < b.endMinutes ? -1 : 1;
    }
    return a.block.id < b.block.id ? -1 : 1;
  });
  const key = sorted
    .map((position) => `${position.block.id}@${String(position.startMinutes)}`)
    .join("|");
  if (sorted.length <= MAX_OVERLAP_LANES) {
    return {
      lanes: sorted.map((position, index) => ({
        ...position,
        lane: index,
        lanes: sorted.length,
      })),
      summary: { key, total: sorted.length, shown: sorted.length, hidden: 0 },
    };
  }
  const shown = sorted.slice(0, MAX_OVERLAP_LANES);
  return {
    lanes: shown.map((position, index) => ({
      ...position,
      lane: index,
      lanes: MAX_OVERLAP_LANES,
    })),
    summary: {
      key,
      total: sorted.length,
      shown: MAX_OVERLAP_LANES,
      hidden: sorted.length - MAX_OVERLAP_LANES,
    },
  };
}

function minutesOfDayUtc(utc: string, timezoneOffsetMinutes: number): number | null {
  const millis = Date.parse(utc);
  if (Number.isNaN(millis)) {
    return null;
  }
  const shifted = new Date(millis + timezoneOffsetMinutes * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function sameLocalDate(utc: string, dateKey: string, timezoneOffsetMinutes: number): boolean {
  return toLocalDateKey(utc, timezoneOffsetMinutes) === dateKey;
}

function localDayDistance(fromDateKey: string, toDateKey: string): number | null {
  const fromMillis = Date.parse(`${fromDateKey}T00:00:00Z`);
  const toMillis = Date.parse(`${toDateKey}T00:00:00Z`);
  if (Number.isNaN(fromMillis) || Number.isNaN(toMillis)) {
    return null;
  }
  return Math.round((toMillis - fromMillis) / 86_400_000);
}

export function layoutDayBlocks(input: {
  readonly blocks: readonly CalendarBlock[];
  readonly dateKey: string;
  readonly timezoneOffsetMinutes: number;
  readonly startHour?: number;
  readonly endHour?: number;
  readonly nowMinutes?: number | null;
  /** T130: laajennettujen ylijäämäryhmien avaimet — kaikki jäsenet näkyvät. */
  readonly expandedGroupKeys?: readonly string[];
}): DayLayout {
  const startHour = input.startHour ?? 6;
  const endHour = input.endHour ?? 22;
  const totalMinutes = Math.max(60, (endHour - startHour) * 60);
  const windowStart = startHour * 60;
  const positions: DayBlockPosition[] = [];

  interface Candidate {
    readonly block: CalendarBlock;
    readonly startMin: number;
    readonly endMin: number;
  }
  const candidates: Candidate[] = [];
  for (const block of input.blocks) {
    if (block.deletedAt !== null) {
      continue;
    }
    if (!sameLocalDate(block.startsAt, input.dateKey, input.timezoneOffsetMinutes)) {
      continue;
    }
    const startsAtMillis = Date.parse(block.startsAt);
    const endsAtMillis = Date.parse(block.endsAt);
    if (
      Number.isNaN(startsAtMillis) ||
      Number.isNaN(endsAtMillis) ||
      endsAtMillis <= startsAtMillis
    ) {
      continue;
    }
    const startMinutes = minutesOfDayUtc(block.startsAt, input.timezoneOffsetMinutes);
    const endMinutesRaw = minutesOfDayUtc(block.endsAt, input.timezoneOffsetMinutes);
    const endDateKey = toLocalDateKey(block.endsAt, input.timezoneOffsetMinutes);
    const daySpan = localDayDistance(input.dateKey, endDateKey);
    if (startMinutes === null || endMinutesRaw === null || daySpan === null || daySpan < 0) {
      continue;
    }
    const endMinutes = endMinutesRaw + daySpan * 24 * 60;
    if (endMinutes <= startMinutes) {
      continue;
    }
    candidates.push({
      block,
      startMin: startMinutes,
      endMin: Math.max(endMinutes, startMinutes + 15),
    });
  }
  // Järjestys alkamisajan mukaan (kaistanjakokin vaatii järjestyksen).
  candidates.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  // Päällekkäisyysryhmät: ketjutettu komponentti (start < edellinen end).
  interface Group {
    readonly members: Candidate[];
  }
  const groups: Group[] = [];
  let current: Candidate[] = [];
  let currentEnd = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    if (current.length > 0 && candidate.startMin >= currentEnd) {
      groups.push({ members: current });
      current = [];
      currentEnd = Number.NEGATIVE_INFINITY;
    }
    current.push(candidate);
    currentEnd = Math.max(currentEnd, candidate.endMin);
  }
  if (current.length > 0) {
    groups.push({ members: current });
  }

  const overflowGroups: OverlapSummary[] = [];
  for (const group of groups) {
    // Ahne kaistanjako: jokainen block kaistalle jonka edellinen on jo
    // päättynyt; kaistoja = max samanaikaisuus ryhmässä.
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const member of group.members) {
      let lane = laneEnds.findIndex((end) => end <= member.startMin);
      if (lane === -1) {
        laneEnds.push(member.endMin);
        lane = laneEnds.length - 1;
      } else {
        laneEnds[lane] = member.endMin;
      }
      laneOf.set(member.block.id, lane);
    }
    const lanes = laneEnds.length;
    // T130: yli MAX_OVERLAP_LANES kaistan ryhmät tiivistetään — kaistat
    // numeroituu uudelleen 0..2 ja ylijäävät kootaan indikaattorin alle.
    // Laajennettu ryhmä (indikaattorin "Piilota") näyttää KAIKKI jäsenet
    // täydellä kaistamäärällä (kapeampi mutta ei peittyvä, §6).
    const expandedKeys = input.expandedGroupKeys ?? [];
    const laneOverrides = new Map<string, number>();
    let visibleLanes = lanes;
    let visibleIds: ReadonlySet<string> | null = null;
    if (lanes > MAX_OVERLAP_LANES) {
      const summarized = summarizeOverlap(
        group.members.map((member) => ({
          block: member.block,
          topPercent: 0,
          heightPercent: 1,
          lane: 0,
          lanes,
          startMinutes: member.startMin,
          endMinutes: member.endMin,
        })),
      );
      overflowGroups.push(summarized.summary);
      if (!expandedKeys.includes(summarized.summary.key)) {
        visibleLanes = MAX_OVERLAP_LANES;
        visibleIds = new Set(summarized.lanes.map((lane) => lane.block.id));
        for (const lane of summarized.lanes) {
          laneOverrides.set(lane.block.id, lane.lane);
        }
      }
    }
    for (const member of group.members) {
      if (visibleIds !== null && !visibleIds.has(member.block.id)) {
        continue;
      }
      const clampedStart = Math.max(member.startMin, windowStart);
      const clampedEnd = Math.min(member.endMin, windowStart + totalMinutes);
      if (clampedEnd <= clampedStart) {
        continue;
      }
      const topPercent = ((clampedStart - windowStart) / totalMinutes) * 100;
      const heightPercent = Math.max(1, ((clampedEnd - clampedStart) / totalMinutes) * 100);
      positions.push({
        block: member.block,
        topPercent,
        heightPercent,
        lane: laneOverrides.get(member.block.id) ?? laneOf.get(member.block.id) ?? 0,
        lanes: visibleLanes,
        startMinutes: member.startMin,
        endMinutes: member.endMin,
      });
    }
  }

  const hourTicks: { hour: number; topPercent: number }[] = [];
  for (let hour = startHour; hour < endHour; hour += 1) {
    hourTicks.push({
      hour,
      topPercent: ((hour * 60 - windowStart) / totalMinutes) * 100,
    });
  }

  return { startHour, endHour, totalMinutes, blocks: positions, overflowGroups, hourTicks };
}

/** Nykyhetken minuutit paikallisena vuorokaudenaikana (null epävalidillä). */
export function nowMinutesLocal(nowIso: string, timezoneOffsetMinutes: number): number | null {
  return minutesOfDayUtc(nowIso, timezoneOffsetMinutes);
}

// T128: blockin siirto ajassa (drag) — molemmat reunat siirtyvät samalla
// deltalla; UTC-matematiikkaa, ei paikallisavainarvailua. Epävalidi blockki
// tai ei-kokonainen delta → null. Clampaus (ikkuna/min-kesto) on UI:n
// vastuulla (näkymä tietää ikkunan).
export function shiftBlockUtc(
  block: CalendarBlock,
  deltaMinutes: number,
): { readonly startsAt: string; readonly endsAt: string } | null {
  if (!Number.isInteger(deltaMinutes)) {
    return null;
  }
  const startMillis = Date.parse(block.startsAt);
  const endMillis = Date.parse(block.endsAt);
  if (Number.isNaN(startMillis) || Number.isNaN(endMillis) || endMillis <= startMillis) {
    return null;
  }
  return {
    startsAt: new Date(startMillis + deltaMinutes * 60_000).toISOString(),
    endsAt: new Date(endMillis + deltaMinutes * 60_000).toISOString(),
  };
}

// T122: päiväkohtaisen viikko-/kuukausinäkymän leikkaus — elävät blockit
// joiden alku osuu paikallispäivään, aloitusajan mukaan (deterministinen).
export function blocksOnDay(
  blocks: readonly CalendarBlock[],
  dateKey: string,
  timezoneOffsetMinutes: number,
): readonly CalendarBlock[] {
  return [...blocks]
    .filter(
      (block) =>
        block.deletedAt === null && sameLocalDate(block.startsAt, dateKey, timezoneOffsetMinutes),
    )
    .sort((a, b) => {
      if (a.startsAt === b.startsAt) {
        return 0;
      }
      return a.startsAt < b.startsAt ? -1 : 1;
    });
}

/** "HH:MM" + kesto minuutteina → UTC-hetket (§50; sama kaava kuin T109). */
export function blockUtcFromLocal(
  dateKey: string,
  startTime: string,
  durationMinutes: number,
  timezoneOffsetMinutes: number,
): { readonly startsAt: string; readonly endsAt: string } | null {
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(startTime);
  const year = Number(dateKey.slice(0, 4));
  const monthIndex = Number(dateKey.slice(5, 7)) - 1;
  const day = Number(dateKey.slice(8, 10));
  if (
    timeMatch === null ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 5 ||
    Number.isNaN(Date.parse(`${dateKey}T00:00:00Z`))
  ) {
    return null;
  }
  const startUtc =
    Date.UTC(year, monthIndex, day, Number(timeMatch[1]), Number(timeMatch[2])) -
    timezoneOffsetMinutes * 60_000;
  return {
    startsAt: new Date(startUtc).toISOString(),
    endsAt: new Date(startUtc + durationMinutes * 60_000).toISOString(),
  };
}
