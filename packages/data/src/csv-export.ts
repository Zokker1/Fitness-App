/**
 * T273: yhteinen, deterministinen CSV-sarjoitin.
 * Otsakkeet ovat skeeman ASCII-avaimia, eivät käyttöliittymän käännöksiä.
 */

export type CsvCellValue = string | number | boolean | null | undefined;

export interface CsvColumn<Row> {
  /** Pysyvä ASCII-otsake, jota ei lokalisoida. */
  readonly key: string;
  readonly value: (row: Row) => CsvCellValue;
}

export interface CsvSchema<Row> {
  /** Vakaasti dokumentoitu tunniste, esimerkiksi `goal-routine-history`. */
  readonly id: string;
  /** Kasvatetaan aina, kun skeeman sarakkeita tai niiden merkityksiä muutetaan. */
  readonly version: number;
  readonly columns: readonly CsvColumn<Row>[];
}

const SCHEMA_ID_PATTERN = /^[a-z][a-z0-9-]*$/u;
const COLUMN_KEY_PATTERN = /^[a-z][A-Za-z0-9_]*$/u;
const SPREADSHEET_FORMULA_PREFIXES = ["=", "+", "-", "@"] as const;

function validateSchema<Row>(schema: CsvSchema<Row>): void {
  if (!SCHEMA_ID_PATTERN.test(schema.id)) {
    throw new TypeError(`Invalid CSV schema id: ${schema.id}`);
  }
  if (!Number.isInteger(schema.version) || schema.version < 1) {
    throw new TypeError(`Invalid CSV schema version for ${schema.id}`);
  }
  if (schema.columns.length === 0) {
    throw new TypeError(`CSV schema ${schema.id} must contain at least one column`);
  }

  const keys = new Set<string>();
  for (const column of schema.columns) {
    if (!COLUMN_KEY_PATTERN.test(column.key)) {
      throw new TypeError(`Invalid CSV column key in ${schema.id}: ${column.key}`);
    }
    if (keys.has(column.key)) {
      throw new TypeError(`Duplicate CSV column key in ${schema.id}: ${column.key}`);
    }
    keys.add(column.key);
  }
}

function serializeCell(value: CsvCellValue): string {
  let text = value === null || value === undefined ? "" : String(value);
  // Spreadsheet programs may interpret a quoted cell as a formula too.
  // Prefix formula-like user text with an apostrophe so imported content
  // cannot become an executable formula when someone opens the export.
  if (
    typeof value === "string" &&
    SPREADSHEET_FORMULA_PREFIXES.some((prefix) => value.trimStart().startsWith(prefix))
  ) {
    text = `'${text}`;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

/**
 * Serializes rows with stable ASCII headers, invariant scalar formatting,
 * quoted cells, and LF record separators. The returned string is Unicode;
 * browser downloads must encode it as UTF-8 and use a
 * `text/csv;charset=utf-8` media type.
 */
export function serializeCsv<Row>(records: readonly Row[], schema: CsvSchema<Row>): string {
  validateSchema(schema);

  const header = schema.columns.map(({ key }) => serializeCell(key)).join(",");
  const rows = records.map((record) =>
    schema.columns.map(({ value }) => serializeCell(value(record))).join(","),
  );
  return [header, ...rows].join("\n");
}
