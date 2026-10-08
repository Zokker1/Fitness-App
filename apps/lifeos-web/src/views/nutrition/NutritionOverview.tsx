import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Alert, Button, Card, Display, LogCard, Meta, NumberInput } from "@lifeos/ui";
import type { HealthOverviewCard, SupplementStockEstimate } from "@lifeos/data";
import {
  clearSupplementStockService,
  setSupplementStockService,
  summarizeHealthOverview,
  SUPPLEMENT_STOCK_AMOUNT_MAXIMUM,
  systemClock,
} from "@lifeos/data";
import type { Supplement } from "@lifeos/domain";
import { useData } from "../../dataContext.tsx";
import { useHydrationTarget } from "../../preferences/HydrationTargetContext.tsx";
import { HydrationTargetSettings } from "../../preferences/HydrationTargetSettings.tsx";
import { MacroTargetsSettings } from "../../preferences/MacroTargetsSettings.tsx";
import { MealSlotsSettings } from "../../preferences/MealSlotsSettings.tsx";
import { NutritionDiary } from "../health/NutritionDiary.tsx";
import { NutritionEntryForm } from "../health/NutritionEntryForm.tsx";
import { NutritionSupplementHistory } from "../health/NutritionSupplementHistory.tsx";
import "./nutrition-overview.css";

type NutritionSummaryCard = Extract<
  HealthOverviewCard,
  { readonly id: "hydration" | "supplements" }
>;

function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits }).format(value);
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function SupplementStockControl({
  supplement,
  estimate,
  onSave,
  onClear,
}: {
  readonly supplement: Supplement;
  readonly estimate: SupplementStockEstimate;
  readonly onSave: (supplementId: string, amount: number) => Promise<string | null>;
  readonly onClear: (supplementId: string) => Promise<string | null>;
}): React.JSX.Element {
  const [draft, setDraft] = useState(
    supplement.stockAmount === undefined || supplement.stockAmount === null
      ? ""
      : String(supplement.stockAmount),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const canTrack =
    typeof supplement.amount === "number" &&
    typeof supplement.unit === "string" &&
    supplement.unit.trim().length > 0;

  useEffect(() => {
    setDraft(
      supplement.stockAmount === undefined || supplement.stockAmount === null
        ? ""
        : String(supplement.stockAmount),
    );
  }, [supplement.stockAmount, supplement.stockCountedAt]);

  const save = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalized = draft.trim().replace(",", ".");
    const amount = normalized === "" ? Number.NaN : Number(normalized);
    if (!Number.isFinite(amount) || amount < 0 || amount > SUPPLEMENT_STOCK_AMOUNT_MAXIMUM) {
      setError(tTemplate("Anna saldo väliltä 0–{{0}}.", [String(SUPPLEMENT_STOCK_AMOUNT_MAXIMUM)]));
      setSaved(false);
      return;
    }
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await onSave(supplement.id, amount);
      setError(result ?? "");
      setSaved(result === null);
    } catch {
      setError("Saldoa ei voitu tallentaa.");
    } finally {
      setSaving(false);
    }
  };

  const clear = async (): Promise<void> => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await onClear(supplement.id);
      setError(result ?? "");
      setSaved(result === null);
    } catch {
      setError("Saldoarvion poistaminen ei onnistunut.");
    } finally {
      setSaving(false);
    }
  };

  const estimateText =
    estimate.status === "available"
      ? tTemplate(
          "Arvio jäljellä {{0}} {{1}}; kirjauksista vähennetty {{2}} {{3}} ({{4}} ottoa saldotarkistuksen jälkeen).",
          [
            formatNumber(estimate.remainingAmount ?? 0, 6),
            estimate.unit ?? "",
            formatNumber(estimate.consumedAmount ?? 0, 6),
            estimate.unit ?? "",
            String(estimate.takenLogCount),
          ],
        )
      : estimate.status === "not-set"
        ? canTrack
          ? "Saldoa ei ole vielä asetettu."
          : "Lisää ensin annos ja yksikkö, jotta saldoa voi arvioida."
        : estimate.reason === "unit-mismatch"
          ? tTemplate(
              "Annosyksikkö poikkeaa saldoyksiköstä ({{0}}). Laske saldo uudelleen nykyisellä määrällä.",
              [estimate.unit ?? "tuntematon"],
            )
          : estimate.reason === "missing-dose"
            ? "Saldoarviota ei voi laskea, koska otetusta kirjauksesta puuttuu annosmäärä."
            : "Saldoarvion lähtötiedot ovat puutteelliset.";

  return (
    <div data-ui="supplement-stock-row" data-testid={`supplement-stock-${supplement.id}`}>
      <Meta>
        <strong>{supplement.name}</strong> — {estimateText}
      </Meta>
      {canTrack ? (
        <form noValidate onSubmit={(event) => void save(event)}>
          <NumberInput
            label={tTemplate("Nykyinen saldo ({{0}})", [supplement.unit ?? "yksikkö"])}
            hint={t(
              "Kirjaa nyt näkemäsi määrä. Arvio vähentää siitä tämän jälkeen otetut annokset.",
            )}
            min={0}
            max={SUPPLEMENT_STOCK_AMOUNT_MAXIMUM}
            step="any"
            value={draft}
            disabled={saving}
            onChange={(event) => {
              setDraft(event.target.value);
              setError("");
              setSaved(false);
            }}
          />
          {error !== "" ? (
            <p data-ui="field-error" role="alert">
              {t(error)}
            </p>
          ) : null}
          {saved ? (
            <div role="status">
              <Meta>{t("Saldo tallennettu.")}</Meta>
            </div>
          ) : null}
          <p>
            <Button type="submit" variant="secondary" disabled={saving} loading={saving}>
              {t("Tallenna saldo")}
            </Button>{" "}
            {supplement.stockAmount !== undefined && supplement.stockAmount !== null ? (
              <Button
                type="button"
                variant="secondary"
                disabled={saving}
                onClick={() => void clear()}
              >
                {t("Lopeta saldoseuranta")}
              </Button>
            ) : null}
          </p>
        </form>
      ) : null}
    </div>
  );
}

function NutritionSummaryModule({
  card,
  onSaveStock,
  onClearStock,
}: {
  readonly card: NutritionSummaryCard;
  readonly onSaveStock: (supplementId: string, amount: number) => Promise<string | null>;
  readonly onClearStock: (supplementId: string) => Promise<string | null>;
}): React.JSX.Element {
  if (card.id === "hydration") {
    const targetMeta =
      card.targetMilliliters === null
        ? undefined
        : tTemplate("Päivän tavoite {{0}} ml · {{1}} %", [
            formatNumber(card.targetMilliliters, 0),
            String(card.progressPercent),
          ]);
    return (
      <LogCard
        heading={t("Neste")}
        rows={[
          {
            title: card.todayEntryCount > 0 ? "Tänään kirjattu" : "Tänään",
            meta: [
              card.latestEntry === null
                ? "Ei kirjauksia vielä"
                : `Viimeisin kirjaus ${formatDateTime(card.latestEntry.drunkAt)}`,
              targetMeta,
            ]
              .filter((value): value is string => value !== undefined)
              .join(". "),
            value:
              card.todayEntryCount > 0
                ? `${formatNumber(card.todayMilliliters, 0)} ml`
                : "Ei kirjauksia",
          },
        ]}
        emptyText={t("Ei nestekirjauksia vielä.")}
        data-testid="nutrition-module-hydration"
      />
    );
  }

  const visibleSupplements = card.supplements.slice(0, 4);
  const extraCount = Math.max(0, card.supplements.length - visibleSupplements.length);
  const rows = visibleSupplements.map((supplement) => {
    const doseLabel =
      typeof supplement.amount === "number" && typeof supplement.unit === "string"
        ? `${formatNumber(supplement.amount, 6)} ${supplement.unit}`
        : supplement.doseLabel;
    const scheduleLabel =
      supplement.schedule === undefined || supplement.schedule.length === 0
        ? undefined
        : `Aikataulu ${supplement.schedule.join(", ")}`;
    const meta = [doseLabel, scheduleLabel]
      .filter((value): value is string => value !== null && value !== undefined && value !== "")
      .join(" · ");
    return { title: supplement.name, ...(meta.length > 0 ? { meta } : {}) };
  });
  if (extraCount > 0) rows.push({ title: `${String(extraCount)} muuta` });
  const latestLog =
    card.latestLogAt === null ? undefined : `Viimeisin kirjaus ${formatDateTime(card.latestLogAt)}`;
  const todayLogs =
    card.todayLogCount === 0
      ? "Ei kirjauksia tänään"
      : [
          card.todayLogStatusCounts.taken > 0
            ? `Otettu ${String(card.todayLogStatusCounts.taken)}`
            : undefined,
          card.todayLogStatusCounts.skipped > 0
            ? `Ohitettu ${String(card.todayLogStatusCounts.skipped)}`
            : undefined,
          card.todayLogStatusCounts.pending > 0
            ? `Odottaa ${String(card.todayLogStatusCounts.pending)}`
            : undefined,
        ]
          .filter((value): value is string => value !== undefined)
          .join(", ");

  return (
    <div data-ui="nutrition-supplements-module">
      <LogCard
        heading={t("Lisäravinteet")}
        rows={rows.map((row, index) =>
          index === 0
            ? {
                ...row,
                meta: [row.meta, `${todayLogs}.`, latestLog].filter(Boolean).join(" "),
              }
            : row,
        )}
        emptyText={t("Ei käytössä olevia lisäravinnetietoja.")}
        data-testid="nutrition-module-supplements"
      />
      <Card heading={t("Saldoarviot")} data-ui="supplement-stock-list">
        <Meta>
          {t(
            "Syötä saldo annoksen samassa yksikössä. Arvio vähentää vain saldon tarkistuksen jälkeen otetut annokset.",
          )}
        </Meta>
        {card.supplements.map((supplement) => {
          const stock = card.stockEstimates.find((item) => item.supplementId === supplement.id);
          return (
            <SupplementStockControl
              key={supplement.id}
              supplement={supplement}
              estimate={
                stock?.estimate ?? {
                  status: "not-set",
                  startingAmount: null,
                  consumedAmount: null,
                  remainingAmount: null,
                  unit: supplement.unit ?? null,
                  takenLogCount: 0,
                  reason: null,
                }
              }
              onSave={onSaveStock}
              onClear={onClearStock}
            />
          );
        })}
      </Card>
    </div>
  );
}

export function NutritionOverview(): React.JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { hydrationEntries, supplements, supplementLogs } = useData();
  const hydrationTarget = useHydrationTarget();
  const [cards, setCards] = useState<readonly NutritionSummaryCard[] | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const refresh = useCallback(async () => {
    const [hydrationResult, supplementResult, logResult] = await Promise.all([
      hydrationEntries.list(),
      supplements.list(),
      supplementLogs.list(),
    ]);
    if (!hydrationResult.ok || !supplementResult.ok || !logResult.ok) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    const now = new Date().toISOString();
    const summary = summarizeHealthOverview({
      now,
      timezoneOffsetMinutes: -new Date(now).getTimezoneOffset(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      measurements: [],
      weightTarget: null,
      heightCm: null,
      sleepEntries: [],
      moodCheckins: [],
      hydrationEntries: hydrationResult.value,
      hydrationTargetMl: hydrationTarget.targetMilliliters,
      supplements: supplementResult.value,
      supplementLogs: logResult.value,
    });
    setCards(
      summary.cards.filter(
        (card): card is NutritionSummaryCard =>
          card.id === "hydration" || card.id === "supplements",
      ),
    );
    setLoadError(false);
    setLoading(false);
  }, [hydrationEntries, hydrationTarget.targetMilliliters, supplementLogs, supplements]);

  const saveSupplementStock = useCallback(
    async (supplementId: string, amount: number): Promise<string | null> => {
      const result = await setSupplementStockService(
        { clock: systemClock(), supplements },
        supplementId,
        amount,
      );
      if (!result.ok) return result.error.userMessage;
      await refresh();
      return null;
    },
    [refresh, supplements],
  );

  const clearSupplementStock = useCallback(
    async (supplementId: string): Promise<string | null> => {
      const result = await clearSupplementStockService(
        { clock: systemClock(), supplements },
        supplementId,
      );
      if (!result.ok) return result.error.userMessage;
      await refresh();
      return null;
    },
    [refresh, supplements],
  );

  useEffect(() => {
    let active = true;
    const runRefresh = (): void => {
      void refresh().catch(() => {
        if (active) {
          setLoadError(true);
          setLoading(false);
        }
      });
    };
    runRefresh();
    window.addEventListener("lifeos:data-changed", runRefresh);
    return () => {
      active = false;
      window.removeEventListener("lifeos:data-changed", runRefresh);
    };
  }, [refresh]);

  return (
    <div data-ui="nutrition-overview-page">
      <Display>{t("Ravinto")}</Display>
      <div data-ui="nutrition-overview-intro">
        <Meta>{t("Ruoka, neste ja lisäravinteet")}</Meta>
        <p>{t("Kirjaa päivän syömiset ja seuraa ravintotavoitteitasi.")}</p>
      </div>
      <section data-ui="nutrition-food-section" aria-label={t("Ruokakirjaukset")}>
        <Card heading={t("Omat ruoat")} data-testid="nutrition-food-library-entry">
          <p>{t("Lisää ruokia ja niiden ravintoarvoja omaan ruokakirjastoosi.")}</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => navigate({ pathname: "/nutrition/foods", search: location.search })}
          >
            {t("Avaa ruokakirjasto")}
          </Button>
        </Card>
        <NutritionEntryForm />
        <NutritionDiary />
      </section>
      {loading ? (
        <Card heading={t("Neste ja lisäravinteet")} data-testid="nutrition-summary-loading">
          <p role="status">{t("Ladataan neste- ja lisäravinnetietoja…")}</p>
        </Card>
      ) : loadError ? (
        <Alert tone="danger" title={t("Neste- ja lisäravinnetietoja ei voitu ladata")}>
          {t("Yritä uudelleen hetken kuluttua.")}
        </Alert>
      ) : cards !== undefined && cards.length > 0 ? (
        <section
          data-ui="nutrition-overview-grid"
          aria-label={t("Neste ja lisäravinteet")}
          data-testid="nutrition-overview-grid"
        >
          {cards.map((card) => (
            <NutritionSummaryModule
              key={card.id}
              card={card}
              onSaveStock={saveSupplementStock}
              onClearStock={clearSupplementStock}
            />
          ))}
        </section>
      ) : null}
      <NutritionSupplementHistory />
      <div data-ui="nutrition-settings">
        <MealSlotsSettings />
        <MacroTargetsSettings />
        <HydrationTargetSettings />
      </div>
    </div>
  );
}
