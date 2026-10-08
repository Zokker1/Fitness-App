// T090: Quick Add -avaus (§4, §21). FAB (brief periaate 1: aina sama paikka,
// aina sama label "Kirjaa") + keyboard-shortcut avaavat alustalle sopivan
// overlayn: mobiilissa bottom sheet, desktopissa keskitetty modal — valinta on
// CSS:ssä (T050 BottomSheet), ei JS-haaraa. Overlay on T050-perheen mukainen:
// focus-trap, Esc + scrim sulkevat, fokus palaa avaajaan. Sisältö (Quick Task
// yms.) tulee T091+:ssa — tässä vain valintalista joka reitittää oikeaan
// Quick-toimintoon (placeholder-teksti, ei feikkilomakkeita).
// Sijoitus: App-tasolla (kaikilla reiteillä), FAB piilossa kun overlay auki
// (ei tuplafokusta). Shortcut: Alt+N (ei selaimen/vakio-TABBIn päälle;
// dokumentoitu title-attribuutissa).
// T095: offline-huomautus sheetin yläreunassa — kirjaukset toimivat offline
// (paikallinen kanta), huomautus poistaa epävarmuuden.
import { t } from "../language.tsx";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { BottomSheet, Fab } from "@lifeos/ui";
import { summarizeHydrationDay, systemClock } from "@lifeos/data";
import { useOnlineStatus } from "../adapters/useOnlineStatus.ts";
import { useData } from "../dataContext.tsx";
import { useHydrationTarget } from "../preferences/HydrationTargetContext.tsx";
import { useHydrationConditionalReminder } from "../preferences/useHydrationConditionalReminder.ts";
import { QuickMeasureForm } from "./QuickMeasureForm.tsx";
import { QuickMoodForm } from "./QuickMoodForm.tsx";
import { QuickTaskForm } from "./QuickTaskForm.tsx";
import { QuickWaterPanel } from "./QuickWaterPanel.tsx";
import type { QuickHealthMeasurementType } from "./QuickHealthMeasurementForm.tsx";
import type { Measurement } from "@lifeos/domain";
import { getMeasurementTypeDefinition, normalizeBodyMeasureName } from "@lifeos/domain";

const QuickHealthMeasurementForm = lazy(async () => {
  const module = await import("./QuickHealthMeasurementForm.tsx");
  return { default: module.QuickHealthMeasurementForm };
});

export type QuickAddKind = "task" | "water" | "weight" | "mood" | QuickHealthMeasurementType;

const QUICK_HEALTH_MEASUREMENT_TYPES: readonly QuickHealthMeasurementType[] = [
  "temperature",
  "spo2",
  "blood-sugar",
  "body-measure",
  "custom",
];

const QUICK_ADD_OPTIONS: readonly { readonly kind: QuickAddKind; readonly label: string }[] = [
  { kind: "task", label: "Tehtävä" },
  { kind: "water", label: "Vesi" },
  { kind: "weight", label: "Paino / verenpaine" },
  { kind: "mood", label: "Mieliala" },
];

function isQuickHealthMeasurementActive(
  type: QuickHealthMeasurementType,
  measurements: readonly Measurement[],
): boolean {
  return measurements.some(
    (measurement) =>
      measurement.type === type &&
      (type !== "body-measure" || normalizeBodyMeasureName(measurement.metricName ?? "") !== ""),
  );
}

export function QuickAdd({
  launcherVisible = true,
}: {
  readonly launcherVisible?: boolean;
}): React.JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<QuickAddKind | null>(null);
  // Avaaja FAB:lle annetaan overlayn returnTo-propille suora elementti-ref
  // (callback-ref — aina tuore, ei stale-closurea). FAB piiloutuu avatessa
  // samassa renderissä, joten overlayn mount-hetken activeElement on jo body
  // tässä tapauksessa — overlay palauttaa fokuksen returnTo-kohteeseen
  // sulkeutuessa. EI varmistusfokusta tässä: se rikkoisi Tab-järjestyksen
  // (todistettu a11y-baseline-flakella).
  // T091: datamuutoseventti TodayView'lle. Yksinkertainen CustomEvent
  // (ei event-bus-kirjastoa — yksi tapahtumatyyppi riittää): QuickTaskForm
  // dispatchaa onnistuneesta luonnista, TodayView kuuntelee ja lataa
  // näkymän uudestaan. Tapahtuma kulkee windowin kautta (ei prop-drillingia
  // App-tason läpi). T101: eventtinimi dokumentoitu data-paketissa
  // (lifeos/data-changed) — kuuntelijat: TodayView, TaskInboxView.
  const notifyCreated = useCallback(() => {
    window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
  }, []);
  const { tasks, tags, projects, hydrationEntries, xpTransactions, measurements, moodCheckins } =
    useData();
  const hydrationTarget = useHydrationTarget();
  const hydrationReminder = useHydrationConditionalReminder(open && pending === "water");
  const [activeMeasurements, setActiveMeasurements] = useState<readonly Measurement[]>([]);
  const [quickMeasurementsLoading, setQuickMeasurementsLoading] = useState(false);
  const [quickMeasurementsError, setQuickMeasurementsError] = useState(false);
  const online = useOnlineStatus();
  const offsetMinutes = -new Date().getTimezoneOffset();
  const localDate = new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 10);
  const localDateKey = localDate;
  const [todayWaterMl, setTodayWaterMl] = useState(0);
  useEffect(() => {
    if (location.pathname !== "/nutrition") {
      return;
    }
    const quickActions = new URLSearchParams(location.search).getAll("quick");
    if (quickActions.length !== 1 || quickActions[0] !== "water") {
      return;
    }

    setPending("water");
    setOpen(true);
    // The action is consumed once, leaving a clean URL after opening the panel.
    void navigate("/nutrition", { replace: true });
  }, [location.pathname, location.search, navigate]);
  // Sheetin avautuessa laske päivän saldo kerran (ei live-seurantaa —
  // paneeli näyttää session omat kirjaukset päälle).
  useEffect(() => {
    if (!open) {
      return;
    }
    const guard = { cancelled: false };
    void hydrationEntries
      .list()
      .then((listed) => {
        if (guard.cancelled || !listed.ok) {
          return;
        }
        const summary = summarizeHydrationDay({
          entries: listed.value,
          localDate: localDateKey,
          timezoneOffsetMinutes: offsetMinutes,
          targetMilliliters: hydrationTarget.targetMilliliters,
          now: systemClock().nowIso(),
        });
        setTodayWaterMl(summary.milliliters);
      })
      .catch(() => undefined);
    return () => {
      guard.cancelled = true;
    };
  }, [open, hydrationEntries, offsetMinutes, localDateKey, hydrationTarget.targetMilliliters]);
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setQuickMeasurementsLoading(true);
    setQuickMeasurementsError(false);
    void measurements
      .list()
      .then((listed) => {
        if (cancelled) {
          return;
        }
        if (!listed.ok) {
          setQuickMeasurementsError(true);
          setActiveMeasurements([]);
          return;
        }
        setActiveMeasurements(listed.value);
      })
      .catch(() => {
        if (!cancelled) {
          setQuickMeasurementsError(true);
          setActiveMeasurements([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setQuickMeasurementsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, measurements]);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const setOpenerRef = useCallback((element: HTMLButtonElement | null) => {
    openerRef.current = element;
  }, []);
  const openSheet = useCallback(() => {
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    setPending(null);
  }, []);
  useEffect(() => {
    const onOpenQuickAdd = (event: Event): void => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (detail === null || typeof detail !== "object" || !("kind" in detail)) {
        return;
      }
      const request = detail as { readonly kind: unknown; readonly opener?: unknown };
      if (request.kind !== "weight") return;
      if (request.opener instanceof HTMLButtonElement) {
        openerRef.current = request.opener;
      }
      setPending("weight");
      setOpen(true);
    };
    window.addEventListener("lifeos:open-quick-add", onOpenQuickAdd);
    return () => {
      window.removeEventListener("lifeos:open-quick-add", onOpenQuickAdd);
    };
  }, []);
  // Fokuksen palautus sulkeutuessa on overlayn vastuulla (returnTo + rAF-ketju
  // siellä); ei effectiä tässä (kaksoispalautus kilpailisi overlayn kanssa).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (event.key !== "n" && event.key !== "N") {
        return;
      }
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      openSheet();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openSheet]);
  // Alt+N — ei estä selaimen omia (Ctrl/Cmd) eikä TAB-navigointia; ohitetaan
  // tekstikentissä kirjoittaessa (ei kaappaa syötettä — katso effecti yllä).
  return (
    <>
      {open || !launcherVisible ? null : (
        <Fab
          label={t("Kirjaa")}
          title={t("Kirjaa (Alt+N)")}
          data-testid="quick-add-fab"
          buttonRef={setOpenerRef}
          onClick={() => {
            openSheet();
          }}
        />
      )}
      <BottomSheet
        title={pending === "water" ? t("Vesi") : t("Kirjaa")}
        description={
          pending === null
            ? t("Valitse mitä kirjaat — lomake avautuu samassa ikkunassa.")
            : undefined
        }
        open={open}
        onClose={close}
        returnTo={openerRef.current}
      >
        {!online ? (
          <p data-ui="meta" data-testid="quick-add-offline-note">
            {t("Offline — kirjaukset tallentuvat laitteelle normaalisti.")}
          </p>
        ) : null}
        {pending === null ? (
          <>
            <ul data-ui="quick-add-list" data-testid="quick-add-menu">
              {[
                ...QUICK_ADD_OPTIONS,
                ...QUICK_HEALTH_MEASUREMENT_TYPES.filter((type) =>
                  isQuickHealthMeasurementActive(type, activeMeasurements),
                ).map((type) => ({ kind: type, label: getMeasurementTypeDefinition(type).label })),
              ].map((option) => (
                <li key={option.kind}>
                  <button
                    type="button"
                    data-testid={`quick-add-${option.kind}`}
                    onClick={() => {
                      setPending(option.kind);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
            {quickMeasurementsLoading ? (
              <p data-ui="meta" data-testid="quick-add-measurements-loading">
                {t("Ladataan aktivoituja terveysmittauksia…")}
              </p>
            ) : null}
            {quickMeasurementsError ? (
              <p data-ui="field-error" role="alert" data-testid="quick-add-measurements-error">
                {t(
                  "Aktivoituja terveysmittauksia ei voitu ladata. Sulje ja avaa kirjaus uudelleen.",
                )}
              </p>
            ) : null}
          </>
        ) : pending === "task" ? (
          <QuickTaskForm
            deps={{ clock: systemClock(), tasks }}
            localDate={localDate}
            timezoneOffsetMinutes={offsetMinutes}
            tags={tags}
            projects={projects}
            onCreated={() => {
              notifyCreated();
              close();
            }}
            onCancel={close}
          />
        ) : pending === "water" ? (
          <QuickWaterPanel
            hydrationEntries={hydrationEntries}
            xpTransactions={xpTransactions}
            todayMilliliters={todayWaterMl}
            targetMilliliters={hydrationTarget.targetMilliliters}
            reminderCondition={hydrationReminder.condition}
            onLogged={() => {
              notifyCreated();
            }}
          />
        ) : pending === "weight" ? (
          <QuickMeasureForm
            measurements={measurements}
            onSaved={() => {
              notifyCreated();
              close();
            }}
            onCancel={close}
          />
        ) : pending === "mood" ? (
          <QuickMoodForm
            moodCheckins={moodCheckins}
            onSaved={() => {
              notifyCreated();
              close();
            }}
            onCancel={close}
          />
        ) : (
          <Suspense
            fallback={
              <p data-ui="meta" role="status">
                {t("Avataan mittauslomaketta…")}
              </p>
            }
          >
            <QuickHealthMeasurementForm
              key={pending}
              type={pending}
              measurements={measurements}
              activeMeasurements={activeMeasurements}
              onSaved={() => {
                notifyCreated();
                close();
              }}
              onCancel={close}
            />
          </Suspense>
        )}
      </BottomSheet>
    </>
  );
}
