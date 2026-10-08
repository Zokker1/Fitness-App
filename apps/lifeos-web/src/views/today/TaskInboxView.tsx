// T101: Task Inbox (§5). Yksi näkymä joka kokoaa avoimet tehtävät. T105:
// järjestys säilyttää deadline-näkyvyyden — myöhässä ensin (vanhin eräpäivä),
// sitten läheisyys päivittäin, prioriteetti high→low VAIN saman päivän sisällä,
// ei-deadlinea viimeisenä (prioriteetti ei koskaan piilota deadlinea).
// Toiminnot aidosta datasta:
// - valmis-merkintä (checkbox → completeTaskService → lataa uudestaan);
// - avaa uudelleen (done-rivillä reopenTaskService);
// - poista (pehmeä tombstone → deleteTaskService, historian säilyttäen T100).
// Design-järjestelmä (§28/T040–T051): Display/Meta/SectionHeading/Button/
// EmptyState/Skeleton/Alert — ei raakoja h-elementtejä/buttonia/p-tekstiä.
//
// T103: ?upcoming=1 näyttää Seuraavat/Myöhässä-näkymän (T103 upcoming-
// overdue-ryhmittely): Myöhässä + Seuraavat erikseen, EI valmistuneita
// kummassakaan ryhmässä (ei donesekoitusta). Muuten sama lataus + toiminnot.
// Reititys ei muutu (/tasks) — näkymätila on URL-parametrissa jotta se on
// jaettava + paluu toimii selaimen backilla (§27).
//
// Sisällytys kummassakin tilassa: POISTETUT EI NÄY (tombstone historia
// säilyy tietokannassa — ei kummitusosumia), VALMIIT näkyvät omana
// ryhmänään vain oletustilassa (ei sekoita avoimiin).
//
// TIEDOT: lista tulee useData.tasks.list() + tags.list() — yksi haku, ei
// hakuketjuja komponentissa (T080-malli). Tyhjätila ohjaa Quick Add -FAB:iin.
//
// T106: tagit — luonti Quick Task -lomakkeella (puuttuvat luodaan), suodatus
// URL-parametrilla ?tag=<id> (jaettava, back toimii §27) ja yhtenäinen
// chip-esitys (data-ui="tag-chip") sekä suodatinrivillä että riveillä.
import { t, tOptions, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { BottomSheet } from "@lifeos/ui";
import {
  Alert,
  Button,
  Display,
  EmptyState,
  Meta,
  SectionHeading,
  SegmentedControl,
  Select,
  Skeleton,
} from "@lifeos/ui";
import type { Tag, Task, TaskChecklistItem } from "@lifeos/domain";
import {
  completeTaskService,
  deleteTaskService,
  formatDueDateTime,
  formatMinutes,
  groupTasksInPeriod,
  groupTasksUpcoming,
  hasRecurrence,
  isOverdue,
  beginFocusSession,
  FIVE_MINUTE_START_SECONDS,
  reopenTaskService,
  startFocusSession,
  sumEstimateMinutes,
  systemClock,
  timeboxSuggestion,
  updateTaskService,
  type TaskPeriodKey,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { TaskChecklist } from "./TaskChecklist.tsx";

/** Rivin tagichipit (display-only) — yksi esitys kaikille näkymille. */
function TagChips({
  tagIds,
  tags,
}: {
  readonly tagIds: readonly string[];
  readonly tags: readonly Tag[];
}): React.JSX.Element | null {
  if (tagIds.length === 0 || tags.length === 0) {
    return null;
  }
  const names = tagIds
    .map((id) => tags.find((tag) => tag.id === id)?.name)
    .filter((name): name is string => name !== undefined);
  if (names.length === 0) {
    return null;
  }
  return (
    <ul data-ui="tag-chip-list">
      {names.map((name) => (
        <li key={name} data-ui="tag-chip">
          #{name}
        </li>
      ))}
    </ul>
  );
}

const PRIORITY_LABELS: Readonly<Record<Task["priority"], string>> = {
  high: "korkea",
  normal: "normaali",
  low: "matala",
};

function formatActualFocusTime(seconds: number): string {
  if (seconds < 60) {
    return "alle 1 min";
  }
  return `${String(Math.floor(seconds / 60))} min`;
}

// T110: toiston metarivi (sama sanasto kuin lomakkeessa).
const RECURRENCE_LABELS: Readonly<Record<NonNullable<Task["recurrence"]>["kind"], string>> = {
  daily: "päivittäin",
  weekly: "viikoittain",
  monthly: "kuukausittain",
  custom: "mukautetusti",
};

/** T111: arvio + timebox-ehdotus riville (esim. "Arvio 90 min — ehdotus 4 × 25 min"). */
function EstimateMeta({ task }: { readonly task: Task }): React.JSX.Element | null {
  const estimate = task.estimateMinutes;
  const estimateText =
    typeof estimate === "number" && Number.isFinite(estimate) && estimate > 0
      ? (() => {
          const suggestion = timeboxSuggestion(estimate);
          return suggestion === null
            ? null
            : `Arvio ${formatMinutes(suggestion.minutes) ?? `${String(suggestion.minutes)} min`} — timebox-ehdotus ${String(suggestion.chunks)} × 25 min`;
        })()
      : null;
  const actualSeconds = task.actualSeconds ?? 0;
  const actualText =
    actualSeconds > 0 ? `Fokukseen kirjattu ${formatActualFocusTime(actualSeconds)}` : null;
  const meta = [estimateText, actualText].filter((value): value is string => value !== null);
  if (meta.length === 0) {
    return null;
  }
  return <Meta>{meta.join(" · ")}</Meta>;
}

// T104: jaksonäkymän valinnat — "kaikki" = T103-käyttäytyminen (Myöhässä +
// kaikki Seuraavat), muut rajaa Seuraavat valitulle ajanjaksolle.
const PERIOD_OPTIONS: readonly {
  readonly value: TaskPeriodKey | "kaikki";
  readonly label: string;
}[] = [
  { value: "kaikki", label: "Kaikki" },
  { value: "paiva", label: "Päivä" },
  { value: "viikko", label: "Viikko" },
  { value: "kuukausi", label: "Kuukausi" },
];

const PERIOD_LABELS: Readonly<Record<TaskPeriodKey, string>> = {
  paiva: "Päivä",
  viikko: "Viikko",
  kuukausi: "Kuukausi",
};

function isPeriodKey(value: string | null): value is TaskPeriodKey {
  return value === "paiva" || value === "viikko" || value === "kuukausi";
}

/** Päiväavain "18.9." muotoon (UTC-vyöhykkeellä — avain on jo paikallispäivä). */
function formatFiDay(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

/** Päiväavain "18.9.2026" muotoon. */
function formatFiDayYear(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

interface InboxRows {
  readonly open: readonly Task[];
  readonly done: readonly Task[];
}

function compareTimestampsNewestFirst(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? 1 : -1;
}

function splitRows(
  rows: readonly Task[],
  localDate: string,
  timezoneOffsetMinutes: number,
): InboxRows {
  // Tombstonet pois molemmista tiloista — poistettu ei näy kummituksena.
  const alive = rows.filter((row) => row.deletedAt === null);
  // T105: prioriteetti vaikuttaa järjestykseen MUTTA ei piilota deadlineja:
  // myöhässä ensin (vanhin eräpäivä), sitten läheisyys päivittäin, prioriteetti
  // vain saman päivän sisällä; ei-deadlinea viimeisenä prioriteetilla.
  // Sama sääntö kuin T103 upcoming-näkymässä — yksi järjestyslogiikka.
  const ordered = groupTasksUpcoming({ tasks: alive, localDate, timezoneOffsetMinutes });
  const open = [...ordered.overdue, ...ordered.upcoming];
  const done = [...alive.filter((row) => row.status === "done")].sort((a, b) =>
    compareTimestampsNewestFirst(a.completedAt ?? a.updatedAt, b.completedAt ?? b.updatedAt),
  );
  return { open, done };
}

function localDayInfo(): {
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
} {
  const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
  const nowIso = new Date().toISOString();
  const localDate = new Date(Date.parse(nowIso) + timezoneOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
  return { localDate, timezoneOffsetMinutes };
}

function localDayInput(rows: readonly Task[]): {
  readonly tasks: readonly Task[];
  readonly localDate: string;
  readonly timezoneOffsetMinutes: number;
} {
  return { tasks: rows, ...localDayInfo() };
}

export function TaskInboxView(): React.JSX.Element {
  const { tasks, tags, taskChecklistItems, focusSessions, xpTransactions, projects } = useData();
  const [searchParams, setSearchParams] = useSearchParams();
  const showUpcoming = searchParams.get("upcoming") === "1";
  const periodParam = searchParams.get("period");
  const period: TaskPeriodKey | "kaikki" = isPeriodKey(periodParam) ? periodParam : "kaikki";
  // T106: tagisuodatus (URL-parametri — jaettava linkki + back toimii).
  const tagParam = searchParams.get("tag");
  const [rows, setRows] = useState<InboxRows | undefined>(undefined);
  const [tagList, setTagList] = useState<readonly Tag[]>([]);
  // T108: muistilistan alitehtävät (vain elävät; ryhmitellään renderissä).
  const [checklistAll, setChecklistAll] = useState<readonly TaskChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  // T113: refresh-sarjanumero — myöhästynyt vastausrivi (esim. raahauksen
  // ja näppäimistösiirron päällekkäiset haut) ei saa ylikirjoittaa uudempaa
  // tilaa vanhalla snapshotilla.
  const refreshSeq = useRef(0);
  // T114: massavalinta (valmiit rivit) — tuhoava massapoisto VAATII
  // vahvistusdialogin (kriteeri: ei vahingossa tuhoavaa toimintoa).
  const [selectedDone, setSelectedDone] = useState<readonly string[]>([]);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkWorking, setBulkWorking] = useState(false);
  // T122: massasiirron kohdeprojekti + projektioptiot sekä keskittymismoodi
  // (komposiittinäkymä tarvitsee vain tasks+projects — sama raja kuin T080,
  // ei hakuketjuja komponentissa; hookit aina samassa järjestyksessä).
  const [moveTarget, setMoveTarget] = useState("");
  const [moveSource, setMoveSource] = useState<"valitut" | "kaikki" | null>(null);
  const [projectOptions, setProjectOptions] = useState<
    readonly { readonly value: string; readonly label: string }[]
  >([]);
  const [focusProject, setFocusProject] = useState("");
  // T122: arkistonäkymän massasiirto-projektiin kerralla (kaikki valinnalla
  // tai kaikki valmiit kerralla).
  const setTagFilter = useCallback(
    (tagId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (tagId === null) {
        next.delete("tag");
      } else {
        next.set("tag", tagId);
      }
      setSearchParams(next, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );
  // T112: muokkausnäkymä avataan ?task=<id> -parametrilla (TaskRoute jakaa).
  const openTask = useCallback(
    (id: string) => {
      const next = new URLSearchParams(searchParams);
      next.set("task", id);
      setSearchParams(next, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );
  const setShowUpcoming = useCallback(
    (value: boolean) => {
      const next = new URLSearchParams(searchParams);
      if (value) {
        next.set("upcoming", "1");
      } else {
        next.delete("upcoming");
        next.delete("period");
      }
      setSearchParams(next, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );
  const setPeriod = useCallback(
    (value: TaskPeriodKey | "kaikki") => {
      const next = new URLSearchParams(searchParams);
      if (value === "kaikki") {
        next.delete("period");
      } else {
        next.set("upcoming", "1");
        next.set("period", value);
      }
      setSearchParams(next, { preventScrollReset: true });
    },
    [searchParams, setSearchParams],
  );
  const refresh = useCallback(async () => {
    const seq = ++refreshSeq.current;
    const [listed, listedTags, listedChecklist, listedProjects] = await Promise.all([
      tasks.list(),
      tags.list(),
      taskChecklistItems.list(),
      projects.list(),
    ]);
    if (refreshSeq.current !== seq) {
      // Uudempi haku on jo päivittänyt tilan — ohita myöhästynyt snapshot.
      return;
    }
    if (listed.ok) {
      const day = localDayInfo();
      setRows(splitRows(listed.value, day.localDate, day.timezoneOffsetMinutes));
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    if (listedTags.ok) {
      setTagList(listedTags.value.filter((tag) => tag.deletedAt === null));
    }
    if (listedChecklist.ok) {
      setChecklistAll(listedChecklist.value.filter((item) => item.deletedAt === null));
    }
    if (listedProjects.ok) {
      setProjectOptions(
        listedProjects.value
          .filter((project) => project.deletedAt === null)
          .map((project) => ({ value: project.id, label: project.name })),
      );
    }
    if (listed.ok) {
      // T114: pudota valinnat joiden kohderivi ei ole enää valmiina (poistettu
      // tai avattu uudelleen toisesta näkymästä).
      setSelectedDone((prev) =>
        prev.filter((id) =>
          listed.value.some(
            (task) => task.id === id && task.status === "done" && task.deletedAt === null,
          ),
        ),
      );
    }
    setLoading(false);
  }, [tasks, tags, taskChecklistItems, projects]);
  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => undefined);
      }
    };
    void refresh()
      .catch(() => undefined)
      .finally(() => {
        if (!shouldStop(guard)) {
          setLoading(false);
        }
      });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  // T114: massatoiminnot — poisto (tuhoava → vahvistus) ja avaus uudelleen.
  const toggleDoneSelect = useCallback((id: string): void => {
    setSelectedDone((prev) =>
      prev.includes(id) ? prev.filter((value) => value !== id) : [...prev, id],
    );
  }, []);
  const bulkDelete = useCallback(async (): Promise<void> => {
    setBulkWorking(true);
    try {
      const serviceDeps = { clock: systemClock(), tasks };
      for (const id of selectedDone) {
        await deleteTaskService(serviceDeps, id);
      }
      setSelectedDone([]);
      setBulkConfirmOpen(false);
      await refresh().catch(() => undefined);
    } finally {
      setBulkWorking(false);
    }
  }, [refresh, selectedDone, tasks]);
  const bulkReopen = useCallback(async (): Promise<void> => {
    setBulkWorking(true);
    try {
      const serviceDeps = { clock: systemClock(), tasks };
      for (const id of selectedDone) {
        await reopenTaskService(serviceDeps, id);
      }
      setSelectedDone([]);
      await refresh().catch(() => undefined);
    } finally {
      setBulkWorking(false);
    }
  }, [refresh, selectedDone, tasks]);

  // T122: arkistonäkymän massasiirto projekteihin kerralla (kaikki valinnalla
  // tai kaikki valmiit kerralla). Lähde määrää listan: valitut = nykyinen
  // massavalinta, kaikki = kaikki valmiit rivit kerralla.
  const bulkMove = useCallback(async (): Promise<void> => {
    const source = moveSource;
    if (source === null || moveTarget === "" || rows === undefined) {
      return;
    }
    const ids =
      source === "kaikki"
        ? rows.done.map((row) => (row.status === "done" && row.deletedAt === null ? row.id : ""))
        : selectedDone;
    const validIds = ids.filter((id) => id !== "");
    if (validIds.length === 0) {
      return;
    }
    const projectId = moveTarget === "none" ? null : moveTarget;
    setBulkWorking(true);
    try {
      const serviceDeps = { clock: systemClock(), tasks };
      for (const id of validIds) {
        await updateTaskService(serviceDeps, id, { projectId });
      }
      setSelectedDone([]);
      setMoveTarget("");
      setMoveSource(null);
      await refresh().catch(() => undefined);
    } finally {
      setBulkWorking(false);
    }
  }, [moveSource, moveTarget, rows, selectedDone, refresh, tasks]);
  // T115: "aloita 5 minuutiksi" — käynnistää lyhyen focus-session tehtävälle
  // (300 s, running heti). §8: aloitus mahdollisimman matalalla kynnyksellä.
  const [focusStartingId, setFocusStartingId] = useState<string | null>(null);
  const [focusStartedId, setFocusStartedId] = useState<string | null>(null);
  const startFiveMinutes = useCallback(
    async (id: string): Promise<void> => {
      if (focusStartingId !== null) {
        return;
      }
      setFocusStartingId(id);
      try {
        const focusDeps = { clock: systemClock(), sessions: focusSessions };
        const created = await startFocusSession(focusDeps, {
          taskId: id,
          plannedSeconds: FIVE_MINUTE_START_SECONDS,
        });
        if (!created.ok) {
          return;
        }
        const running = await beginFocusSession(focusDeps, created.value.id);
        if (running.ok) {
          setFocusStartedId(id);
          window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
        }
      } finally {
        setFocusStartingId(null);
      }
    },
    [focusSessions, focusStartingId],
  );

  const handleComplete = useCallback(
    async (id: string): Promise<void> => {
      // T110: offset mukana → toistuvan tehtävän seuraava instanssi syntyy
      // deterministisesti (§50 — ei kellolta arvausta). T117: XP-repo mukana
      // → completion tuottaa idempotentin XP-tapahtuman.
      const done = await completeTaskService({ clock: systemClock(), tasks, xpTransactions }, id, {
        timezoneOffsetMinutes: localDayInfo().timezoneOffsetMinutes,
      });
      if (done.ok) {
        window.dispatchEvent(new Event("lifeos:data-changed"));
        await refresh().catch(() => undefined);
      }
    },
    [refresh, tasks, xpTransactions],
  );
  const handleReopen = useCallback(
    async (id: string): Promise<void> => {
      const opened = await reopenTaskService({ clock: systemClock(), tasks }, id);
      if (opened.ok) {
        await refresh().catch(() => undefined);
      }
    },
    [refresh, tasks],
  );
  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      const deleted = await deleteTaskService({ clock: systemClock(), tasks }, id);
      if (deleted.ok) {
        await refresh().catch(() => undefined);
      }
    },
    [refresh, tasks],
  );

  if (loading) {
    return (
      <section aria-label={t("Tehtävät")} data-testid="task-inbox">
        <Display>{t("Tehtävät")}</Display>
        <Skeleton lines={3} label={t("Ladataan tehtäviä…")} />
      </section>
    );
  }
  const allRows: InboxRows | undefined = rows;
  // T106: tagisuodatus rajaa molemmat tilat ENNEN ryhmittelyä ja laskentaa —
  // kaikki näkymät (inbox, Myöhässä/Seuraavat, jaksot) noudattavat suodatusta.
  const activeTag =
    tagParam !== null && tagList.some((tag) => tag.id === tagParam) ? tagParam : null;
  const grouped: InboxRows | undefined =
    allRows === undefined
      ? undefined
      : activeTag === null && focusProject === ""
        ? allRows
        : {
            open: allRows.open.filter(
              (row) =>
                (activeTag === null || row.tagIds.includes(activeTag)) &&
                (focusProject === "" || row.projectId === focusProject),
            ),
            done: allRows.done.filter(
              (row) =>
                (activeTag === null || row.tagIds.includes(activeTag)) &&
                (focusProject === "" || row.projectId === focusProject),
            ),
          };
  // T103: Seuraavat/Myöhässä-ryhmittely ladatusta listasta (ei uutta hakua) —
  // paikallispäivä selaimen offsetilla (sama laskenta kuin TodayView).
  // done-status EI kulje ryhmittelyyn mukaan — upcoming/overdue ovat open-rivejä.
  const dayInfo = localDayInfo();
  const upcomingInput = grouped === undefined ? undefined : localDayInput(grouped.open);
  const upcomingGroups =
    upcomingInput === undefined ? undefined : groupTasksUpcoming(upcomingInput);
  // T104: jaksonäkymä (päivä/viikko/kuukausi) — kokoaa due- ja completed-
  // ryhmät valitulle ajanjaksolle; "kaikki" = T103-näkymä sellaisenaan.
  const periodGroups =
    showUpcoming && period !== "kaikki" && grouped !== undefined
      ? groupTasksInPeriod({
          tasks: [...grouped.open, ...grouped.done],
          period,
          localDate: dayInfo.localDate,
          timezoneOffsetMinutes: dayInfo.timezoneOffsetMinutes,
        })
      : undefined;
  const periodHasContent =
    periodGroups !== undefined &&
    ((upcomingGroups?.overdue.length ?? 0) > 0 ||
      periodGroups.dueInPeriod.length > 0 ||
      periodGroups.completedInPeriod.length > 0);
  // T111: suunnittelun yhteisarvio (myöhässä + valittu jakso / kaikki).
  const planningTasks =
    showUpcoming && upcomingGroups !== undefined
      ? period === "kaikki"
        ? [...upcomingGroups.overdue, ...upcomingGroups.upcoming]
        : (periodGroups?.dueInPeriod ?? [])
      : [];
  const planningEstimate = sumEstimateMinutes(planningTasks);
  return (
    <section aria-label={t("Tehtävät")} data-testid="task-inbox">
      <Display>{t("Tehtävät")}</Display>
      <Meta>
        {grouped !== undefined
          ? tTemplate("{{0}} avoinna, {{1}} valmista", [
              String(grouped.open.length),
              String(grouped.done.length),
            ])
          : "—"}
      </Meta>
      {loadFailed ? (
        <Alert tone="warning" title={t("Tehtäviä ei voitu ladata")}>
          <p>
            {t("Näytetään viimeisin tunnettu tila. Yritä ladata näkymä uudelleen hetken kuluttua.")}
          </p>
        </Alert>
      ) : null}
      <p>
        <Button
          variant="secondary"
          data-testid="task-inbox-view-toggle"
          aria-pressed={showUpcoming}
          onClick={() => {
            setShowUpcoming(!showUpcoming);
          }}
        >
          {showUpcoming ? t("Näytä: kaikki") : t("Näytä: Seuraavat / Myöhässä")}
        </Button>
      </p>
      {showUpcoming ? (
        <div data-testid="task-period-select">
          <SegmentedControl
            label={t("Ajanjakso")}
            options={tOptions([...PERIOD_OPTIONS])}
            value={period}
            onOptionChange={(value) => {
              if (value === "kaikki" || isPeriodKey(value)) {
                setPeriod(value);
              }
            }}
          />
        </div>
      ) : null}
      {tagList.length > 0 || projectOptions.length > 0 ? (
        <div data-testid="task-focus-filter">
          <Select
            label={t("Keskittymisprojekti")}
            hint={t("Rajoita näkymä yhteen projektiin (ei valmiita hävitetä — suodatus).")}
            placeholder={t("Ei rajausta")}
            options={tOptions(projectOptions)}
            value={focusProject}
            onChange={(event) => {
              setFocusProject(event.target.value);
            }}
          />
        </div>
      ) : null}
      {tagList.length > 0 ? (
        <ul
          data-ui="tag-chip-list"
          data-testid="task-tag-filter"
          aria-label={t("Suodata tageilla")}
        >
          <li>
            <button
              type="button"
              data-ui="tag-chip"
              data-testid="tag-filter-all"
              aria-pressed={activeTag === null}
              onClick={() => {
                setTagFilter(null);
              }}
            >
              {t("Kaikki")}
            </button>
          </li>
          {tagList.map((tag) => (
            <li key={tag.id}>
              <button
                type="button"
                data-ui="tag-chip"
                data-testid={`tag-filter-${tag.name}`}
                aria-pressed={activeTag === tag.id}
                onClick={() => {
                  setTagFilter(activeTag === tag.id ? null : tag.id);
                }}
              >
                #{tag.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showUpcoming && planningEstimate > 0 ? (
        <div data-testid="task-planning-total">
          <Meta>
            {t("Suunnittelussa: arvio yht. ")}
            {formatMinutes(planningEstimate)}
          </Meta>
        </div>
      ) : null}
      {showUpcoming && period !== "kaikki" ? (
        periodGroups === undefined || !periodHasContent ? (
          <div data-testid="task-inbox-upcoming-empty">
            <EmptyState
              icon="check"
              title={tTemplate("Ei tehtäviä ajalla {{0}}.", [
                t(PERIOD_LABELS[period]).toLocaleLowerCase(getIntlLocale()),
              ])}
              hint={t("Vaihda ajanjaksoa yltä tai kirjaa uusi tehtävä FAB:sta.")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPeriod("kaikki");
                  }}
                >
                  {t("Näytä kaikki seuraavat")}
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {upcomingGroups !== undefined && upcomingGroups.overdue.length > 0 ? (
              <section data-testid="task-inbox-overdue" aria-label={t("Myöhässä olevat")}>
                <SectionHeading>
                  {t("Myöhässä (")}
                  {String(upcomingGroups.overdue.length)})
                </SectionHeading>
                <ul data-ui="card-log-list">
                  {upcomingGroups.overdue.map((row) => (
                    <li key={row.id} data-ui="card-log-row">
                      <div>
                        <input
                          type="checkbox"
                          id={`upcoming-${row.id}`}
                          data-ui="task-checkbox"
                          data-testid={`upcoming-check-${row.id}`}
                          aria-label={tTemplate("Merkitse valmiiksi: {{0}}", [row.title])}
                          onChange={() => void handleComplete(row.id)}
                        />{" "}
                        <label htmlFor={`upcoming-${row.id}`}>
                          <strong>{row.title}</strong> {t("— myöhässä")}
                        </label>
                      </div>
                      <Meta>
                        {t("Prioriteetti: ")}
                        {t(PRIORITY_LABELS[row.priority])}
                      </Meta>
                      <EstimateMeta task={row} />
                      <TagChips tagIds={row.tagIds} tags={tagList} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <div data-testid="task-period-range">
              <Meta>
                {periodGroups.startLocalDate === periodGroups.endLocalDate
                  ? tTemplate("Ajalla {{0}}", [formatFiDayYear(periodGroups.startLocalDate)])
                  : tTemplate("Ajalla {{0}} – {{1}}", [
                      formatFiDay(periodGroups.startLocalDate),
                      formatFiDayYear(periodGroups.endLocalDate),
                    ])}
              </Meta>
            </div>
            {periodGroups.dueInPeriod.length > 0 ? (
              <section
                data-testid="task-period-list"
                aria-label={tTemplate("{{0}} erääntyvät", [t(PERIOD_LABELS[period])])}
              >
                <SectionHeading>
                  {t(PERIOD_LABELS[period])} ({String(periodGroups.dueInPeriod.length)})
                </SectionHeading>
                <ul data-ui="card-log-list">
                  {periodGroups.dueInPeriod.map((row) => (
                    <li key={row.id} data-ui="card-log-row">
                      <div>
                        <input
                          type="checkbox"
                          id={`period-${row.id}`}
                          data-ui="task-checkbox"
                          data-testid={`period-check-${row.id}`}
                          aria-label={tTemplate("Merkitse valmiiksi: {{0}}", [row.title])}
                          onChange={() => void handleComplete(row.id)}
                        />{" "}
                        <label htmlFor={`period-${row.id}`}>
                          <strong>{row.title}</strong>
                          {isOverdue(row.dueAt, dayInfo.localDate, dayInfo.timezoneOffsetMinutes)
                            ? t(" — myöhässä")
                            : ""}
                        </label>
                      </div>
                      {row.dueAt !== null ? (
                        <Meta>
                          {t("Eräpäivä")}
                          {formatDueDateTime(row.dueAt, dayInfo.timezoneOffsetMinutes)}
                        </Meta>
                      ) : null}
                      <Meta>
                        {t("Prioriteetti: ")}
                        {t(PRIORITY_LABELS[row.priority])}
                      </Meta>
                      <EstimateMeta task={row} />
                      <TagChips tagIds={row.tagIds} tags={tagList} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {periodGroups.completedInPeriod.length > 0 ? (
              <section data-testid="task-period-done" aria-label={t("Valmiit ajalla")}>
                <SectionHeading>
                  {t("Valmiit ajalla (")}
                  {String(periodGroups.completedInPeriod.length)})
                </SectionHeading>
                <ul data-ui="card-log-list">
                  {periodGroups.completedInPeriod.map((row) => (
                    <li key={row.id} data-ui="card-log-row">
                      <div>
                        <input
                          type="checkbox"
                          id={`period-done-${row.id}`}
                          data-ui="task-checkbox"
                          data-testid={`period-done-check-${row.id}`}
                          checked
                          aria-label={tTemplate("Avaa uudelleen: {{0}}", [row.title])}
                          onChange={() => void handleReopen(row.id)}
                        />{" "}
                        <label htmlFor={`period-done-${row.id}`}>{row.title}</label>
                        <TagChips tagIds={row.tagIds} tags={tagList} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )
      ) : showUpcoming ? (
        upcomingGroups === undefined ||
        (upcomingGroups.overdue.length === 0 && upcomingGroups.upcoming.length === 0) ? (
          <div data-testid="task-inbox-upcoming-empty">
            <EmptyState
              icon="check"
              title={t("Ei myöhässä eikä tulevia tehtäviä.")}
              hint={t("Avoimet tehtävät ilman myöhästymistä ja tulevia deadlineja näkyvät täällä.")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setShowUpcoming(false);
                  }}
                >
                  {t("Näytä kaikki tehtävät")}
                </Button>
              }
            />
          </div>
        ) : (
          <>
            {upcomingGroups.overdue.length > 0 ? (
              <section data-testid="task-inbox-overdue" aria-label={t("Myöhässä olevat")}>
                <SectionHeading>
                  {t("Myöhässä (")}
                  {String(upcomingGroups.overdue.length)})
                </SectionHeading>
                <ul data-ui="card-log-list">
                  {upcomingGroups.overdue.map((row) => (
                    <li key={row.id} data-ui="card-log-row">
                      <div>
                        <input
                          type="checkbox"
                          id={`upcoming-${row.id}`}
                          data-ui="task-checkbox"
                          data-testid={`upcoming-check-${row.id}`}
                          aria-label={tTemplate("Merkitse valmiiksi: {{0}}", [row.title])}
                          onChange={() => void handleComplete(row.id)}
                        />{" "}
                        <label htmlFor={`upcoming-${row.id}`}>
                          <strong>{row.title}</strong> {t("— myöhässä")}
                        </label>
                      </div>
                      <Meta>
                        {t("Prioriteetti: ")}
                        {t(PRIORITY_LABELS[row.priority])}
                      </Meta>
                      <EstimateMeta task={row} />
                      <TagChips tagIds={row.tagIds} tags={tagList} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {upcomingGroups.upcoming.length > 0 ? (
              <section data-testid="task-inbox-upcoming" aria-label={t("Seuraavat tehtävät")}>
                <SectionHeading>
                  {t("Seuraavat (")}
                  {String(upcomingGroups.upcoming.length)})
                </SectionHeading>
                <ul data-ui="card-log-list">
                  {upcomingGroups.upcoming.map((row) => (
                    <li key={row.id} data-ui="card-log-row">
                      <div>
                        <input
                          type="checkbox"
                          id={`upcoming-${row.id}`}
                          data-ui="task-checkbox"
                          data-testid={`upcoming-check-${row.id}`}
                          aria-label={tTemplate("Merkitse valmiiksi: {{0}}", [row.title])}
                          onChange={() => void handleComplete(row.id)}
                        />{" "}
                        <label htmlFor={`upcoming-${row.id}`}>
                          <strong>{row.title}</strong>
                        </label>
                      </div>
                      <Meta>
                        {t("Prioriteetti: ")}
                        {t(PRIORITY_LABELS[row.priority])}
                      </Meta>
                      <EstimateMeta task={row} />
                      <TagChips tagIds={row.tagIds} tags={tagList} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )
      ) : grouped === undefined || (grouped.open.length === 0 && grouped.done.length === 0) ? (
        <div data-testid="task-inbox-empty">
          {activeTag !== null ? (
            <EmptyState
              icon="check"
              title={tTemplate("Ei tehtäviä tagilla #{{0}}.", [
                tagList.find((tag) => tag.id === activeTag)?.name ?? "",
              ])}
              hint={t("Poista suodatus nähdäksesi kaikki tehtävät.")}
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTagFilter(null);
                  }}
                >
                  {t("Näytä kaikki tehtävät")}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon="add"
              title={t("Ei tehtäviä.")}
              hint={t("Kirjaa ensimmäinen FAB:sta — se ilmestyy tänne heti.")}
            />
          )}
        </div>
      ) : (
        <>
          {grouped.open.length > 0 ? (
            <section data-testid="task-inbox-open" aria-label={t("Avoimet tehtävät")}>
              <SectionHeading>
                {t("Avoimet (")}
                {String(grouped.open.length)})
              </SectionHeading>
              <ul data-ui="card-log-list">
                {grouped.open.map((row) => (
                  <li key={row.id} data-ui="card-log-row">
                    <div>
                      <input
                        type="checkbox"
                        id={`inbox-${row.id}`}
                        data-ui="task-checkbox"
                        data-testid={`inbox-check-${row.id}`}
                        aria-label={tTemplate("Merkitse valmiiksi: {{0}}", [row.title])}
                        onChange={() => void handleComplete(row.id)}
                      />{" "}
                      <label htmlFor={`inbox-${row.id}`}>
                        <strong>{row.title}</strong>
                        {isOverdue(row.dueAt, dayInfo.localDate, dayInfo.timezoneOffsetMinutes)
                          ? t(" — myöhässä")
                          : ""}
                      </label>
                      {row.dueAt !== null ? (
                        <Meta>
                          {t("Eräpäivä")}
                          {formatDueDateTime(row.dueAt, dayInfo.timezoneOffsetMinutes)}
                        </Meta>
                      ) : null}
                      <Meta>
                        {t("Prioriteetti: ")}
                        {t(PRIORITY_LABELS[row.priority])}
                      </Meta>
                      {hasRecurrence(row) ? (
                        <Meta>
                          {t("Toistuu: ")}
                          {t(RECURRENCE_LABELS[row.recurrence.kind])}
                        </Meta>
                      ) : null}
                      <EstimateMeta task={row} />
                      {focusStartedId === row.id ? (
                        <Meta data-testid={`task-focus-active-${row.id}`}>
                          {t("5 min -fokus käynnissä tehtävällä.")}
                        </Meta>
                      ) : null}
                      <TagChips tagIds={row.tagIds} tags={tagList} />
                      <TaskChecklist
                        taskId={row.id}
                        items={checklistAll.filter((item) => item.taskId === row.id)}
                        onChanged={() => {
                          void refresh().catch(() => undefined);
                        }}
                      />
                    </div>
                    <div>
                      <Button
                        variant="ghost"
                        data-testid={`task-start-${row.id}`}
                        loading={focusStartingId === row.id}
                        aria-label={tTemplate("Aloita 5 minuutin fokus: {{0}}", [row.title])}
                        onClick={() => {
                          void startFiveMinutes(row.id);
                        }}
                      >
                        {t("5 min")}
                      </Button>
                      <Button
                        variant="ghost"
                        data-testid={`task-edit-${row.id}`}
                        onClick={() => {
                          openTask(row.id);
                        }}
                      >
                        {t("Muokkaa")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {grouped.done.length > 0 ? (
            <section data-testid="task-inbox-done" aria-label={t("Valmiit tehtävät")}>
              <SectionHeading>
                {t("Valmiit (")}
                {String(grouped.done.length)})
              </SectionHeading>
              <ul data-ui="card-log-list">
                {grouped.done.map((row) => (
                  <li key={row.id} data-ui="card-log-row">
                    <div>
                      <input
                        type="checkbox"
                        id={`inbox-${row.id}`}
                        data-ui="task-checkbox"
                        data-testid={`inbox-reopen-${row.id}`}
                        checked
                        aria-label={tTemplate("Avaa uudelleen: {{0}}", [row.title])}
                        onChange={() => void handleReopen(row.id)}
                      />{" "}
                      <label htmlFor={`inbox-${row.id}`}>{row.title}</label>
                      <TagChips tagIds={row.tagIds} tags={tagList} />
                    </div>
                    <div>
                      <input
                        type="checkbox"
                        data-ui="task-checkbox"
                        data-testid={`bulk-select-${row.id}`}
                        aria-label={tTemplate("Valitse poistettavaksi: {{0}}", [row.title])}
                        checked={selectedDone.includes(row.id)}
                        onChange={() => {
                          toggleDoneSelect(row.id);
                        }}
                      />
                      <Button
                        variant="ghost"
                        data-testid={`task-edit-${row.id}`}
                        onClick={() => {
                          openTask(row.id);
                        }}
                      >
                        {t("Muokkaa")}
                      </Button>
                      <Button
                        variant="danger"
                        data-testid={`inbox-delete-${row.id}`}
                        onClick={() => void handleDelete(row.id)}
                      >
                        {t("Poista")}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {selectedDone.length > 0 ? (
            <div data-testid="bulk-bar" role="group" aria-label={t("Massatoiminnot")}>
              <Meta>
                {t("Valittu: ")}
                {String(selectedDone.length)}
              </Meta>
              <p>
                <Button
                  variant="secondary"
                  data-testid="bulk-reopen"
                  loading={bulkWorking}
                  onClick={() => void bulkReopen()}
                >
                  {t("Avaa uudelleen (")}
                  {String(selectedDone.length)})
                </Button>{" "}
                <Button
                  variant="danger"
                  data-testid="bulk-delete"
                  onClick={() => {
                    setBulkConfirmOpen(true);
                  }}
                >
                  {t("Poista valitut (")}
                  {String(selectedDone.length)})
                </Button>{" "}
                <Button
                  variant="ghost"
                  data-testid="bulk-clear"
                  onClick={() => {
                    setSelectedDone([]);
                    setMoveSource(null);
                  }}
                >
                  {t("Peruuta valinta")}
                </Button>
              </p>
            </div>
          ) : null}
          {grouped.done.length > 0 && moveSource === null ? (
            <p>
              <Button
                variant="ghost"
                data-testid="bulk-move-start"
                onClick={() => {
                  setMoveSource(selectedDone.length > 0 ? "valitut" : "kaikki");
                }}
              >
                {t("Siirrä projekteihin kerralla")}
              </Button>
            </p>
          ) : null}
          {moveSource !== null ? (
            <div data-testid="bulk-move" role="group" aria-label={t("Massasiirto projekteihin")}>
              <Meta>
                {t("Siirretään:")}{" "}
                {moveSource === "kaikki"
                  ? `kaikki valmiit (${String(grouped.done.length)})`
                  : `${String(selectedDone.length)} valittua`}
              </Meta>
              <Select
                label={t("Kohdeprojekti")}
                options={tOptions([{ value: "none", label: "Ei projektia" }, ...projectOptions])}
                value={moveTarget}
                disabled={bulkWorking}
                onChange={(event) => {
                  setMoveTarget(event.target.value);
                }}
              />
              <p>
                <Button
                  variant="secondary"
                  data-testid="bulk-move-confirm"
                  loading={bulkWorking}
                  disabled={moveTarget === "" || bulkWorking}
                  onClick={() => void bulkMove()}
                >
                  {t("Siirrä kohteeseen")}
                </Button>{" "}
                <Button
                  variant="ghost"
                  data-testid="bulk-move-cancel"
                  disabled={bulkWorking}
                  onClick={() => {
                    setMoveSource(null);
                    setMoveTarget("");
                  }}
                >
                  {t("Peruuta")}
                </Button>
              </p>
            </div>
          ) : null}
        </>
      )}
      <BottomSheet
        title={t("Vahvista poisto")}
        description={t("Poistetut tehtävät siirtyvät poistettuihin — historia säilyy.")}
        open={bulkConfirmOpen}
        onClose={() => {
          if (!bulkWorking) {
            setBulkConfirmOpen(false);
          }
        }}
      >
        <Meta data-testid="bulk-confirm-text">
          {t("Poistetaan")}
          {String(selectedDone.length)} {t("valittua tehtävää?")}
        </Meta>
        <p>
          <Button
            variant="danger"
            data-testid="bulk-confirm-delete"
            loading={bulkWorking}
            onClick={() => void bulkDelete()}
          >
            {t("Poista (")}
            {String(selectedDone.length)})
          </Button>{" "}
          <Button
            variant="secondary"
            data-testid="bulk-cancel-delete"
            disabled={bulkWorking}
            onClick={() => {
              setBulkConfirmOpen(false);
            }}
          >
            {t("Peruuta")}
          </Button>
        </p>
      </BottomSheet>
    </section>
  );
}

function shouldStop(guard: { readonly cancelled: boolean }): boolean {
  return guard.cancelled;
}
