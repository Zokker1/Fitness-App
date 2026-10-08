// T146: tavoitteen yleisnäkymä ja syvälinkitettävä tavoitedetail.
// - Yleisnäkymä näyttää määräaikaisten tavoitteiden etenemisen.
// - ?goal=<id> avaa saman reitin sisällä tavoitekalenterin.
// - Päivät ovat paikallisia kalenteripäiviä; tilat tulevat T145:n tilakoneesta.
import { t, tTemplate, getIntlLocale } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Display,
  EmptyState,
  FieldShell,
  Input,
  GoalProgress,
  Meta,
  MetricCard,
  NumberInput,
  Skeleton,
} from "@lifeos/ui";
import type { Goal, GoalDay, HabitCadence, HabitRule } from "@lifeos/domain";
import { isGoalActiveOnLocalDate } from "@lifeos/domain";
import {
  addDaysIso,
  createGoal,
  createHabitRule,
  evaluateGoalDayState,
  summarizeGoalProgress,
  toggleGoalDay,
  type GoalDayStatus,
  type GoalProgress as GoalProgressSummary,
} from "@lifeos/data";
import { systemClock } from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import { RoutinePlayer } from "./RoutinePlayer.tsx";
import { RoutineOverview } from "./RoutineOverview.tsx";
import { GoalRoutineHistory } from "./GoalRoutineHistory.tsx";

const STATUS_LABELS: Readonly<Record<GoalDayStatus, string>> = {
  success: "Onnistui",
  partial: "Osittain",
  fail: "Ei onnistunut",
  "not-required": "Ei vaadita",
  future: "Tuleva",
  pending: "Kesken",
};

const STATUS_TONES: Readonly<Record<GoalDayStatus, "success" | "warning" | "info">> = {
  success: "success",
  partial: "warning",
  fail: "warning",
  "not-required": "info",
  future: "info",
  pending: "warning",
};

function localTodayKey(): string {
  const offset = -new Date().getTimezoneOffset();
  return new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
}

type GoalIntent = "period" | "daily" | "weekly" | "ongoing" | "avoidance" | "cumulative";

interface GoalIntentOption {
  readonly value: GoalIntent;
  readonly label: string;
  readonly description: string;
  readonly example: string;
}

const GOAL_INTENTS: readonly GoalIntentOption[] = [
  {
    value: "period",
    label: "Määräaikainen jakso",
    description: "Kokeilu tai projekti, jolla on alku ja loppu.",
    example: "Esim. testaan uutta ruokarytmiä",
  },
  {
    value: "daily",
    label: "Joka päivä",
    description: "Pieni määrä tai teko, jonka haluat muistaa päivittäin.",
    example: "Esim. 2 lasia vettä aamulla",
  },
  {
    value: "weekly",
    label: "Kertoja viikossa",
    description: "Teko, joka toistuu tietyn määrän kertoja viikossa.",
    example: "Esim. 3 treeniä viikossa",
  },
  {
    value: "ongoing",
    label: "Jatkuva tapa",
    description: "Asia, jonka haluat pitää mukana ilman päättymispäivää.",
    example: "Esim. rauhallinen iltarutiini",
  },
  {
    value: "avoidance",
    label: "Vältän jotain",
    description: "Asia, jonka haluat jättää tekemättä tai pitää poissa.",
    example: "Esim. ei energiajuomia",
  },
  {
    value: "cumulative",
    label: "Kerrytän yhteensä",
    description: "Yhteismäärä, jota kohti etenet valitulla ajanjaksolla.",
    example: "Esim. 20 harjoitusta syksyn aikana",
  },
];

const WIZARD_STEPS = [
  [1, "Suunta"],
  [2, "Rytmi"],
  [3, "Vahvista"],
] as const;

function intentOption(intent: GoalIntent | null): GoalIntentOption | null {
  return GOAL_INTENTS.find((option) => option.value === intent) ?? null;
}

function intentNeedsTarget(intent: GoalIntent | null): boolean {
  return intent === "daily" || intent === "weekly" || intent === "cumulative";
}

function intentRule(
  intent: GoalIntent | null,
  target: number,
): {
  readonly cadence: HabitCadence;
  readonly targetPerPeriod: number;
} | null {
  if (intent === "daily") {
    return { cadence: "daily", targetPerPeriod: target };
  }
  if (intent === "weekly") {
    return { cadence: "weekly", targetPerPeriod: target };
  }
  if (intent === "ongoing") {
    return { cadence: "custom", targetPerPeriod: 1 };
  }
  if (intent === "cumulative") {
    return { cadence: "custom", targetPerPeriod: target };
  }
  return null;
}

function formatWizardDateRange(start: string, end: string): string {
  if (end.length === 0) {
    return tTemplate("Alkaen {{0}}", [formatDate(start)]);
  }
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function GoalCreateWizard({
  onCancel,
  onCreated,
}: {
  readonly onCancel: () => void;
  readonly onCreated: () => void;
}): React.JSX.Element {
  const { goals, habitRules } = useData();
  const todayKey = useMemo(() => localTodayKey(), []);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [intent, setIntent] = useState<GoalIntent | null>(null);
  const [activeFrom, setActiveFrom] = useState(todayKey);
  const [activeUntil, setActiveUntil] = useState(addDaysIso(todayKey, 13));
  const [target, setTarget] = useState("1");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const selectedOption = intentOption(intent);
  const requiresEndDate = intent !== "ongoing" && intent !== "avoidance";

  const chooseIntent = (next: GoalIntent): void => {
    setIntent(next);
    setError(null);
    if (next === "ongoing" || next === "avoidance") {
      setActiveUntil("");
    } else if (activeUntil.length === 0) {
      setActiveUntil(addDaysIso(activeFrom, 13));
    }
  };

  const validateStep = (): boolean => {
    if (step === 1 && intent === null) {
      setError("Valitse ensin tavoitteen tyyppi.");
      return false;
    }
    if (step === 2) {
      if (activeFrom.length === 0) {
        setError(t("Valitse tavoitteen alkupäivä."));
        return false;
      }
      if (requiresEndDate && activeUntil.length === 0) {
        setError(t("Valitse tavoitteen loppupäivä."));
        return false;
      }
      if (activeUntil.length > 0 && activeFrom > activeUntil) {
        setError(t("Alkupäivä ei voi olla loppupäivän jälkeen."));
        return false;
      }
      if (intentNeedsTarget(intent)) {
        const parsedTarget = Number(target);
        if (!Number.isInteger(parsedTarget) || parsedTarget < 1) {
          setError(t("Määrän on oltava vähintään yksi kokonainen kerta."));
          return false;
        }
      }
    }
    if (step === 3 && title.trim().length === 0) {
      setError(t("Anna tavoitteelle nimi, jotta löydät sen myöhemmin."));
      return false;
    }
    setError(null);
    return true;
  };

  const goNext = (): void => {
    if (!validateStep()) {
      return;
    }
    if (step < 3) {
      setStep((current) => (current + 1) as 1 | 2 | 3);
    }
  };

  const goBack = (): void => {
    setError(null);
    setStep((current) => (current - 1) as 1 | 2 | 3);
  };

  const save = async (): Promise<void> => {
    if (!validateStep() || intent === null || selectedOption === null) {
      return;
    }
    setSaving(true);
    setError(null);
    const clock = systemClock();
    const createdGoal = await createGoal(
      { clock, goals, habitRules },
      {
        title,
        description: description.trim().length > 0 ? description : null,
        activeFrom,
        activeUntil: activeUntil.length > 0 ? activeUntil : null,
      },
    );
    if (!createdGoal.ok) {
      setError(createdGoal.error.userMessage);
      setSaving(false);
      return;
    }

    const parsedTarget = Number(target);
    const rule = intentRule(intent, parsedTarget);
    if (rule !== null) {
      const createdRule = await createHabitRule(
        { clock, goals, habitRules },
        {
          goalId: createdGoal.value.id,
          title: title.trim(),
          cadence: rule.cadence,
          targetPerPeriod: rule.targetPerPeriod,
        },
      );
      if (!createdRule.ok) {
        setError(t("Tavoite tallentui, mutta sen rytmiä ei voitu tallentaa. Yritä vielä kerran."));
        setSaving(false);
        return;
      }
    }

    window.dispatchEvent(new Event("lifeos:data-changed"));
    setSaving(false);
    onCreated();
  };

  return (
    <Card heading={t("Luo uusi tavoite")} data-testid="goal-create-wizard">
      <div data-ui="goal-wizard-intro">
        <Meta>{t("Kolme rauhallista vaihetta")}</Meta>
        <p>
          {t("Valitse ensin tavoitteen luonne. Saat seuraavaksi vain siihen sopivat kysymykset.")}
        </p>
      </div>
      <ol data-ui="goal-wizard-steps" aria-label={t("Tavoitteen luomisen vaiheet")}>
        {WIZARD_STEPS.map(([number, label]) => (
          <li
            key={number}
            data-state={step === number ? "current" : step > number ? "done" : "todo"}
          >
            <span aria-hidden="true">{number}</span>
            <span>{t(label)}</span>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <fieldset data-ui="goal-intent-picker">
          <legend>{t("Millainen muutos sopii sinulle nyt?")}</legend>
          <p data-ui="field-hint">
            {t("Tavoitteen tyyppi auttaa tekemään seurannasta sopivan kokoisen.")}
          </p>
          <div data-ui="goal-intent-grid">
            {GOAL_INTENTS.map((option) => (
              <label
                key={option.value}
                data-ui="goal-intent-card"
                data-selected={intent === option.value ? "true" : undefined}
              >
                <input
                  type="radio"
                  name="goal-intent"
                  value={option.value}
                  checked={intent === option.value}
                  onChange={() => {
                    chooseIntent(option.value);
                  }}
                />
                <span data-ui="goal-intent-copy">
                  <strong>{t(option.label)}</strong>
                  <span>{t(option.description)}</span>
                  <small>{t(option.example)}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {step === 2 ? (
        <div data-ui="goal-wizard-fields">
          <div data-ui="goal-wizard-section-intro">
            <Meta>{t("Valittu suunta")}</Meta>
            <strong>{selectedOption === null ? null : t(selectedOption.label)}</strong>
            <p>{selectedOption === null ? null : t(selectedOption.description)}</p>
          </div>
          <div data-ui="goal-wizard-date-grid">
            <DatePicker
              id="goal-wizard-start"
              label={t("Alkaa")}
              value={activeFrom}
              onChange={(event) => {
                setActiveFrom(event.currentTarget.value);
              }}
              required
            />
            <DatePicker
              id="goal-wizard-end"
              label={t("Päättyy")}
              hint={
                requiresEndDate
                  ? t("Ajanjakso auttaa näkemään etenemisen.")
                  : t("Jätä tyhjäksi, jos tavoite jatkuu avoimesti.")
              }
              value={activeUntil}
              onChange={(event) => {
                setActiveUntil(event.currentTarget.value);
              }}
              required={requiresEndDate}
            />
          </div>
          {intentNeedsTarget(intent) ? (
            <NumberInput
              id="goal-wizard-target"
              label={
                intent === "weekly"
                  ? "Tavoite viikossa"
                  : intent === "cumulative"
                    ? t("Kerrytettävä määrä")
                    : t("Tavoite päivässä")
              }
              hint={
                intent === "cumulative"
                  ? t("Kirjaa kokonaismäärä, jota kohti haluat edetä.")
                  : "Kokonaisia kertoja tai tekoja."
              }
              min={1}
              step={1}
              value={target}
              onChange={(event) => {
                setTarget(event.currentTarget.value);
              }}
              required
            />
          ) : (
            <div data-ui="goal-wizard-note">
              <strong>
                {intent === "avoidance"
                  ? t("Seurataan valintaa ilman suoritusmäärää.")
                  : t("Tämä tavoite saa edetä ilman laskuria.")}
              </strong>
              <p>{t("Voit tarkistaa sen päiväkohtaisesti tavoitteen omasta näkymästä.")}</p>
            </div>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <div data-ui="goal-wizard-fields">
          <Input
            id="goal-wizard-title"
            label={t("Tavoitteen nimi")}
            hint={t("Kirjoita nimi omilla sanoillasi.")}
            value={title}
            onChange={(event) => {
              setTitle(event.currentTarget.value);
            }}
            placeholder={t("Esim. Rauhallinen aamu")}
            maxLength={200}
            required
          />
          <FieldShell
            id="goal-wizard-description"
            label={t("Kuvaus (valinnainen)")}
            hint={t("Yksi lause riittää muistuttamaan, miksi tämä on tärkeä.")}
          >
            <textarea
              id="goal-wizard-description"
              data-ui="input"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
              }}
              placeholder={t("Mitä haluan tämän tuovan arkeeni?")}
            />
          </FieldShell>
          <div data-ui="goal-wizard-summary" aria-label={t("Tavoitteen yhteenveto")}>
            <Meta>{t("Yhteenveto")}</Meta>
            <dl>
              <div>
                <dt>{t("Tyyppi")}</dt>
                <dd>{selectedOption === null ? "" : t(selectedOption.label)}</dd>
              </div>
              <div>
                <dt>{t("Ajanjakso")}</dt>
                <dd>{formatWizardDateRange(activeFrom, activeUntil)}</dd>
              </div>
              {intentNeedsTarget(intent) ? (
                <div>
                  <dt>{t("Rytmi")}</dt>
                  <dd>
                    {target} {intent === "weekly" ? t("kertaa viikossa") : t("kertaa päivässä")}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <Alert tone="warning" title={t("Tarkista vielä yksi asia")}>
          <p>{t(error)}</p>
        </Alert>
      ) : null}
      <div data-ui="goal-wizard-actions">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          {t("Peruuta")}
        </Button>
        <span />
        {step > 1 ? (
          <Button variant="secondary" onClick={goBack} disabled={saving}>
            {t("← Edellinen")}
          </Button>
        ) : null}
        <Button onClick={step === 3 ? () => void save() : goNext} loading={saving}>
          {step === 3 ? t("Tallenna tavoite") : t("Jatka")}
        </Button>
      </div>
    </Card>
  );
}

function formatDate(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

function weekdayLabel(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    weekday: "short",
    timeZone: "UTC",
  })
    .format(new Date(`${dateKey}T00:00:00Z`))
    .replace(".", "");
}

function dayNumber(dateKey: string): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00Z`));
}

function dateRange(startDate: string, endDate: string): readonly string[] {
  const days: string[] = [];
  let current = startDate;
  while (current <= endDate) {
    days.push(current);
    const next = addDaysIso(current, 1);
    if (next === current) {
      break;
    }
    current = next;
  }
  return days;
}

function progressStatus(summary: GoalProgressSummary): string {
  if (summary.todayKey > summary.endDate) {
    return "Määräaika päättyi.";
  }
  if (summary.todayKey === summary.endDate) {
    return "Tänään on määräajan viimeinen päivä.";
  }
  return tTemplate("{{0}} päivää jäljellä.", [String(summary.remainingDays)]);
}

function goalDayForDate(goalDays: readonly GoalDay[], localDate: string): GoalDay | null {
  return goalDays.find((goalDay) => goalDay.localDate === localDate) ?? null;
}

function evaluateDay(
  goal: Goal,
  goalDays: readonly GoalDay[],
  localDate: string,
  todayKey: string,
) {
  return evaluateGoalDayState({
    goal,
    localDate,
    todayKey,
    goalDay: goalDayForDate(goalDays, localDate),
  });
}

function GoalDayCalendar({
  goal,
  goalDays,
  todayKey,
}: {
  readonly goal: Goal;
  readonly goalDays: readonly GoalDay[];
  readonly todayKey: string;
}): React.JSX.Element {
  const startDate = goal.activeFrom ?? todayKey;
  const endDate = goal.activeUntil ?? startDate;
  const days = dateRange(startDate, endDate);
  const weekdays = days.slice(0, 7);

  return (
    <div data-ui="goal-detail-calendar" data-testid="goal-detail-calendar">
      <div data-ui="goal-detail-weekdays" aria-hidden="true">
        {weekdays.map((dateKey) => (
          <span key={dateKey}>{weekdayLabel(dateKey)}</span>
        ))}
      </div>
      <div
        data-ui="goal-detail-grid"
        role="grid"
        aria-label={tTemplate("{{0}} päiväkalenteri", [goal.title])}
      >
        {days.map((dateKey) => {
          const evaluation = evaluateDay(goal, goalDays, dateKey, todayKey);
          const state = evaluation.ok ? evaluation.value.status : "pending";
          const label = t(STATUS_LABELS[state]);
          const today = dateKey === todayKey;
          return (
            <div
              key={dateKey}
              data-ui="goal-detail-day"
              data-state={state}
              data-today={today ? "true" : "false"}
              data-testid="goal-detail-day"
              role="gridcell"
              aria-label={tTemplate("{{0}}: {{1}}{{2}}", [
                formatDate(dateKey),
                label,
                today ? t(", tänään") : "",
              ])}
            >
              <strong>{dayNumber(dateKey)}</strong>
              <span>{label}</span>
              {today ? <small>{t("Tänään")}</small> : null}
            </div>
          );
        })}
      </div>
      <ul data-ui="goal-detail-legend" aria-label={t("Päiväkalenterin selite")}>
        {(Object.keys(STATUS_LABELS) as GoalDayStatus[]).map((status) => (
          <li key={status} data-tone={STATUS_TONES[status]} data-state={status}>
            <span aria-hidden="true" />
            {t(STATUS_LABELS[status])}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface GoalPreviewData {
  readonly goal: Goal;
  readonly days: readonly GoalDay[];
}

function GoalDetailView({
  goalId,
  onBack,
  preview,
}: {
  readonly goalId: string;
  readonly onBack: () => void;
  readonly preview?: GoalPreviewData;
}) {
  const { goals, goalDays } = useData();
  const [goal, setGoal] = useState<Goal | null>(null);
  const [days, setDays] = useState<readonly GoalDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const todayKey = useMemo(() => localTodayKey(), []);

  const refresh = useCallback(async () => {
    const [goalResult, dayResult] = await Promise.all([goals.getById(goalId), goalDays.list()]);
    if (!goalResult.ok) {
      setGoal(null);
      setLoadError(t("Tavoitetta ei löytynyt."));
      setLoading(false);
      return;
    }
    if (!dayResult.ok) {
      setGoal(goalResult.value);
      setLoadError(t("Tavoitepäiviä ei voitu ladata."));
      setLoading(false);
      return;
    }
    setGoal(goalResult.value);
    setDays(dayResult.value.filter((day) => day.goalId === goalId));
    setLoadError(null);
    setLoading(false);
  }, [goalDays, goalId, goals]);

  useEffect(() => {
    const guard = { cancelled: false };
    if (preview !== undefined) {
      setGoal(preview.goal);
      setDays(preview.days);
      setLoadError(null);
      setLoading(false);
      return () => {
        guard.cancelled = true;
      };
    }
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => {
          setLoadError("Tavoitetta ei voitu ladata.");
        });
      }
    };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setLoadError("Tavoitetta ei voitu ladata.");
        setLoading(false);
      }
    });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [preview, refresh]);

  if (loading) {
    return (
      <section aria-label={t("Tavoite")} data-testid="goal-detail-loading">
        <Display>{t("Tavoite")}</Display>
        <Skeleton lines={5} label={t("Ladataan tavoitetta…")} />
      </section>
    );
  }

  if (goal === null) {
    return (
      <section aria-label={t("Tavoite")} data-testid="goal-detail-error">
        <Display>{t("Tavoite")}</Display>
        <Alert tone="warning" title={t("Tavoitetta ei löytynyt")}>
          <p>{loadError ?? "Tarkista linkki tai palaa tavoitteiden listaan."}</p>
          <Button onClick={onBack}>{t("Palaa tavoitteisiin")}</Button>
        </Alert>
      </section>
    );
  }

  const summaryResult = summarizeGoalProgress({ goal, goalDays: days, todayKey });
  return (
    <section aria-label={tTemplate("Tavoite: {{0}}", [goal.title])} data-testid="goal-detail">
      <div data-ui="goal-detail-header">
        <Button variant="secondary" onClick={onBack} aria-label={t("Palaa tavoitteiden listaan")}>
          {t("← Tavoitteet")}
        </Button>
        <Display>{goal.title}</Display>
        {goal.description !== null ? <p>{goal.description}</p> : null}
      </div>
      {loadError !== null ? (
        <Alert tone="warning" title={t("Tavoitepäivien lataus jäi vajaaksi")}>
          <p>{t(loadError)}</p>
        </Alert>
      ) : null}
      {!summaryResult.ok ? (
        <Alert tone="warning" title={t("Etenemistä ei voi laskea")}>
          <p>{summaryResult.error.userMessage}</p>
        </Alert>
      ) : (
        <>
          <Card heading={t("Eteneminen")} data-testid="goal-detail-progress">
            <GoalProgress
              value={summaryResult.value.progressRatio * 100}
              label={tTemplate("{{0}}: {{1}} / {{2}} päivää", [
                goal.title,
                String(summaryResult.value.completedDays),
                String(summaryResult.value.totalDays),
              ])}
              current={`${String(summaryResult.value.completedDays)} / ${String(summaryResult.value.totalDays)}`}
              target={t("päivää")}
              statusText={progressStatus(summaryResult.value)}
            />
            <dl data-ui="goal-detail-facts">
              <div>
                <dt>{t("Alkaa")}</dt>
                <dd>{formatDate(summaryResult.value.startDate)}</dd>
              </div>
              <div>
                <dt>{t("Päättyy")}</dt>
                <dd>{formatDate(summaryResult.value.endDate)}</dd>
              </div>
              <div>
                <dt>{t("Valmiina")}</dt>
                <dd>
                  {String(summaryResult.value.completedDays)} {t(" päivää")}
                </dd>
              </div>
              <div>
                <dt>{t("Jäljellä")}</dt>
                <dd>
                  {String(summaryResult.value.remainingDays)} {t(" päivää")}
                </dd>
              </div>
            </dl>
          </Card>
          <Card heading={t("Päiväkalenteri")}>
            <GoalDayCalendar goal={goal} goalDays={days} todayKey={todayKey} />
          </Card>
          <Card heading={t("Tavoitteen tila")}>
            <p data-ui="goal-detail-status">
              <strong>{progressStatus(summaryResult.value)}</strong>
            </p>
            <Meta>
              {t("Valmiit päivät näkyvät onnistuneina; tulevaa ei merkitä epäonnistuneeksi.")}
            </Meta>
          </Card>
        </>
      )}
    </section>
  );
}

/** T146: kehityksen/E2E:n visuaalinen fixture — ei normaali tuotantopinta. */
export function GoalDetailPreview(): React.JSX.Element {
  const preview = useMemo<GoalPreviewData>(() => {
    const today = localTodayKey();
    const goal: Goal = {
      id: "goal-preview",
      createdAt: "2026-09-18T08:00:00.000Z",
      updatedAt: "2026-09-18T08:00:00.000Z",
      version: 1,
      title: "Aamun rauha",
      description: "Lyhyt, toistuva aloitus päivälle.",
      activeFrom: addDaysIso(today, -3),
      activeUntil: addDaysIso(today, 4),
      archivedAt: null,
      deletedAt: null,
    };
    const completedDate = addDaysIso(today, -1);
    const days: GoalDay[] = [
      {
        id: "goal-preview-done",
        createdAt: goal.createdAt,
        updatedAt: goal.updatedAt,
        version: 1,
        goalId: goal.id,
        localDate: completedDate,
        completed: true,
      },
    ];
    return { goal, days };
  }, []);
  return <GoalDetailView goalId={preview.goal.id} onBack={() => undefined} preview={preview} />;
}

type HabitCellState = "done" | "open" | "future" | "outside";

function habitCellState(
  goal: Goal,
  day: GoalDay | undefined,
  localDate: string,
  todayKey: string,
): HabitCellState {
  if (!isGoalActiveOnLocalDate(goal, localDate)) {
    return "outside";
  }
  if (localDate > todayKey) {
    return "future";
  }
  return day?.completed === true ? "done" : "open";
}

function habitRuleTargetLabel(rule: HabitRule): string {
  if (rule.cadence === "daily") {
    return tTemplate("{{0}} / päivä", [String(rule.targetPerPeriod)]);
  }
  if (rule.cadence === "weekly") {
    return `${String(rule.targetPerPeriod)} / viikko`;
  }
  return `${String(rule.targetPerPeriod)} / jakso`;
}

function HabitTracker(): React.JSX.Element {
  const { goals, habitRules, goalDays } = useData();
  const todayKey = useMemo(() => localTodayKey(), []);
  const dates = useMemo(
    () => dateRange(addDaysIso(todayKey, -6), addDaysIso(todayKey, 7)),
    [todayKey],
  );
  const [rules, setRules] = useState<readonly HabitRule[]>([]);
  const [items, setItems] = useState<readonly Goal[]>([]);
  const [days, setDays] = useState<readonly GoalDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const goalById = useMemo(() => new Map(items.map((goal) => [goal.id, goal])), [items]);
  const dayByKey = useMemo(
    () => new Map(days.map((day) => [`${day.goalId}:${day.localDate}`, day])),
    [days],
  );

  const refresh = useCallback(async () => {
    const [goalResult, ruleResult, dayResult] = await Promise.all([
      goals.list(),
      habitRules.list(),
      goalDays.list(),
    ]);
    if (!goalResult.ok || !ruleResult.ok || !dayResult.ok) {
      setLoadError("Tapoja ei voitu ladata.");
      setLoading(false);
      return;
    }
    const liveGoals = goalResult.value.filter(
      (goal) => goal.deletedAt === null && goal.archivedAt === null,
    );
    const liveGoalIds = new Set(liveGoals.map((goal) => goal.id));
    setItems(liveGoals);
    setRules(
      ruleResult.value
        .filter(
          (rule) => rule.deletedAt === null && rule.goalId !== null && liveGoalIds.has(rule.goalId),
        )
        .sort((left, right) => left.title.localeCompare(right.title, getIntlLocale())),
    );
    setDays(dayResult.value);
    setLoadError(null);
    setLoading(false);
  }, [goalDays, goals, habitRules]);

  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => {
          setLoadError("Tapoja ei voitu ladata.");
          setLoading(false);
        });
      }
    };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setLoadError("Tapoja ei voitu ladata.");
        setLoading(false);
      }
    });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  const toggle = async (rule: HabitRule, localDate: string): Promise<void> => {
    if (rule.goalId === null || localDate > todayKey) {
      return;
    }
    const goal = goalById.get(rule.goalId);
    if (goal === undefined) {
      return;
    }
    const existing = dayByKey.get(`${rule.goalId}:${localDate}`);
    const decided = toggleGoalDay({
      goalId: rule.goalId,
      localDate,
      completed: existing?.completed !== true,
      todayKey,
      existing: days,
      goals: items,
    });
    if (!decided.ok) {
      setLoadError(decided.error);
      return;
    }
    const write = decided.value;
    const result =
      write.create !== null
        ? await goalDays.create(write.create)
        : write.updateId !== null && write.updateCompleted !== null
          ? await goalDays.update(write.updateId, { completed: write.updateCompleted })
          : null;
    if (result === null || !result.ok) {
      setLoadError(t("Päivän tilaa ei voitu tallentaa."));
      return;
    }
    setLoadError(null);
    await refresh().catch(() => {
      setLoadError(t("Tapoja ei voitu ladata tallennuksen jälkeen."));
    });
  };

  if (loading) {
    return (
      <Card heading={t("Tavat")} data-testid="habit-tracker-loading">
        <Skeleton lines={4} label={t("Ladataan tapoja…")} />
      </Card>
    );
  }

  return (
    <Card heading={t("Tavat")} data-testid="habit-tracker">
      <div data-ui="habit-tracker-header">
        <p>{t("Pidä mukana vain tämän hetken tärkeimmät tavat. Menneitä päiviä voi täydentää.")}</p>
        <Meta>{t("14 päivän ikkuna")}</Meta>
      </div>
      {loadError !== null ? (
        <Alert tone="warning" title={t("Tavan tila ei päivittynyt")}>
          <p>{t(loadError)}</p>
        </Alert>
      ) : null}
      {rules.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={t("Tapoja ei vielä ole.")}
          hint={t(
            "Kun luot päivittäisen tai viikoittaisen tavoitteen, sen rytmi näkyy tässä matriisissa.",
          )}
        />
      ) : (
        <>
          <div data-ui="habit-tracker-scroll">
            <table data-ui="habit-tracker-table">
              <caption data-ui="sr-only">
                {t("Tavoitteiden tapaseuranta viimeisille ja tuleville päiville")}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{t("Tapa")}</th>
                  {dates.map((dateKey) => (
                    <th
                      key={dateKey}
                      scope="col"
                      data-today={dateKey === todayKey ? "true" : undefined}
                    >
                      <span>{weekdayLabel(dateKey)}</span>
                      <strong>{dayNumber(dateKey)}</strong>
                      {dateKey === todayKey ? <small>{t("Tänään")}</small> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => {
                  const goal = rule.goalId === null ? undefined : goalById.get(rule.goalId);
                  if (goal === undefined) {
                    return null;
                  }
                  return (
                    <tr key={rule.id} data-testid={`habit-row-${rule.id}`}>
                      <th scope="row" data-ui="habit-tracker-label">
                        <strong>{rule.title}</strong>
                        <Meta>{habitRuleTargetLabel(rule)}</Meta>
                      </th>
                      {dates.map((dateKey) => {
                        const day = dayByKey.get(`${goal.id}:${dateKey}`);
                        const state = habitCellState(goal, day, dateKey, todayKey);
                        const canToggle = state === "done" || state === "open";
                        const statusLabel =
                          state === "done"
                            ? "tehty"
                            : state === "future"
                              ? "tuleva"
                              : state === "outside"
                                ? "ei käytössä"
                                : dateKey === todayKey
                                  ? "ei vielä kirjattu"
                                  : "ei kirjattu";
                        return (
                          <td
                            key={dateKey}
                            data-state={state}
                            data-today={dateKey === todayKey ? "true" : undefined}
                          >
                            {canToggle ? (
                              <button
                                type="button"
                                aria-label={tTemplate("{{0}}, {{1}}: {{2}}", [
                                  rule.title,
                                  formatDate(dateKey),
                                  t(statusLabel),
                                ])}
                                aria-pressed={state === "done"}
                                onClick={() => {
                                  void toggle(rule, dateKey);
                                }}
                              >
                                <span aria-hidden="true">{state === "done" ? "✓" : "○"}</span>
                              </button>
                            ) : (
                              <span
                                aria-label={tTemplate("{{0}}, {{1}}: {{2}}", [
                                  rule.title,
                                  formatDate(dateKey),
                                  t(statusLabel),
                                ])}
                              >
                                <span aria-hidden="true">{state === "future" ? "·" : "—"}</span>
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div data-ui="habit-tracker-legend" aria-label={t("Tapaseurannan selite")}>
            <span data-state="done">
              <i aria-hidden="true">✓</i> {t("Tehty")}
            </span>
            <span data-state="open">
              <i aria-hidden="true">○</i> {t("Kirjaamaton päivä")}
            </span>
            <span data-state="future">
              <i aria-hidden="true">·</i> {t("Tuleva")}
            </span>
          </div>
        </>
      )}
    </Card>
  );
}

function GoalsOverview(): React.JSX.Element {
  const { goals, goalDays } = useData();
  const [items, setItems] = useState<readonly Goal[]>([]);
  const [days, setDays] = useState<readonly GoalDay[]>([]);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const todayKey = useMemo(() => localTodayKey(), []);

  const refresh = useCallback(async () => {
    const [goalResult, dayResult] = await Promise.all([goals.list(), goalDays.list()]);
    if (!goalResult.ok || !dayResult.ok) {
      setLoadError(true);
      setLoading(false);
      return;
    }
    setItems(
      goalResult.value
        .filter((goal) => goal.deletedAt === null && goal.archivedAt === null)
        .sort((left, right) => left.title.localeCompare(right.title, getIntlLocale())),
    );
    setDays(dayResult.value);
    setLoadError(false);
    setLoading(false);
  }, [goalDays, goals]);

  useEffect(() => {
    const guard = { cancelled: false };
    const onDataChanged = (): void => {
      if (!guard.cancelled) {
        void refresh().catch(() => {
          setLoadError(true);
        });
      }
    };
    void refresh().catch(() => {
      if (!guard.cancelled) {
        setLoadError(true);
        setLoading(false);
      }
    });
    window.addEventListener("lifeos:data-changed", onDataChanged);
    return () => {
      guard.cancelled = true;
      window.removeEventListener("lifeos:data-changed", onDataChanged);
    };
  }, [refresh]);

  if (loading) {
    return (
      <section aria-label={t("Tavoitteet")} data-testid="goals-overview-loading">
        <Display>{t("Tavoitteet ja rutiinit")}</Display>
        <Skeleton lines={4} label={t("Ladataan tavoitteita…")} />
      </section>
    );
  }

  return (
    <section aria-label={t("Tavoitteet")} data-testid="goals-overview">
      <div data-ui="goals-overview-header">
        <div>
          <Display>{t("Tavoitteet ja rutiinit")}</Display>
          <p data-ui="goals-overview-lede">
            {t("Valitse yksi selkeä muutos ja rakenna sille sopiva rytmi.")}
          </p>
        </div>
        <div data-ui="goals-overview-actions">
          <Button
            data-testid="goal-create-open"
            onClick={() => {
              setWizardOpen(true);
            }}
          >
            {t("+ Luo tavoite")}
          </Button>
          <Link to="/goals?history=1" data-testid="goal-history-link">
            {t("Avaa historia")}
          </Link>
        </div>
      </div>
      {wizardOpen ? (
        <GoalCreateWizard
          onCancel={() => {
            setWizardOpen(false);
          }}
          onCreated={() => {
            setWizardOpen(false);
            void refresh();
          }}
        />
      ) : null}
      {loadError ? (
        <Alert tone="warning" title={t("Tavoitteita ei voitu ladata")}>
          <p>{t("Yritä ladata näkymä uudelleen hetken kuluttua.")}</p>
        </Alert>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={t("Ei aktiivisia tavoitteita vielä.")}
          hint={t("Kun tavoite luodaan, sen eteneminen ja päiväkalenteri näkyvät tässä.")}
        />
      ) : (
        <div data-testid="goal-list">
          {items.map((goal) => {
            const summaryResult = summarizeGoalProgress({
              goal,
              goalDays: days,
              todayKey,
            });
            const summary = summaryResult.ok ? summaryResult.value : null;
            return (
              <MetricCard
                key={goal.id}
                heading={goal.title}
                value={
                  summary === null
                    ? "—"
                    : `${String(summary.completedDays)}/${String(summary.totalDays)}`
                }
                valueLabel={summary === null ? "Tavoitteen ajanjakso puuttuu" : "Valmiit päivät"}
                progress={summary === null ? undefined : summary.progressRatio * 100}
                changeText={summary === null ? "Määräaika puuttuu." : progressStatus(summary)}
                tone={summary === null ? "warning" : "info"}
                data-testid={`goal-card-${goal.id}`}
              >
                {goal.description !== null ? <Meta>{goal.description}</Meta> : null}
                <Link to={`/goals?goal=${encodeURIComponent(goal.id)}`}>{t("Avaa tavoite")}</Link>
              </MetricCard>
            );
          })}
        </div>
      )}
      <RoutineOverview />
      <HabitTracker />
    </section>
  );
}

export function GoalsRoute(): React.JSX.Element {
  const [searchParams, setSearchParams] = useSearchParams();
  const goalId = searchParams.get("goal");
  const routineId = searchParams.get("routine");
  const history = searchParams.get("history") === "1";
  const onBack = (): void => {
    setSearchParams((current) => {
      current.delete("goal");
      current.delete("routine");
      current.delete("history");
      return current;
    });
  };
  if (routineId !== null) {
    return <RoutinePlayer routineId={routineId} onBack={onBack} />;
  }
  if (history) {
    return <GoalRoutineHistory onBack={onBack} />;
  }
  return goalId === null ? <GoalsOverview /> : <GoalDetailView goalId={goalId} onBack={onBack} />;
}
