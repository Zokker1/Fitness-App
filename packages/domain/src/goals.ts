// T140: Goal/HabitRule-domainvalidointi. Päivämäärät ovat paikallisia
// kalenteripäiviä, eivät hetkiä — niitä ei muunnetä UTC-aikaleimoiksi.
import type { Goal, HabitCadence } from "./productivity.ts";
import type { DomainResult } from "./rules.ts";

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function localDateToOrdinal(value: string): number | null {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.getTime();
}

export function isValidLocalDateKey(value: string): boolean {
  return localDateToOrdinal(value) !== null;
}

export interface GoalValues {
  readonly title: string;
  readonly description: string | null;
  readonly activeFrom: string | null;
  readonly activeUntil: string | null;
}

export function validateGoalValues(input: {
  readonly title: string;
  readonly description?: string | null;
  readonly activeFrom?: string | null;
  readonly activeUntil?: string | null;
}): DomainResult<GoalValues> {
  const title = input.title.trim();
  if (title.length === 0) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavoitteen otsikko ei saa olla tyhjä." },
    };
  }
  if (title.length > 200) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Tavoitteen otsikko on liian pitkä (enintään 200 merkkiä).",
      },
    };
  }
  const description = input.description?.trim() ?? null;
  if (description !== null && description.length > 2000) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Tavoitteen kuvaus on liian pitkä (enintään 2000 merkkiä).",
      },
    };
  }
  const activeFrom = input.activeFrom ?? null;
  const activeUntil = input.activeUntil ?? null;
  const fromOrdinal = activeFrom === null ? null : localDateToOrdinal(activeFrom);
  const untilOrdinal = activeUntil === null ? null : localDateToOrdinal(activeUntil);
  if (activeFrom !== null && fromOrdinal === null) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Tavoitteen alkupäivän on oltava kelvollinen YYYY-MM-DD-päivä.",
      },
    };
  }
  if (activeUntil !== null && untilOrdinal === null) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Tavoitteen loppupäivän on oltava kelvollinen YYYY-MM-DD-päivä.",
      },
    };
  }
  if (fromOrdinal !== null && untilOrdinal !== null && fromOrdinal > untilOrdinal) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Tavoitteen alkupäivä ei voi olla loppupäivän jälkeen.",
      },
    };
  }
  return { ok: true, value: { title, description, activeFrom, activeUntil } };
}

export function isGoalActiveOnLocalDate(
  goal: Pick<Goal, "deletedAt" | "archivedAt" | "activeFrom" | "activeUntil">,
  localDate: string,
): boolean {
  const dateOrdinal = localDateToOrdinal(localDate);
  if (dateOrdinal === null || goal.deletedAt !== null || goal.archivedAt !== null) {
    return false;
  }
  const fromOrdinal =
    goal.activeFrom === undefined || goal.activeFrom === null
      ? null
      : localDateToOrdinal(goal.activeFrom);
  const untilOrdinal =
    goal.activeUntil === undefined || goal.activeUntil === null
      ? null
      : localDateToOrdinal(goal.activeUntil);
  return (
    (fromOrdinal === null || dateOrdinal >= fromOrdinal) &&
    (untilOrdinal === null || dateOrdinal <= untilOrdinal)
  );
}

export interface HabitRuleValues {
  readonly goalId: string | null;
  readonly title: string;
  readonly cadence: HabitCadence;
  readonly targetPerPeriod: number;
}

export function validateHabitRuleValues(input: {
  readonly goalId?: string | null;
  readonly title: string;
  readonly cadence: string;
  readonly targetPerPeriod: number;
}): DomainResult<HabitRuleValues> {
  const title = input.title.trim();
  if (title.length === 0 || title.length > 200) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavan säännön otsikon pituus on 1–200 merkkiä." },
    };
  }
  if (input.goalId !== undefined && input.goalId !== null && input.goalId.trim().length === 0) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavan tavoitetunniste ei saa olla tyhjä." },
    };
  }
  if (input.cadence !== "daily" && input.cadence !== "weekly" && input.cadence !== "custom") {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavan rytmin on oltava daily, weekly tai custom." },
    };
  }
  if (!Number.isInteger(input.targetPerPeriod) || input.targetPerPeriod < 1) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Tavan tavoitemäärän on oltava vähintään 1 kokonaisluku.",
      },
    };
  }
  return {
    ok: true,
    value: {
      goalId: input.goalId ?? null,
      title,
      cadence: input.cadence,
      targetPerPeriod: input.targetPerPeriod,
    },
  };
}
