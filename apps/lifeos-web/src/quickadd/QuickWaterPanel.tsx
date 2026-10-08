// T092: Quick Water -paneeli. Yksi napautus = yksi lasillinen (250 ml) NYT.
// Ei lomaketta, ei määräkyselyä (Keep it Simple, §21: kirjaus alle
// sekunnissa). Paneeli näyttää: ison kirjausnapin + päivän saldon
// (summataan kutsujan antamista kirjauksista) + "Kirjaa toinen" pysyy
// samana nappina (sama toiminto toistuu). Virhetilassa rehellinen viesti,
// ei hiljaista feikkiä. onLogged(entry) → kutsuja (QuickAdd) dispatchaa
// dataChanged-eventin; sulkeminen on kutsujan vastuulla.
import { t, tTemplate } from "../language.tsx";
import { useRef, useState } from "react";
import { Button, NumberInput } from "@lifeos/ui";
import {
  createHydrationEntryService,
  HYDRATION_ENTRY_MILLILITERS_MAXIMUM,
  hydrationProgressPercent,
  systemClock,
  type HydrationReminderCondition,
  type EntityRepository,
} from "@lifeos/data";
import type { HydrationEntry, UtcTimestamp, XPTransaction } from "@lifeos/domain";
import "./quick-water.css";

export const QUICK_WATER_MILLILITERS = 250;
export const HYDRATION_QUICK_AMOUNTS = [150, 250, 330, 500] as const;

export interface QuickWaterPanelProps {
  readonly hydrationEntries: EntityRepository<HydrationEntry>;
  readonly xpTransactions?: EntityRepository<XPTransaction> | undefined;
  readonly todayMilliliters: number;
  readonly targetMilliliters?: number | null | undefined;
  readonly reminderCondition?: HydrationReminderCondition | null | undefined;
  readonly now?: UtcTimestamp | undefined;
  readonly onLogged: (entry: HydrationEntry) => void;
}

export function QuickWaterPanel({
  hydrationEntries,
  xpTransactions,
  todayMilliliters,
  targetMilliliters = null,
  reminderCondition = null,
  now,
  onLogged,
}: QuickWaterPanelProps): React.JSX.Element {
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [loggedMilliliters, setLoggedMilliliters] = useState(0);
  const [lastLoggedMilliliters, setLastLoggedMilliliters] = useState<number | null>(null);
  const [customAmountDraft, setCustomAmountDraft] = useState("");

  const logAmount = (milliliters: number): void => {
    if (savingRef.current) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    const drunkAt = now ?? systemClock().nowIso();
    void createHydrationEntryService(
      {
        clock: systemClock(),
        hydrationEntries,
        ...(xpTransactions === undefined ? {} : { xpTransactions }),
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      },
      { drunkAt, milliliters },
    )
      .then((result) => {
        if (!result.ok) {
          setError(result.error.userMessage);
          return;
        }
        setLoggedMilliliters((total) => total + milliliters);
        setLastLoggedMilliliters(milliliters);
        onLogged(result.value);
      })
      .catch(() => {
        setError(t("Tallennus epäonnistui. Yritä uudelleen."));
      })
      .finally(() => {
        savingRef.current = false;
        setSaving(false);
      });
  };

  const customAmount = customAmountDraft.trim() === "" ? null : Number(customAmountDraft);
  const customAmountValid =
    customAmount !== null &&
    Number.isInteger(customAmount) &&
    customAmount >= 1 &&
    customAmount <= HYDRATION_ENTRY_MILLILITERS_MAXIMUM;
  const adjustCustomAmount = (delta: number): void => {
    const current = Number(customAmountDraft);
    const base = Number.isInteger(current) ? current : 0;
    const next = Math.max(1, Math.min(HYDRATION_ENTRY_MILLILITERS_MAXIMUM, base + delta));
    setCustomAmountDraft(String(next));
  };

  const total = todayMilliliters + loggedMilliliters;
  const progress = hydrationProgressPercent(total, targetMilliliters);
  return (
    <div data-ui="quick-water-panel" data-testid="quick-water-panel">
      <p data-ui="meta" data-testid="quick-water-balance">
        {t("Tänään")} {String(total)} {t("ml")}
      </p>
      {targetMilliliters !== null ? (
        <p data-ui="meta" data-testid="quick-water-target">
          {t("Tavoite")} {String(targetMilliliters)} {t(" ml · ")}
          {String(progress)}%
        </p>
      ) : null}
      {reminderCondition?.shouldRemind === true ? (
        <p data-ui="meta" data-testid="quick-water-reminder" role="status">
          {t("Tämän päivän kirjattu määrä on")}
          {String(reminderCondition.millilitersToday)} /{" "}
          {String(reminderCondition.targetMilliliters)} {t(" ml. Tavoitteesta puuttuu vielä")}{" "}
          {String(reminderCondition.shortfallMilliliters)} {t("ml.")}
        </p>
      ) : null}
      {lastLoggedMilliliters !== null ? (
        <p data-ui="meta" data-testid="quick-water-confirmation" role="status">
          {t("Kirjattu")} {String(lastLoggedMilliliters)} {t("ml.")}
        </p>
      ) : null}
      {error !== "" ? (
        <p data-ui="field-error" role="alert">
          {t(error)}
        </p>
      ) : null}
      <div data-ui="quick-water-controls">
        <fieldset>
          <legend>{t("Kirjaa valmis määrä")}</legend>
          <div data-ui="quick-water-presets">
            {HYDRATION_QUICK_AMOUNTS.map((milliliters) => (
              <Button
                key={milliliters}
                type="button"
                variant={milliliters === QUICK_WATER_MILLILITERS ? "primary" : "secondary"}
                disabled={saving}
                data-testid={`quick-water-preset-${String(milliliters)}`}
                onClick={() => {
                  logAmount(milliliters);
                }}
              >
                {t("Kirjaa")} {String(milliliters)} {t("ml")}
              </Button>
            ))}
          </div>
        </fieldset>
        <section data-ui="quick-water-custom">
          <h3>{t("Oma määrä")}</h3>
          <div data-ui="quick-water-stepper">
            <Button
              type="button"
              variant="secondary"
              disabled={saving}
              aria-label={t("Vähennä 50 millilitraa")}
              onClick={() => {
                adjustCustomAmount(-50);
              }}
            >
              −50
            </Button>
            <NumberInput
              label={t("Määrä (ml)")}
              min={1}
              max={HYDRATION_ENTRY_MILLILITERS_MAXIMUM}
              step={1}
              inputMode="numeric"
              value={customAmountDraft}
              disabled={saving}
              error={
                customAmount === null || customAmountValid
                  ? undefined
                  : tTemplate("Anna kokonaisluku 1–{{0}} ml.", [
                      String(HYDRATION_ENTRY_MILLILITERS_MAXIMUM),
                    ])
              }
              onChange={(event) => {
                setCustomAmountDraft(event.target.value);
              }}
              data-testid="quick-water-custom-amount"
            />
            <Button
              type="button"
              variant="secondary"
              disabled={
                saving ||
                (customAmount !== null && customAmount >= HYDRATION_ENTRY_MILLILITERS_MAXIMUM)
              }
              aria-label={t("Lisää 50 millilitraa")}
              onClick={() => {
                adjustCustomAmount(50);
              }}
            >
              +50
            </Button>
          </div>
          <Button
            type="button"
            variant="primary"
            loading={saving}
            disabled={saving || !customAmountValid}
            data-testid="quick-water-custom-submit"
            onClick={() => {
              if (customAmountValid) {
                logAmount(customAmount);
              }
            }}
          >
            {t("Kirjaa oma määrä")}
          </Button>
        </section>
      </div>
    </div>
  );
}
