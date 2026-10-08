// T282: vakioidut muistutuskategoriat ja niiden paikalliset asetukset.
export const NOTIFICATION_CATEGORY_KEYS = [
  "task",
  "routine",
  "focus",
  "health",
  "supplement",
  "system",
] as const;

export type NotificationCategoryKey = (typeof NOTIFICATION_CATEGORY_KEYS)[number];
export type NotificationCategorySettings = Readonly<Record<NotificationCategoryKey, boolean>>;

export interface NotificationCopy {
  readonly categoryKey: string;
  readonly title: string;
  readonly body: string;
}

/** Redaktoi lukitusnäytöltä arkaluonteiset ja tuntemattomat kategoriat. */
export function redactNotificationCopy(
  copy: NotificationCopy,
): Pick<NotificationCopy, "title" | "body"> {
  const categoryKey = resolveNotificationCategoryKey(copy.categoryKey);
  if (categoryKey === null || categoryKey === "health" || categoryKey === "supplement") {
    return { title: "LifeOS", body: "" };
  }
  return { title: copy.title, body: copy.body };
}

export const DEFAULT_NOTIFICATION_CATEGORY_SETTINGS: NotificationCategorySettings = {
  task: true,
  routine: true,
  focus: true,
  health: true,
  supplement: true,
  system: true,
};

export type NotificationCategoryValidation =
  | { readonly ok: true; readonly value: NotificationCategorySettings }
  | { readonly ok: false; readonly message: string };

export function validateNotificationCategorySettings(
  input: unknown,
): NotificationCategoryValidation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, message: "Ilmoituskategorioiden asetusten pitää olla olio." };
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (
    keys.length !== NOTIFICATION_CATEGORY_KEYS.length ||
    keys.some((key) => !NOTIFICATION_CATEGORY_KEYS.includes(key as NotificationCategoryKey)) ||
    NOTIFICATION_CATEGORY_KEYS.some((key) => typeof record[key] !== "boolean")
  ) {
    return { ok: false, message: "Ilmoituskategorioiden asetukset eivät kelpaa." };
  }
  return {
    ok: true,
    value: {
      task: record.task as boolean,
      routine: record.routine as boolean,
      focus: record.focus as boolean,
      health: record.health as boolean,
      supplement: record.supplement as boolean,
      system: record.system as boolean,
    },
  };
}

/** Tuntematon luokka ei peri hiljaisesti ilmoituslupaa; `tasks` on vanha alias. */
export function resolveNotificationCategoryKey(value: string): NotificationCategoryKey | null {
  if (value === "tasks") return "task";
  return NOTIFICATION_CATEGORY_KEYS.includes(value as NotificationCategoryKey)
    ? (value as NotificationCategoryKey)
    : null;
}
