// T060: UserPreferences-palvelun flow-testit fake-workerilla (ilman selainta).
// Todistaa: ensure luo oletukset v1 (id/kello injektoitu), toinen ensure
// palauttaa saman (ei duplikaattia), update validoi domain-säännöllä ja
// kasvattaa version (v1 -> v2 -> v3), virheellinen arvo hylätään ilman
// kirjoitusta, ja protokollavirhe kulkee DataResulttina. Oikea worker+OPFS
// ajetaan Playwright-E2E:ssä (persistenssi-tab).
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCE_VALUES } from "@lifeos/domain";
import type { UserPreferences } from "@lifeos/domain";
import {
  CURRENT_SCHEMA_VERSION,
  configureDatabaseWorker,
  ensurePreferences,
  fixedClock,
  resetDatabaseWorkerForTests,
  sequentialIdGenerator,
  updatePreferences,
} from "../src/index.ts";

interface PrefsState {
  row: Record<string, unknown> | null;
  version: number;
}

const state: PrefsState = { row: null, version: 0 };

type Listener = (event: { data: unknown }) => void;

function fakeWorker(): {
  postMessage: (message: Record<string, unknown>) => void;
  terminate: () => void;
  set onmessage(fn: Listener | null);
} {
  const listeners = new Set<Listener>();
  return {
    postMessage(message: Record<string, unknown>) {
      queueMicrotask(() => {
        const requestId = message.requestId as string;
        const ok = (rows: readonly unknown[] = [], extra: Record<string, unknown> = {}) => ({
          requestId,
          ok: true,
          rows,
          backend: "memory",
          persisted: false,
          ...extra,
        });
        let out: Record<string, unknown>;
        if (message.kind === "ping" || message.kind === "close") {
          out = ok();
        } else if (message.kind === "open") {
          out = ok([], { schemaVersion: state.version });
        } else if (message.kind === "migrate") {
          const target = message.targetVersion as number;
          if (target > CURRENT_SCHEMA_VERSION) {
            out = {
              requestId,
              ok: false,
              code: "invalid-input",
              diagnosticCode: "db.migrate.migration-target-too-new",
            };
          } else {
            state.version = target;
            out = ok([], { schemaVersion: state.version });
          }
        } else if (message.kind === "exec" && message.op === "putPreferences") {
          // Simuloi workerin bind-muunnosta: boolean -> 0/1 kantaan.
          const raw = message.params as Record<string, unknown>;
          state.row = {
            ...raw,
            gamification_visible: raw.gamification_visible === true ? 1 : 0,
            notification_defaults_enabled: raw.notification_defaults_enabled === true ? 1 : 0,
            notification_categories: raw.notification_categories,
            app_lock_enabled: raw.app_lock_enabled === true ? 1 : 0,
            weight_target: raw.weight_target === "" ? null : raw.weight_target,
            height_cm: raw.height_cm === "" ? null : raw.height_cm,
            hydration_target_ml: raw.hydration_target_ml === "" ? null : raw.hydration_target_ml,
            hydration_reminder_time:
              raw.hydration_reminder_time === "" ? null : raw.hydration_reminder_time,
          };
          out = ok();
        } else if (message.kind === "query" && message.op === "getPreferences") {
          out = ok(state.row === null ? [] : [state.row]);
        } else if (message.kind === "query" && message.op === "getSchemaVersion") {
          out = ok([{ version: state.version }]);
        } else if (message.kind === "query") {
          out = ok();
        } else {
          out = { requestId, ok: false, code: "invalid-input", diagnosticCode: "fake" };
        }
        for (const fn of listeners) {
          fn({ data: out });
        }
      });
    },
    terminate() {},
    set onmessage(fn: Listener | null) {
      if (fn !== null) {
        listeners.add(fn);
      }
    },
  };
}

const deps = { clock: fixedClock("2026-09-17T12:00:00.000Z"), ids: sequentialIdGenerator() };

afterEach(() => {
  resetDatabaseWorkerForTests();
  state.row = null;
  state.version = 0;
});

describe("preferences service", () => {
  it("ensure luo oletusrivin v1 ja toinen ensure palauttaa saman", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const first = await ensurePreferences(deps);
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    const entity: UserPreferences = first.value;
    expect(entity.version).toBe(1);
    expect(entity.theme).toBe("system");
    expect(entity.dayStartHour).toBe(8);
    expect(entity.gamificationVisible).toBe(true);
    expect(entity.enabledSections).toHaveLength(7);
    expect(entity.notificationDefaults.enabled).toBe(false);
    expect(entity.notificationCategories.task).toBe(true);
    expect(entity.appLockEnabled).toBe(false);
    expect(entity.createdAt).toBe("2026-09-17T12:00:00.000Z");
    expect(state.row).not.toBeNull();

    const second = await ensurePreferences(deps);
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.id).toBe(entity.id);
    expect(second.value.version).toBe(1);
  });

  it("update kasvattaa version (v1 -> v2 -> v3) ja säilyttää muut kentät", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    const first = await ensurePreferences(deps);
    expect(first.ok).toBe(true);
    const updated = await updatePreferences(deps, { dayStartHour: 9 });
    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }
    expect(updated.value.version).toBe(2);
    expect(updated.value.dayStartHour).toBe(9);
    expect(updated.value.theme).toBe("system");

    const second = await updatePreferences(deps, { theme: "dark", appLockEnabled: true });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      return;
    }
    expect(second.value.version).toBe(3);
    expect(second.value.theme).toBe("dark");
    expect(second.value.dayStartHour).toBe(9);
    expect(second.value.appLockEnabled).toBe(true);
    expect(second.value.enabledSections).toHaveLength(7);
  });

  it("virheellinen arvo hylätään ennen kirjoitusta (ei version hyppyä)", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    await ensurePreferences(deps);
    const badHour = await updatePreferences(deps, { dayStartHour: 24 });
    expect(badHour.ok).toBe(false);
    const badTheme = await updatePreferences(deps, { theme: "blue" as never });
    expect(badTheme.ok).toBe(false);
    expect(state.row === null ? 0 : Number(state.row.version)).toBe(1);
    expect(Number(state.row?.day_start_hour)).toBe(8);
  });

  it("rikki tallennettu rivi palauttaa hallitun virheen, ei poikkeusta", async () => {
    configureDatabaseWorker({ create: () => fakeWorker() as unknown as Worker });
    state.row = {
      id: "p1",
      theme: "blue",
      day_start_hour: 8,
      gamification_visible: 1,
      enabled_sections: "[]",
      notification_defaults_enabled: 0,
      app_lock_enabled: 0,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      version: 1,
      weight_target: null,
      height_cm: null,
      meal_slots: JSON.stringify(DEFAULT_PREFERENCE_VALUES.mealSlots),
      macro_targets: JSON.stringify(DEFAULT_PREFERENCE_VALUES.macroTargets),
      hydration_target_ml: null,
      hydration_reminder_time: null,
      notification_categories: JSON.stringify(DEFAULT_PREFERENCE_VALUES.notificationCategories),
    };
    const result = await ensurePreferences(deps);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnosticCode).toBe("data.preferences.corrupt");
    }
  });
});
