// T243: UTC-aikaleimalla tallennettu aktiviteettimerkintä ja valinnainen note.

import type { ActivityEntry, UtcTimestamp } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

export const ACTIVITY_KIND_MAX_LENGTH = 60;
export const ACTIVITY_NOTE_MAX_LENGTH = 500;

export interface ActivityEntryServiceDeps {
  readonly clock: Clock;
  readonly activities: EntityRepository<ActivityEntry>;
}

export interface CreateActivityEntryInput {
  /** Aktiviteetin ajankohta UTC ISO-8601 -muodossa. */
  readonly activityAt: UtcTimestamp;
  /** Vapaa aktiviteettityyppi, esimerkiksi kävely tai kuntosaliharjoitus. */
  readonly kind: string;
  readonly durationSeconds?: number | null | undefined;
  readonly distanceMeters?: number | null | undefined;
  readonly note?: string | null | undefined;
}

export type UpdateActivityEntryInput = Partial<CreateActivityEntryInput>;

export interface ListActivityEntriesOptions {
  readonly includeDeleted?: boolean | undefined;
}

type ActivityFields = Pick<
  ActivityEntry,
  "activityAt" | "kind" | "durationSeconds" | "distanceMeters" | "note"
>;

const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function invalidActivityEntry<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.activity-entry.validation.${field}`, message),
  };
}

function isValidUtcTimestamp(value: unknown): value is UtcTimestamp {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return false;
  const parts = value.slice(0, -1).split(".");
  const wholeSeconds = parts[0];
  const fraction = parts[1] ?? "";
  if (wholeSeconds === undefined) return false;
  return new Date(milliseconds).toISOString() === `${wholeSeconds}.${fraction.padEnd(3, "0")}Z`;
}

function validateActivityFields(input: CreateActivityEntryInput): DataResult<ActivityFields> {
  if (!isValidUtcTimestamp(input.activityAt)) {
    return invalidActivityEntry("time", "Aktiviteetin aika ei ole kelvollinen UTC-aika.");
  }
  if (typeof input.kind !== "string") {
    return invalidActivityEntry("kind", "Valitse aktiviteetin tyyppi.");
  }
  const kind = input.kind.trim();
  if (kind.length === 0 || kind.length > ACTIVITY_KIND_MAX_LENGTH) {
    return invalidActivityEntry(
      "kind-length",
      `Aktiviteetin tyypin pitää olla 1–${String(ACTIVITY_KIND_MAX_LENGTH)} merkkiä.`,
    );
  }
  const durationSeconds = input.durationSeconds ?? null;
  if (durationSeconds !== null && (!Number.isInteger(durationSeconds) || durationSeconds < 0)) {
    return invalidActivityEntry(
      "duration",
      "Keston pitää olla nolla tai sitä suurempi kokonaisluku sekunteina.",
    );
  }
  const distanceMeters = input.distanceMeters ?? null;
  if (
    distanceMeters !== null &&
    (typeof distanceMeters !== "number" || !Number.isFinite(distanceMeters) || distanceMeters < 0)
  ) {
    return invalidActivityEntry(
      "distance",
      "Matkan pitää olla nolla tai sitä suurempi äärellinen luku metreinä.",
    );
  }
  const rawNote = input.note ?? null;
  if (rawNote !== null && typeof rawNote !== "string") {
    return invalidActivityEntry("note", "Muistiinpano ei kelpaa.");
  }
  const note = rawNote?.trim() || null;
  if (note !== null && note.length > ACTIVITY_NOTE_MAX_LENGTH) {
    return invalidActivityEntry(
      "note-length",
      `Muistiinpano voi olla enintään ${String(ACTIVITY_NOTE_MAX_LENGTH)} merkkiä.`,
    );
  }
  return {
    ok: true,
    value: { activityAt: input.activityAt, kind, durationSeconds, distanceMeters, note },
  };
}

export async function createActivityEntryService(
  deps: ActivityEntryServiceDeps,
  input: CreateActivityEntryInput,
): Promise<DataResult<ActivityEntry>> {
  const fields = validateActivityFields(input);
  if (!fields.ok) return fields;
  return deps.activities.create({ ...fields.value, deletedAt: null });
}

export function getActivityEntryService(
  deps: ActivityEntryServiceDeps,
  id: string,
): Promise<DataResult<ActivityEntry>> {
  return deps.activities.getById(id);
}

export async function listActivityEntriesService(
  deps: ActivityEntryServiceDeps,
  options: ListActivityEntriesOptions = {},
): Promise<DataResult<readonly ActivityEntry[]>> {
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== "boolean") {
    return invalidActivityEntry(
      "include-deleted",
      "Poistettujen aktiviteettien valinta ei kelpaa.",
    );
  }
  const listed = await deps.activities.list();
  if (!listed.ok) return listed;
  const entries = listed.value
    .filter((entry) => options.includeDeleted === true || entry.deletedAt === null)
    .slice()
    .sort((left, right) =>
      left.activityAt === right.activityAt
        ? left.id.localeCompare(right.id)
        : right.activityAt.localeCompare(left.activityAt),
    );
  return { ok: true, value: entries };
}

export async function updateActivityEntryService(
  deps: ActivityEntryServiceDeps,
  id: string,
  patch: UpdateActivityEntryInput,
): Promise<DataResult<ActivityEntry>> {
  const existing = await deps.activities.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null) {
    return invalidActivityEntry("update-deleted", "Poistettua aktiviteettia ei voi muokata.");
  }
  if (
    patch.activityAt === undefined &&
    patch.kind === undefined &&
    patch.durationSeconds === undefined &&
    patch.distanceMeters === undefined &&
    patch.note === undefined
  ) {
    return invalidActivityEntry(
      "empty-update",
      "Muuta aktiviteettia, aikaa, kestoa tai muistiinpanoa.",
    );
  }
  const fields = validateActivityFields({
    activityAt: patch.activityAt ?? existing.value.activityAt,
    kind: patch.kind ?? existing.value.kind,
    durationSeconds:
      patch.durationSeconds === undefined ? existing.value.durationSeconds : patch.durationSeconds,
    distanceMeters:
      patch.distanceMeters === undefined ? existing.value.distanceMeters : patch.distanceMeters,
    note: patch.note === undefined ? (existing.value.note ?? null) : patch.note,
  });
  if (!fields.ok) return fields;
  return deps.activities.update(id, fields.value);
}

export async function deleteActivityEntryService(
  deps: ActivityEntryServiceDeps,
  id: string,
): Promise<DataResult<ActivityEntry>> {
  const existing = await deps.activities.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null) {
    return invalidActivityEntry("delete-transition", "Aktiviteetti on jo poistettu.");
  }
  return deps.activities.update(id, { deletedAt: deps.clock.nowIso() });
}

export async function restoreActivityEntryService(
  deps: ActivityEntryServiceDeps,
  id: string,
): Promise<DataResult<ActivityEntry>> {
  const existing = await deps.activities.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt === null) {
    return invalidActivityEntry("restore-transition", "Aktiviteettia ei ole poistettu.");
  }
  return deps.activities.update(id, { deletedAt: null });
}
