// T236: ruoka- ja lisäravinnelokit haetaan paikallisen päivän tai aikavälin mukaan.
import { getIntlLocale, t, tOptions, tTemplate, useLanguage } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Input, SegmentedControl, Select } from "@lifeos/ui";
import {
  getSupplementLogActivityAt,
  getSupplementLogStatus,
  listNutritionEntriesService,
  listSupplementLogsService,
  systemClock,
} from "@lifeos/data";
import type { NutritionEntry, Supplement, SupplementLog } from "@lifeos/domain";
import type { AppError } from "../../errors/appError.ts";
import { fromDataError, fromUnknown } from "../../errors/appError.ts";
import { useData } from "../../dataContext.tsx";

type HistoryMode = "day" | "range";
type HistoryFilter = "all" | "food" | "supplement";

interface DateRange {
  readonly from: string;
  readonly to: string;
}

interface HistoryItemBase {
  readonly id: string;
  readonly at: string;
  readonly label: string;
  readonly detail: string;
}

type HistoryItem =
  | (HistoryItemBase & { readonly type: "food" })
  | (HistoryItemBase & { readonly type: "supplement"; readonly status: string });

interface HistoryDay {
  readonly dateKey: string;
  readonly items: readonly HistoryItem[];
}

const HISTORY_MODE_OPTIONS = [
  { value: "day", label: "Yksi päivä" },
  { value: "range", label: "Aikaväli" },
] as const;

const HISTORY_FILTER_OPTIONS = [
  { value: "all", label: "Kaikki merkinnät" },
  { value: "food", label: "Vain ruoat" },
  { value: "supplement", label: "Vain lisäravinteet" },
] as const;

const amountFormat = {
  format: (value: number): string =>
    new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 1 }).format(value),
};
const calorieFormat = {
  format: (value: number): string =>
    new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 0 }).format(value),
};

function localDateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function localDateRange(fromDate: string, toDate: string): DateRange | null {
  const start = parseLocalDateKey(fromDate);
  const end = parseLocalDateKey(toDate);
  if (start === null || end === null || fromDate > toDate) return null;
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return {
    from: start.toISOString(),
    to: new Date(end.getTime() - 1).toISOString(),
  };
}

function formatDay(dateKey: string): string {
  const date = parseLocalDateKey(dateKey);
  if (date === null) return dateKey;
  return new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), { hour: "2-digit", minute: "2-digit" }).format(
    new Date(value),
  );
}

function createHistoryItems(
  nutritionEntries: readonly NutritionEntry[],
  supplementLogs: readonly SupplementLog[],
  supplements: readonly Supplement[],
): readonly HistoryItem[] {
  const supplementById = new Map(supplements.map((supplement) => [supplement.id, supplement]));
  const foodItems: HistoryItem[] = nutritionEntries.map((entry) => {
    const detailParts = [
      entry.amountG === null || entry.amountG === undefined
        ? "Määrä ei tiedossa"
        : `${amountFormat.format(entry.amountG)} g`,
      entry.calories === null
        ? "Energia ei tiedossa"
        : `${calorieFormat.format(entry.calories)} kcal`,
    ];
    return {
      type: "food",
      id: entry.id,
      at: entry.eatenAt,
      label: entry.label,
      detail: detailParts.join(", "),
    };
  });
  const supplementItems: HistoryItem[] = supplementLogs.map((log) => {
    const supplement = supplementById.get(log.supplementId);
    const status = getSupplementLogStatus(log);
    const statusLabel =
      status === "taken" ? "Otettu" : status === "skipped" ? "Ohitettu" : "Odottaa";
    const doseLabel =
      typeof log.doseAmount === "number" && typeof log.doseUnit === "string"
        ? `${amountFormat.format(log.doseAmount)} ${log.doseUnit}`
        : null;
    return {
      type: "supplement",
      id: log.id,
      at: getSupplementLogActivityAt(log),
      label: supplement?.name ?? "Lisäravinne",
      detail: [doseLabel, statusLabel].filter((part): part is string => part !== null).join(", "),
      status: statusLabel,
    };
  });
  return [...foodItems, ...supplementItems].sort(
    (left, right) => right.at.localeCompare(left.at) || left.id.localeCompare(right.id),
  );
}

function groupHistoryByDay(items: readonly HistoryItem[]): readonly HistoryDay[] {
  const groups = new Map<string, HistoryItem[]>();
  for (const item of items) {
    const dateKey = localDateKey(new Date(item.at));
    const dayItems = groups.get(dateKey) ?? [];
    dayItems.push(item);
    groups.set(dateKey, dayItems);
  }
  return [...groups].map(([dateKey, dayItems]) => ({ dateKey, items: dayItems }));
}

export function NutritionSupplementHistory(): React.JSX.Element {
  const { language } = useLanguage();
  const { foods, nutritionEntries, supplementLogs, supplements } = useData();
  const today = localDateKey(new Date());
  const [mode, setMode] = useState<HistoryMode>("day");
  const [day, setDay] = useState(today);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [activeRange, setActiveRange] = useState({ from: today, to: today });
  const [items, setItems] = useState<readonly HistoryItem[]>([]);
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<AppError | null>(null);
  const [rangeError, setRangeError] = useState("");
  const requestSequence = useRef(0);

  const searchHistory = useCallback(
    async (startDate: string, endDate: string): Promise<void> => {
      const range = localDateRange(startDate, endDate);
      if (range === null) {
        setRangeError(t("Valitse kelvollinen päivä tai aikaväli."));
        return;
      }
      const requestId = ++requestSequence.current;
      setActiveRange({ from: startDate, to: endDate });
      setLoading(true);
      setLoadError(null);
      setItems([]);
      try {
        const [nutritionResult, supplementResult, supplementsResult] = await Promise.all([
          listNutritionEntriesService(
            { clock: systemClock(), nutritionEntries, foods, mealSlots: [] },
            range,
          ),
          listSupplementLogsService({ clock: systemClock(), supplements, supplementLogs }, range),
          supplements.list(),
        ]);
        if (requestSequence.current !== requestId) return;
        if (!nutritionResult.ok) {
          setLoadError(fromDataError(nutritionResult.error));
          return;
        }
        if (!supplementResult.ok) {
          setLoadError(fromDataError(supplementResult.error));
          return;
        }
        if (!supplementsResult.ok) {
          setLoadError(fromDataError(supplementsResult.error));
          return;
        }
        setItems(
          createHistoryItems(
            nutritionResult.value,
            supplementResult.value,
            supplementsResult.value,
          ),
        );
      } catch (error: unknown) {
        if (requestSequence.current === requestId) setLoadError(fromUnknown(error));
      } finally {
        if (requestSequence.current === requestId) setLoading(false);
      }
    },
    [foods, nutritionEntries, supplementLogs, supplements],
  );

  useEffect(() => {
    void searchHistory(today, today);
    return () => {
      requestSequence.current += 1;
    };
  }, [searchHistory, today]);

  useEffect(() => {
    const handleDataChanged = (): void => {
      void searchHistory(activeRange.from, activeRange.to);
    };
    window.addEventListener("lifeos:data-changed", handleDataChanged);
    return () => {
      window.removeEventListener("lifeos:data-changed", handleDataChanged);
    };
  }, [activeRange.from, activeRange.to, searchHistory]);

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(getIntlLocale(language));
    return items.filter((item) => {
      if (filter !== "all" && item.type !== filter) return false;
      return (
        normalizedQuery === "" ||
        `${item.label} ${item.detail}`
          .toLocaleLowerCase(getIntlLocale(language))
          .includes(normalizedQuery)
      );
    });
  }, [filter, items, language, query]);
  const days = useMemo(() => groupHistoryByDay(filteredItems), [filteredItems]);

  const submit = (event: React.SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const startDate = mode === "day" ? day : fromDate;
    const endDate = mode === "day" ? day : toDate;
    const range = localDateRange(startDate, endDate);
    if (range === null) {
      setRangeError(
        startDate > endDate
          ? t("Aikavälin alkupäivä ei voi olla loppupäivää myöhemmin.")
          : t("Valitse kelvollinen päivä tai aikaväli."),
      );
      return;
    }
    setRangeError("");
    void searchHistory(startDate, endDate);
  };

  return (
    <Card
      heading={t("Ravinnon ja lisäravinteiden historia")}
      data-testid="nutrition-supplement-history"
    >
      <p data-ui="health-history-intro">
        {t("Hae aiempia ruokakirjauksia ja lisäravinnelokeja päivä kerrallaan tai aikaväliltä.")}
      </p>
      <form data-ui="health-history-search" noValidate onSubmit={submit}>
        <SegmentedControl
          label={t("Ajanjakso")}
          name="health-history-mode"
          options={tOptions(HISTORY_MODE_OPTIONS)}
          value={mode}
          disabled={loading}
          onOptionChange={(value) => {
            if (value === "day" || value === "range") {
              setMode(value);
              setRangeError("");
            }
          }}
        />
        <div data-ui="health-history-dates">
          {mode === "day" ? (
            <label data-ui="health-history-date">
              <span>{t("Päivä")}</span>
              <input
                type="date"
                value={day}
                disabled={loading}
                onChange={(event) => {
                  setDay(event.target.value);
                  setRangeError("");
                }}
              />
            </label>
          ) : (
            <>
              <label data-ui="health-history-date">
                <span>{t("Alkupäivä")}</span>
                <input
                  type="date"
                  value={fromDate}
                  disabled={loading}
                  onChange={(event) => {
                    setFromDate(event.target.value);
                    setRangeError("");
                  }}
                />
              </label>
              <label data-ui="health-history-date">
                <span>{t("Loppupäivä")}</span>
                <input
                  type="date"
                  value={toDate}
                  disabled={loading}
                  onChange={(event) => {
                    setToDate(event.target.value);
                    setRangeError("");
                  }}
                />
              </label>
            </>
          )}
        </div>
        <div data-ui="health-history-filters">
          <Select
            label={t("Merkinnät")}
            options={tOptions(HISTORY_FILTER_OPTIONS)}
            value={filter}
            disabled={loading}
            onChange={(event) => {
              setFilter(event.target.value as HistoryFilter);
            }}
          />
          <Input
            label={t("Etsi nimellä tai tiedolla")}
            placeholder={t("Esim. kaurapuuro")}
            value={query}
            disabled={loading}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        {rangeError !== "" ? (
          <p data-ui="field-error" role="alert">
            {t(rangeError)}
          </p>
        ) : null}
        <Button type="submit" variant="secondary" loading={loading} disabled={loading}>
          {t("Hae historia")}
        </Button>
      </form>

      {loading ? <p role="status">{t("Haetaan kirjauksia…")}</p> : null}
      {!loading && loadError !== null ? (
        <p data-ui="health-history-error" role="alert">
          {loadError.body}
        </p>
      ) : null}
      {!loading && loadError === null ? (
        <>
          <p data-ui="health-history-result-count" role="status">
            {filteredItems.length === 1
              ? t("1 merkintä.")
              : tTemplate("{{0}} merkintää.", [String(filteredItems.length)])}{" "}
            {activeRange.from === activeRange.to
              ? tTemplate("Päivä {{0}}", [formatDay(activeRange.from)])
              : tTemplate("Aikaväli {{0}} – {{1}}", [
                  formatDay(activeRange.from),
                  formatDay(activeRange.to),
                ])}
          </p>
          {days.length === 0 ? (
            <p data-ui="health-history-empty">
              {t("Tältä haulta ei löytynyt merkintöjä. Kokeile toista päivää tai aikaväliä.")}
            </p>
          ) : (
            <div data-ui="health-history-days">
              {days.map((group) => (
                <section key={group.dateKey} aria-label={formatDay(group.dateKey)}>
                  <h3>{formatDay(group.dateKey)}</h3>
                  <ol>
                    {group.items.map((item) => (
                      <li key={`${item.type}-${item.id}`} data-kind={item.type}>
                        <time dateTime={item.at}>{formatTime(item.at)}</time>
                        <div data-ui="health-history-item-copy">
                          <strong>{item.label}</strong>
                          <span data-ui="health-history-kind">
                            {item.type === "food"
                              ? t("Ruoka")
                              : tTemplate("Lisäravinne, {{0}}", [item.status])}
                          </span>
                          <span>{item.detail}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </>
      ) : null}
    </Card>
  );
}
