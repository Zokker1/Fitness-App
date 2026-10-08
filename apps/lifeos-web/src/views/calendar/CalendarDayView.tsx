// T121: päiväkalenteri (§6). Kriteeri: tunnit, nykyhetki ja blockit näkyvät
// touch- ja mouse/keyboard-ystävällisesti responsiivisessa selaimessa.
// - Aikamalli: layoutDayBlocks (T121, pure) — prosenttipositiot →
//   responsiivinen CSS; päällekkäisyydet jaetaan kaistoiksi (näkyvät).
// - Nykyhetki: viiva + aikaleima vain katsotulla päivällä; päivittyy
//   minuutin välein.
// - Navigointi: ?date=<YYYY-MM-DD> (Edellinen/Tänään/Seuraava) — SPA,
//   jaettava linkki (§27).
// - Timeboxin luonti: otsikko + aloitusaika + kesto (+ valinnainen
//   tehtävälinkitys §6) → calendarBlocks-repo (kind "event"/"task").
// - Näppäimistö: blockit ovat nappiruutuja (Tab + Enter); kaikki toiminnot
//   napeilla (§31). Tuntirivit ovat display-kohteita (aria-hidden).
// T131: unscheduled-paneeli (§6: tehtävä voidaan vetää ajalle).
// - Ajastamattomat avoimet tehtävät (selectUnscheduledTasks: ei elävää
//   blockki-linkkiä) listataan päivänäkymässä; veto tunnille (HTML5-DnD,
//   text/lifeos-task-id) tai Ajasta-nappi luo kind:"task"-blockin
//   pudotustunnille (snap 15 min §8) — tehtävän data pysyy tasks-repossa
//   (T125-kaava, ei duplikaattia); mobiilissa Ajasta-nappi (§31).
// T122: näkymän valinta (päivä/viikko SegmentedControl; URL day/week).
// - Päivä: T121 DayGrid (tunnit, nykyhetki, blockit);
// - Viikko: WeekSummary-komposiitti (kaistat skaalautuvat; keskittymistilassa
//   tyhjät päivät piilotetaan mobiililla CSS:llä, sisältö SR:ää varten).
// T135: desktop-oikotiet (←/→ siirtymä, T = tänään, N = uusi timebox),
//   vain ei-editointikontekstissa ja ilman modifier-yhdistelmiä.
import { t, tOptions, tTemplate, getIntlLocale, useLanguage } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Display,
  EmptyState,
  Input,
  Meta,
  SegmentedControl,
  Select,
  Skeleton,
  TimePicker,
} from "@lifeos/ui";
import type { CalendarBlock, Project, Routine, Tag, Task } from "@lifeos/domain";
import {
  addDaysIso,
  blockUtcFromLocal,
  buildCalendarModel,
  filterCalendarBlocks,
  hasCalendarBlockFilters,
  layoutDayBlocks,
  beginFocusSession,
  nowMinutesLocal,
  selectUnscheduledTasks,
  shiftBlockUtc,
  startFocusSession,
  systemClock,
  timezoneOffsetMinutesAtLocalDateTime,
} from "@lifeos/data";
import { toLocalDateKey } from "@lifeos/domain";
import { useData } from "../../dataContext.tsx";
import {
  MonthGrid,
  WeekGrid,
  WeekSummary,
  getWeekStartKey,
  monthBusyDaysOf,
  monthNameFi,
} from "./WeekSummary.tsx";

// T123: kuukauden siirto offset-laskennalla (ei dayjs-riippuvuutta —
// samaa UTC-avainaritmetiikkaa kuin muualla T120-mallissa).
function addMonthsIsoLocal(dateKey: string, months: number): string {
  const base = new Date(Date.parse(`${dateKey}T00:00:00Z`));
  const year = base.getUTCFullYear();
  const monthIndex = base.getUTCMonth() + months;
  const target = new Date(
    Date.UTC(Math.floor(monthIndex / 12) + year, ((monthIndex % 12) + 12) % 12, 1),
  );
  const days = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.min(base.getUTCDate(), days);
  target.setUTCDate(day);
  return target.toISOString().slice(0, 10);
}

const DAY_START_HOUR = 6;
const DAY_END_HOUR = 22;

function isValidDateKey(dateKey: string | null): dateKey is string {
  if (typeof dateKey !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return false;
  }
  const millis = Date.parse(`${dateKey}T00:00:00Z`);
  return !Number.isNaN(millis) && new Date(millis).toISOString().slice(0, 10) === dateKey;
}

function addDaysIsoLocal(dateKey: string, days: number): string {
  return addDaysIso(dateKey, days);
}

function localTodayKey(): string {
  const offset = -new Date().getTimezoneOffset();
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
}

function minutesToLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}.${String(rest).padStart(2, "0")}`;
}

function minutesToInputValue(minutes: number): string {
  const snapped = Math.max(
    DAY_START_HOUR * 60,
    Math.min(DAY_END_HOUR * 60 - 15, Math.round(minutes / 15) * 15),
  );
  const hours = Math.floor(snapped / 60);
  const rest = snapped % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function durationMinutesUtc(block: CalendarBlock): number | null {
  const startsAt = Date.parse(block.startsAt);
  const endsAt = Date.parse(block.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) {
    return null;
  }
  return Math.round((endsAt - startsAt) / 60_000);
}

function formatCalendarDateFi(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

function isCalendarShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function offsetForLocalTime(
  dateKey: string,
  time: string,
  timeZone: string,
  fallback: number,
): number {
  return (
    timezoneOffsetMinutesAtLocalDateTime(dateKey, time.replace(".", ":"), timeZone) ?? fallback
  );
}

function CalendarJumpPicker({
  dateKey,
  onDateChange,
}: {
  readonly dateKey: string;
  readonly onDateChange: (dateKey: string) => void;
}): React.JSX.Element {
  return (
    <DatePicker
      label={t("Siirry päivään")}
      value={dateKey}
      data-testid="calendar-date-picker"
      onChange={(event) => {
        const next = event.target.value;
        if (isValidDateKey(next)) {
          onDateChange(next);
        }
      }}
    />
  );
}

export function CalendarDayView(): React.JSX.Element {
  const { language } = useLanguage();
  const {
    calendarBlocks,
    tasks,
    routines: routinesRepo,
    projects: projectsRepo,
    tags: tagsRepo,
    focusSessions,
  } = useData();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const routeEditBlockId = useMemo(() => {
    const state: unknown = location.state;
    if (typeof state !== "object" || state === null) {
      return null;
    }
    const blockId = (state as Record<string, unknown>)["openBlockId"];
    return typeof blockId === "string" ? blockId : null;
  }, [location.state]);
  const dateParam = searchParams.get("date");
  const dateKey = isValidDateKey(dateParam) ? dateParam : localTodayKey();
  const todayKey = localTodayKey();
  const viewParam = searchParams.get("view");
  const view: "day" | "week" | "month" =
    viewParam === "week" || viewParam === "month" ? viewParam : "day";
  // Viikon ankkuri: näkymä on eksplisiittinen (?view=week) ja dateKey
  // valitsee viikon — drill-down ruudukosta (?view=week&date=) säilyttää
  // molemmat, jotta käyttäjä palaa siihen mistä tuli (ei oletusarvauksia
  // reitityksessä §27).
  // T122: vakio offset SEKÄ query-mallille ETTÄ renderille — yksi offset
  // per render, ei eri arvoja querylle ja layoutille (§50 kutsujan
  // maailmasta, samaan tapaan kuin T104).
  const timeZone = browserTimeZone();
  // T133: offset kuuluu katsottuun paikallispäivään. Nykyhetken offset
  // rikkoisi esimerkiksi tammikuun luontipolun kesäaikana.
  const timezoneOffsetMinutes =
    timezoneOffsetMinutesAtLocalDateTime(dateKey, "12:00", timeZone) ??
    -new Date().getTimezoneOffset();
  // T123: viikkosiirtymän malli — viikon alku T120-mallista (yksi lähde,
  // ei kahta aritmetiikkaa); monthModel rakentuu samasta mallista.
  const monthModel = buildCalendarModel({ view: "month", localDate: dateKey });
  // T123: kuukauden kiireisten päivien määrä — lasketaan vasta kun blockit
  // ovat ladattu (ks. useEffect alla); ei ennen hookien valmistumista.
  const monthName = monthNameFi(monthModel);

  const [blocks, setBlocks] = useState<readonly CalendarBlock[] | undefined>(undefined);
  const [openTasks, setOpenTasks] = useState<readonly Task[]>([]);
  // T125: kaikki elävät tehtävät — linkitetyn tehtävän otsikon lookupia
  // varten (yksi totuuden lähde tasks-repossa, ei kopiota blockiin).
  const [allTasks, setAllTasks] = useState<readonly Task[]>([]);
  // T126: elävät rutiinit — linkitysvalinta + otsikon lookup (sama kaava
  // kuin tehtävillä). Nimi vaihtuu kollision välttämiseksi.
  const [routineList, setRoutineList] = useState<readonly Routine[]>([]);
  // T136: suodatinvaihtoehdot pidetään erillään blockeista; valinta ei
  // koskaan muokkaa tai poista lähdedataa.
  const [projectList, setProjectList] = useState<readonly Project[]>([]);
  const [tagList, setTagList] = useState<readonly Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [duration, setDuration] = useState("60");
  const [linkedTaskId, setLinkedTaskId] = useState("");
  // T126: rutiinilinkitys — PÄÄLLEKKÄIN task-linkityksen kanssa ei saa olla:
  // blockki linkittyy joko tehtävään TAI rutiiniin (§6: yksi blockki = yksi
  // suunnitelma; toisen valinta tyhjentää toisen).
  const [linkedRoutineId, setLinkedRoutineId] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  // T125: linkitetyn tehtävän otsikko lookupilla (day grid + esitäyttö).
  const taskTitleById = useMemo(
    () => new Map(allTasks.map((task) => [task.id, task.title] as const)),
    [allTasks],
  );
  // T136: kaikki suodattimet ovat näkymän johdettu rajaus. Raw blocks säilyy
  // edelleen muokkausta, poistoa ja ajastamattomien tehtävien laskentaa varten.
  const [projectFilter, setProjectFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [routineFilter, setRoutineFilter] = useState("");
  const filterActive = hasCalendarBlockFilters({
    projectId: projectFilter,
    tagId: tagFilter,
    routineId: routineFilter,
  });
  const visibleBlocks = useMemo(
    () =>
      filterCalendarBlocks({
        blocks: blocks ?? [],
        tasks: allTasks,
        filters: {
          projectId: projectFilter,
          tagId: tagFilter,
          routineId: routineFilter,
        },
      }),
    [allTasks, blocks, projectFilter, routineFilter, tagFilter],
  );
  const projectFilterOptions = useMemo(
    () => [
      { value: "", label: "Kaikki projektit" },
      ...projectList
        .filter((project) => project.deletedAt === null)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, getIntlLocale(language)))
        .map((project) => ({ value: project.id, label: project.name })),
    ],
    [language, projectList],
  );
  const tagFilterOptions = useMemo(
    () => [
      { value: "", label: "Kaikki tagit" },
      ...tagList
        .filter((tag) => tag.deletedAt === null)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name, getIntlLocale(language)))
        .map((tag) => ({ value: tag.id, label: tag.name })),
    ],
    [language, tagList],
  );
  const routineFilterOptions = useMemo(
    () => [
      { value: "", label: "Kaikki rutiinit" },
      ...routineList
        .filter((routine) => routine.deletedAt === null)
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title, getIntlLocale(language)))
        .map((routine) => ({ value: routine.id, label: routine.title })),
    ],
    [language, routineList],
  );
  // T131: unscheduled-paneeli (§6: tehtävä voidaan vetää ajalle).
  // - Valinta on puhdas funktio: avoin + ei elävää blockki-linkkiä (ei
  //   duplikaattia — tehtävän data pysyy tasks-repossa, T125-kaava);
  // - Järjestys prioriteetti→createdAt (sama kuin T103 saman päivän sisällä);
  // - Lomakkeen keston oletus toimii myös pudotuksen kestona (ei arvailua —
  //   käyttäjän valitsema kesto, §21).
  const unscheduledTasks = useMemo(
    () => selectUnscheduledTasks({ tasks: allTasks, blocks: blocks ?? [] }),
    [allTasks, blocks],
  );
  // T131: vedettävän tehtävän id React-statessa dragstartista dropiin
  // (dataTransfer on suojattu dragoverissa — getData tyhjää; oikea
  // dragstart asettaa id:n, drop lukee sijainnin).
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  // T131 E2E-hookin ref — hook-nappi lukee pudotuksen attribuutit
  // suoraan DOM:ista klikissä (ei state-peilausta, ei observeria).
  const payloadRef = useCallback((_node: HTMLButtonElement | null): void => {}, []);
  // T131: pudotuskohdan esikatselu (tunti + kohde-aika) tuntiruudukon
  // dragoverista — sama snap kuin siirrossa (15 min, §8).
  const [dropPreview, setDropPreview] = useState<{
    readonly hour: number;
    readonly startMinutes: number;
  } | null>(null);
  // T131: vedä ajalle — luo blockin suoraan pudotustunnille pudotetun
  // tehtävän otsikolla + linkedTaskId (kind "task"). Tehtävä poistuu
  // paneelista automaattisesti (refresh päivittää valinnan). Ei navigointia
  // pois (§21).
  const scheduleUnscheduledTask = useCallback(
    async (taskId: string, startMinutes: number): Promise<void> => {
      const linked = unscheduledTasks.find((task) => task.id === taskId);
      if (linked === undefined) {
        return;
      }
      const rounded = Math.max(
        DAY_START_HOUR * 60,
        Math.min(DAY_END_HOUR * 60 - 15, Math.round(startMinutes / 15) * 15),
      );
      const label = `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
      const durationMinutes = Math.max(15, Number.parseInt(duration, 10) || 60);
      const utc = blockUtcFromLocal(
        dateKey,
        label,
        durationMinutes,
        offsetForLocalTime(dateKey, label, timeZone, timezoneOffsetMinutes),
      );
      if (utc === null) {
        setCreateError("Valitse kelvollinen aloitusaika ja kesto.");
        return;
      }
      setCreateError("");
      const created = await calendarBlocks.create({
        kind: "task",
        title: linked.title,
        startsAt: utc.startsAt,
        endsAt: utc.endsAt,
        linkedTaskId: linked.id,
        linkedRoutineId: null,
        deletedAt: null,
      });
      if (!created.ok) {
        setCreateError(created.error.userMessage);
        return;
      }
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    },
    [unscheduledTasks, dateKey, duration, calendarBlocks, timeZone, timezoneOffsetMinutes],
  );
  // T126: rutiinilinkityksen esitäyttö — linkitetyn rutiinin otsikko
  // lookupilla (sama kaava kuin tehtävillä).
  const routineTitleById = useMemo(
    () => new Map(routineList.map((routine) => [routine.id, routine.title] as const)),
    [routineList],
  );
  // T126: rutiinilinkityksen esitäyttö — kun rutiini valitaan ja nimi on
  // tyhjä, nimi täyttyy rutiinin otsikosta; task-linkitys tyhjentyy (yksi
  // blockki = yksi suunnitelma).
  const selectRoutine = useCallback(
    (nextId: string): void => {
      setLinkedRoutineId(nextId);
      if (nextId !== "") {
        setLinkedTaskId("");
        if (title.trim() === "") {
          const linked = routineList.find((routine) => routine.id === nextId);
          if (linked !== undefined) {
            setTitle(linked.title);
          }
        }
      }
    },
    [routineList, title],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const consumedRouteEditId = useRef<string | null>(null);
  const [working, setWorking] = useState(false);
  // T127: blockista käynnistetty focus-session (§6 — oikea sessio
  // startFocusSession-palvelulla, ei feikkiä).
  const [focusStarting, setFocusStarting] = useState(false);
  const [focusStartedId, setFocusStartedId] = useState<string | null>(null);
  // T128: tallenna vedon lopputulos (kutsutaan pudotuksessa) — laskee
  // snap-clammatun siirron shiftBlockUtc:llä ja persistoi update:lla.
  const finishBlockDrag = useCallback(
    async (dragState: {
      readonly id: string;
      readonly mode: "move" | "resize";
      readonly deltaMinutes: number;
    }): Promise<void> => {
      const block = (blocks ?? []).find((candidate) => candidate.id === dragState.id);
      if (block === undefined) {
        return;
      }
      const roundedDelta = Math.round(dragState.deltaMinutes / 15) * 15;
      if (roundedDelta === 0) {
        return;
      }
      const shifted = shiftBlockUtc(block, roundedDelta);
      if (shifted === null) {
        return;
      }
      // Clamp samaan päiväavaimeen (§50): siirto ei saa viedä blockkia pois
      // katsotusta päivästä (hallittu §6).
      if (toLocalDateKey(shifted.startsAt, timezoneOffsetMinutes) !== dateKey) {
        return;
      }
      const updated = await calendarBlocks.update(block.id, {
        startsAt: shifted.startsAt,
        endsAt: shifted.endsAt,
      });
      if (updated.ok) {
        window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      }
    },
    [blocks, calendarBlocks, dateKey, timezoneOffsetMinutes],
  );

  const editingBlock =
    editingId !== null ? (blocks ?? []).find((block) => block.id === editingId) : undefined;
  const editingDuration = editingBlock !== undefined ? durationMinutesUtc(editingBlock) : null;
  // Kesto-optiot: peruslista + muokattavan blockin todellinen kesto, jos se
  // ei ole peruslistassa (esim. 35 min).
  const durationOptions = useMemo(() => {
    const base = [
      { value: "15", label: "15 min" },
      { value: "30", label: "30 min" },
      { value: "45", label: "45 min" },
      { value: "60", label: "60 min" },
      { value: "90", label: "90 min" },
    ];
    if (
      editingDuration === null ||
      base.some((option) => option.value === String(editingDuration))
    ) {
      return base;
    }
    return [...base, { value: String(editingDuration), label: `${String(editingDuration)} min` }];
  }, [editingDuration]);

  // Esitäytä lomake muokattavan blockin tiedoilla (paikallinen aloitusaika
  // §50-offsetilla; kesto minuutteina).
  useEffect(() => {
    if (editingId === null) {
      return;
    }
    const block = (blocks ?? []).find((candidate) => candidate.id === editingId);
    if (block === undefined) {
      setEditingId(null);
      return;
    }
    const startMinutes = nowMinutesLocal(block.startsAt, timezoneOffsetMinutes);
    const durationMinutes = durationMinutesUtc(block);
    if (startMinutes === null || durationMinutes === null) {
      setEditingId(null);
      return;
    }
    setTitle(block.title);
    setStartTime(minutesToLabel(startMinutes));
    setDuration(String(Math.max(15, durationMinutes)));
    setLinkedTaskId(block.linkedTaskId ?? "");
    setLinkedRoutineId(block.linkedRoutineId ?? "");
  }, [editingId, blocks, timezoneOffsetMinutes]);
  const refresh = useCallback(async () => {
    const [listed, listedTasks, listedRoutines, listedProjects, listedTags] = await Promise.all([
      calendarBlocks.list(),
      tasks.list(),
      routinesRepo.list(),
      projectsRepo.list(),
      tagsRepo.list(),
    ]);
    if (listed.ok) {
      setBlocks(listed.value.filter((block) => block.deletedAt === null));
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    if (listedTasks.ok) {
      setOpenTasks(
        listedTasks.value.filter((task) => task.deletedAt === null && task.status === "open"),
      );
      setAllTasks(listedTasks.value.filter((task) => task.deletedAt === null));
    }
    if (listedRoutines.ok) {
      setRoutineList(
        listedRoutines.value.filter(
          (routine) => routine.deletedAt === null && routine.archivedAt === null,
        ),
      );
    }
    if (listedProjects.ok) {
      setProjectList(listedProjects.value.filter((project) => project.deletedAt === null));
    }
    if (listedTags.ok) {
      setTagList(listedTags.value.filter((tag) => tag.deletedAt === null));
    }
    setLoading(false);
  }, [calendarBlocks, projectsRepo, routinesRepo, tagsRepo, tasks]);

  useEffect(() => {
    const guard = { cancelled: false };
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!guard.cancelled) {
          setLoading(false);
        }
      });
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => undefined);
      }
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (
      blocks === undefined ||
      routeEditBlockId === null ||
      consumedRouteEditId.current === routeEditBlockId
    ) {
      return;
    }
    if (blocks.some((block) => block.id === routeEditBlockId)) {
      consumedRouteEditId.current = routeEditBlockId;
      setEditingId(routeEditBlockId);
    }
  }, [blocks, routeEditBlockId]);

  // Nykyhetki = käyttäjän paikallinen kello (näkymäelementti, ei dataa —
  // tallennettu data on UTC:tä ja §50-offsetit kulkevat kutsujalta).
  // DayGrid hoitaa oman kello-päivityksensä.

  const setDate = useCallback(
    (next: string) => {
      const params = new URLSearchParams(searchParams);
      if (next === todayKey) {
        params.delete("date");
      } else {
        params.set("date", next);
      }
      setSearchParams(params, { preventScrollReset: true });
    },
    [searchParams, setSearchParams, todayKey],
  );

  const setView = useCallback(
    (next: "day" | "week" | "month") => {
      const params = new URLSearchParams(searchParams);
      if (next === "day") {
        params.delete("view");
      } else {
        params.set("view", next);
      }
      setSearchParams(params, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );

  // T126: kind linkityksen mukaan — rutiini voittaa (§6: yksi blockki =
  // yksi suunnitelma; rutiinivalinta tyhjentää task-linkin ja toisinpäin).
  const blockKind: "event" | "task" | "routine" =
    linkedRoutineId !== "" ? "routine" : linkedTaskId === "" ? "event" : "task";

  const create = async (): Promise<void> => {
    const trimmed = title.trim();
    if (trimmed.length === 0 || creating) {
      return;
    }
    const utc = blockUtcFromLocal(
      dateKey,
      startTime,
      Number.parseInt(duration, 10),
      offsetForLocalTime(dateKey, startTime, timeZone, timezoneOffsetMinutes),
    );
    if (utc === null) {
      setCreateError("Valitse kelvollinen aloitusaika ja kesto.");
      return;
    }
    setCreating(true);
    setCreateError("");
    try {
      const created = await calendarBlocks.create({
        kind: blockKind,
        title: trimmed,
        startsAt: utc.startsAt,
        endsAt: utc.endsAt,
        linkedTaskId: linkedTaskId === "" ? null : linkedTaskId,
        linkedRoutineId: linkedRoutineId === "" ? null : linkedRoutineId,
        deletedAt: null,
      });
      if (!created.ok) {
        setCreateError(created.error.userMessage);
        return;
      }
      setTitle("");
      setLinkedTaskId("");
      setLinkedRoutineId("");
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } finally {
      setCreating(false);
    }
  };

  // T124: muokkaa blockia — sama lomake, patch updateTaskService-tyyliin
  // (vain muuttuneet kentät; versio kasvaa repossa).
  const saveEdit = async (): Promise<void> => {
    if (editingId === null || working) {
      return;
    }
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setCreateError(t("Nimi ei voi olla tyhjä."));
      return;
    }
    const utc = blockUtcFromLocal(
      dateKey,
      startTime,
      Number.parseInt(duration, 10),
      offsetForLocalTime(dateKey, startTime, timeZone, timezoneOffsetMinutes),
    );
    if (utc === null) {
      setCreateError("Valitse kelvollinen aloitusaika ja kesto.");
      return;
    }
    setWorking(true);
    setCreateError("");
    try {
      const updated = await calendarBlocks.update(editingId, {
        title: trimmed,
        startsAt: utc.startsAt,
        endsAt: utc.endsAt,
        linkedTaskId: linkedTaskId === "" ? null : linkedTaskId,
        linkedRoutineId: linkedRoutineId === "" ? null : linkedRoutineId,
        kind: blockKind,
      });
      if (!updated.ok) {
        setCreateError(updated.error.userMessage);
        return;
      }
      setEditingId(null);
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } finally {
      setWorking(false);
    }
  };

  // T124: poista blockki (pehmeä tombstone — historia säilyy §6).
  const deleteEdit = async (): Promise<void> => {
    if (editingId === null || working) {
      return;
    }
    setWorking(true);
    setCreateError("");
    try {
      const removed = await calendarBlocks.remove(editingId);
      if (!removed.ok) {
        setCreateError(removed.error.userMessage);
        return;
      }
      setEditingId(null);
      setTitle("");
      window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
    } finally {
      setWorking(false);
    }
  };

  // T127/T170: block käynnistyy oikeana sessiona ja säilyttää block-linkin.
  // Käyttäjä voi halutessaan siirtyä fokustilaan vahvistuslinkistä.
  const startBlockFocus = useCallback(async (): Promise<void> => {
    if (editingId === null || focusStarting) {
      return;
    }
    const block = (blocks ?? []).find((candidate) => candidate.id === editingId);
    if (block === undefined) {
      return;
    }
    const startMinutes = nowMinutesLocal(block.startsAt, timezoneOffsetMinutes);
    const durationMinutes = durationMinutesUtc(block);
    if (startMinutes === null || durationMinutes === null) {
      return;
    }
    const plannedSeconds = Math.max(300, durationMinutes * 60);
    setFocusStarting(true);
    try {
      const focusDeps = { clock: systemClock(), sessions: focusSessions };
      const created = await startFocusSession(focusDeps, {
        taskId: block.linkedTaskId,
        routineId: block.linkedRoutineId,
        calendarBlockId: block.id,
        plannedSeconds,
      });
      if (!created.ok) {
        setCreateError(created.error.userMessage);
        return;
      }
      const running = await beginFocusSession(focusDeps, created.value.id);
      if (running.ok) {
        setFocusStartedId(editingId);
        window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      }
    } finally {
      setFocusStarting(false);
    }
  }, [blocks, editingId, focusSessions, focusStarting, timezoneOffsetMinutes]);

  const cancelEdit = useCallback((): void => {
    setEditingId(null);
    setTitle("");
    setStartTime("09:00");
    setDuration("60");
    setLinkedTaskId("");
    setLinkedRoutineId("");
    setCreateError("");
  }, []);

  // T135: desktop-kalenterin oikotiet. Nuolinäppäimet siirtyvät nykyisen
  // näkymän askelilla, T palaa tähän päivään ja N avaa uuden timeboxin.
  // Modifier-yhdistelmät sekä lomakekentät jätetään selaimen/kentän omalle
  // toiminnalle; näin Alt+N Quick Add ja tekstin navigointi eivät riitele.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isCalendarShortcutEditableTarget(event.target)
      ) {
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        if (view === "month") {
          setDate(addMonthsIsoLocal(dateKey, delta));
        } else {
          setDate(addDaysIsoLocal(dateKey, view === "week" ? delta * 7 : delta));
        }
        return;
      }

      const shortcut = event.key.toLowerCase();
      if (shortcut === "t") {
        event.preventDefault();
        setDate(todayKey);
        return;
      }
      if (shortcut !== "n") {
        return;
      }

      event.preventDefault();
      if (editingId !== null) {
        cancelEdit();
      } else {
        setTitle("");
        setDuration("60");
        setLinkedTaskId("");
        setLinkedRoutineId("");
        setCreateError("");
      }
      window.setTimeout(() => {
        document.getElementById("calendar-timebox-title")?.focus();
      }, 0);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [cancelEdit, dateKey, editingId, setDate, todayKey, view]);

  // T134: tyhjän päiväruutukohdan napautus/klikkaus valitsee uuden
  // timeboxin aloitusajan 15 minuutin snapilla. Muokkaustila suljetaan ennen
  // uuden blockin aloittamista, jotta tallennuspainike ei jää väärään tilaan.
  const chooseCalendarStart = (minutes: number): void => {
    if (editingId !== null) {
      cancelEdit();
    }
    setStartTime(minutesToInputValue(minutes));
    setCreateError("");
  };

  if (loading) {
    return (
      <section aria-label={t("Päiväkalenteri")} data-testid="calendar-day">
        <Display>{t("Kalenteri")}</Display>
        <Skeleton lines={4} label={t("Ladataan kalenteria…")} />
      </section>
    );
  }

  return (
    <section aria-label={t("Päiväkalenteri")} data-testid="calendar-day">
      <Display>{t("Kalenteri")}</Display>
      {loadFailed ? (
        <Alert tone="warning" title={t("Kalenteria ei voitu ladata")}>
          <p>{t("Yritä ladata näkymä uudelleen hetken kuluttua.")}</p>
        </Alert>
      ) : null}
      <div data-testid="calendar-view-select">
        <SegmentedControl
          label={t("Näkymä")}
          hint={t(
            "Päivä = tuntiruudukko; Viikko = 7 päivän yhteenveto; Kuukausi = tiheysruudukko.",
          )}
          options={tOptions([
            { value: "day", label: "Päivä" },
            { value: "week", label: "Viikko" },
            { value: "month", label: "Kuukausi" },
          ])}
          value={view}
          onOptionChange={(value) => {
            if (value === "day" || value === "week" || value === "month") {
              setView(value);
            }
          }}
        />
      </div>
      <Card heading={t("Kalenterin suodattimet")} data-testid="calendar-filters">
        <Select
          label={t("Projekti")}
          options={tOptions(projectFilterOptions)}
          value={projectFilter}
          data-testid="calendar-filter-project"
          onChange={(event) => {
            setProjectFilter(event.target.value);
          }}
        />
        <Select
          label={t("Tagi")}
          options={tOptions(tagFilterOptions)}
          value={tagFilter}
          data-testid="calendar-filter-tag"
          onChange={(event) => {
            setTagFilter(event.target.value);
          }}
        />
        <Select
          label={t("Rutiini")}
          options={tOptions(routineFilterOptions)}
          value={routineFilter}
          data-testid="calendar-filter-routine"
          onChange={(event) => {
            setRoutineFilter(event.target.value);
          }}
        />
        <div data-testid="calendar-filter-summary">
          <Meta>
            {filterActive
              ? tTemplate("{{0}} / {{1}} timeboxia näkyvissä.", [
                  String(visibleBlocks.length),
                  String((blocks ?? []).length),
                ])
              : t("Kaikki timeboxit näkyvät.")}
          </Meta>
        </div>
        {filterActive ? (
          <Button
            variant="ghost"
            data-testid="calendar-filter-reset"
            onClick={() => {
              setProjectFilter("");
              setTagFilter("");
              setRoutineFilter("");
            }}
          >
            {t("Tyhjennä suodattimet")}
          </Button>
        ) : null}
      </Card>
      {view === "week" ? (
        <Card heading={t("Viikko")}>
          <CalendarJumpPicker dateKey={dateKey} onDateChange={setDate} />
          <Meta>
            {t("Viikko: ")}
            {formatCalendarDateFi(getWeekStartKey(dateKey))} {t(" alkaen")}
          </Meta>
          <p>
            <Button
              variant="ghost"
              data-testid="calendar-prev-week"
              onClick={() => {
                setDate(addDaysIsoLocal(dateKey, -7));
              }}
            >
              {t("‹ Edellinen viikko")}
            </Button>{" "}
            <Button
              variant="secondary"
              data-testid="calendar-today"
              onClick={() => {
                setDate(todayKey);
              }}
            >
              {t("Tänään")}
            </Button>{" "}
            <Button
              variant="ghost"
              data-testid="calendar-next-week"
              onClick={() => {
                setDate(addDaysIsoLocal(dateKey, 7));
              }}
            >
              {t("Seuraava viikko ›")}
            </Button>
          </p>
        </Card>
      ) : view === "month" ? (
        <Card heading={t("Kuukausi")}>
          <CalendarJumpPicker dateKey={dateKey} onDateChange={setDate} />
          <Meta>
            {monthName} —{" "}
            {String(monthBusyDaysOf(monthModel, visibleBlocks, timezoneOffsetMinutes))}{" "}
            {t("kiireistä päivää")}
          </Meta>
          <p>
            <Button
              variant="ghost"
              data-testid="calendar-prev-month"
              onClick={() => {
                setDate(addMonthsIsoLocal(dateKey, -1));
              }}
            >
              {t("‹ Edellinen kuukausi")}
            </Button>{" "}
            <Button
              variant="secondary"
              data-testid="calendar-today"
              onClick={() => {
                setDate(todayKey);
              }}
            >
              {t("Tänään")}
            </Button>{" "}
            <Button
              variant="ghost"
              data-testid="calendar-next-month"
              onClick={() => {
                setDate(addMonthsIsoLocal(dateKey, 1));
              }}
            >
              {t("Seuraava kuukausi ›")}
            </Button>
          </p>
        </Card>
      ) : (
        <Card heading={t("Päivä")}>
          <CalendarJumpPicker dateKey={dateKey} onDateChange={setDate} />
          <Meta>
            {t("Päivä: ")}
            {formatCalendarDateFi(dateKey)}
          </Meta>
          <p>
            <Button
              variant="ghost"
              data-testid="calendar-prev-day"
              onClick={() => {
                setDate(addDaysIsoLocal(dateKey, -1));
              }}
            >
              {t("‹ Edellinen")}
            </Button>{" "}
            <Button
              variant="secondary"
              data-testid="calendar-today"
              onClick={() => {
                setDate(todayKey);
              }}
            >
              {t("Tänään")}
            </Button>{" "}
            <Button
              variant="ghost"
              data-testid="calendar-next-day"
              onClick={() => {
                setDate(addDaysIsoLocal(dateKey, 1));
              }}
            >
              {t("Seuraava ›")}
            </Button>
          </p>
        </Card>
      )}
      <Card heading={editingId === null ? "Uusi timebox" : "Muokkaa timeboxia"}>
        <Input
          id="calendar-timebox-title"
          label={t("Timeboxin nimi")}
          placeholder={t("Esim. Syventyminen")}
          value={title}
          disabled={creating || working}
          onChange={(event) => {
            setTitle(event.target.value);
            if (createError !== "") {
              setCreateError("");
            }
          }}
        />
        <TimePicker
          label={t("Aloitusaika")}
          value={startTime}
          disabled={creating || working}
          onChange={(event) => {
            setStartTime(event.target.value);
          }}
        />
        {editingId === null ? (
          <Meta>{t("Napsauta päiväruudukosta tyhjää kohtaa valitaksesi aloitusajan.")}</Meta>
        ) : null}
        <Select
          label={t("Kesto")}
          options={tOptions(durationOptions)}
          value={duration}
          disabled={creating || working}
          onChange={(event) => {
            setDuration(event.target.value);
          }}
        />
        <Select
          label={t("Tehtävälinkitys (valinnainen)")}
          hint={t("Valinta täyttää nimen tehtävän otsikolla — tehtävän data ei kopioidu.")}
          placeholder={t("Ei linkitystä")}
          options={tOptions(openTasks.map((task) => ({ value: task.id, label: task.title })))}
          value={linkedTaskId}
          disabled={creating || working}
          onChange={(event) => {
            const nextId = event.target.value;
            setLinkedTaskId(nextId);
            // T125: esitäytä nimi linkitetyn tehtävän otsikolla (jos käyttäjä
            // ei ole jo kirjoittanut omaa nimeä) — ei datan duplikointia:
            // linkki säilyy id:llä, tehtävän tila pysyy tasks-repossa.
            if (nextId !== "" && title.trim() === "") {
              const linked = openTasks.find((task) => task.id === nextId);
              if (linked !== undefined) {
                setTitle(linked.title);
              }
            }
            // T126: task-linkitys tyhjentää rutiinilinkityksen (yksi blockki =
            // yksi suunnitelma).
            if (nextId !== "") {
              setLinkedRoutineId("");
            }
          }}
        />
        <Select
          label={t("Rutiinilinkitys (valinnainen)")}
          hint={t("Rutiini näkyy suunniteltuna blokkina — rutiinin data ei kopioidu.")}
          placeholder={t("Ei linkitystä")}
          options={tOptions(
            routineList.map((routine) => ({ value: routine.id, label: routine.title })),
          )}
          value={linkedRoutineId}
          disabled={creating || working}
          onChange={(event) => {
            selectRoutine(event.target.value);
          }}
        />
        {createError !== "" ? <Meta>{t(createError)}</Meta> : null}
        <p>
          {editingId === null ? (
            <Button
              variant="primary"
              data-testid="calendar-block-create"
              loading={creating}
              disabled={title.trim().length === 0 || creating}
              onClick={() => void create()}
            >
              {t("Lisää timebox")}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                data-testid="calendar-block-save"
                loading={working}
                disabled={title.trim().length === 0 || working}
                onClick={() => void saveEdit()}
              >
                {t("Tallenna muutokset")}
              </Button>{" "}
              <Button
                variant="secondary"
                data-testid="calendar-block-focus"
                loading={focusStarting}
                disabled={working || focusStarting}
                onClick={() => void startBlockFocus()}
              >
                {t("Aloita fokus")}
              </Button>{" "}
              <Button
                variant="danger"
                data-testid="calendar-block-delete"
                loading={working}
                disabled={working}
                onClick={() => void deleteEdit()}
              >
                {t("Poista")}
              </Button>{" "}
              <Button
                variant="ghost"
                data-testid="calendar-block-cancel"
                disabled={working}
                onClick={cancelEdit}
              >
                {t("Peruuta")}
              </Button>
              {focusStartedId !== null ? (
                <div data-testid="calendar-block-focus-active">
                  <Meta>{t("Fokus käynnissä. Timebox-linkki säilyi.")}</Meta>
                  <Link
                    data-ui="calendar-focus-open"
                    to="/focus"
                    state={{ calendarReturnTo: `${location.pathname}${location.search}` }}
                  >
                    {t("Avaa fokusnäkymä")}
                  </Link>
                </div>
              ) : null}
            </>
          )}
        </p>
      </Card>
      {view === "day" ? (
        <>
          <Card heading={t("Ajastamattomat tehtävät")}>
            <Meta>
              {unscheduledTasks.length === 0
                ? t("Kaikki avoimet tehtävät on ajastettu.")
                : tTemplate("{{0}} ajastamatonta — vedä tunnille tai paina Ajasta.", [
                    String(unscheduledTasks.length),
                  ])}
            </Meta>
            {unscheduledTasks.length > 0 ? (
              <ul data-testid="calendar-unscheduled-list">
                {unscheduledTasks.map((unscheduled) => (
                  <li key={unscheduled.id} data-testid={`calendar-unscheduled-${unscheduled.id}`}>
                    <strong
                      draggable
                      data-testid={`calendar-unscheduled-drag-${unscheduled.id}`}
                      title={t("Vedä tunnille ajastaaksesi")}
                      onDragStart={(dragEvent) => {
                        dragEvent.dataTransfer.setData("text/lifeos-task-id", unscheduled.id);
                        dragEvent.dataTransfer.effectAllowed = "copy";
                        setDragTaskId(unscheduled.id);
                      }}
                      onDragEnd={() => {
                        setDragTaskId(null);
                      }}
                    >
                      {unscheduled.title}
                    </strong>
                    <Button
                      variant="secondary"
                      data-testid={`calendar-unscheduled-schedule-${unscheduled.id}`}
                      onClick={() => {
                        const hourLabel = startTime.split(":")[0] ?? "09";
                        const hour = Number.parseInt(hourLabel, 10);
                        const hourClamped = Number.isFinite(hour) ? hour : 9;
                        void scheduleUnscheduledTask(unscheduled.id, hourClamped * 60);
                      }}
                    >
                      {t("Ajasta (")}
                      {startTime})
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          {/* T131: vedettävän id:n piilokantaja (diagnostiikka + testi).
              E2E-hook: ulkoinen testi voi pudottaa tehtävän kalenteriin
              ilman natiivia DnD:tä asettamalla data-task-drop-minutes +
              klikkaamalla (sama scheduleUnscheduledTask-polku kuin oikea
              veto). Piilossa (hidden), ei layout-vaikutusta. */}
          <button
            ref={payloadRef}
            type="button"
            data-testid="calendar-task-drop-payload"
            data-task-drop-task={dragTaskId ?? undefined}
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => {
              const payload = document.querySelector('[data-testid="calendar-task-drop-payload"]');
              const taskId = payload?.getAttribute("data-task-drop-task") ?? dragTaskId;
              const minutesRaw = payload?.getAttribute("data-task-drop-minutes") ?? "";
              const minutes = Number.parseInt(minutesRaw, 10);
              if (taskId === null || taskId === "" || !Number.isFinite(minutes)) {
                return;
              }
              setDragTaskId(null);
              void scheduleUnscheduledTask(taskId, minutes);
            }}
          />
          <DayGrid
            dateKey={dateKey}
            blocks={visibleBlocks}
            todayKey={todayKey}
            timezoneOffsetMinutes={timezoneOffsetMinutes}
            editingId={editingId}
            taskTitleById={taskTitleById}
            routineTitleById={routineTitleById}
            dropPreview={dropPreview}
            onBlockClick={(blockId) => {
              setEditingId(blockId);
            }}
            onBlockDragEnd={(blockId, deltaMinutes) => {
              const block = (blocks ?? []).find((candidate) => candidate.id === blockId);
              if (block === undefined) {
                return Promise.resolve();
              }
              return finishBlockDrag({ id: blockId, mode: "move", deltaMinutes });
            }}
            onTaskDrop={(taskId, startMinutes) => scheduleUnscheduledTask(taskId, startMinutes)}
            onEmptyGridClick={chooseCalendarStart}
            onDropPreviewChange={setDropPreview}
            dragTaskId={dragTaskId}
            onDragTaskIdChange={setDragTaskId}
          />
        </>
      ) : view === "week" ? (
        <Card heading={t("Viikko")}>
          <WeekGrid
            startLocalDate={getWeekStartKey(dateKey)}
            todayKey={todayKey}
            blocks={visibleBlocks}
            timezoneOffsetMinutes={timezoneOffsetMinutes}
          />
          <WeekSummary
            startLocalDate={getWeekStartKey(dateKey)}
            todayKey={todayKey}
            blocks={visibleBlocks}
            timezoneOffsetMinutes={timezoneOffsetMinutes}
          />
        </Card>
      ) : (
        <Card heading={t("Kuukausi")}>
          <Meta>
            {monthName} — {String(monthBusyDaysOf(monthModel, blocks ?? [], timezoneOffsetMinutes))}{" "}
            {t("kiireistä päivää")}
          </Meta>
          <p>
            <Button
              variant="ghost"
              data-testid="calendar-prev-month"
              onClick={() => {
                setDate(addMonthsIsoLocal(dateKey, -1));
              }}
            >
              {t("‹ Edellinen kuukausi")}
            </Button>{" "}
            <Button
              variant="secondary"
              data-testid="calendar-today"
              onClick={() => {
                setDate(todayKey);
              }}
            >
              {t("Tänään")}
            </Button>{" "}
            <Button
              variant="ghost"
              data-testid="calendar-next-month"
              onClick={() => {
                setDate(addMonthsIsoLocal(dateKey, 1));
              }}
            >
              {t("Seuraava kuukausi ›")}
            </Button>
          </p>
          <MonthGrid
            model={monthModel}
            todayKey={todayKey}
            blocks={visibleBlocks}
            timezoneOffsetMinutes={timezoneOffsetMinutes}
          />
        </Card>
      )}
    </section>
  );
}

function DayGrid({
  dateKey,
  blocks,
  todayKey,
  timezoneOffsetMinutes,
  onBlockClick,
  onBlockDragEnd,
  editingId,
  taskTitleById,
  routineTitleById,
  dropPreview,
  onTaskDrop,
  onEmptyGridClick,
  onDropPreviewChange,
  dragTaskId,
  onDragTaskIdChange,
}: {
  readonly dateKey: string;
  readonly blocks: readonly CalendarBlock[];
  readonly todayKey: string;
  readonly timezoneOffsetMinutes: number;
  readonly onBlockClick: (blockId: string) => void;
  /** T128: vedon (move) lopputulos: id + delta minuutteina (snapattu). */
  readonly onBlockDragEnd: (blockId: string, deltaMinutes: number) => Promise<void>;
  readonly editingId: string | null;
  /** T125: linkitetyn tehtävän NYKYINEN otsikko lookupilla — ei kopiota. */
  readonly taskTitleById: ReadonlyMap<string, string>;
  /** T126: linkitetyn rutiinin NYKYINEN otsikko lookupilla — ei kopiota. */
  readonly routineTitleById: ReadonlyMap<string, string>;
  /** T131: pudotuskohdan esikatselu (tunti + snapattu aloitus). */
  readonly dropPreview: { readonly hour: number; readonly startMinutes: number } | null;
  /** T131: paneelitehtävän pudotus tunnille → blockin luonti (§6 veto). */
  readonly onTaskDrop: (taskId: string, startMinutes: number) => Promise<void>;
  /** T134: tyhjä ruutukohta valitsee uuden blockin aloitusajan. */
  readonly onEmptyGridClick: (startMinutes: number) => void;
  readonly onDropPreviewChange: (
    next: { readonly hour: number; readonly startMinutes: number } | null,
  ) => void;
  /** T131: vedettävän tehtävän id (ylätason state — dragstart paneelista). */
  readonly dragTaskId: string | null;
  readonly onDragTaskIdChange: (next: string | null) => void;
}): React.JSX.Element {
  const [nowMinutes, setNowMinutes] = useState<number | null>(
    nowMinutesLocal(new Date().toISOString(), -new Date().getTimezoneOffset()),
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMinutes(nowMinutesLocal(new Date().toISOString(), -new Date().getTimezoneOffset()));
    }, 60_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  // T128: raahaus-state: mikä blockki, mistä Y:stä, liikuttuiko (>=4px →
  // pudotuksessa persistoidaan, muuten klikki avaa muokkauksen T124).
  // T129: mobiilissa vaaditaan pitkä painallus (600 ms) ennen kuin veto
  // alkaa — lyhyt kosketus säilyttää scrollin ja selaimen omat eleet,
  // pitkä painallus lukitsee vedon (touch-action:none + pointer-capture).
  type BlockDragState = {
    readonly id: string;
    readonly startY: number;
  };
  const [dragState, setDragState] = useState<BlockDragState | null>(null);
  const dragStateRef = useRef<BlockDragState | null>(null);
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressArmedRef = useRef(false);

  const clearLongPressTimer = (): void => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  useEffect(
    () => () => {
      clearLongPressTimer();
    },
    [],
  );

  const beginBlockDrag = (event: React.PointerEvent<HTMLButtonElement>, blockId: string): void => {
    // T128: hiiri/trackpad alkaa heti. T129: kosketus vasta 600 ms pitkän
    // painalluksen jälkeen (muuten scroll + selaineleet säilyvät).
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      event.currentTarget.setPointerCapture(event.pointerId);
      dragMovedRef.current = false;
      suppressClickRef.current = false;
      const nextState = { id: blockId, startY: event.clientY };
      dragStateRef.current = nextState;
      setDragState(nextState);
      return;
    }
    clearLongPressTimer();
    longPressArmedRef.current = false;
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    const startY = event.clientY;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressArmedRef.current = true;
      try {
        target.setPointerCapture(pointerId);
      } catch {
        // Ei capturea → veto ei ala, klikki/muokkaus silti toimii.
        longPressArmedRef.current = false;
        return;
      }
      dragMovedRef.current = false;
      suppressClickRef.current = false;
      const nextState = { id: blockId, startY };
      dragStateRef.current = nextState;
      setDragState(nextState);
    }, 600);
  };

  const moveBlockDrag = (event: React.PointerEvent<HTMLButtonElement>): void => {
    // T129: ennen pitkää painallusta kosketusliike peruuttaa vedon
    // (scroll saa jatkua) — ei kosketa dragMovedRef:iä.
    if (!longPressArmedRef.current && event.pointerType === "touch") {
      if (dragState === null) {
        clearLongPressTimer();
      }
      return;
    }
    const state = dragStateRef.current;
    if (state === null) {
      return;
    }
    if (Math.abs(event.clientY - state.startY) >= 4) {
      dragMovedRef.current = true;
      suppressClickRef.current = true;
    }
  };

  const cancelBlockDrag = (): void => {
    clearLongPressTimer();
    longPressArmedRef.current = false;
    if (dragStateRef.current !== null) {
      suppressClickRef.current = true;
    }
    dragStateRef.current = null;
    setDragState(null);
  };

  const endBlockDrag = async (event: React.PointerEvent<HTMLButtonElement>): Promise<void> => {
    const state = dragStateRef.current;
    clearLongPressTimer();
    longPressArmedRef.current = false;
    dragStateRef.current = null;
    setDragState(null);
    if (state === null) {
      // Lyhyt kosketus jatkaa tavalliseen click-polkuun. Erillinen
      // onBlockClick tässä haarassa tuplaisi Reactin natiivin clickin.
      return;
    }
    // Ei liikettä → tavallinen klikki (muokkaus T124); pudotus vain jos
    // vedettiin. Muunnos px→min ruudukon korkeudesta (960 min ikkuna),
    // snap 15 min (§8 timebox-tahdit).
    const grid = gridRef.current;
    if (!dragMovedRef.current || grid === null || grid.clientHeight === 0) {
      dragMovedRef.current = false;
      return;
    }
    dragMovedRef.current = false;
    const dayGridMinutesPerPixel = 960 / grid.clientHeight;
    const deltaMinutes = Math.round(
      (((event.clientY - state.startY) * dayGridMinutesPerPixel) / 15) * 15,
    );
    if (deltaMinutes === 0) {
      return;
    }
    suppressClickRef.current = true;
    await onBlockDragEnd(state.id, deltaMinutes);
  };

  // T130: ylijäämäryhmän "N lisää" -indikaattori (max 3 kaistaa; ylijäävät
  // kootaan tekstinaperiksi, ei peitetä §6).
  const [expandedGroups, setExpandedGroups] = useState<readonly string[]>([]);
  const toggleGroup = useCallback((key: string): void => {
    setExpandedGroups((prev) =>
      prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key],
    );
  }, []);

  const layout = useMemo(
    () =>
      layoutDayBlocks({
        blocks,
        dateKey,
        timezoneOffsetMinutes,
        startHour: DAY_START_HOUR,
        endHour: DAY_END_HOUR,
        // T130: laajennettu ryhmä renderöi kaikki jäsenensä (data-kerros
        // palauttaa ne täydellä kaistamäärällä — ei peittyviä, §6).
        expandedGroupKeys: expandedGroups,
      }),
    [blocks, dateKey, timezoneOffsetMinutes, expandedGroups],
  );
  const isToday = dateKey === todayKey;
  const nowLabel =
    isToday &&
    nowMinutes !== null &&
    nowMinutes >= DAY_START_HOUR * 60 &&
    nowMinutes <= DAY_END_HOUR * 60
      ? minutesToLabel(nowMinutes)
      : null;
  const nowTopPercent =
    nowLabel !== null && nowMinutes !== null
      ? `${String(((nowMinutes - DAY_START_HOUR * 60) / layout.totalMinutes) * 100)}%`
      : null;

  // T131: tunti → minuutit osoittimen Y:stä (sama 06–22-ikkuna kuin
  // layoutissa; snap 15 min §8 — sama kuin blockin siirrossa T128).
  const minutesAtClientY = (clientY: number): number | null => {
    const grid = gridRef.current;
    if (grid === null || grid.clientHeight === 0) {
      return null;
    }
    const rect = grid.getBoundingClientRect();
    const ratio = (clientY - rect.top) / grid.clientHeight;
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
      return null;
    }
    return DAY_START_HOUR * 60 + ratio * layout.totalMinutes;
  };

  return (
    <section
      data-testid="calendar-day-grid"
      aria-label={tTemplate("Päivänäkymä {{0}}: tuntirivit ja timeboxit", [dateKey])}
    >
      {nowLabel !== null ? (
        <div data-testid="calendar-now-indicator">
          <Meta>
            {t("Nyt kello ")}
            {nowLabel}
          </Meta>
        </div>
      ) : null}
      <div
        className="calendar-day-grid"
        data-ui="calendar-day-grid"
        ref={gridRef}
        // T131: veto kuplii grid-tasolla (bubbling, ei hit-testiä) — ei
        // peitä block-nappeja (T128-veto) eikä T129-tapia (§6). Natiivi
        // HTML5-DnD desktopilla; mobiilissa paneelin Ajasta-nappi (§31).
        // dataTransfer on suojattu dragoverissa (getData tyhjää) ja
        // synteettinen DragEvent ei kanna tyyppejä React 19:lle → dragover
        // hyväksyy kun dragTaskId on asetettu (oikea dragstart) TAI
        // tyypit täsmäävät; id + sijainti luetaan vasta dropissa.
        onDragOver={(dragEvent) => {
          const isTaskDrag =
            dragTaskId !== null || dragEvent.dataTransfer.types.includes("text/lifeos-task-id");
          if (!isTaskDrag) {
            return;
          }
          dragEvent.preventDefault();
          dragEvent.dataTransfer.dropEffect = "copy";
          const at = minutesAtClientY(dragEvent.clientY);
          if (at !== null) {
            const snapped = Math.round(at / 15) * 15;
            const hour = Math.floor(snapped / 60);
            onDropPreviewChange({ hour, startMinutes: snapped });
          }
        }}
        onDragLeave={() => {
          onDropPreviewChange(null);
        }}
        onDrop={(dropEvent) => {
          const transferred: string = dropEvent.dataTransfer.getData("text/lifeos-task-id");
          const taskId: string | null = transferred === "" ? dragTaskId : transferred;
          onDropPreviewChange(null);
          onDragTaskIdChange(null);
          if (taskId === null || taskId === "") {
            return;
          }
          dropEvent.preventDefault();
          const at = minutesAtClientY(dropEvent.clientY);
          void onTaskDrop(taskId, at ?? DAY_START_HOUR * 60);
        }}
        onClick={(clickEvent) => {
          const target = clickEvent.target;
          if (
            target instanceof HTMLElement &&
            target.closest('[data-ui="calendar-block"], [data-ui="calendar-drop-preview"]') !== null
          ) {
            return;
          }
          const at = minutesAtClientY(clickEvent.clientY);
          if (at !== null) {
            onEmptyGridClick(at);
          }
        }}
      >
        {layout.hourTicks.map((tick) => (
          <div
            key={tick.hour}
            data-ui="calendar-hour-tick"
            data-testid={`calendar-hour-${String(tick.hour).padStart(2, "0")}`}
            style={{ top: `${String(tick.topPercent)}%` }}
            aria-hidden="true"
          >
            {String(tick.hour).padStart(2, "0")}
          </div>
        ))}
        {dropPreview !== null ? (
          <div
            data-ui="calendar-drop-preview"
            data-testid={`calendar-drop-preview-${String(dropPreview.hour).padStart(2, "0")}`}
            aria-hidden="true"
          >
            <Meta>
              {t("Pudota tähän (")}
              {minutesToLabel(dropPreview.startMinutes)})
            </Meta>
          </div>
        ) : null}
        {nowTopPercent !== null ? (
          <div
            data-ui="calendar-now-line"
            data-testid="calendar-now-line"
            style={{ top: nowTopPercent }}
            role="img"
            aria-label={tTemplate("Nykyhetki {{0}}", [nowLabel ?? ""])}
          />
        ) : null}
        {layout.overflowGroups.map((group) => (
          <button
            key={`overflow-${group.key}`}
            type="button"
            data-ui="calendar-block"
            data-testid={`calendar-overflow-${String(group.total - group.shown)}-more`}
            style={{ top: "0%", height: "auto", left: "0%", width: "100%" }}
            title={tTemplate("{{0}} lisää samanaikaisessa ryhmässä", [String(group.hidden)])}
            onClick={() => {
              toggleGroup(group.key);
            }}
          >
            <strong>
              {expandedGroups.includes(group.key)
                ? t("Piilota")
                : tTemplate("{{0}} lisää", [String(group.hidden)])}
            </strong>
          </button>
        ))}
        {layout.blocks.map((position) => {
          // T125/T126: linkitetyn tehtävän/rutiinin NYKYINEN otsikko
          // lookupilla (yksi totuuden lähde repossa — ei kopiota blockiin).
          // Rutiini voittaa (§6: yksi blockki = yksi suunnitelma).
          const linkedRoutineTitle =
            position.block.linkedRoutineId !== null
              ? routineTitleById.get(position.block.linkedRoutineId)
              : undefined;
          const linkedTaskTitle =
            linkedRoutineTitle === undefined && position.block.linkedTaskId !== null
              ? taskTitleById.get(position.block.linkedTaskId)
              : undefined;
          const linkKind =
            position.block.linkedRoutineId !== null
              ? "Rutiini"
              : position.block.linkedTaskId !== null
                ? "Tehtävä"
                : null;
          const displayTitle = linkedRoutineTitle ?? linkedTaskTitle ?? position.block.title;
          return (
            <button
              key={position.block.id}
              type="button"
              data-ui="calendar-block"
              data-testid={`calendar-block-${position.block.id}`}
              data-starts-at={position.block.startsAt}
              data-editing={editingId === position.block.id ? "true" : undefined}
              data-linked={linkKind !== null ? "true" : undefined}
              title={`${displayTitle} ${minutesToLabel(position.startMinutes)}–${minutesToLabel(position.endMinutes)}`}
              onClick={() => {
                // T128: raahattu klikki ei avaa muokkausta (§6).
                if (suppressClickRef.current || dragMovedRef.current) {
                  suppressClickRef.current = false;
                  dragMovedRef.current = false;
                  return;
                }
                onBlockClick(position.block.id);
              }}
              draggable={false}
              // T129: vedettäessä kosketus lukitaan ruudukkoon (touch-action),
              // muuten scroll saa jatkua — asetetaan vasta kun pitkä painallus
              // on virittänyt vedon.
              style={{
                top: `${String(position.topPercent)}%`,
                height: `${String(position.heightPercent)}%`,
                left: `${String((position.lane / position.lanes) * 100)}%`,
                width: `${String((1 / position.lanes) * 100)}%`,
                touchAction: dragState !== null ? "none" : undefined,
              }}
              onPointerDown={(dragEvent) => {
                beginBlockDrag(dragEvent, position.block.id);
              }}
              onPointerMove={moveBlockDrag}
              onPointerUp={(dragEvent) => {
                void endBlockDrag(dragEvent);
              }}
              onPointerCancel={cancelBlockDrag}
              onContextMenu={(menuEvent) => {
                // T129: pitkän painalluksen yhteydessä tuleva contextmenu ei
                // saa keskeyttää vetoa eikä avata selaimen valikkoa.
                if (dragState !== null) {
                  menuEvent.preventDefault();
                }
              }}
            >
              <strong>{displayTitle}</strong>
              <span>
                {minutesToLabel(position.startMinutes)}–{minutesToLabel(position.endMinutes)}
              </span>
              {linkKind !== null ? <span>{linkKind}</span> : null}
            </button>
          );
        })}
      </div>
      {layout.blocks.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={t("Ei timeboxeja tälle päivälle.")}
          hint={t("Lisää timebox yltä — voit linkittää sen avoimeen tehtävään.")}
        />
      ) : null}
    </section>
  );
}
