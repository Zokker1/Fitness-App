// T272: yhteinen, paikallinen tapahtumahistoria tyypeittäin ja ajanjaksoittain.

import { t, tOptions, tTemplate, getIntlLocale, useLanguage } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useData } from "../../dataContext.tsx";
import { useGamificationVisibility } from "../../preferences/GamificationVisibilityContext.tsx";
import {
  buildHistoryRecords,
  type DataResult,
  type HistoryBrowserInput,
  type HistoryRecord,
  type HistoryRecordKind,
} from "@lifeos/data";
import {
  Alert,
  Button,
  Card,
  Display,
  EmptyState,
  Icon,
  Meta,
  SegmentedControl,
  Select,
  Skeleton,
} from "@lifeos/ui";
import type { IconKey } from "@lifeos/ui";
import "./HistoryBrowser.css";

type HistoryRange = "7" | "30" | "90" | "365" | "all";
type HistoryType = HistoryRecordKind | "all";

const RANGE_OPTIONS = [
  { value: "7", label: "7 pv" },
  { value: "30", label: "30 pv" },
  { value: "90", label: "90 pv" },
  { value: "365", label: "Vuosi" },
  { value: "all", label: "Kaikki" },
] as const;

const TYPE_LABELS: Readonly<Record<HistoryRecordKind, string>> = {
  task: "Tehtävät",
  focus: "Fokusistunnot",
  goal: "Tavoitepäivät",
  routine: "Rutiinit",
  measurement: "Mittaukset",
  food: "Ruoka",
  hydration: "Neste",
  sleep: "Uni",
  activity: "Liikunta",
  mood: "Hyvinvoinnin tarkistukset",
  journal: "Päiväkirja",
  supplement: "Lisäravinteet",
  breathing: "Hengitysharjoitukset",
  gamification: "Pelillistäminen",
};

const TYPE_ICONS: Readonly<Record<HistoryRecordKind, IconKey>> = {
  task: "tasks",
  focus: "focus",
  goal: "check",
  routine: "calendar",
  measurement: "health",
  food: "nutrition",
  hydration: "health",
  sleep: "health",
  activity: "health",
  mood: "health",
  journal: "info",
  supplement: "add",
  breathing: "focus",
  gamification: "insights",
};

const SYSTEM_RECORD_TITLES = new Set([
  "Fokusistunto",
  "Paino",
  "Verenpaine",
  "Verensokeri",
  "Lämpötila",
  "Happisaturaatio",
  "Kehon mitta",
  "Oma mittaus",
  "Vesimerkintä",
  "Päiväunet",
  "Uni",
  "Hyvinvoinnin tarkistus",
  "Päiväkirjamerkintä",
  "Lisäravinne",
  "Hengitysharjoitus",
  "Palkinto",
  "Palkinto ansaittu",
  "Keräilyesine avattu",
  "Saavutus ansaittu",
]);

function displayHistoryTitle(record: HistoryRecord): string {
  return SYSTEM_RECORD_TITLES.has(record.title) ? t(record.title) : record.title;
}

function displayHistoryDetail(detail: string): string {
  const exactTranslation = t(detail);
  if (exactTranslation !== detail) return exactTranslation;

  const routineProgress = detail.match(/^(\d+) \/ (\d+) vaihetta käsitelty$/u);
  if (routineProgress !== null) {
    return tTemplate("{{0}} / {{1}} vaihetta käsitelty", [routineProgress[1], routineProgress[2]]);
  }

  return detail
    .replace(/, laatuarvio /gu, `, ${t("laatuarvio")} `)
    .replace(/, pulssi /gu, `, ${t("pulssi")} `)
    .replace(/^Mieliala /u, `${t("Mieliala")} `)
    .replace(/^Lunastettu, (\d+) XP käytetty$/u, (_text, amount: string) =>
      tTemplate("Lunastettu, {{0}} XP käytetty", [amount]),
    )
    .replace(
      /^(Fokusistunto valmis|Fokusistunto peruttiin), (.+)$/u,
      (_text, label: string, value: string) => `${t(label)}, ${t(value)}`,
    );
}

const PAGE_SIZE = 60;

function readResult<T>(result: DataResult<T>): T {
  if (!result.ok) throw new Error(result.error.userMessage);
  return result.value;
}

function localDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year") ?? "0000"}-${values.get("month") ?? "00"}-${values.get("day") ?? "00"}`;
}

function recordDateKey(record: HistoryRecord): string | null {
  if (record.localDate !== undefined) return record.localDate;
  const date = new Date(record.occurredAt);
  return Number.isNaN(date.getTime()) ? null : localDateKey(date);
}

function rangeStart(today: string, range: HistoryRange): string | null {
  if (range === "all") return null;
  const days = Number(range);
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days + 1);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { hour: "2-digit", minute: "2-digit" }).format(
    new Date(timestamp),
  );
}

interface HistoryGroup {
  readonly dateKey: string;
  readonly records: readonly HistoryRecord[];
}

function groupByDate(records: readonly HistoryRecord[]): readonly HistoryGroup[] {
  const groups = new Map<string, HistoryRecord[]>();
  for (const record of records) {
    const dateKey = recordDateKey(record);
    if (dateKey === null) continue;
    const group = groups.get(dateKey) ?? [];
    group.push(record);
    groups.set(dateKey, group);
  }
  return [...groups.entries()].map(([dateKey, groupedRecords]) => ({
    dateKey,
    records: groupedRecords,
  }));
}

function HistoryRow({ record }: { readonly record: HistoryRecord }): React.JSX.Element {
  return (
    <li data-ui="history-browser-row" data-kind={record.kind}>
      <span data-ui="history-browser-icon" aria-hidden="true">
        <Icon name={TYPE_ICONS[record.kind]} />
      </span>
      <div data-ui="history-browser-copy">
        <div data-ui="history-browser-row-heading">
          <strong>{displayHistoryTitle(record)}</strong>
          <span data-ui="history-browser-kind">{t(TYPE_LABELS[record.kind])}</span>
        </div>
        <p>{displayHistoryDetail(record.detail)}</p>
      </div>
      {record.dateOnly ? null : (
        <time data-ui="history-browser-time" dateTime={record.occurredAt}>
          {formatTime(record.occurredAt)}
        </time>
      )}
    </li>
  );
}

export function HistoryBrowser(): React.JSX.Element {
  const { language } = useLanguage();
  const data = useData();
  const { visible: gamificationVisible } = useGamificationVisibility();
  const [records, setRecords] = useState<readonly HistoryRecord[]>([]);
  const [range, setRange] = useState<HistoryRange>("30");
  const [type, setType] = useState<HistoryType>("all");
  const [shownCount, setShownCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const latestRequest = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = latestRequest.current + 1;
    latestRequest.current = requestId;
    setLoading(true);
    setLoadError(false);
    try {
      const [
        taskResult,
        focusResult,
        goalResult,
        goalDayResult,
        routineResult,
        routineRunResult,
        measurementResult,
        nutritionResult,
        hydrationResult,
        sleepResult,
        activityResult,
        moodResult,
        journalResult,
        supplementResult,
        supplementLogResult,
        breathingResult,
        xpResult,
        vaultClaimResult,
        vaultRewardResult,
        userRewardResult,
        achievementResult,
        collectibleResult,
      ] = await Promise.all([
        data.tasks.list(),
        data.focusSessions.list(),
        data.goals.list(),
        data.goalDays.list(),
        data.routines.list(),
        data.routineRuns.list(),
        data.measurements.list(),
        data.nutritionEntries.list(),
        data.hydrationEntries.list(),
        data.sleepEntries.list(),
        data.activityEntries.list(),
        data.moodCheckins.list(),
        data.journalEntries.list(),
        data.supplements.list(),
        data.supplementLogs.list(),
        data.breathingSessions.list(),
        data.xpTransactions.list(),
        data.vaultClaims.list(),
        data.vaultRewards.list(),
        data.userRewards.list(),
        data.achievements.list(),
        data.collectibles.list(),
      ]);
      const input: HistoryBrowserInput = {
        locale: getIntlLocale(),
        tasks: readResult(taskResult),
        focusSessions: readResult(focusResult),
        goals: readResult(goalResult),
        goalDays: readResult(goalDayResult),
        routines: readResult(routineResult),
        routineRuns: readResult(routineRunResult),
        measurements: readResult(measurementResult),
        nutritionEntries: readResult(nutritionResult),
        hydrationEntries: readResult(hydrationResult),
        sleepEntries: readResult(sleepResult),
        activityEntries: readResult(activityResult),
        moodCheckins: readResult(moodResult),
        journalEntries: readResult(journalResult),
        supplements: readResult(supplementResult),
        supplementLogs: readResult(supplementLogResult),
        breathingSessions: readResult(breathingResult),
        xpTransactions: readResult(xpResult),
        vaultClaims: readResult(vaultClaimResult),
        vaultRewards: readResult(vaultRewardResult),
        userRewards: readResult(userRewardResult),
        achievements: readResult(achievementResult),
        collectibles: readResult(collectibleResult),
      };
      if (requestId === latestRequest.current) setRecords(buildHistoryRecords(input));
    } catch {
      if (requestId === latestRequest.current) setLoadError(true);
    } finally {
      if (requestId === latestRequest.current) setLoading(false);
    }
  }, [data]);

  useEffect(() => {
    void refresh();
    const onDataChanged = (): void => {
      void refresh();
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      latestRequest.current += 1;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  useEffect(() => {
    if (gamificationVisible !== true && type === "gamification") {
      setType("all");
      setShownCount(PAGE_SIZE);
    }
  }, [gamificationVisible, type]);

  const today = localDateKey(new Date());
  const filteredRecords = useMemo(() => {
    const from = rangeStart(today, range);
    return records.filter((record) => {
      if (gamificationVisible !== true && record.kind === "gamification") return false;
      if (type !== "all" && record.kind !== type) return false;
      const dateKey = recordDateKey(record);
      if (dateKey === null || dateKey > today) return false;
      return from === null || dateKey >= from;
    });
  }, [gamificationVisible, range, records, today, type]);

  const visibleRecords = useMemo(
    () => groupByDate(filteredRecords.slice(0, shownCount)),
    [filteredRecords, shownCount],
  );
  const typeOptions = useMemo(
    () => [
      { value: "all", label: t("Kaikki merkinnät", language) },
      ...Object.entries(TYPE_LABELS)
        .filter(([kind]) => gamificationVisible === true || kind !== "gamification")
        .map(([kind, label]) => ({ value: kind, label: t(label, language) })),
    ],
    [gamificationVisible, language],
  );

  return (
    <div data-ui="history-browser" data-testid="history-browser">
      <Display>{t("Historia")}</Display>
      <p data-ui="history-browser-intro">
        {t("Selaa tehtäviä, rutiineja ja kirjauksia samassa aikajanassa.")}
      </p>
      <Card heading={t("Rajaa historiaa")} data-testid="history-browser-controls">
        <div data-ui="history-browser-controls-grid">
          <SegmentedControl
            label={t("Ajanjakso")}
            options={tOptions(RANGE_OPTIONS)}
            value={range}
            disabled={loading}
            onOptionChange={(value) => {
              if (
                value === "7" ||
                value === "30" ||
                value === "90" ||
                value === "365" ||
                value === "all"
              ) {
                setRange(value);
                setShownCount(PAGE_SIZE);
              }
            }}
          />
          <Select
            label={t("Tapahtuman tyyppi")}
            options={tOptions(typeOptions)}
            value={type}
            disabled={loading}
            onChange={(event) => {
              setType(event.currentTarget.value as HistoryType);
              setShownCount(PAGE_SIZE);
            }}
          />
        </div>
        {!loading && !loadError ? (
          <p data-ui="meta" role="status">
            {filteredRecords.length > shownCount
              ? tTemplate("Näytetään {{0}} uusinta {{1}} merkinnästä", [
                  String(Math.min(shownCount, filteredRecords.length)),
                  String(filteredRecords.length),
                ])
              : filteredRecords.length === 1
                ? t("1 merkintä")
                : tTemplate("{{0}} merkintää", [String(filteredRecords.length)])}
          </p>
        ) : null}
      </Card>

      {loading ? <Skeleton lines={6} label={t("Ladataan historiaa…")} /> : null}
      {!loading && loadError ? (
        <Alert tone="warning" title={t("Historiaa ei voitu ladata")}>
          <p>{t("Tarkista tallennustila ja yritä uudelleen.")}</p>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t("Yritä uudelleen")}
          </Button>
        </Alert>
      ) : null}
      {!loading && !loadError && filteredRecords.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={
            records.length === 0
              ? t("Historiaa ei vielä ole")
              : t("Ei merkintöjä tällä rajauksella")
          }
          hint={
            records.length === 0
              ? t("Kun tallennat tehtävän, rutiinin tai muun kirjauksen, se ilmestyy tänne.")
              : "Valitse pidempi ajanjakso tai toinen tapahtuman tyyppi."
          }
        />
      ) : null}
      {!loading && !loadError && filteredRecords.length > 0 ? (
        <section data-ui="history-browser-results" aria-label={t("Historiatapahtumat")}>
          {visibleRecords.map((group) => (
            <section
              key={group.dateKey}
              data-ui="history-browser-day"
              aria-label={formatDate(group.dateKey)}
            >
              <h2>{formatDate(group.dateKey)}</h2>
              <ol>
                {group.records.map((record) => (
                  <HistoryRow key={record.key} record={record} />
                ))}
              </ol>
            </section>
          ))}
          {filteredRecords.length > shownCount ? (
            <div data-ui="history-browser-more">
              <Meta>
                {String(Math.min(shownCount, filteredRecords.length))} /{" "}
                {String(filteredRecords.length)} {t("merkintää")}
              </Meta>
              <Button
                variant="secondary"
                onClick={() => {
                  setShownCount((count) => count + PAGE_SIZE);
                }}
              >
                {t("Näytä vanhempia merkintöjä")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
