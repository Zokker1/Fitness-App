// T278: health CSV export -> fresh local database -> import roundtrip.
import { describe, expect, it } from "vitest";
import type {
  ActivityEntry,
  BaseEntity,
  BreathingSession,
  HydrationEntry,
  Measurement,
  MoodCheckin,
  NutritionEntry,
  SleepEntry,
  Supplement,
  SupplementLog,
  XPTransaction,
} from "@lifeos/domain";
import {
  commitHealthCsvImport,
  createEntityRepository,
  createHealthCsvExport,
  fixedClock,
  HEALTH_CSV_EXPORT_DEFINITIONS,
  InMemoryStore,
  parseHealthCsv,
  previewHealthCsvImport,
  sequentialIdGenerator,
  suggestHealthCsvColumnMapping,
  suggestHealthCsvImportKind,
  type HealthCsvExportInput,
  type HealthCsvImportRepositories,
} from "../src/index.ts";

const AT = "2026-09-18T12:00:00.000Z";
const META = { createdAt: AT, updatedAt: AT, version: 1 } as const;
const supplement: Supplement = {
  ...META,
  id: "supplement-roundtrip",
  name: "D-vitamiini",
  deletedAt: null,
  doseLabel: "1 kapseli",
};

function fixture<T extends BaseEntity>(
  id: string,
  value: Omit<T, "id" | "createdAt" | "updatedAt" | "version">,
): T {
  return { ...META, id, ...value } as T;
}

const source: HealthCsvExportInput = {
  measurements: [
    fixture<Measurement>("weight-source", {
      type: "weight",
      value: 72.4,
      secondaryValue: null,
      unit: "kg",
      measuredAt: AT,
      note: "Aamulla",
    }),
    fixture<Measurement>("pressure-source", {
      type: "blood-pressure",
      value: 120,
      secondaryValue: 80,
      unit: "mmHg",
      measuredAt: "2026-09-18T13:00:00.000Z",
      pulseBpm: 64,
      context: "resting",
      note: null,
    }),
    fixture<Measurement>("body-measure-source", {
      type: "body-measure",
      metricName: "Vyötärö",
      value: 82,
      secondaryValue: null,
      unit: "cm",
      measuredAt: "2026-09-18T14:00:00.000Z",
      note: null,
    }),
  ],
  hydrationEntries: [
    fixture<HydrationEntry>("hydration-source", { drunkAt: AT, milliliters: 250 }),
  ],
  nutritionEntries: [
    fixture<NutritionEntry>("nutrition-source", {
      eatenAt: AT,
      mealSlotId: "lunch",
      foodId: "food-oats",
      label: "Kaurapuuro",
      amountG: 180,
      calories: 220,
      proteinG: 8,
      carbsG: 36,
      fatG: 5,
      fiberG: 6,
      deletedAt: null,
    }),
  ],
  sleepEntries: [
    fixture<SleepEntry>("sleep-source", {
      sleepStart: "2026-09-17T22:30:00.000Z",
      sleepEnd: AT,
      quality: 4,
      isNap: false,
      deletedAt: null,
    }),
  ],
  activityEntries: [
    fixture<ActivityEntry>("activity-source", {
      activityAt: AT,
      kind: "walking",
      durationSeconds: 1800,
      distanceMeters: 1200,
      note: "Puistokierros",
      deletedAt: null,
    }),
  ],
  moodCheckins: [
    fixture<MoodCheckin>("mood-source", {
      checkedAt: AT,
      mood: 4,
      stress: 2,
      energy: 4,
      motivation: 3,
      focus: 4,
      note: "Hyvä päivä",
    }),
  ],
  supplements: [supplement],
  supplementLogs: [
    fixture<SupplementLog>("supplement-log-source", {
      supplementId: supplement.id,
      status: "taken",
      scheduledAt: null,
      takenAt: AT,
      doseAmount: 1,
      doseUnit: "kapseli",
    }),
  ],
  breathingSessions: [
    fixture<BreathingSession>("breathing-source", {
      startedAt: AT,
      endedAt: "2026-09-18T12:05:00.000Z",
      patternKey: "box-breathing",
    }),
  ],
};

function createTargetDatabase() {
  const clock = fixedClock(AT);
  function repository<T extends BaseEntity>(entityType: string) {
    const store = new InMemoryStore<T>(entityType);
    const repo = createEntityRepository(store, {
      clock,
      ids: sequentialIdGenerator(`target-${entityType}`),
    });
    return { store, repo };
  }

  const measurements = repository<Measurement>("measurement");
  const hydrationEntries = repository<HydrationEntry>("hydration-entry");
  const nutritionEntries = repository<NutritionEntry>("nutrition-entry");
  const sleepEntries = repository<SleepEntry>("sleep-entry");
  const activityEntries = repository<ActivityEntry>("activity-entry");
  const moodCheckins = repository<MoodCheckin>("mood-checkin");
  const supplementLogs = repository<SupplementLog>("supplement-log");
  const breathingSessions = repository<BreathingSession>("breathing-session");

  const repositories: HealthCsvImportRepositories = {
    measurements: measurements.repo,
    hydrationEntries: hydrationEntries.repo,
    nutritionEntries: nutritionEntries.repo,
    sleepEntries: sleepEntries.repo,
    activityEntries: activityEntries.repo,
    moodCheckins: moodCheckins.repo,
    supplementLogs: supplementLogs.repo,
    breathingSessions: breathingSessions.repo,
  };
  const xpTransactions = new InMemoryStore<XPTransaction>("xp-transaction", [
    fixture<XPTransaction>("existing-xp", {
      source: "manual",
      sourceEntityId: null,
      amount: 25,
      earnedAt: AT,
      reason: "Ennen tuontia kirjattu XP",
    }),
  ]);

  return {
    repositories,
    stores: {
      measurements: measurements.store,
      hydrationEntries: hydrationEntries.store,
      nutritionEntries: nutritionEntries.store,
      sleepEntries: sleepEntries.store,
      activityEntries: activityEntries.store,
      moodCheckins: moodCheckins.store,
      supplementLogs: supplementLogs.store,
      breathingSessions: breathingSessions.store,
      xpTransactions,
    },
  };
}

function rowsWithoutExportIds(content: string): readonly (readonly string[])[] {
  const parsed = parseHealthCsv(content);
  expect(parsed.fatalError).toBeNull();
  return parsed.rows.map((row) => row.values.slice(1));
}

describe("health CSV export/import roundtrip (T278)", () => {
  it("säilyttää tuetut terveyshistoriat uudessa kannassa eikä muuta XP-ledgeriä", async () => {
    const target = createTargetDatabase();
    const xpBefore = await target.stores.xpTransactions.list();
    expect(xpBefore.ok).toBe(true);

    for (const definition of HEALTH_CSV_EXPORT_DEFINITIONS) {
      const file = createHealthCsvExport(definition.kind, source);
      const table = parseHealthCsv(file.content);
      expect(table.fatalError, definition.kind).toBeNull();
      expect(suggestHealthCsvImportKind(table.headers), definition.kind).toBe(definition.kind);

      const mapping = suggestHealthCsvColumnMapping(table.headers, definition.kind);
      const preview = previewHealthCsvImport(table, definition.kind, mapping, {
        knownSupplementIds: [supplement.id],
        existingRecords: [],
      });
      expect(preview.mappingErrors, definition.kind).toEqual([]);
      expect(preview.invalidCount, definition.kind).toBe(0);
      expect(preview.duplicateCount, definition.kind).toBe(0);
      expect(preview.validCount, definition.kind).toBe(file.rowCount);

      const committed = await commitHealthCsvImport(target.repositories, preview.rows);
      expect(committed.failedRows, definition.kind).toEqual([]);
      expect(committed.duplicateRows, definition.kind).toEqual([]);
      expect(committed.importedCount, definition.kind).toBe(file.rowCount);
    }

    const readStore = async <T extends { readonly id: string }>(store: InMemoryStore<T>) => {
      const result = await store.list();
      if (!result.ok) throw new Error(`Could not read ${store.entityType}`);
      return result.value;
    };
    const roundtripped: HealthCsvExportInput = {
      measurements: await readStore(target.stores.measurements),
      hydrationEntries: await readStore(target.stores.hydrationEntries),
      nutritionEntries: await readStore(target.stores.nutritionEntries),
      sleepEntries: await readStore(target.stores.sleepEntries),
      activityEntries: await readStore(target.stores.activityEntries),
      moodCheckins: await readStore(target.stores.moodCheckins),
      supplements: [supplement],
      supplementLogs: await readStore(target.stores.supplementLogs),
      breathingSessions: await readStore(target.stores.breathingSessions),
    };

    for (const definition of HEALTH_CSV_EXPORT_DEFINITIONS) {
      const original = createHealthCsvExport(definition.kind, source);
      const restored = createHealthCsvExport(definition.kind, roundtripped);
      expect(restored.rowCount, definition.kind).toBe(original.rowCount);
      expect(rowsWithoutExportIds(restored.content), definition.kind).toEqual(
        rowsWithoutExportIds(original.content),
      );
    }

    const xpAfter = await target.stores.xpTransactions.list();
    expect(xpAfter).toEqual(xpBefore);
  });
});
