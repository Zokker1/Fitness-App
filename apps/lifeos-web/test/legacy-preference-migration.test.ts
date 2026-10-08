import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DataApi from "@lifeos/data";

const { ensurePreferences, updatePreferences } = vi.hoisted(() => ({
  ensurePreferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

vi.mock("@lifeos/data", async (importOriginal) => {
  const actual = await importOriginal<typeof DataApi>();
  return { ...actual, ensurePreferences, updatePreferences };
});

import { migrateLegacyLocalPreferences } from "../src/security/legacyPreferenceMigration.ts";

describe("legacy local preference migration", () => {
  beforeEach(() => {
    window.localStorage.clear();
    ensurePreferences.mockReset();
    ensurePreferences.mockResolvedValue({ ok: true, value: { appLockEnabled: false } });
    updatePreferences.mockReset();
    updatePreferences.mockResolvedValue({ ok: true, value: {} });
  });

  it("moves validated health and nutrition settings before removing plaintext snapshots", async () => {
    window.localStorage.setItem("lifeos-weight-target", JSON.stringify({ value: 64, unit: "kg" }));
    window.localStorage.setItem("lifeos-height-cm", "171");
    window.localStorage.setItem("lifeos-hydration-target-ml", "2200");
    window.localStorage.setItem("lifeos-hydration-reminder-time", "09:15");
    window.localStorage.setItem(
      "lifeos-macro-targets",
      JSON.stringify({
        caloriesKcal: 1900,
        proteinG: 90,
        carbsG: 210,
        fatG: 60,
        fiberG: 30,
      }),
    );
    window.localStorage.setItem(
      "lifeos-meal-slots",
      JSON.stringify([{ id: "breakfast", label: "Breakfast", sortOrder: 0, archived: false }]),
    );
    window.localStorage.setItem("lifeos-gamification-visible", "false");
    window.localStorage.setItem("lifeos-app-lock-enabled", "true");

    await migrateLegacyLocalPreferences();

    expect(updatePreferences).toHaveBeenCalledOnce();
    expect(updatePreferences.mock.calls[0]?.[1]).toMatchObject({
      weightTarget: { value: 64, unit: "kg" },
      heightCm: 171,
      hydrationTargetMl: 2200,
      hydrationReminderTime: "09:15",
      macroTargets: { caloriesKcal: 1900, proteinG: 90, carbsG: 210, fatG: 60, fiberG: 30 },
      mealSlots: [{ id: "breakfast", label: "Breakfast", sortOrder: 0, archived: false }],
      gamificationVisible: false,
      appLockEnabled: true,
    });
    expect(window.localStorage.length).toBe(0);
  });

  it("removes invalid legacy snapshots without copying invalid values", async () => {
    window.localStorage.setItem("lifeos-height-cm", "not-a-number");
    window.localStorage.setItem("lifeos-macro-targets", "not-json");

    await migrateLegacyLocalPreferences();

    expect(updatePreferences).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });

  it("does not rewrite an unchanged app-lock fallback on every unlock", async () => {
    window.localStorage.setItem("lifeos-app-lock-enabled", "false");

    await migrateLegacyLocalPreferences();

    expect(ensurePreferences).toHaveBeenCalledOnce();
    expect(updatePreferences).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
  });
});
