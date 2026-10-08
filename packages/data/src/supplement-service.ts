// T233: lisäravinteen käyttäjän antamat tiedot validoidaan ennen tallennusta.
// Määrä tai aikataulu eivät ole lääketieteellisiä suosituksia.

import { containsControlCharacters } from "@lifeos/domain";
import type { Supplement } from "@lifeos/domain";
import type { Clock } from "./clock.ts";
import { type DataResult, invalidInput } from "./errors.ts";
import type { EntityRepository } from "./repositories.ts";

const SUPPLEMENT_NAME_MAX_LENGTH = 200;
const SUPPLEMENT_UNIT_MAX_LENGTH = 40;
const SUPPLEMENT_AMOUNT_MAXIMUM = 1_000_000;
const SUPPLEMENT_SCHEDULE_MAX_COUNT = 12;
const LOCAL_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export interface SupplementServiceDeps {
  readonly clock: Clock;
  readonly supplements: EntityRepository<Supplement>;
}

export interface CreateSupplementInput {
  readonly name: string;
  readonly amount: number;
  readonly unit: string;
  /** Paikalliset päivittäiset ottoajat; tyhjä lista tarkoittaa, ettei aikataulua ole asetettu. */
  readonly schedule?: readonly string[] | undefined;
}

export interface UpdateSupplementInput {
  readonly name?: string | undefined;
  readonly amount?: number | undefined;
  readonly unit?: string | undefined;
  readonly schedule?: readonly string[] | undefined;
}

export interface ListSupplementsOptions {
  readonly query?: string | undefined;
  readonly includeDeleted?: boolean | undefined;
}

function invalidSupplement<T>(field: string, message: string): DataResult<T> {
  return {
    ok: false,
    error: invalidInput(`data.supplement.validation.${field}`, message),
  };
}

function validateName(value: unknown): DataResult<string> {
  if (typeof value !== "string") {
    return invalidSupplement("name", "Anna lisäravinteelle nimi.");
  }
  const name = value.trim();
  if (
    name.length === 0 ||
    name.length > SUPPLEMENT_NAME_MAX_LENGTH ||
    containsControlCharacters(name)
  ) {
    return invalidSupplement(
      "name",
      `Nimen pituuden tulee olla 1–${String(SUPPLEMENT_NAME_MAX_LENGTH)} merkkiä ilman ohjausmerkkejä.`,
    );
  }
  return { ok: true, value: name };
}

function validateAmount(value: unknown): DataResult<number> {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > SUPPLEMENT_AMOUNT_MAXIMUM
  ) {
    return invalidSupplement(
      "amount",
      `Määrän on oltava yli 0 ja enintään ${String(SUPPLEMENT_AMOUNT_MAXIMUM)}.`,
    );
  }
  return { ok: true, value };
}

function validateUnit(value: unknown): DataResult<string> {
  if (typeof value !== "string") {
    return invalidSupplement("unit", "Anna määrälle yksikkö.");
  }
  const unit = value.trim();
  if (
    unit.length === 0 ||
    unit.length > SUPPLEMENT_UNIT_MAX_LENGTH ||
    containsControlCharacters(unit)
  ) {
    return invalidSupplement(
      "unit",
      `Yksikön pituuden tulee olla 1–${String(SUPPLEMENT_UNIT_MAX_LENGTH)} merkkiä ilman ohjausmerkkejä.`,
    );
  }
  return { ok: true, value: unit };
}

function validateSchedule(value: unknown): DataResult<readonly string[]> {
  if (!Array.isArray(value) || value.length > SUPPLEMENT_SCHEDULE_MAX_COUNT) {
    return invalidSupplement(
      "schedule",
      `Aikataulu voi sisältää enintään ${String(SUPPLEMENT_SCHEDULE_MAX_COUNT)} kellonaikaa.`,
    );
  }
  const times: string[] = [];
  for (const item of value as readonly unknown[]) {
    if (typeof item !== "string" || !LOCAL_TIME_PATTERN.test(item)) {
      return invalidSupplement(
        "schedule",
        "Valitse jokaiselle aikataulumerkinnälle kellonaika HH:MM.",
      );
    }
    if (times.includes(item)) {
      return invalidSupplement(
        "schedule-duplicate",
        "Sama kellonaika voi olla aikataulussa vain kerran.",
      );
    }
    times.push(item);
  }
  return { ok: true, value: times.sort() };
}

/** Luo lisäravinteen käyttäjän toimittamalla määrällä, yksiköllä ja päiväaikataululla. */
export async function createSupplementService(
  deps: SupplementServiceDeps,
  input: CreateSupplementInput,
): Promise<DataResult<Supplement>> {
  const name = validateName(input.name);
  if (!name.ok) return name;
  const amount = validateAmount(input.amount);
  if (!amount.ok) return amount;
  const unit = validateUnit(input.unit);
  if (!unit.ok) return unit;
  const schedule = validateSchedule(input.schedule ?? []);
  if (!schedule.ok) return schedule;
  return deps.supplements.create({
    name: name.value,
    amount: amount.value,
    unit: unit.value,
    schedule: schedule.value,
    doseLabel: `${String(amount.value)} ${unit.value}`,
    deletedAt: null,
  });
}

/** Hakee lisäravinteen tunnisteella. */
export function getSupplementService(
  deps: SupplementServiceDeps,
  id: string,
): Promise<DataResult<Supplement>> {
  return deps.supplements.getById(id);
}

/** Listaa aktiiviset lisäravinteet nimijärjestyksessä. */
export async function listSupplementsService(
  deps: SupplementServiceDeps,
  options: ListSupplementsOptions = {},
): Promise<DataResult<readonly Supplement[]>> {
  if (options.query !== undefined && typeof options.query !== "string") {
    return invalidSupplement("query", "Hakutekstin on oltava tekstiä.");
  }
  if (options.query !== undefined && containsControlCharacters(options.query)) {
    return invalidSupplement("query", "Hakuteksti ei voi sisältää ohjausmerkkejä.");
  }
  if (options.includeDeleted !== undefined && typeof options.includeDeleted !== "boolean") {
    return invalidSupplement("include-deleted", "Poistettujen valinnan on oltava kyllä tai ei.");
  }
  const listed = await deps.supplements.list();
  if (!listed.ok) return listed;
  const query = options.query?.trim().toLocaleLowerCase("fi-FI") ?? "";
  const supplements = listed.value
    .filter((supplement) => options.includeDeleted === true || supplement.deletedAt === null)
    .filter(
      (supplement) =>
        query.length === 0 || supplement.name.toLocaleLowerCase("fi-FI").includes(query),
    )
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "fi-FI", { sensitivity: "base" }) ||
        left.id.localeCompare(right.id),
    );
  return { ok: true, value: supplements };
}

/** Päivittää lisäravinteen käyttäjän antamia tietoja. */
export async function updateSupplementService(
  deps: SupplementServiceDeps,
  id: string,
  patch: UpdateSupplementInput,
): Promise<DataResult<Supplement>> {
  const existing = await deps.supplements.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null) {
    return invalidSupplement("update-deleted", "Poistettua lisäravinnetta ei voi muokata.");
  }
  if (
    patch.name === undefined &&
    patch.amount === undefined &&
    patch.unit === undefined &&
    patch.schedule === undefined
  ) {
    return invalidSupplement("empty-update", "Muuta nimeä, määrää, yksikköä tai aikataulua.");
  }

  const name =
    patch.name === undefined
      ? { ok: true as const, value: existing.value.name }
      : validateName(patch.name);
  if (!name.ok) return name;
  const schedule = validateSchedule(patch.schedule ?? existing.value.schedule ?? []);
  if (!schedule.ok) return schedule;
  let doseChanges:
    | { readonly amount: number; readonly unit: string; readonly doseLabel: string }
    | Record<string, never> = {};
  if (patch.amount !== undefined || patch.unit !== undefined) {
    const amountValue = patch.amount ?? existing.value.amount;
    const unitValue = patch.unit ?? existing.value.unit;
    if (amountValue === undefined || unitValue === undefined) {
      return invalidSupplement(
        "legacy-dose",
        "Päivitä sekä määrä että yksikkö vanhalle annosmerkinnälle.",
      );
    }
    const amount = validateAmount(amountValue);
    if (!amount.ok) return amount;
    const unit = validateUnit(unitValue);
    if (!unit.ok) return unit;
    doseChanges = {
      amount: amount.value,
      unit: unit.value,
      doseLabel: `${String(amount.value)} ${unit.value}`,
    };
  }
  return deps.supplements.update(id, {
    name: name.value,
    schedule: schedule.value,
    ...doseChanges,
  });
}

/** Poistaa lisäravinteen pehmeästi, jolloin sen kirjaukset säilyvät. */
export async function deleteSupplementService(
  deps: SupplementServiceDeps,
  id: string,
): Promise<DataResult<Supplement>> {
  const existing = await deps.supplements.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt !== null) {
    return invalidSupplement("delete-transition", "Lisäravinne on jo poistettu.");
  }
  return deps.supplements.update(id, { deletedAt: deps.clock.nowIso() });
}

/** Palauttaa aiemmin pehmeästi poistetun lisäravinteen. */
export async function restoreSupplementService(
  deps: SupplementServiceDeps,
  id: string,
): Promise<DataResult<Supplement>> {
  const existing = await deps.supplements.getById(id);
  if (!existing.ok) return existing;
  if (existing.value.deletedAt === null) {
    return invalidSupplement("restore-transition", "Lisäravinne ei ole poistettu.");
  }
  return deps.supplements.update(id, { deletedAt: null });
}
