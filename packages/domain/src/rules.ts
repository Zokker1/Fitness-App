// T026: puhtaat domain-säännöt (ei IO:ta, ei Date.now:ta piilossa, ei
// selainta, ei Drivea). Säännöt ottavat eksplisiittiset syötteet ja
// palauttavat uuden tilan tai virheen — testattavia ilman alustaa.

import type { EntityId, UtcTimestamp } from "./base.ts";
import {
  DEFAULT_MEAL_SLOTS,
  DEFAULT_MACRO_TARGETS,
  HYDRATION_TARGET_ML_MAXIMUM,
  HEIGHT_CM_RANGE,
  MACRO_TARGET_MAXIMUMS,
  MEAL_SLOT_MAX_COUNT,
  MEAL_SLOT_NAME_MAX_LENGTH,
} from "./identity.ts";
import type {
  MacroTargets,
  MealSlotPreference,
  ThemePreference,
  WeightTarget,
} from "./identity.ts";
import {
  DEFAULT_NOTIFICATION_CATEGORY_SETTINGS,
  validateNotificationCategorySettings,
} from "./notifications.ts";
import type { NotificationCategorySettings } from "./notifications.ts";
import {
  BREATHING_PHASE_DURATION_MAX_SECONDS,
  BREATHING_PHASE_DURATION_MIN_SECONDS,
  BREATHING_PHASE_BREATH_MIN_SECONDS,
  BREATHING_PHASE_HOLD_MAX_SECONDS,
  BREATHING_PHASE_KINDS,
  BREATHING_PROTOCOL_KEY_MAX_LENGTH,
  BREATHING_PROTOCOL_MAX_PHASES,
  BREATHING_PROTOCOL_NAME_MAX_LENGTH,
  BREATHING_PROTOCOL_ROUNDS_MAX,
  BREATHING_PROTOCOL_ROUNDS_MIN,
  BREATHING_PROTOCOL_RISKS,
  BREATHING_PROTOCOL_TOTAL_DURATION_MAX_SECONDS,
  BREATHING_RISK_CONTEXTS,
  BREATHING_SAFETY_WARNING_MAX_LENGTH,
} from "./health.ts";
import type {
  BreathingPhaseKind,
  BreathingProtocol,
  BreathingProtocolRisk,
  BreathingRiskContext,
  MoodCheckinScales,
} from "./health.ts";
import {
  containsControlCharacters,
  getMeasurementUnitDefinition,
  normalizeMeasurementMetricName,
} from "./measurement-registry.ts";
import type { FocusSession } from "./productivity.ts";
import type { SyncOperation } from "./sync.ts";

// ---------------------------------------------------------------------------
// Yleinen tulos explicitly virheellisille domain-siirtymille.
// ---------------------------------------------------------------------------

export type DomainErrorCode = "invalid-transition" | "invalid-input" | "conflict-open";

export interface DomainError {
  readonly code: DomainErrorCode;
  readonly message: string;
}

export type DomainResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: DomainError };

export const MOOD_CHECKIN_SCALE_MINIMUM = 1;
export const MOOD_CHECKIN_SCALE_MAXIMUM = 5;

/** Validoi mieliala- ja itsearvioasteikot ilman tulkintaa tai diagnostiikkaa. */
export function validateMoodCheckinScales(
  values: MoodCheckinScales,
): DomainResult<MoodCheckinScales> {
  const labels: Readonly<Record<keyof MoodCheckinScales, string>> = {
    mood: "Mieliala",
    stress: "Stressi",
    energy: "Energia",
    motivation: "Motivaatio",
    focus: "Keskittyminen",
  };
  for (const key of Object.keys(labels) as (keyof MoodCheckinScales)[]) {
    const value = values[key];
    if (key !== "mood" && value === null) {
      continue;
    }
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < MOOD_CHECKIN_SCALE_MINIMUM ||
      value > MOOD_CHECKIN_SCALE_MAXIMUM
    ) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          message: `${labels[key]}-arvon tulee olla kokonaisluku väliltä 1–5.`,
        },
      };
    }
  }
  return { ok: true, value: { ...values } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMember<const T extends readonly string[]>(
  values: T,
  value: unknown,
): value is T[number] {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

function invalidBreathingProtocol(message: string): DomainResult<never> {
  return { ok: false, error: { code: "invalid-input", message } };
}

/**
 * Validoi protocol-määritelmän ja palauttaa siitä kopion, jotta ajastin saa
 * rajatut kestot ja riskiharjoitus ei voi kulkea ilman varoitusta.
 */
export function validateBreathingProtocol(input: unknown): DomainResult<BreathingProtocol> {
  if (!isRecord(input)) {
    return invalidBreathingProtocol("Hengitysprotokollan pitää olla olio.");
  }
  const key = input.key;
  const name = input.name;
  const rounds = input.rounds;
  if (
    typeof key !== "string" ||
    key.trim().length === 0 ||
    key.trim().length > BREATHING_PROTOCOL_KEY_MAX_LENGTH ||
    containsControlCharacters(key) ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.trim().length > BREATHING_PROTOCOL_NAME_MAX_LENGTH ||
    containsControlCharacters(name)
  ) {
    return invalidBreathingProtocol("Anna hengitysprotokollalle kelvollinen tunniste ja nimi.");
  }
  if (
    typeof rounds !== "number" ||
    !Number.isInteger(rounds) ||
    rounds < BREATHING_PROTOCOL_ROUNDS_MIN ||
    rounds > BREATHING_PROTOCOL_ROUNDS_MAX
  ) {
    return invalidBreathingProtocol(
      `Kierroksia voi olla ${String(BREATHING_PROTOCOL_ROUNDS_MIN)}–${String(BREATHING_PROTOCOL_ROUNDS_MAX)}.`,
    );
  }
  if (
    !Array.isArray(input.phases) ||
    input.phases.length === 0 ||
    input.phases.length > BREATHING_PROTOCOL_MAX_PHASES
  ) {
    return invalidBreathingProtocol(
      `Protokollassa pitää olla 1–${String(BREATHING_PROTOCOL_MAX_PHASES)} vaihetta.`,
    );
  }

  const phases: { readonly kind: BreathingPhaseKind; readonly durationSeconds: number }[] = [];
  let roundDurationSeconds = 0;
  for (const rawPhase of input.phases as unknown[]) {
    if (!isRecord(rawPhase) || !isMember(BREATHING_PHASE_KINDS, rawPhase.kind)) {
      return invalidBreathingProtocol("Hengitysvaiheen tyyppi ei kelpaa.");
    }
    const durationSeconds = rawPhase.durationSeconds;
    if (
      typeof durationSeconds !== "number" ||
      !Number.isInteger(durationSeconds) ||
      durationSeconds < BREATHING_PHASE_DURATION_MIN_SECONDS ||
      durationSeconds > BREATHING_PHASE_DURATION_MAX_SECONDS
    ) {
      return invalidBreathingProtocol(
        `Vaiheen keston pitää olla ${String(BREATHING_PHASE_DURATION_MIN_SECONDS)}–${String(BREATHING_PHASE_DURATION_MAX_SECONDS)} sekuntia.`,
      );
    }
    if (
      (rawPhase.kind === "inhale" || rawPhase.kind === "exhale") &&
      durationSeconds < BREATHING_PHASE_BREATH_MIN_SECONDS
    ) {
      return invalidBreathingProtocol(
        `Sisään- ja uloshengityksen pitää kestää vähintään ${String(BREATHING_PHASE_BREATH_MIN_SECONDS)} sekuntia.`,
      );
    }
    if (rawPhase.kind === "hold" && durationSeconds > BREATHING_PHASE_HOLD_MAX_SECONDS) {
      return invalidBreathingProtocol(
        `Hengityksenpidätys voi kestää enintään ${String(BREATHING_PHASE_HOLD_MAX_SECONDS)} sekuntia.`,
      );
    }
    roundDurationSeconds += durationSeconds;
    phases.push({ kind: rawPhase.kind, durationSeconds });
  }
  if (roundDurationSeconds * rounds > BREATHING_PROTOCOL_TOTAL_DURATION_MAX_SECONDS) {
    return invalidBreathingProtocol("Hengitysharjoituksen enimmäiskesto on 60 minuuttia.");
  }

  if (!isRecord(input.safety) || !Array.isArray(input.safety.risks)) {
    return invalidBreathingProtocol("Protokollan turvallisuustiedot eivät kelpaa.");
  }
  const risks: BreathingProtocolRisk[] = [];
  for (const risk of input.safety.risks as unknown[]) {
    if (!isMember(BREATHING_PROTOCOL_RISKS, risk) || risks.includes(risk)) {
      return invalidBreathingProtocol("Protokollan riskiluokitus ei kelpaa.");
    }
    risks.push(risk);
  }
  if (!Array.isArray(input.safety.avoidContexts)) {
    return invalidBreathingProtocol("Protokollan vältettävät tilanteet eivät kelpaa.");
  }
  const avoidContexts: BreathingRiskContext[] = [];
  for (const context of input.safety.avoidContexts as unknown[]) {
    if (!isMember(BREATHING_RISK_CONTEXTS, context) || avoidContexts.includes(context)) {
      return invalidBreathingProtocol("Protokollan vältettävät tilanteet eivät kelpaa.");
    }
    avoidContexts.push(context);
  }
  const warning = input.safety.warning;
  if (warning !== null && typeof warning !== "string") {
    return invalidBreathingProtocol("Turvallisuusvaroituksen pitää olla tekstiä tai null.");
  }
  const normalizedWarning = typeof warning === "string" ? warning.trim() : null;
  if (
    normalizedWarning !== null &&
    normalizedWarning.length > BREATHING_SAFETY_WARNING_MAX_LENGTH
  ) {
    return invalidBreathingProtocol("Turvallisuusvaroitus on liian pitkä.");
  }

  const includesHoldPhase = phases.some((phase) => phase.kind === "hold");
  const includesHoldRisk = risks.includes("breath-hold");
  const hasRisk = risks.length > 0;
  if (includesHoldPhase !== includesHoldRisk) {
    return invalidBreathingProtocol(
      "Hengityksenpidätys ja sen riskiluokitus pitää ilmoittaa yhdessä.",
    );
  }
  if (hasRisk && (normalizedWarning === null || normalizedWarning.length === 0)) {
    return invalidBreathingProtocol("Riskiprotokollassa pitää olla turvallisuusvaroitus.");
  }
  if (hasRisk && BREATHING_RISK_CONTEXTS.some((context) => !avoidContexts.includes(context))) {
    return invalidBreathingProtocol(
      "Riskiprotokollan pitää kieltää harjoittelu vedessä, ajaessa, seisten ja koneita käyttäessä.",
    );
  }

  return {
    ok: true,
    value: {
      key: key.trim(),
      name: name.trim(),
      phases,
      rounds,
      safety: { risks, warning: normalizedWarning, avoidContexts },
    },
  };
}

// ---------------------------------------------------------------------------
// Aika: vertailu ISO-UTC-merkkijonoilla (leksikaalinen = kronologinen).
// ---------------------------------------------------------------------------

export function isBefore(a: UtcTimestamp, b: UtcTimestamp): boolean {
  return a < b;
}

// ---------------------------------------------------------------------------
// Task: open <-> done. Reopen säilyttää historian (completedAt jää,
// reopenedAt merkitään; §5/B05 täyttää historianäkymän).
// ---------------------------------------------------------------------------

export function completeTask<T extends { status: string }>(
  task: T,
  at: UtcTimestamp,
): DomainResult<T & { completedAt: UtcTimestamp }> {
  if (task.status === "done") {
    return {
      ok: false,
      error: { code: "invalid-transition", message: "Tehtävä on jo valmis." },
    };
  }
  return {
    ok: true,
    value: { ...task, status: "done", completedAt: at },
  };
}

export function reopenTask<T extends { status: string }>(
  task: T,
  at: UtcTimestamp,
): DomainResult<T & { reopenedAt: UtcTimestamp }> {
  if (task.status !== "done") {
    return {
      ok: false,
      error: {
        code: "invalid-transition",
        message: "Vain valmis tehtävä voidaan avata uudelleen.",
      },
    };
  }
  return {
    ok: true,
    value: { ...task, status: "open", reopenedAt: at },
  };
}

// T100: pehmeä poisto — tombstone säilyttää historian (§8: mitään ei
// kovapoisteta, sync + tombstone-kulutus B15/B16:ssa). Idempotentti:
// jo poistettu tehtävä ei muuta aikaleimaa uudelleen.
export function deleteTask<T extends { status: string; deletedAt: UtcTimestamp | null }>(
  task: T,
  at: UtcTimestamp,
): DomainResult<T & { deletedAt: UtcTimestamp }> {
  if (task.deletedAt !== null) {
    return {
      ok: false,
      error: { code: "invalid-transition", message: "Tehtävä on jo poistettu." },
    };
  }
  return { ok: true, value: { ...task, deletedAt: at } };
}

export function restoreTask<T extends { status: string; deletedAt: UtcTimestamp | null }>(
  task: T,
): DomainResult<T & { deletedAt: null }> {
  if (task.deletedAt === null) {
    return {
      ok: false,
      error: { code: "invalid-transition", message: "Vain poistettu tehtävä voidaan palauttaa." },
    };
  }
  return { ok: true, value: { ...task, deletedAt: null } };
}

// ---------------------------------------------------------------------------
// Focus: planned -> running -> paused <-> running -> completed | cancelled.
// ---------------------------------------------------------------------------

const focusTransitions: Readonly<Record<FocusSession["phase"], readonly FocusSession["phase"][]>> =
  {
    planned: ["running", "cancelled"],
    running: ["paused", "completed", "cancelled"],
    paused: ["running", "completed", "cancelled"],
    completed: [],
    cancelled: [],
  };

export function transitionFocus(
  session: FocusSession,
  to: FocusSession["phase"],
): DomainResult<FocusSession> {
  const allowed: readonly FocusSession["phase"][] = focusTransitions[session.phase];
  if (!allowed.includes(to)) {
    return {
      ok: false,
      error: {
        code: "invalid-transition",
        message: `Fokusta ei voi siirtää tilasta ${session.phase} tilaan ${to}.`,
      },
    };
  }
  return { ok: true, value: { ...session, phase: to } };
}

// ---------------------------------------------------------------------------
// Sync: idempotenssi operationId:llä (§34 kohta 5–6). Puhdas apuri:
// nähtyjen ID:iden joukko suodattaa duplikaatit ennen soveltamista.
// ---------------------------------------------------------------------------

export function filterUnseenOperations(
  operations: readonly SyncOperation[],
  seenOperationIds: ReadonlySet<string>,
): readonly SyncOperation[] {
  const seen = new Set(seenOperationIds);
  return operations.filter((op) => {
    if (seen.has(op.operationId)) return false;
    seen.add(op.operationId);
    return true;
  });
}

export function isDuplicateOperation(
  operationId: string,
  seenOperationIds: ReadonlySet<string>,
): boolean {
  return seenOperationIds.has(operationId);
}

// ---------------------------------------------------------------------------
// Paikallinen päiväavain raportointiin ("YYYY-MM-DD"). Aikavyöhyke tulee
// kutsujalta (UI), domain ei lue selaimen asetuksia.
// ---------------------------------------------------------------------------

export function toLocalDateKey(utc: UtcTimestamp, timeZoneOffsetMinutes: number): string {
  const shifted = new Date(new Date(utc).getTime() + timeZoneOffsetMinutes * 60_000);
  const year = String(shifted.getUTCFullYear());
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Varmistaa ettei ulkopuolinen ID vuoda tyhjänä entiteetteihin. */
export function assertEntityId(id: EntityId): DomainResult<EntityId> {
  if (id.trim().length === 0) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tunniste ei saa olla tyhjä." },
    };
  }
  return { ok: true, value: id };
}

// ---------------------------------------------------------------------------
// UserPreferences (§33): asetusarvojen eheys. Theme on suljettu unioni,
// päivän raja kokonaisluku 0–23 (§25), painotavoitteella yksikkökohtainen
// laaja syöttöraja ja pituudella laaja syöttöraja. Syöte on löyhästi tyypitetty
// tallennusrajalla.
// ---------------------------------------------------------------------------

const PREFERENCE_THEMES: readonly string[] = ["light", "dark", "system"];

export interface UserPreferencesValues {
  readonly theme: ThemePreference;
  readonly dayStartHour: number;
  readonly weightTarget: WeightTarget | null;
  readonly heightCm: number | null;
  readonly mealSlots: readonly MealSlotPreference[];
  readonly macroTargets: MacroTargets;
  readonly hydrationTargetMl: number | null;
  readonly hydrationReminderTime: string | null;
  readonly notificationCategories: NotificationCategorySettings;
}

/** Validoi valinnaisen nestetavoitteen millilitroina. */
export function validateHydrationTargetMl(input: unknown): DomainResult<number | null> {
  if (input === null || input === undefined) {
    return { ok: true, value: null };
  }
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < 1 ||
    input > HYDRATION_TARGET_ML_MAXIMUM
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: `Nestetavoitteen on oltava kokonaisluku välillä 1–${String(HYDRATION_TARGET_ML_MAXIMUM)} ml.`,
      },
    };
  }
  return { ok: true, value: input };
}

/** Validoi paikallisen kellonajan, jolloin nestetavoitteen ehtoa tarkistetaan. */
export function validateHydrationReminderTime(input: unknown): DomainResult<string | null> {
  if (input === null || input === undefined || input === "") {
    return { ok: true, value: null };
  }
  if (typeof input !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input)) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Muistutuksen tarkistusajan on oltava kellonaika muodossa HH:MM.",
      },
    };
  }
  return { ok: true, value: input };
}

/** Validoi valinnaiset ravintotavoitteet ennen asetuksiin tallentamista. */
export function validateMacroTargets(input: unknown): DomainResult<MacroTargets> {
  if (input === null || input === undefined) {
    return { ok: true, value: { ...DEFAULT_MACRO_TARGETS } };
  }
  if (typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Ravintotavoitteet ovat virheelliset." },
    };
  }

  const record = input as Record<string, unknown>;
  const keys = Object.keys(MACRO_TARGET_MAXIMUMS);
  if (Object.keys(record).some((key) => !keys.includes(key))) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Ravintotavoitteissa on tuntematon arvo." },
    };
  }

  const values: Record<string, number | null> = {};
  for (const key of keys) {
    const value = record[key];
    if (value === null || value === undefined) {
      values[key] = null;
      continue;
    }
    const maximum = MACRO_TARGET_MAXIMUMS[key as keyof typeof MACRO_TARGET_MAXIMUMS];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          message: `Ravintotavoitteen on oltava 0–${String(maximum)} tai tyhjä.`,
        },
      };
    }
    values[key] = value;
  }
  return {
    ok: true,
    value: {
      caloriesKcal: values.caloriesKcal ?? null,
      proteinG: values.proteinG ?? null,
      carbsG: values.carbsG ?? null,
      fatG: values.fatG ?? null,
      fiberG: values.fiberG ?? null,
    },
  };
}

/** Validoi ja normalisoi asetuksiin tallennettavat aterialuokat. */
export function validateMealSlots(input: unknown): DomainResult<readonly MealSlotPreference[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > MEAL_SLOT_MAX_COUNT) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: `Aterialuokkia voi olla 1–${String(MEAL_SLOT_MAX_COUNT)}.`,
      },
    };
  }
  const ids = new Set<string>();
  const labels = new Set<string>();
  const orders = new Set<number>();
  const slots: MealSlotPreference[] = [];
  for (const value of input) {
    if (typeof value !== "object" || value === null) {
      return {
        ok: false,
        error: { code: "invalid-input", message: "Aterialuokka on virheellinen." },
      };
    }
    const record = value as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      record.id.trim() !== record.id ||
      record.id.length === 0 ||
      record.id.length > 100 ||
      containsControlCharacters(record.id) ||
      ids.has(record.id)
    ) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          message: "Aterialuokalla on oltava yksilöllinen tunniste.",
        },
      };
    }
    if (typeof record.label !== "string" || containsControlCharacters(record.label)) {
      return { ok: false, error: { code: "invalid-input", message: "Anna aterialuokalle nimi." } };
    }
    const label = normalizeMeasurementMetricName(record.label);
    const labelKey = label.toLowerCase();
    if (label.length === 0 || label.length > MEAL_SLOT_NAME_MAX_LENGTH || labels.has(labelKey)) {
      return {
        ok: false,
        error: {
          code: "invalid-input",
          message: `Nimen on oltava yksilöllinen ja 1–${String(MEAL_SLOT_NAME_MAX_LENGTH)} merkkiä pitkä.`,
        },
      };
    }
    if (
      typeof record.sortOrder !== "number" ||
      !Number.isInteger(record.sortOrder) ||
      record.sortOrder < 0 ||
      record.sortOrder >= input.length ||
      orders.has(record.sortOrder)
    ) {
      return {
        ok: false,
        error: { code: "invalid-input", message: "Aterialuokkien järjestys on virheellinen." },
      };
    }
    if (typeof record.archived !== "boolean") {
      return {
        ok: false,
        error: { code: "invalid-input", message: "Aterialuokan näkyvyysasetus on virheellinen." },
      };
    }
    ids.add(record.id);
    labels.add(labelKey);
    orders.add(record.sortOrder);
    slots.push({ id: record.id, label, sortOrder: record.sortOrder, archived: record.archived });
  }
  if (slots.every(({ archived }) => archived)) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Vähintään yhden aterialuokan pitää olla näkyvissä.",
      },
    };
  }
  return { ok: true, value: slots.sort((left, right) => left.sortOrder - right.sortOrder) };
}

export function validateHeightCm(input: unknown): DomainResult<number | null> {
  if (input === null || input === undefined) {
    return { ok: true, value: null };
  }
  if (
    typeof input !== "number" ||
    !Number.isFinite(input) ||
    input < HEIGHT_CM_RANGE.minimum ||
    input > HEIGHT_CM_RANGE.maximum
  ) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: `Pituuden on oltava ${String(HEIGHT_CM_RANGE.minimum)}–${String(HEIGHT_CM_RANGE.maximum)} cm.`,
      },
    };
  }
  return { ok: true, value: input };
}

export function validateWeightTarget(input: unknown): DomainResult<WeightTarget | null> {
  if (input === null || input === undefined) {
    return { ok: true, value: null };
  }
  if (typeof input !== "object" || !("value" in input) || !("unit" in input)) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavoitepaino on virheellinen." },
    };
  }
  const value = input.value;
  const unit = input.unit;
  if (typeof value !== "number" || !Number.isFinite(value) || (unit !== "kg" && unit !== "lb")) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavoitepaino on virheellinen." },
    };
  }
  const unitDefinition = getMeasurementUnitDefinition("weight", unit);
  if (unitDefinition === null) {
    return {
      ok: false,
      error: { code: "invalid-input", message: "Tavoitepainossa on oltava tuettu yksikkö." },
    };
  }
  if (value < unitDefinition.minimum || value > unitDefinition.maximum) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: `Tavoitepainon on oltava ${String(unitDefinition.minimum)}–${String(unitDefinition.maximum)} ${unit}.`,
      },
    };
  }
  return { ok: true, value: { value, unit } };
}

export function validateUserPreferencesValues(input: {
  readonly theme: string;
  readonly dayStartHour: number;
  readonly weightTarget?: unknown;
  readonly heightCm?: unknown;
  readonly mealSlots?: unknown;
  readonly macroTargets?: unknown;
  readonly hydrationTargetMl?: unknown;
  readonly hydrationReminderTime?: unknown;
  readonly notificationCategories?: unknown;
}): DomainResult<UserPreferencesValues> {
  if (!PREFERENCE_THEMES.includes(input.theme)) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Teema on tuntematon (sallitut: light, dark, system).",
      },
    };
  }
  const hour = input.dayStartHour;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return {
      ok: false,
      error: {
        code: "invalid-input",
        message: "Päivän raja on kokonaisluku 0–23.",
      },
    };
  }
  const weightTarget = validateWeightTarget(input.weightTarget);
  if (!weightTarget.ok) {
    return weightTarget;
  }
  const heightCm = validateHeightCm(input.heightCm);
  if (!heightCm.ok) {
    return heightCm;
  }
  const mealSlots = validateMealSlots(
    input.mealSlots === undefined ? DEFAULT_MEAL_SLOTS : input.mealSlots,
  );
  if (!mealSlots.ok) {
    return mealSlots;
  }
  const macroTargets = validateMacroTargets(input.macroTargets);
  if (!macroTargets.ok) {
    return macroTargets;
  }
  const hydrationTargetMl = validateHydrationTargetMl(input.hydrationTargetMl);
  if (!hydrationTargetMl.ok) {
    return hydrationTargetMl;
  }
  const hydrationReminderTime = validateHydrationReminderTime(input.hydrationReminderTime);
  if (!hydrationReminderTime.ok) {
    return hydrationReminderTime;
  }
  const notificationCategories = validateNotificationCategorySettings(
    input.notificationCategories === undefined
      ? DEFAULT_NOTIFICATION_CATEGORY_SETTINGS
      : input.notificationCategories,
  );
  if (!notificationCategories.ok) {
    return {
      ok: false,
      error: { code: "invalid-input", message: notificationCategories.message },
    };
  }
  return {
    ok: true,
    value: {
      theme: input.theme as ThemePreference,
      dayStartHour: hour,
      weightTarget: weightTarget.value,
      heightCm: heightCm.value,
      mealSlots: mealSlots.value,
      macroTargets: macroTargets.value,
      hydrationTargetMl: hydrationTargetMl.value,
      hydrationReminderTime: hydrationReminderTime.value,
      notificationCategories: notificationCategories.value,
    },
  };
}

// ---------------------------------------------------------------------------
// BrowserInstallation (§39): asennuksen elinkaari. Revokaatio on
// eksplisiittinen tila — revoked-instanssi ei enää tee aktiivisia kirjoituksia
// (uudelleenvaltuutus on erillinen operaatio, B15). Touch (lastSeen) ei ole
// aktiivinen kirjoitus: se on passiivinen metadatamerkintä.
// ---------------------------------------------------------------------------

export function assertInstallationActive<T extends { readonly revokedAt: UtcTimestamp | null }>(
  installation: T,
): DomainResult<T> {
  if (installation.revokedAt !== null) {
    return {
      ok: false,
      error: {
        code: "invalid-transition",
        message: "Asennus on passivoitu. Uudelleenvaltuutus vaaditaan.",
      },
    };
  }
  return { ok: true, value: installation };
}

export function touchInstallation<T extends { readonly revokedAt: UtcTimestamp | null }>(
  installation: T,
  at: UtcTimestamp,
  appVersion: string,
): DomainResult<T & { lastSeenAppVersion: string }> {
  const active = assertInstallationActive(installation);
  if (!active.ok) {
    return active;
  }
  return { ok: true, value: { ...installation, lastSeenAppVersion: appVersion, updatedAt: at } };
}

export function revokeInstallation<T extends { readonly revokedAt: UtcTimestamp | null }>(
  installation: T,
  at: UtcTimestamp,
): DomainResult<T & { revokedAt: UtcTimestamp }> {
  const active = assertInstallationActive(installation);
  if (!active.ok) {
    return active;
  }
  return { ok: true, value: { ...installation, revokedAt: at, updatedAt: at } };
}
