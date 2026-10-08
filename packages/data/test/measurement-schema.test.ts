// T068: Measurement-integriteettitesti (oikea wasm, sama M001-M028-ketju
// kuin worker ajaa). Todistaa:
// - useita mittaustyyppejä, omat yksiköt ja lisäkentät tallentuvat;
// - blood-pressure-secondary (diastolinen) tallentuu;
// - append-only: EI deleted_at-saraketta (ei soft-deleteä §36);
// - eheysehdot: tuntematon tyyppi, tyhjä unit, pitkä unit hylätään.
import { describe, expect, it } from "vitest";
import initModule from "@sqlite.org/sqlite-wasm";
import { MIGRATIONS } from "../src/index.ts";

type Row = Record<string, unknown>;

type Db = {
  exec: (sql: string, options?: { bind?: unknown; rowMode?: string; resultRows?: Row[] }) => void;
  close: () => void;
};

async function openMigrated(): Promise<Db> {
  const sqlite3 = await initModule();
  const db = new sqlite3.oo1.DB(":memory:", "ct") as unknown as Db;
  db.exec("PRAGMA foreign_keys=ON;");
  for (const step of MIGRATIONS) {
    for (const statement of step.statements) {
      db.exec(statement);
    }
  }
  return db;
}

const AT = "2026-01-01T00:00:00.000Z";

function insertMeasurement(db: Db, id: string, overrides: Record<string, unknown> = {}): void {
  const row: Record<string, unknown> = {
    id,
    type: "weight",
    value: 75.5,
    secondary_value: null,
    unit: "kg",
    metric_name: null,
    pulse_bpm: null,
    context: null,
    measured_at: "2026-01-02T07:30:00.000Z",
    note: null,
    created_at: AT,
    updated_at: AT,
    version: 1,
    ...overrides,
  };
  db.exec(
    `INSERT INTO measurements (
       id, type, value, secondary_value, unit, metric_name, pulse_bpm, context,
       measured_at, note, created_at, updated_at, version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    {
      bind: [
        row.id,
        row.type,
        row.value,
        row.secondary_value,
        row.unit,
        row.metric_name,
        row.pulse_bpm,
        row.context,
        row.measured_at,
        row.note,
        row.created_at,
        row.updated_at,
        row.version,
      ],
    },
  );
}

describe("measurements schema (T068)", () => {
  it("kaikki tyypit + secondary value + negatiivinen lämpötila tallentuvat", async () => {
    const db = await openMigrated();
    try {
      insertMeasurement(db, "m-1");
      insertMeasurement(db, "m-2", {
        type: "blood-pressure",
        value: 120,
        secondary_value: 80,
        unit: "mmHg",
        pulse_bpm: 64,
        context: "morning",
      });
      insertMeasurement(db, "m-3", {
        type: "temperature",
        value: -2.5,
        unit: "°C",
      });
      insertMeasurement(db, "m-4", {
        type: "custom",
        value: 12,
        unit: "kpl",
        metric_name: "Oma mittari",
        note: "Oma mittaus",
      });
      insertMeasurement(db, "m-5", {
        type: "body-measure",
        value: 84,
        unit: "cm",
        metric_name: "Vyötärö",
      });
      const rows: Row[] = [];
      db.exec(
        `SELECT type, value, secondary_value, unit, metric_name, pulse_bpm, context
         FROM measurements ORDER BY id;`,
        {
          rowMode: "object",
          resultRows: rows,
        },
      );
      expect(rows).toHaveLength(5);
      expect(rows[1]).toMatchObject({
        type: "blood-pressure",
        secondary_value: 80,
        pulse_bpm: 64,
        context: "morning",
      });
      expect(rows[2]).toMatchObject({ value: -2.5 });
      expect(rows[3]).toMatchObject({ metric_name: "Oma mittari" });
      expect(rows[4]).toMatchObject({ metric_name: "Vyötärö" });

      // Append-only: ei deleted_at-saraketta.
      const columns: Row[] = [];
      db.exec("PRAGMA table_info(measurements);", { rowMode: "object", resultRows: columns });
      const names = columns.map((row) => String(row.name));
      expect(names).not.toContain("deleted_at");
    } finally {
      db.close();
    }
  });

  it("eheysehdot: tuntematon tyyppi, tyhjä/pitkä unit hylätään", async () => {
    const db = await openMigrated();
    try {
      insertMeasurement(db, "m-ok");
      expect(() => {
        insertMeasurement(db, "m-bad-type", { type: "mood" });
      }).toThrow();
      expect(() => {
        insertMeasurement(db, "m-empty-unit", { unit: "  " });
      }).toThrow();
      expect(() => {
        insertMeasurement(db, "m-long-unit", { unit: "a".repeat(21) });
      }).toThrow();
      expect(() => {
        insertMeasurement(db, "m-long-name", { metric_name: "a".repeat(61) });
      }).toThrow();
      expect(() => {
        insertMeasurement(db, "m-bad-pulse", { pulse_bpm: 301 });
      }).toThrow();
      expect(() => {
        insertMeasurement(db, "m-bad-context", { context: "unknown" });
      }).toThrow();
      // Rajat OK: unit 20 merkkiä.
      insertMeasurement(db, "m-20", { unit: "a".repeat(20) });
    } finally {
      db.close();
    }
  });
});
