// T240: unimerkinnän palveluraja. UTC-hetket ovat ainoa tallennettava
// aikamuoto; kesto lasketaan kuluneesta ajasta, joten DST-vaihdokset eivät
// muuta saman unen todellista pituutta.

import type { SleepEntry, UtcTimestamp } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export const SLEEP_QUALITY_MINIMUM = 1;
export const SLEEP_QUALITY_MAXIMUM = 5;

export interface SleepEntryServiceDeps {
  readonly clock: Clock;
  readonly sleepEntries: EntityRepository<SleepEntry>;
}

export interface CreateSleepEntryInput {
  /** Nukkumaanmenohetki UTC ISO-8601 -muodossa. */
  readonly sleepStart: UtcTimestamp;
  /** Heräämishetki UTC ISO-8601 -muodossa. */
  readonly sleepEnd: UtcTimestamp;
  /** Käyttäjän oma arvio 1–5; null jättää arvion tyhjäksi. */
  readonly quality?: number | null | undefined;
  readonly isNap?: boolean | undefined;
}

export type UpdateSleepEntryInput = Partial<CreateSleepEntryInput>;

export interface ListSleepEntriesOptions {
  readonly includeDeleted?: boolean | undefined;
}

type SleepFields = Pick<SleepEntry, "sleepStart" | "sleepEnd" | "quality" | "isNap">;

const UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;

function invalidSleepEntry<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.sleep-entry.validation.${field}`, message),
  };
}

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string") return false;
  const match = UTC_TIMESTAMP_PATTERN.exec(value);
  if (match === null || match[1] === undefined) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const fraction = (match[2] ?? "").padEnd(3, "0");
  return new Date(milliseconds).toISOString() === `${match[1]}.${fraction}Z`;
}

function validateSleepFields(input: CreateSleepEntryInput): DataResult<SleepFields> {
  if (!isValidUtcTimestamp(input.sleepStart)) {
    return invalidSleepEntry("sleep-start", "Nukkumaanmenoaika ei ole kelvollinen UTC-aika.");
  }
  if (!isValidUtcTimestamp(input.sleepEnd)) {
    return invalidSleepEntry("sleep-end", "Heräämisaika ei ole kelvollinen UTC-aika.");
  }
  if (Date.parse(input.sleepEnd) <= Date.parse(input.sleepStart)) {
    return invalidSleepEntry("interval", "Heräämisajan pitää olla nukkumaanmenon jälkeen.");
  }
  const quality = input.quality ?? null;
  if (
    quality !== null &&
    (typeof quality !== "number" ||
      !Number.isInteger(quality) ||
      quality < SLEEP_QUALITY_MINIMUM ||
      quality > SLEEP_QUALITY_MAXIMUM)
  ) {
    return invalidSleepEntry("quality", "Unen laatuarvion on oltava kokonaisluku väliltä 1–5.");
  }
  const isNap = input.isNap ?? false;
  if (typeof isNap !== "boolean") {
    return invalidSleepEntry("nap", "Valitse, onko kyse päiväunista.");
  }
  return {
    ok: true,
    value: { sleepStart: input.sleepStart, sleepEnd: input.sleepEnd, quality, isNap },
  };
}

/** Palauttaa todellisen keston minuutteina UTC-instanteista, ilman paikallista kellolaskentaa. */
export function calculateSleepDurationMinutes(
  entry: Pick<SleepEntry, "sleepStart" | "sleepEnd">,
): number {
  return (Date.parse(entry.sleepEnd) - Date.parse(entry.sleepStart)) / 60_000;
}

export async function createSleepEntryService(
  deps: SleepEntryServiceDeps,
  input: CreateSleepEntryInput,
): Promise<DataResult<SleepEntry>> {
  const fields = validateSleepFields(input);
  if (!fields.ok) return fields;
  return deps.sleepEntries.create({ ...fields.value, deletedAt: null });
}

export function getSleepEntryService(
  deps: SleepEntryServiceDeps,
  id: string,
): Promise<DataResult<SleepEntry>> {
  return deps.sleepEntries.getById(id);
}

export async function listSleepEntriesService(
  deps: SleepEntryServiceDeps,
  options: ListSleepEntriesOptions = {},
): Promise<DataResult<readonly SleepEntry[]>> {
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== "boolean") {
    return invalidSleepEntry("include-deleted", "Poistettujen unitietojen valinta ei kelpaa.");
  }
  const listed = await deps.sleepEntries.list();
  if (!listed.ok) return listed;
  const entries = listed.value
    .filter((entry) => options.includeDeleted === true || entry.deletedAt === null)
    .slice()
    .sort((left, right) =>
      left.sleepStart === right.sleepStart
        ? left.id.localeCompare(right.id)
        : right.sleepStart.localeCompare(left.sleepStart),
    );
  return { ok: true, value: entries };
}

export async function updateSleepEntryService(
  deps: SleepEntryServiceDeps,
  id: string,
  patch: UpdateSleepEntryInput,
): Promise<DataResult<SleepEntry>> {
  const existing = await deps.sleepEntries.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null) {
    return invalidSleepEntry("update-deleted", "Poistettua unitietoa ei voi muokata.");
  }
  if (
    patch.sleepStart === undefined &&
    patch.sleepEnd === undefined &&
    patch.quality === undefined &&
    patch.isNap === undefined
  ) {
    return invalidSleepEntry("empty-update", "Muuta nukkumisväliä, laatuarviota tai unityyppiä.");
  }
  const fields = validateSleepFields({
    sleepStart: patch.sleepStart === undefined ? existing.value.sleepStart : patch.sleepStart,
    sleepEnd: patch.sleepEnd === undefined ? existing.value.sleepEnd : patch.sleepEnd,
    quality: patch.quality === undefined ? existing.value.quality : patch.quality,
    isNap: patch.isNap === undefined ? (existing.value.isNap ?? false) : patch.isNap,
  });
  if (!fields.ok) return fields;
  return deps.sleepEntries.update(id, fields.value);
}

export async function deleteSleepEntryService(
  deps: SleepEntryServiceDeps,
  id: string,
): Promise<DataResult<SleepEntry>> {
  const existing = await deps.sleepEntries.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null) {
    return invalidSleepEntry("delete-transition", "Unitieto on jo poistettu.");
  }
  return deps.sleepEntries.update(id, { deletedAt: deps.clock.nowIso() });
}

export async function restoreSleepEntryService(
  deps: SleepEntryServiceDeps,
  id: string,
): Promise<DataResult<SleepEntry>> {
  const existing = await deps.sleepEntries.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt === null) {
    return invalidSleepEntry("restore-transition", "Unitieto ei ole poistettu.");
  }
  return deps.sleepEntries.update(id, { deletedAt: null });
}
