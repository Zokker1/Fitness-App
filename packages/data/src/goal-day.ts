// T085: goal-day-toggle (pure data-funktiot, ei IO:ta).
// Kriteeri: aktiiviset goal-day-tilat näkyvät ILMAN tulevien päivien väärää
// completionia. Säännöt:
// - toggle koskee AINA yhtä (goalId, localDate) -paria; ei massamerkintöjä.
// - Vain TÄMÄ päivä on vaihdettavissa UI:sta: tulevan päivän (localDate >
//   todayKey) merkintä completediksi HYLÄTÄÄN (ei väärää completionia);
//   mennyt päivä sallitaan (jälkikirjaus on rehellistä).
// - toggleGoalDay palauttaa uuden GoalDay-rivin valmiina tallennukseen
//   (create tai update eroteltuna) — repository-kutsut jäävät kutsujalle
//   (ei store-riippuvuutta tässä).
import type { EntityId, Goal, GoalDay } from "@lifeos/domain";

export interface GoalDayToggle {
  /** Uusi completed-tila vaihtamisen jälkeen. */
  readonly completed: boolean;
}

export interface GoalDayWrite {
  readonly create: Omit<GoalDay, "id" | "createdAt" | "updatedAt" | "version"> | null;
  readonly updateId: EntityId | null;
  readonly updateCompleted: boolean | null;
}

/**
 * Laskee vaihtamisen tuloksen. Palauttaa kirjoitusohjeen TAI virheen
 * (tulevan päivän completion + tuntematon goalId hylätään).
 */
export function toggleGoalDay(input: {
  readonly goalId: EntityId;
  readonly localDate: string;
  readonly completed: boolean;
  readonly todayKey: string;
  readonly existing: readonly GoalDay[];
  readonly goals: readonly Goal[];
}): { ok: true; value: GoalDayWrite & GoalDayToggle } | { ok: false; error: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate)) {
    return { ok: false, error: "Päivämäärän muoto on YYYY-MM-DD." };
  }
  const goal = input.goals.find((candidate) => candidate.id === input.goalId);
  if (goal === undefined || goal.deletedAt !== null || goal.archivedAt !== null) {
    return { ok: false, error: "Tavoitetta ei löydy tai se ei ole aktiivinen." };
  }
  if (input.localDate > input.todayKey && input.completed) {
    return { ok: false, error: "Tulevaa päivää ei voi merkitä tehdyksi etukäteen." };
  }
  const row = input.existing.find(
    (candidate) => candidate.goalId === input.goalId && candidate.localDate === input.localDate,
  );
  if (row === undefined) {
    return {
      ok: true,
      value: {
        completed: input.completed,
        create: { goalId: input.goalId, localDate: input.localDate, completed: input.completed },
        updateId: null,
        updateCompleted: null,
      },
    };
  }
  return {
    ok: true,
    value: {
      completed: input.completed,
      create: null,
      updateId: row.id,
      updateCompleted: input.completed,
    },
  };
}

/** Päivämääräavain UTC-hetkestä UI:n offsetilla (sama kuin TodayView). */
export function localDateKey(nowIso: string, timezoneOffsetMinutes: number): string {
  return new Date(Date.parse(nowIso) + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}
