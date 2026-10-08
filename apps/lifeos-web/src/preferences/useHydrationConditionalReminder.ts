// T232: arvioi käyttäjän paikallisen vesiehdon vain aktiivisessa sovellusnäkymässä.
import { useEffect, useState } from "react";
import {
  evaluateHydrationReminderCondition,
  systemClock,
  type HydrationReminderCondition,
} from "@lifeos/data";
import { useData } from "../dataContext.tsx";
import { useHydrationTarget } from "./HydrationTargetContext.tsx";
import { currentLocalReminderTime } from "../reminders/reminder-time.ts";

interface HydrationReminderState {
  readonly condition: HydrationReminderCondition | null;
  readonly error: string | null;
}

const EMPTY_STATE: HydrationReminderState = { condition: null, error: null };

export function useHydrationConditionalReminder(active: boolean): HydrationReminderState {
  const { hydrationEntries } = useData();
  const { targetMilliliters, reminderTime } = useHydrationTarget();
  const [state, setState] = useState<HydrationReminderState>(EMPTY_STATE);

  useEffect(() => {
    if (!active || targetMilliliters === null || reminderTime === null) {
      setState(EMPTY_STATE);
      return;
    }

    const guard: { cancelled: boolean } = { cancelled: false };
    const isCancelled = (): boolean => guard.cancelled;
    let checking = false;
    const evaluate = async (): Promise<void> => {
      if (isCancelled() || checking || document.visibilityState === "hidden") {
        return;
      }
      checking = true;
      try {
        const now = systemClock().nowIso();
        const local = currentLocalReminderTime(new Date(now));
        const listed = await hydrationEntries.list();
        if (isCancelled()) {
          return;
        }
        if (!listed.ok) {
          setState({ condition: null, error: listed.error.userMessage });
          return;
        }
        setState({
          condition: evaluateHydrationReminderCondition({
            entries: listed.value,
            localDate: local.date,
            timezoneOffsetMinutes: local.timezoneOffsetMinutes,
            timeZone: local.timeZone,
            now,
            targetMilliliters,
            reminderTime,
          }),
          error: null,
        });
      } catch {
        if (!isCancelled()) {
          setState({ condition: null, error: "Nestemuistutusta ei voitu tarkistaa." });
        }
      } finally {
        checking = false;
      }
    };

    void evaluate();
    const interval = window.setInterval(() => {
      void evaluate();
    }, 60_000);
    const onDataChanged = (): void => {
      void evaluate();
    };
    const onVisibilityChanged = (): void => {
      if (document.visibilityState === "visible") {
        void evaluate();
      }
    };
    window.addEventListener("lifeos:data-changed", onDataChanged);
    document.addEventListener("visibilitychange", onVisibilityChanged);
    return () => {
      guard.cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("lifeos:data-changed", onDataChanged);
      document.removeEventListener("visibilitychange", onVisibilityChanged);
    };
  }, [active, hydrationEntries, reminderTime, targetMilliliters]);

  return state;
}
