// T234: lisäravinnesuunnitelman ajankohdat ja toteutuneet tilat ovat erillisiä.

import { toLocalDateKey } from "@lifeos/domain";
import type { Supplement, SupplementLog, SupplementLogStatus } from "@lifeos/domain";
import { alreadyExists, type DataResult, invalidInput } from "./errors.ts";
import { awardHealthTrackingXp, type HealthTrackingXpDeps } from "./health-tracking-xp.ts";
import type { EntityRepository } from "./repositories.ts";

const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const MAX_SCHEDULE_COUNT = 12;

export interface SupplementLogServiceDeps extends HealthTrackingXpDeps {
  readonly supplements: EntityRepository<Supplement>;
  readonly supplementLogs: EntityRepository<SupplementLog>;
}

export interface CreateSupplementLogInput {
  readonly supplementId: string;
  readonly status: SupplementLogStatus;
  /** Suunnitellun päivittäisen annoksen UTC-aika; null = aikatauluton otto. */
  readonly scheduledAt?: string | null | undefined;
}

export interface ListSupplementLogsOptions {
  readonly supplementId?: string | undefined;
  readonly localDate?: string | undefined;
  readonly timezoneOffsetMinutes?: number | undefined;
  /** Inclusive UTC activity-time lower bound for history searches. */
  readonly from?: string | undefined;
  /** Inclusive UTC activity-time upper bound for history searches. */
  readonly to?: string | undefined;
  readonly status?: SupplementLogStatus | undefined;
}

export interface EnsureSupplementScheduleInput {
  readonly localDate: string;
  /** Minuutit UTC-ajasta käyttäjän paikallisaikaan, sama suunta kuin toLocalDateKey-funktiossa. */
  readonly timezoneOffsetMinutes: number;
}

function invalidLog<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.supplement-log.validation.${field}`, message),
  };
}

function isSupplementLogStatus(value: unknown): value is SupplementLogStatus {
  return value === "taken" || value === "skipped" || value === "pending";
}

/** Vanhoissa lokeissa, joissa tilaa ei ole tallennettu, takenAt ratkaisee tilan. */
export function getSupplementLogStatus(
  log: Pick<SupplementLog, "status" | "takenAt">,
): SupplementLogStatus {
  if (isSupplementLogStatus(log.status)) return log.status;
  return log.takenAt === null ? "pending" : "taken";
}

/** Päivänäkymä käyttää otetuille todellista ottoaikaa ja muille suunniteltua aikaa. */
export function getSupplementLogActivityAt(log: SupplementLog): string {
  return getSupplementLogStatus(log) === "taken"
    ? (log.takenAt ?? log.scheduledAt ?? log.createdAt)
    : (log.scheduledAt ?? log.createdAt);
}

function validateStatus(value: unknown): DataResult<SupplementLogStatus> {
  if (!isSupplementLogStatus(value)) {
    return invalidLog("status", "Valitse tilaksi otettu, ohitettu tai odottaa.");
  }
  return { ok: true, value };
}

function validateTimestamp(value: unknown, field: string): DataResult<string> {
  if (
    typeof value !== "string" ||
    !UTC_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    return invalidLog(field, "Ajankohta ei ole kelvollinen UTC-aikaleima.");
  }
  if (new Date(value).toISOString().slice(0, 10) !== value.slice(0, 10)) {
    return invalidLog(field, "Ajankohta ei ole kelvollinen UTC-aikaleima.");
  }
  return { ok: true, value };
}

function validateLocalDate(value: unknown): DataResult<string> {
  if (typeof value !== "string" || !LOCAL_DATE_PATTERN.test(value)) {
    return invalidLog("local-date", "Päivämäärän tulee olla muodossa YYYY-MM-DD.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalidLog("local-date", "Päivämäärä ei ole kelvollinen.");
  }
  return { ok: true, value };
}

function validateTimezoneOffset(value: unknown): DataResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < -840 || value > 840) {
    return invalidLog(
      "timezone-offset",
      "Aikavyöhykkeen siirtymän tulee olla kokonaisluku välillä −840–840.",
    );
  }
  return { ok: true, value };
}

function localScheduleToUtc(localDate: string, localTime: string, offsetMinutes: number): string {
  const [year = 0, month = 1, day = 1] = localDate.split("-").map(Number);
  const [hour = 0, minute = 0] = localTime.split(":").map(Number);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, 0, 0);
  return new Date(local.getTime() - offsetMinutes * 60_000).toISOString();
}

/** Luo yksi eksplisiittinen lokirivi; odottava tai ohitettu rivi tarvitsee suunnitellun ajan. */
export async function createSupplementLogService(
  deps: SupplementLogServiceDeps,
  input: CreateSupplementLogInput,
): Promise<DataResult<SupplementLog>> {
  if (typeof input.supplementId !== "string" || input.supplementId.trim().length === 0) {
    return invalidLog("supplement-id", "Valitse lisäravinne kirjaukselle.");
  }
  const status = validateStatus(input.status);
  if (!status.ok) return status;
  const scheduledAt =
    input.scheduledAt === undefined || input.scheduledAt === null
      ? { ok: true as const, value: null }
      : validateTimestamp(input.scheduledAt, "scheduled-at");
  if (!scheduledAt.ok) return scheduledAt;
  if (status.value !== "taken" && scheduledAt.value === null) {
    return invalidLog(
      "scheduled-at-required",
      "Odottava tai ohitettu kirjaus tarvitsee suunnitellun ajankohdan.",
    );
  }

  const supplement = await deps.supplements.getById(input.supplementId);
  if (!supplement.ok) return supplement;
  if (supplement.value.deletedAt !== null) {
    return invalidLog("supplement-deleted", "Poistetulle lisäravinteelle ei voi lisätä kirjausta.");
  }

  if (scheduledAt.value !== null) {
    const listed = await deps.supplementLogs.list();
    if (!listed.ok) return listed;
    if (
      listed.value.some(
        (log) => log.supplementId === input.supplementId && log.scheduledAt === scheduledAt.value,
      )
    ) {
      return { ok: false, error: alreadyExists("supplement-log") };
    }
  }

  const now = deps.clock.nowIso();
  const created = await deps.supplementLogs.create({
    supplementId: input.supplementId,
    status: status.value,
    scheduledAt: scheduledAt.value,
    doseAmount: supplement.value.amount ?? null,
    doseUnit: supplement.value.unit ?? null,
    takenAt: status.value === "taken" ? now : null,
  });
  if (created.ok && status.value === "taken" && created.value.takenAt !== null) {
    await awardHealthTrackingXp(deps, "supplement", created.value.takenAt);
  }
  return created;
}

/** Luo päivän aikataulun puuttuvat odottavat lokit; uudelleenajo ei monista rivejä. */
export async function ensureSupplementScheduleForDateService(
  deps: SupplementLogServiceDeps,
  input: EnsureSupplementScheduleInput,
): Promise<DataResult<readonly SupplementLog[]>> {
  const localDate = validateLocalDate(input.localDate);
  if (!localDate.ok) return localDate;
  const offsetMinutes = validateTimezoneOffset(input.timezoneOffsetMinutes);
  if (!offsetMinutes.ok) return offsetMinutes;
  const listedSupplements = await deps.supplements.list();
  if (!listedSupplements.ok) return listedSupplements;
  const listedLogs = await deps.supplementLogs.list();
  if (!listedLogs.ok) return listedLogs;

  const created: SupplementLog[] = [];
  const scheduledKeys = new Set(
    listedLogs.value
      .filter((log) => log.scheduledAt !== undefined && log.scheduledAt !== null)
      .map((log) => `${log.supplementId}|${log.scheduledAt ?? ""}`),
  );
  const activeSupplements = listedSupplements.value.filter(
    (supplement) => supplement.deletedAt === null,
  );
  for (const supplement of activeSupplements) {
    const schedule = supplement.schedule ?? [];
    if (!Array.isArray(schedule) || schedule.length > MAX_SCHEDULE_COUNT) {
      return invalidLog("schedule-corrupt", "Lisäravinteen tallennetussa aikataulussa on virhe.");
    }
    for (const localTime of schedule) {
      if (typeof localTime !== "string" || !LOCAL_TIME_PATTERN.test(localTime)) {
        return invalidLog("schedule-corrupt", "Lisäravinteen tallennetussa aikataulussa on virhe.");
      }
      const scheduledAt = localScheduleToUtc(localDate.value, localTime, offsetMinutes.value);
      const scheduleKey = `${supplement.id}|${scheduledAt}`;
      if (scheduledKeys.has(scheduleKey)) continue;
      const log = await createSupplementLogService(deps, {
        supplementId: supplement.id,
        status: "pending",
        scheduledAt,
      });
      if (!log.ok) return log;
      created.push(log.value);
      scheduledKeys.add(scheduleKey);
    }
  }
  return { ok: true, value: created };
}

/** Hakee lokin tunnisteella. */
export function getSupplementLogService(
  deps: SupplementLogServiceDeps,
  id: string,
): Promise<DataResult<SupplementLog>> {
  return deps.supplementLogs.getById(id);
}

/** Listaa lokit uusimmasta ajankohdasta vanhimpaan. */
export async function listSupplementLogsService(
  deps: SupplementLogServiceDeps,
  options: ListSupplementLogsOptions = {},
): Promise<DataResult<readonly SupplementLog[]>> {
  if (
    options.supplementId !== undefined &&
    (typeof options.supplementId !== "string" || options.supplementId.trim().length === 0)
  ) {
    return invalidLog("supplement-id", "Lisäravinteen tunniste ei voi olla tyhjä.");
  }
  let localDate: string | undefined;
  let offsetMinutes: number | undefined;
  if (options.localDate !== undefined) {
    const date = validateLocalDate(options.localDate);
    if (!date.ok) return date;
    localDate = date.value;
  }
  if (options.timezoneOffsetMinutes !== undefined) {
    const offset = validateTimezoneOffset(options.timezoneOffsetMinutes);
    if (!offset.ok) return offset;
    offsetMinutes = offset.value;
  }
  if ((localDate === undefined) !== (offsetMinutes === undefined)) {
    return invalidLog("date-filter", "Päiväsuodatin tarvitsee myös aikavyöhykkeen siirtymän.");
  }
  let from: string | undefined;
  let to: string | undefined;
  if (options.from !== undefined) {
    const validatedFrom = validateTimestamp(options.from, "from");
    if (!validatedFrom.ok) return validatedFrom;
    from = validatedFrom.value;
  }
  if (options.to !== undefined) {
    const validatedTo = validateTimestamp(options.to, "to");
    if (!validatedTo.ok) return validatedTo;
    to = validatedTo.value;
  }
  if (from !== undefined && to !== undefined && from > to) {
    return invalidLog("date-range", "Aikavälin alku ei voi olla loppua myöhemmin.");
  }
  if (options.status !== undefined && !isSupplementLogStatus(options.status)) {
    return invalidLog("status", "Valitse tilaksi otettu, ohitettu tai odottaa.");
  }
  const listed = await deps.supplementLogs.list();
  if (!listed.ok) return listed;
  const logs = listed.value
    .filter(
      (log) => options.supplementId === undefined || log.supplementId === options.supplementId,
    )
    .filter((log) => options.status === undefined || getSupplementLogStatus(log) === options.status)
    .filter(
      (log) =>
        localDate === undefined ||
        toLocalDateKey(getSupplementLogActivityAt(log), offsetMinutes ?? 0) === localDate,
    )
    .filter(
      (log) =>
        from === undefined || Date.parse(getSupplementLogActivityAt(log)) >= Date.parse(from),
    )
    .filter(
      (log) => to === undefined || Date.parse(getSupplementLogActivityAt(log)) <= Date.parse(to),
    )
    .sort(
      (left, right) =>
        Date.parse(getSupplementLogActivityAt(right)) -
          Date.parse(getSupplementLogActivityAt(left)) || right.id.localeCompare(left.id),
    );
  return { ok: true, value: logs };
}

/** Vaihtaa tilaa; pending ja skipped kirjataan ilman takenAt-aikaa. */
export async function updateSupplementLogStatusService(
  deps: SupplementLogServiceDeps,
  id: string,
  nextStatus: SupplementLogStatus,
): Promise<DataResult<SupplementLog>> {
  const status = validateStatus(nextStatus);
  if (!status.ok) return status;
  const existing = await deps.supplementLogs.getById(id);
  if (!existing.ok) return existing;
  const supplement = await deps.supplements.getById(existing.value.supplementId);
  if (!supplement.ok) return supplement;
  if (
    status.value !== "taken" &&
    (existing.value.scheduledAt === undefined || existing.value.scheduledAt === null)
  ) {
    return invalidLog(
      "scheduled-at-required",
      "Odottava tai ohitettu kirjaus tarvitsee suunnitellun ajankohdan.",
    );
  }
  const currentStatus = getSupplementLogStatus(existing.value);
  if (existing.value.status === status.value) return existing;
  const takenAt =
    status.value === "taken"
      ? currentStatus === "taken"
        ? (existing.value.takenAt ?? deps.clock.nowIso())
        : deps.clock.nowIso()
      : null;
  const updated = await deps.supplementLogs.update(id, {
    status: status.value,
    takenAt,
    doseAmount:
      status.value === "taken"
        ? (existing.value.doseAmount ?? supplement.value.amount ?? null)
        : (existing.value.doseAmount ?? null),
    doseUnit:
      status.value === "taken"
        ? (existing.value.doseUnit ?? supplement.value.unit ?? null)
        : (existing.value.doseUnit ?? null),
  });
  if (
    updated.ok &&
    status.value === "taken" &&
    currentStatus !== "taken" &&
    updated.value.takenAt !== null
  ) {
    await awardHealthTrackingXp(deps, "supplement", updated.value.takenAt);
  }
  return updated;
}

/** Kirjaa aikatauluttoman oton tai merkitsee olemassa olevan aikataulurivin otetuksi. */
export async function recordSupplementTakenService(
  deps: SupplementLogServiceDeps,
  input: Omit<CreateSupplementLogInput, "status">,
): Promise<DataResult<SupplementLog>> {
  if (input.scheduledAt !== undefined && input.scheduledAt !== null) {
    const scheduledAt = validateTimestamp(input.scheduledAt, "scheduled-at");
    if (!scheduledAt.ok) return scheduledAt;
    const listed = await deps.supplementLogs.list();
    if (!listed.ok) return listed;
    const existing = listed.value.find(
      (log) => log.supplementId === input.supplementId && log.scheduledAt === scheduledAt.value,
    );
    if (existing !== undefined) {
      return updateSupplementLogStatusService(deps, existing.id, "taken");
    }
  }
  return createSupplementLogService(deps, { ...input, status: "taken" });
}
