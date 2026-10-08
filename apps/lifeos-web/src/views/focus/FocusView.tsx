import { t, tOptions, tTemplate, getIntlLocale, useLanguage } from "../../language.tsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { CalendarBlock, FocusSession, Task, XPTransaction } from "@lifeos/domain";
import { toLocalDateKey } from "@lifeos/domain";
import {
  beginFocusSession,
  cancelFocusSession,
  DEFAULT_POMODORO_PRESET,
  FIVE_MINUTE_START_SECONDS,
  extendFocusSession,
  finishFocusSession,
  pauseFocusSession,
  recordFocusInterruption,
  resumeFocusSession,
  selectNextUp,
  startFocusSession,
  systemClock,
  type DataResult,
  type FocusServiceDeps,
} from "@lifeos/data";
import { Button, Display, Meta, ProgressRing, Select, useHaptics } from "@lifeos/ui";
import { useData } from "../../dataContext.tsx";
import { isFocusAudioSupported, playFocusCue, type FocusCue } from "../../focus/focusFeedback.ts";
import { useFocusCountdown } from "../../focus/useFocusCountdown.ts";
import { FocusDistractionParkingLot } from "./FocusDistractionParkingLot.tsx";
import { FocusHistory } from "./FocusHistory.tsx";
import { FocusWeeklyStats } from "./FocusWeeklyStats.tsx";
import { useGamificationVisibility } from "../../preferences/GamificationVisibilityContext.tsx";

type FocusMutation = (deps: FocusServiceDeps, id: string) => Promise<DataResult<FocusSession>>;

function sessionTimestamp(session: FocusSession): number {
  const timestamp = Date.parse(session.startedAt ?? session.updatedAt);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function latestActiveSession(sessions: readonly FocusSession[]): FocusSession | null {
  return (
    sessions
      .filter(
        (session) =>
          session.phase === "planned" || session.phase === "running" || session.phase === "paused",
      )
      .sort((left, right) => sessionTimestamp(right) - sessionTimestamp(left))[0] ?? null
  );
}

function formatCountdown(seconds: number | null): string {
  if (seconds === null) {
    return "--:--";
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function announceDataChange(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
  }
}

function phaseLabel(phase: FocusSession["phase"]): string {
  if (phase === "paused") {
    return "Tauolla";
  }
  if (phase === "planned") {
    return "Valmis aloittamaan";
  }
  return "Käynnissä";
}

function vibrationPatternFor(cue: FocusCue): number | number[] {
  if (cue === "complete") {
    return [80, 40, 80];
  }
  if (cue === "cancel") {
    return [10, 30, 10];
  }
  return cue === "pause" ? 10 : 20;
}

interface FocusFeedbackSettingsProps {
  readonly soundEnabled: boolean;
  readonly vibrationEnabled: boolean;
  readonly soundSupported: boolean;
  readonly onSoundChange: (enabled: boolean) => void;
  readonly onVibrationChange: (enabled: boolean) => void;
}

function FocusFeedbackSettings({
  soundEnabled,
  vibrationEnabled,
  soundSupported,
  onSoundChange,
  onVibrationChange,
}: FocusFeedbackSettingsProps): React.JSX.Element {
  return (
    <details data-ui="focus-feedback-settings" data-testid="focus-feedback-settings">
      <summary>{t("Palautteet")}</summary>
      <div data-ui="focus-feedback-options">
        <label>
          <input
            type="checkbox"
            checked={soundEnabled}
            disabled={!soundSupported}
            onChange={(event) => {
              onSoundChange(event.target.checked);
            }}
          />
          {t("Äänimerkki vaiheen vaihtuessa")}
        </label>
        <label>
          <input
            type="checkbox"
            checked={vibrationEnabled}
            onChange={(event) => {
              onVibrationChange(event.target.checked);
            }}
          />
          {t("Värinä, jos selain tukee sitä")}
        </label>
        <Meta>
          {t("Palaute on oletuksena pois.")}{" "}
          {soundSupported ? t("Ääni on käytettävissä.") : t("Ääntä ei tueta tässä selaimessa.")}
        </Meta>
      </div>
    </details>
  );
}

export function FocusView(): React.JSX.Element {
  const { language } = useLanguage();
  const { calendarBlocks, focusSessions, tasks, xpTransactions } = useData();
  const { visible: gamificationVisible } = useGamificationVisibility();
  const [sessions, setSessions] = useState<readonly FocusSession[] | null>(null);
  const [taskRows, setTaskRows] = useState<readonly Task[]>([]);
  const [blockRows, setBlockRows] = useState<readonly CalendarBlock[]>([]);
  const [xpRows, setXpRows] = useState<readonly XPTransaction[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRecoveryNotice, setShowRecoveryNotice] = useState(false);
  const [working, setWorking] = useState(false);
  const [startingDuration, setStartingDuration] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [vibrationEnabled, setVibrationEnabled] = useState(false);
  const haptics = useHaptics();
  const location = useLocation();
  const navigate = useNavigate();
  const soundSupported = useMemo(() => isFocusAudioSupported(), []);
  const previousComplete = useRef(false);
  const startShortcutConsumed = useRef(false);
  const [startShortcutFocus, setStartShortcutFocus] = useState(false);

  useEffect(() => {
    const shortcutValues = new URLSearchParams(location.search).getAll("shortcut");
    const isStartShortcut =
      location.pathname === "/focus" &&
      shortcutValues.length === 1 &&
      shortcutValues[0] === "start";
    if (!isStartShortcut) {
      startShortcutConsumed.current = false;
      return;
    }
    if (startShortcutConsumed.current) {
      return;
    }

    startShortcutConsumed.current = true;
    setStartShortcutFocus(true);
    void navigate("/focus", { replace: true });
  }, [location.pathname, location.search, navigate]);

  const nextFocusRecommendation = useMemo(() => {
    const now = systemClock().nowIso();
    const timezoneOffsetMinutes = -new Date(now).getTimezoneOffset();
    const nextUp = selectNextUp({
      now,
      localDate: toLocalDateKey(now, timezoneOffsetMinutes),
      timezoneOffsetMinutes,
      tasks: taskRows,
      timeboxes: [],
    });
    const task =
      nextUp?.taskId === undefined
        ? null
        : (taskRows.find(
            (candidate) =>
              candidate.id === nextUp.taskId &&
              candidate.status === "open" &&
              candidate.deletedAt === null,
          ) ?? null);
    return task === null || nextUp === null ? null : { task, reason: nextUp.reason };
  }, [taskRows]);
  const focusTaskId = selectedTaskId ?? nextFocusRecommendation?.task.id ?? "";

  const triggerFeedback = useCallback(
    (cue: FocusCue): void => {
      if (soundEnabled) {
        playFocusCue(cue);
      }
      if (vibrationEnabled) {
        haptics(vibrationPatternFor(cue));
      }
    },
    [haptics, soundEnabled, vibrationEnabled],
  );

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const [focusResult, taskResult, blockResult, xpResult] = await Promise.all([
        focusSessions.list(),
        tasks.list(),
        calendarBlocks.list(),
        xpTransactions.list(),
      ]);
      if (cancelled) {
        return;
      }
      if (!focusResult.ok) {
        setLoadingError(focusResult.error.userMessage);
        setSessions([]);
        return;
      }
      setSessions(focusResult.value);
      if (taskResult.ok) {
        setTaskRows(taskResult.value);
      }
      if (blockResult.ok) {
        setBlockRows(blockResult.value);
      }
      if (xpResult.ok) {
        setXpRows(xpResult.value);
      }
    };
    void load().catch(() => {
      if (!cancelled) {
        setLoadingError("Fokusistuntoja ei voitu ladata.");
        setSessions([]);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [calendarBlocks, focusSessions, tasks, xpTransactions]);

  const activeSession = useMemo(
    () => (sessions === null ? null : latestActiveSession(sessions)),
    [sessions],
  );
  useEffect(() => {
    if (!startShortcutFocus || sessions === null) {
      return;
    }
    if (activeSession === null) {
      const primaryStart = document.getElementById("focus-start-primary");
      if (primaryStart instanceof HTMLButtonElement) {
        primaryStart.focus();
      }
    }
    setStartShortcutFocus(false);
  }, [activeSession, sessions, startShortcutFocus]);
  const sessionBlockId = activeSession?.calendarBlockId ?? null;
  const timeboxBlock = useMemo(
    () =>
      sessionBlockId === null
        ? null
        : (blockRows.find((block) => block.id === sessionBlockId) ?? null),
    [blockRows, sessionBlockId],
  );
  const taskTitle = useMemo(() => {
    if (activeSession?.taskId !== null && activeSession?.taskId !== undefined) {
      return (
        taskRows.find((task) => task.id === activeSession.taskId)?.title ??
        t("Tehtäväfokus", language)
      );
    }
    return timeboxBlock?.title ?? t("Itsenäinen fokus", language);
  }, [activeSession, language, taskRows, timeboxBlock]);
  const timeboxContext = useMemo(() => {
    if (timeboxBlock === null) {
      return null;
    }
    const formatTime = (stamp: string): string =>
      new Intl.DateTimeFormat(getIntlLocale(language), {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(stamp));
    return activeSession?.taskId !== null && activeSession?.taskId !== undefined
      ? tTemplate(
          "Timebox · {{0}} · {{1}}–{{2}}",
          [timeboxBlock.title, formatTime(timeboxBlock.startsAt), formatTime(timeboxBlock.endsAt)],
          language,
        )
      : tTemplate(
          "Kalenteriaika · {{0}}–{{1}}",
          [formatTime(timeboxBlock.startsAt), formatTime(timeboxBlock.endsAt)],
          language,
        );
  }, [activeSession, language, timeboxBlock]);
  const calendarReturnTo = useMemo((): string => {
    const state: unknown = location.state;
    if (typeof state === "object" && state !== null) {
      const target = (state as Record<string, unknown>)["calendarReturnTo"];
      if (
        typeof target === "string" &&
        (target === "/calendar" || target.startsWith("/calendar?"))
      ) {
        return target;
      }
    }
    return "/calendar";
  }, [location.state]);
  const pausedAt = activeSession?.phase === "paused" ? activeSession.updatedAt : null;
  const countdownNow = useMemo(
    () => (pausedAt === null ? undefined : (): string => pausedAt),
    [pausedAt],
  );
  const countdown = useFocusCountdown({
    startedAt: activeSession?.startedAt ?? null,
    durationSeconds: activeSession?.durationSeconds ?? null,
    accumulatedPauseSeconds: activeSession?.accumulatedPauseSeconds ?? 0,
    ...(countdownNow === undefined ? {} : { now: countdownNow }),
  });
  const remainingSeconds = countdown.snapshot?.remainingSeconds ?? null;
  const progress = countdown.snapshot?.progress ?? 0;
  const isComplete = countdown.snapshot?.isComplete ?? false;

  useEffect(() => {
    if (!previousComplete.current && isComplete) {
      triggerFeedback("complete");
    }
    previousComplete.current = isComplete;
  }, [isComplete, triggerFeedback]);

  const updateSession = async (mutation: FocusMutation): Promise<FocusSession | null> => {
    if (activeSession === null || working) {
      return null;
    }
    setWorking(true);
    setActionError(null);
    try {
      const result = await mutation(
        {
          clock: systemClock(),
          sessions: focusSessions,
          tasks,
          xpTransactions,
          timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        },
        activeSession.id,
      );
      if (!result.ok) {
        setActionError(result.error.userMessage);
        return null;
      }
      setSessions((current) =>
        current === null
          ? [result.value]
          : current.map((session) => (session.id === result.value.id ? result.value : session)),
      );
      setShowRecoveryNotice(result.value.phase === "cancelled" && result.value.startedAt !== null);
      if (result.value.phase === "completed") {
        const [refreshedTasks, refreshedXp] = await Promise.all([
          tasks.list(),
          xpTransactions.list(),
        ]);
        if (refreshedTasks.ok) {
          setTaskRows(refreshedTasks.value);
        }
        if (refreshedXp.ok) {
          setXpRows(refreshedXp.value);
        }
      }
      if (result.value.phase !== activeSession.phase) {
        if (result.value.phase === "paused") {
          triggerFeedback("pause");
        } else if (result.value.phase === "running") {
          triggerFeedback(activeSession.phase === "paused" ? "resume" : "start");
        } else if (result.value.phase === "completed") {
          triggerFeedback("finish");
        } else if (result.value.phase === "cancelled") {
          triggerFeedback("cancel");
        }
      }
      announceDataChange();
      return result.value;
    } catch {
      setActionError(t("Fokusistunnon tilaa ei voitu päivittää."));
      return null;
    } finally {
      setWorking(false);
    }
  };

  const continueFocusFiveMinutes = async (): Promise<void> => {
    const extended = await updateSession((deps, id) =>
      extendFocusSession(deps, id, FIVE_MINUTE_START_SECONDS),
    );
    if (extended?.phase === "paused") {
      await updateSession(resumeFocusSession);
    }
  };

  const moveTimeboxToCalendar = async (): Promise<void> => {
    if (timeboxBlock === null) {
      return;
    }
    const completed = await updateSession(finishFocusSession);
    if (completed !== null) {
      await navigate(calendarReturnTo, { state: { openBlockId: timeboxBlock.id } });
    }
  };

  const startNewSession = async (
    plannedSeconds = DEFAULT_POMODORO_PRESET.workSeconds,
    taskId = focusTaskId,
  ): Promise<void> => {
    if (sessions === null || activeSession !== null || working) {
      return;
    }
    setWorking(true);
    setStartingDuration(plannedSeconds);
    setActionError(null);
    try {
      const deps = { clock: systemClock(), sessions: focusSessions, tasks };
      const planned = await startFocusSession(deps, {
        ...(taskId === "" ? {} : { taskId }),
        plannedSeconds,
      });
      if (!planned.ok) {
        setActionError(planned.error.userMessage);
        return;
      }
      const running = await beginFocusSession(deps, planned.value.id);
      if (!running.ok) {
        setSessions((current) => [...(current ?? []), planned.value]);
        setActionError(running.error.userMessage);
        return;
      }
      setSessions((current) => [...(current ?? []), running.value]);
      setShowRecoveryNotice(false);
      triggerFeedback("start");
      announceDataChange();
    } catch {
      setActionError("Fokusistuntoa ei voitu aloittaa.");
    } finally {
      setStartingDuration(null);
      setWorking(false);
    }
  };

  const progressPercent = Math.round(progress * 100);

  return (
    <>
      <Display>{t("Fokus")}</Display>
      {sessions === null ? (
        <section data-ui="focus-fullscreen" data-testid="focus-view-loading" aria-busy="true">
          <div data-ui="focus-session">
            <Meta>{t("Ladataan fokusta…")}</Meta>
          </div>
        </section>
      ) : activeSession === null ? (
        <section data-ui="focus-fullscreen" data-testid="focus-view-empty">
          <div data-ui="focus-session">
            <p data-ui="focus-kicker">{t("Pieni rajattu hetki")}</p>
            <h2 data-ui="focus-task">{t("Valmis yhdelle työjaksolle?")}</h2>
            <p data-ui="focus-description">
              {t("Sulje häly, valitse yksi asia ja anna sille 25 minuuttia rauhaa.")}
            </p>
            <p data-ui="focus-preset">{t("25 min työjakso · 5 min tauko")}</p>
            {showRecoveryNotice ? (
              <p data-ui="focus-recovery-notice" role="status">
                {t(
                  "Keskeytys tallentui historiaan. Voit palata koska tahansa, vaikka viideksi minuutiksi.",
                )}
              </p>
            ) : null}
            {nextFocusRecommendation !== null && focusTaskId === nextFocusRecommendation.task.id ? (
              <section data-ui="focus-next-step" aria-labelledby="focus-next-step-title">
                <p data-ui="focus-next-step-kicker">{t("Mitä teen seuraavaksi?")}</p>
                <h3 id="focus-next-step-title">{nextFocusRecommendation.task.title}</h3>
                <Meta>
                  {nextFocusRecommendation.reason} {t(" Voit aloittaa tästä suoraan.")}
                </Meta>
              </section>
            ) : null}
            {taskRows.some((task) => task.status === "open" && task.deletedAt === null) ? (
              <Select
                label={t("Liitä fokus tehtävään")}
                hint={
                  nextFocusRecommendation !== null &&
                  focusTaskId === nextFocusRecommendation.task.id
                    ? t("Suositus on valittu valmiiksi. Voit vaihtaa tehtävän ennen aloitusta.")
                    : t("Valmistuneet fokusminuutit kirjautuvat tehtävälle.")
                }
                placeholder={t("Fokus ilman tehtävää")}
                options={tOptions(
                  taskRows
                    .filter((task) => task.status === "open" && task.deletedAt === null)
                    .map((task) => ({ value: task.id, label: task.title })),
                )}
                value={focusTaskId}
                onChange={(event) => {
                  setSelectedTaskId(event.target.value);
                }}
              />
            ) : null}
            {loadingError !== null ? <p data-ui="focus-error">{t(loadingError)}</p> : null}
            {actionError !== null ? <p data-ui="focus-error">{t(actionError)}</p> : null}
            <div data-ui="focus-controls">
              <Button
                id="focus-start-primary"
                loading={working && startingDuration === DEFAULT_POMODORO_PRESET.workSeconds}
                disabled={working}
                onClick={() => void startNewSession()}
              >
                {t("Aloita fokus")}
              </Button>
              <Button
                variant="secondary"
                data-testid="focus-start-five-minutes"
                loading={working && startingDuration === FIVE_MINUTE_START_SECONDS}
                disabled={working}
                onClick={() => void startNewSession(FIVE_MINUTE_START_SECONDS)}
              >
                {t("Aloita 5 minuutiksi")}
              </Button>
              <Link data-ui="focus-exit" to="/">
                {t("Palaa Tänään-näkymään")}
              </Link>
            </div>
            <FocusFeedbackSettings
              soundEnabled={soundEnabled}
              vibrationEnabled={vibrationEnabled}
              soundSupported={soundSupported}
              onSoundChange={setSoundEnabled}
              onVibrationChange={setVibrationEnabled}
            />
          </div>
        </section>
      ) : (
        <section
          data-ui="focus-fullscreen"
          data-testid="focus-fullscreen"
          aria-label={t("Fokus-istunto")}
        >
          <div data-ui="focus-session">
            <div data-ui="focus-session-header">
              <p data-ui="focus-kicker">{phaseLabel(activeSession.phase)}</p>
              <Link data-ui="focus-exit" to={sessionBlockId !== null ? calendarReturnTo : "/"}>
                {sessionBlockId !== null ? t("← Kalenteri") : t("← Tänään")}
              </Link>
            </div>
            <h2 data-ui="focus-task">{taskTitle}</h2>
            {timeboxContext !== null ? (
              <p data-ui="focus-timebox-context">{timeboxContext}</p>
            ) : null}
            <div
              data-ui="focus-visual-progress"
              role="progressbar"
              aria-label={t("Fokusjakson eteneminen")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <ProgressRing
                value={progressPercent}
                label={t("Fokusjakson eteneminen")}
                decorative
              />
              <div data-ui="focus-visual-center">
                <p
                  data-ui="focus-time"
                  role="timer"
                  aria-live="polite"
                  aria-label={
                    remainingSeconds === null
                      ? t("Fokusajan laskenta ei ole vielä saatavilla")
                      : tTemplate("{{0}} jäljellä", [formatCountdown(remainingSeconds)])
                  }
                >
                  {formatCountdown(remainingSeconds)}
                </p>
                <span data-ui="focus-remaining-label">
                  {isComplete ? t("Työjakso valmis") : t("jäljellä")}
                </span>
              </div>
            </div>
            <div data-ui="focus-status-row">
              <Meta>
                {isComplete
                  ? t("Aika tuli täyteen. Valitse seuraava askel.")
                  : countdown.isVisible
                    ? t("Ajastin kulkee mukana myös taustalla.")
                    : t("Ajastin päivittyy, kun palaat tähän näkymään.")}
              </Meta>
            </div>
            {actionError !== null ? <p data-ui="focus-error">{t(actionError)}</p> : null}
            {activeSession.phase !== "planned" ? (
              <section
                data-ui="focus-end-flow"
                data-complete={isComplete ? "true" : "false"}
                aria-labelledby="focus-end-title"
              >
                <h3 id="focus-end-title">{t("Mitä seuraavaksi?")}</h3>
                <p>
                  {activeSession.phase === "paused"
                    ? isComplete
                      ? tTemplate(
                          "Aika tuli täyteen tauon aikana. Valmis kirjaa ajan tai lisää viisi minuuttia ja jatka.{{0}}",
                          [timeboxBlock === null ? "" : " Siirto avaa timeboxin kalenterissa."],
                        )
                      : tTemplate(
                          "Tauolla: jatka ajastinta, lisää viisi minuuttia tai päätä fokus.{{0}}",
                          [
                            timeboxBlock === null
                              ? ""
                              : t(" Siirto kirjaa tehdyn työn ja avaa kalenterin."),
                          ],
                        )
                    : isComplete
                      ? tTemplate(
                          "Aika tuli täyteen. Valmis kirjaa aktiivisen ajan; jatka lisäämällä viisi minuuttia tai pidä tauko.{{0}}",
                          [timeboxBlock === null ? "" : " Siirto avaa timeboxin kalenterissa."],
                        )
                      : tTemplate(
                          "Voit päättää fokuksen, lisätä viisi minuuttia tai pitää tauon.{{0}}",
                          [
                            timeboxBlock === null
                              ? ""
                              : t(" Siirto kirjaa tehdyn työn ja avaa timeboxin kalenterissa."),
                          ],
                        )}
                </p>
                <div data-ui="focus-end-choices">
                  <Button
                    variant="primary"
                    disabled={working}
                    loading={working}
                    onClick={() => void updateSession(finishFocusSession)}
                  >
                    {t("Valmis")}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={working}
                    loading={working}
                    onClick={() => void continueFocusFiveMinutes()}
                  >
                    {isComplete ? t("Jatka 5 min") : t("Lisää 5 min")}
                  </Button>
                  {activeSession.phase === "running" ? (
                    <Button
                      variant="secondary"
                      disabled={working}
                      loading={working}
                      onClick={() => void updateSession(pauseFocusSession)}
                    >
                      {t("Pidä tauko")}
                    </Button>
                  ) : isComplete ? (
                    <Meta>{t("Istunto on tauolla.")}</Meta>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={working}
                      loading={working}
                      onClick={() => void updateSession(resumeFocusSession)}
                    >
                      {t("Jatka")}
                    </Button>
                  )}
                  {timeboxBlock !== null ? (
                    <Button
                      variant="ghost"
                      disabled={working}
                      loading={working}
                      onClick={() => void moveTimeboxToCalendar()}
                    >
                      {t("Siirrä timeboxia")}
                    </Button>
                  ) : null}
                </div>
                {!isComplete ? (
                  <div data-ui="focus-controls">
                    <Button
                      variant="ghost"
                      disabled={working}
                      loading={working}
                      onClick={() => void updateSession(cancelFocusSession)}
                    >
                      {t("Peruuta istunto")}
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : (
              <div data-ui="focus-controls">
                <Button
                  disabled={working}
                  loading={working}
                  onClick={() => void updateSession(beginFocusSession)}
                >
                  {t("Aloita fokus")}
                </Button>
                <Button
                  variant="ghost"
                  disabled={working}
                  loading={working}
                  onClick={() => void updateSession(cancelFocusSession)}
                >
                  {t("Peruuta istunto")}
                </Button>
              </div>
            )}
            {activeSession.phase === "running" || activeSession.phase === "paused" ? (
              <div data-ui="focus-interruption">
                <Meta>
                  {t("Itse kirjattuja keskeytyksiä: ")}
                  {activeSession.interruptionCount ?? 0}
                </Meta>
                <Button
                  variant="ghost"
                  disabled={working}
                  loading={working}
                  onClick={() => void updateSession(recordFocusInterruption)}
                >
                  {t("Kirjaa keskeytys")}
                </Button>
              </div>
            ) : null}
            {activeSession.phase === "running" || activeSession.phase === "paused" ? (
              <FocusDistractionParkingLot session={activeSession} />
            ) : null}
            <FocusFeedbackSettings
              soundEnabled={soundEnabled}
              vibrationEnabled={vibrationEnabled}
              soundSupported={soundSupported}
              onSoundChange={setSoundEnabled}
              onVibrationChange={setVibrationEnabled}
            />
          </div>
        </section>
      )}
      {sessions !== null ? (
        activeSession !== null ? (
          <details data-ui="focus-secondary-info">
            <summary>{t("Tilastot ja historia")}</summary>
            <div data-ui="focus-secondary-info-content">
              <FocusWeeklyStats sessions={sessions} />
              <FocusHistory
                sessions={sessions}
                tasks={taskRows}
                calendarBlocks={blockRows}
                xpTransactions={xpRows}
                showGamification={gamificationVisible === true}
              />
            </div>
          </details>
        ) : (
          <>
            <FocusWeeklyStats sessions={sessions} />
            <FocusHistory
              sessions={sessions}
              tasks={taskRows}
              calendarBlocks={blockRows}
              xpTransactions={xpRows}
              showGamification={gamificationVisible === true}
            />
          </>
        )
      ) : null}
    </>
  );
}
