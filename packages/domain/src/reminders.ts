// T026: muistutukset + ilmoitustila (§24, §33).
// - Reminder on käyttäjän dataa (milloin, mihin reittiin, millä ehdoilla).
// - NotificationState on laitteen paikallinen toimitustila (ei taustalupausta).
// - Kategoriat käyttäjän säädettävissä (§24: kategoriakohtainen säätö).
// - Ei PII:tä/terveysarvoja reitissä tai payload-viitteessä.

import type { BaseEntity, EntityId, SoftDeletable, UtcTimestamp } from "./base.ts";

export type ReminderKind = "time" | "recurring" | "deadline" | "conditional";

export type ReminderCadence = "daily" | "weekly";
export type ReminderSubjectKind = "task" | "routine" | "goal";

/** Päivään sidottu paikallisaikataulu. ISO-viikonpäivä: 1=ma … 7=su. */
export interface ReminderSchedule {
  readonly cadence: ReminderCadence;
  readonly localTime: string;
  /** Päivittäiselle tyhjä; viikoittaiselle yksi tai useampi päivä 1–7. */
  readonly weekdays: readonly number[];
}

export interface ReminderSubject {
  readonly kind: ReminderSubjectKind;
  readonly id: EntityId;
}

interface ReminderRuleBase {
  /** Valinnainen tehtävä-, rutiini- tai tavoiteviite. Ei henkilötietoa URL:ssa. */
  readonly subject?: ReminderSubject;
}

export interface TimeReminderRule extends ReminderRuleBase {
  readonly kind: "time";
  readonly at: UtcTimestamp;
}

export interface RecurringReminderRule extends ReminderRuleBase {
  readonly kind: "recurring";
  readonly schedule: ReminderSchedule;
}

export interface DeadlineReminderRule extends ReminderRuleBase {
  readonly kind: "deadline";
  readonly dueAt: UtcTimestamp;
  /** Yksi ilmoitus ennen deadlinea; 0 tarkoittaa deadline-hetkellä. */
  readonly minutesBefore: number;
}

export interface ConditionalReminderRule extends ReminderRuleBase {
  readonly kind: "conditional";
  readonly schedule: ReminderSchedule;
  readonly condition: {
    readonly kind: "hydration-below";
    readonly targetMilliliters: number;
  };
}

/** Sääntömääritykset pysyvät erillään ilmoituksen toimitus- ja tallennustilasta. */
export type ReminderRule =
  TimeReminderRule | RecurringReminderRule | DeadlineReminderRule | ConditionalReminderRule;

interface ReminderEvaluationBase {
  readonly reminderId: EntityId;
  readonly enabled: boolean;
  readonly deletedAt: UtcTimestamp | null;
  readonly now: UtcTimestamp;
}

export type ReminderRuleEvaluationInput =
  | (ReminderEvaluationBase & { readonly rule: TimeReminderRule })
  | (ReminderEvaluationBase & { readonly rule: DeadlineReminderRule })
  | (ReminderEvaluationBase & {
      readonly rule: RecurringReminderRule;
      readonly localDate: string;
      readonly localTime: string;
    })
  | (ReminderEvaluationBase & {
      readonly rule: ConditionalReminderRule;
      readonly localDate: string;
      readonly localTime: string;
      /** Paikallisen päivän tähänastinen nestemäärä; null jos dataa ei ole. */
      readonly hydrationMillilitersToday: number | null;
    });

export type ReminderRuleNotDueReason =
  "disabled" | "deleted" | "not-scheduled" | "condition-unavailable" | "condition-not-met";

export type ReminderRuleEvaluation =
  | { readonly due: false; readonly reason: ReminderRuleNotDueReason }
  | {
      readonly due: true;
      readonly occurrenceKey: string;
      /** UTC-sääntöjen hetki; paikallissäännöissä scheduler ratkaisee vyöhykkeen. */
      readonly scheduledAt: UtcTimestamp | null;
      readonly localDate: string | null;
      readonly localTime: string | null;
    };

export interface Reminder extends BaseEntity, SoftDeletable {
  readonly kind: ReminderKind;
  /** Turvallinen sisäinen reitti (ei PII:tä, vrt. T025 sanitizeRoute). */
  readonly route: string;
  readonly title: string;
  /** null sallii ennen M049:ää luotujen muistutusten turvallisen käsittelyn. */
  readonly rule: ReminderRule | null;
  readonly fireAt: UtcTimestamp | null;
  readonly snoozedUntil: UtcTimestamp | null;
  readonly categoryKey: string;
  readonly enabled: boolean;
}

export type NotificationDelivery = "pending" | "shown" | "dismissed" | "missed" | "snoozed";

export interface NotificationState extends BaseEntity {
  readonly reminderId: EntityId | null;
  readonly categoryKey: string;
  readonly delivery: NotificationDelivery;
  readonly lastEvaluatedAt: UtcTimestamp;
}
