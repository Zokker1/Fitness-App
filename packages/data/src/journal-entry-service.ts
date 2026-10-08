// T250: validoitu päiväkirja- ja reflektiosisällön luonti.
import type { JournalEntry, UtcTimestamp } from "@lifeos/domain";
import { JOURNAL_REFLECTION_FIELD_MAX_LENGTH } from "@lifeos/domain";
import { type DataResult, invalidInput } from "./errors.ts";
import type { Clock } from "./clock.ts";
import type { EntityRepository } from "./repositories.ts";

export interface JournalEntryServiceDeps {
  readonly clock: Clock;
  readonly journalEntries: EntityRepository<JournalEntry>;
}

export interface CreateJournalEntryInput {
  readonly writtenAt?: UtcTimestamp | undefined;
  readonly title?: string | null | undefined;
  readonly body?: string | undefined;
  readonly reflectionSuccess?: string | null | undefined;
  readonly reflectionDifficult?: string | null | undefined;
  readonly reflectionTomorrow?: string | null | undefined;
}

function isOptionalText(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

function isUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
  ) {
    return false;
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = /\.(\d{1,3})Z$/.exec(value)?.[1]?.padEnd(3, "0") ?? "000";
  return new Date(milliseconds).toISOString() === `${value.slice(0, 19)}.${fraction}Z`;
}

function invalidJournalEntry<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.journal-entry.validation.${field}`, message),
  };
}

export async function createJournalEntryService(
  deps: JournalEntryServiceDeps,
  input: CreateJournalEntryInput,
): Promise<DataResult<JournalEntry>> {
  if (
    !isOptionalText(input.title) ||
    !isOptionalText(input.reflectionSuccess) ||
    !isOptionalText(input.reflectionDifficult) ||
    !isOptionalText(input.reflectionTomorrow)
  ) {
    return invalidJournalEntry("text", "Päiväkirjan tekstikenttien pitää olla merkkijonoja.");
  }
  if (input.body !== undefined && typeof input.body !== "string") {
    return invalidJournalEntry("body", "Päiväkirjan vapaan tekstin pitää olla merkkijono.");
  }
  const title = normalizeOptionalText(input.title);
  const body = input.body?.trim() ?? "";
  const reflectionSuccess = normalizeOptionalText(input.reflectionSuccess);
  const reflectionDifficult = normalizeOptionalText(input.reflectionDifficult);
  const reflectionTomorrow = normalizeOptionalText(input.reflectionTomorrow);
  const reflections = [reflectionSuccess, reflectionDifficult, reflectionTomorrow];
  if (
    reflections.some(
      (value) => value !== null && value.length > JOURNAL_REFLECTION_FIELD_MAX_LENGTH,
    )
  ) {
    return invalidJournalEntry(
      "reflection-length",
      `Reflektiokenttä voi olla enintään ${String(JOURNAL_REFLECTION_FIELD_MAX_LENGTH)} merkkiä.`,
    );
  }
  if (body.length === 0 && reflections.every((value) => value === null)) {
    return invalidJournalEntry(
      "content",
      "Kirjoita vapaata tekstiä tai täytä jokin reflektiokenttä.",
    );
  }
  const writtenAt = input.writtenAt ?? deps.clock.nowIso();
  if (typeof writtenAt !== "string" || !isUtcTimestamp(writtenAt)) {
    return invalidJournalEntry(
      "written-at",
      "Päiväkirjan ajankohdan tulee olla kelvollinen UTC-aika.",
    );
  }
  return deps.journalEntries.create({
    writtenAt,
    title,
    body,
    reflectionSuccess,
    reflectionDifficult,
    reflectionTomorrow,
    deletedAt: null,
  });
}
