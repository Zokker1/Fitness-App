// T280: muistutussääntöjen validointi ja deterministinen arviointi.
import { describe, expect, it } from "vitest";
import { evaluateReminderRule, validateReminderRule } from "../src/index.ts";

const NOW = "2026-10-02T10:30:00.000Z";
const LOCAL_DATE = "2026-10-02"; // perjantai

describe("Reminder rule domain (T280)", () => {
  it("validoi ja normalisoi paikallisen viikkoaikataulun", () => {
    expect(
      validateReminderRule({
        kind: "recurring",
        schedule: { cadence: "weekly", localTime: "08:15", weekdays: [5, 1, 3] },
        subject: { kind: "task", id: "task-1" },
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: "recurring",
        schedule: { cadence: "weekly", localTime: "08:15", weekdays: [1, 3, 5] },
        subject: { kind: "task", id: "task-1" },
      },
    });
  });

  it("hylkää virheelliset aikaleimat, toistot ja tuntemattomat kentät", () => {
    expect(validateReminderRule({ kind: "time", at: "2026-02-30T08:00:00Z" }).ok).toBe(false);
    expect(
      validateReminderRule({
        kind: "recurring",
        schedule: { cadence: "weekly", localTime: "25:00", weekdays: [] },
      }).ok,
    ).toBe(false);
    expect(validateReminderRule({ kind: "deadline", dueAt: NOW, minutesBefore: -1 }).ok).toBe(
      false,
    );
    expect(validateReminderRule({ kind: "time", at: NOW, payload: "ignored?" }).ok).toBe(false);
  });

  it("kertamuistutus erääntyy vasta annetussa hetkessä ja saa vakaan occurrence-avaimen", () => {
    const input = {
      reminderId: "reminder-1",
      rule: { kind: "time", at: "2026-10-02T10:31:00Z" },
      enabled: true,
      deletedAt: null,
      now: NOW,
    } as const;
    expect(evaluateReminderRule(input)).toEqual({
      ok: true,
      value: { due: false, reason: "not-scheduled" },
    });
    expect(evaluateReminderRule({ ...input, now: "2026-10-02T10:31:00.000Z" })).toEqual({
      ok: true,
      value: {
        due: true,
        occurrenceKey: "reminder-1:time:2026-10-02T10:31:00.000Z",
        scheduledAt: "2026-10-02T10:31:00.000Z",
        localDate: null,
        localTime: null,
      },
    });
  });

  it("arvioi daily- ja weekly-toiston eksplisiittisestä paikallisesta ajasta", () => {
    const weekly = {
      cadence: "weekly",
      localTime: "13:00",
      weekdays: [1, 5],
    } as const;
    const input = {
      reminderId: "weekly-1",
      rule: { kind: "recurring", schedule: weekly },
      enabled: true,
      deletedAt: null,
      now: NOW,
      localDate: LOCAL_DATE,
      localTime: "13:00",
    } as const;
    expect(evaluateReminderRule(input)).toEqual({
      ok: true,
      value: {
        due: true,
        occurrenceKey: "weekly-1:recurring:2026-10-02:13:00",
        scheduledAt: null,
        localDate: LOCAL_DATE,
        localTime: "13:00",
      },
    });
    expect(evaluateReminderRule({ ...input, localDate: "2026-10-03" })).toEqual({
      ok: true,
      value: { due: false, reason: "not-scheduled" },
    });
    expect(evaluateReminderRule({ ...input, localTime: "13:01" })).toEqual({
      ok: true,
      value: { due: false, reason: "not-scheduled" },
    });
  });

  it("laskee deadlinen muistutuksen ennakkoajan UTC-hetkestä", () => {
    const input = {
      reminderId: "deadline-1",
      rule: { kind: "deadline", dueAt: "2026-10-02T11:00:00Z", minutesBefore: 15 },
      enabled: true,
      deletedAt: null,
      now: "2026-10-02T10:45:00Z",
    } as const;
    expect(evaluateReminderRule(input)).toEqual({
      ok: true,
      value: {
        due: true,
        occurrenceKey: "deadline-1:deadline:2026-10-02T11:00:00.000Z:15",
        scheduledAt: "2026-10-02T10:45:00.000Z",
        localDate: null,
        localTime: null,
      },
    });
    expect(evaluateReminderRule({ ...input, now: "2026-10-02T10:44:59.999Z" })).toMatchObject({
      ok: true,
      value: { due: false },
    });
  });

  it("ehtomuistutus laukeaa vain sovittuna aikana, jos vesi jää rajan alle", () => {
    const input = {
      reminderId: "water-1",
      rule: {
        kind: "conditional",
        schedule: { cadence: "daily", localTime: "13:00", weekdays: [] },
        condition: { kind: "hydration-below", targetMilliliters: 1_500 },
      },
      enabled: true,
      deletedAt: null,
      now: NOW,
      localDate: LOCAL_DATE,
      localTime: "13:00",
      hydrationMillilitersToday: 1_250,
    } as const;
    expect(evaluateReminderRule(input)).toMatchObject({
      ok: true,
      value: { due: true, occurrenceKey: "water-1:conditional:2026-10-02:13:00" },
    });
    expect(evaluateReminderRule({ ...input, hydrationMillilitersToday: 1_500 })).toEqual({
      ok: true,
      value: { due: false, reason: "condition-not-met" },
    });
    expect(evaluateReminderRule({ ...input, hydrationMillilitersToday: null })).toEqual({
      ok: true,
      value: { due: false, reason: "condition-unavailable" },
    });
  });

  it("ei arvioi pois käytöstä olevia tai poistettuja sääntöjä", () => {
    const input = {
      reminderId: "reminder-1",
      rule: { kind: "time", at: "2026-10-02T10:00:00Z" },
      enabled: false,
      deletedAt: null,
      now: NOW,
    } as const;
    expect(evaluateReminderRule(input)).toEqual({
      ok: true,
      value: { due: false, reason: "disabled" },
    });
    expect(
      evaluateReminderRule({ ...input, enabled: true, deletedAt: "2026-10-02T09:00:00Z" }),
    ).toEqual({ ok: true, value: { due: false, reason: "deleted" } });
  });
});
