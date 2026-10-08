import { t, tTemplate } from "../../language.tsx";
import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Select } from "@lifeos/ui";
import {
  commitHealthCsvImport,
  HEALTH_CSV_IMPORT_FIELDS,
  HEALTH_CSV_IMPORT_LABELS,
  isActiveSupplement,
  listHealthCsvImportExistingRecords,
  parseHealthCsv,
  previewHealthCsvImport,
  suggestHealthCsvColumnMapping,
  suggestHealthCsvImportKind,
  type HealthCsvImportExistingRecord,
  type HealthCsvImportKind,
  type HealthCsvImportRow,
  type ParsedCsvTable,
} from "@lifeos/data";
import { useData } from "../../dataContext.tsx";
import "./health-csv-import.css";

const HEALTH_IMPORT_KINDS = Object.keys(HEALTH_CSV_IMPORT_FIELDS) as HealthCsvImportKind[];
const FILE_SIZE_LIMIT = 12_000_000;
const PREVIEW_LIMIT = 8;
const ERROR_ROW_LIMIT = 25;

function translateImportError(error: string): string {
  const unmatchedQuote = /^CSV-lainausmerkki ei täsmää rivillä (\d+)\.$/u.exec(error);
  if (unmatchedQuote !== null) {
    return tTemplate("CSV-lainausmerkki ei täsmää rivillä {{0}}.", [unmatchedQuote[1] ?? ""]);
  }
  const tooManyRows = /^Tiedosto sisältää yli (\d+) tietoriviä\.$/u.exec(error);
  if (tooManyRows !== null) {
    return tTemplate("Tiedosto sisältää yli {{0}} tietoriviä.", [tooManyRows[1] ?? ""]);
  }
  const widthMismatch = /^Rivillä on (\d+) arvoa, otsakkeita on (\d+)\.$/u.exec(error);
  if (widthMismatch !== null) {
    return tTemplate("Rivillä on {{0}} arvoa, otsakkeita on {{1}}.", [
      widthMismatch[1] ?? "",
      widthMismatch[2] ?? "",
    ]);
  }
  const exactTranslation = t(error);
  if (exactTranslation !== error) return exactTranslation;
  const fieldError = /^(.+?): (.+)$/u.exec(error);
  if (fieldError !== null) {
    return `${t(fieldError[1] ?? "")}: ${t(fieldError[2] ?? "")}`;
  }
  return t(error);
}

function previewValue(row: HealthCsvImportRow, columnIndex: number): string {
  return row.sourceValues[columnIndex] ?? "";
}

export function HealthCsvImport(): React.JSX.Element {
  const {
    measurements,
    hydrationEntries,
    nutritionEntries,
    sleepEntries,
    activityEntries,
    moodCheckins,
    supplementLogs,
    supplements,
    breathingSessions,
  } = useData();
  const importRepositories = useMemo(
    () => ({
      measurements,
      hydrationEntries,
      nutritionEntries,
      sleepEntries,
      activityEntries,
      moodCheckins,
      supplementLogs,
      breathingSessions,
    }),
    [
      measurements,
      hydrationEntries,
      nutritionEntries,
      sleepEntries,
      activityEntries,
      moodCheckins,
      supplementLogs,
      breathingSessions,
    ],
  );
  const [table, setTable] = useState<ParsedCsvTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [kind, setKind] = useState<HealthCsvImportKind>("weight");
  const [mapping, setMapping] = useState<Readonly<Record<string, number | undefined>>>({});
  const [supplementIds, setSupplementIds] = useState<readonly string[]>([]);
  const [supplementsReady, setSupplementsReady] = useState(false);
  const [supplementsFailed, setSupplementsFailed] = useState(false);
  const [existingRecords, setExistingRecords] = useState<
    readonly HealthCsvImportExistingRecord[] | null
  >(null);
  const [historyReadFailed, setHistoryReadFailed] = useState(false);
  const [historyReloadKey, setHistoryReloadKey] = useState(0);
  const [fileError, setFileError] = useState<string | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [failedRows, setFailedRows] = useState<readonly number[]>([]);

  useEffect(() => {
    let active = true;
    void supplements
      .list()
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setSupplementIds(
            result.value.filter(isActiveSupplement).map((supplement) => supplement.id),
          );
        } else {
          setSupplementsFailed(true);
        }
      })
      .catch(() => {
        if (active) setSupplementsFailed(true);
      })
      .finally(() => {
        if (active) setSupplementsReady(true);
      });
    return () => {
      active = false;
    };
  }, [supplements]);

  useEffect(() => {
    if (table === null) {
      setExistingRecords(null);
      setHistoryReadFailed(false);
      return;
    }
    let active = true;
    setExistingRecords(null);
    setHistoryReadFailed(false);
    void listHealthCsvImportExistingRecords(importRepositories, kind)
      .then((result) => {
        if (!active) return;
        if (result.ok) setExistingRecords(result.value);
        else setHistoryReadFailed(true);
      })
      .catch(() => {
        if (active) setHistoryReadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [historyReloadKey, importRepositories, kind, table]);

  const preview = useMemo(
    () =>
      table === null ||
      existingRecords === null ||
      historyReadFailed ||
      (kind === "supplements" && (!supplementsReady || supplementsFailed))
        ? null
        : previewHealthCsvImport(table, kind, mapping, {
            knownSupplementIds: supplementIds,
            existingRecords,
          }),
    [
      existingRecords,
      historyReadFailed,
      kind,
      mapping,
      supplementIds,
      supplementsFailed,
      supplementsReady,
      table,
    ],
  );
  const selectedFields = HEALTH_CSV_IMPORT_FIELDS[kind].filter(
    (field) => mapping[field.key] !== undefined,
  );
  const validRows =
    preview?.rows.filter(
      (row) => row.value !== null && row.errors.length === 0 && !row.duplicate,
    ) ?? [];
  const duplicateRows = preview?.rows.filter((row) => row.duplicate) ?? [];
  const errorRows = preview?.rows.filter((row) => row.errors.length > 0) ?? [];

  const onFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    setTable(null);
    setFileName("");
    setFileError(null);
    setResultMessage(null);
    setFailedRows([]);
    if (file === undefined) return;
    if (!file.name.toLocaleLowerCase("en-US").endsWith(".csv")) {
      setFileError(t("Valitse .csv-päätteinen tiedosto."));
      return;
    }
    if (file.size > FILE_SIZE_LIMIT) {
      setFileError(t("Tiedosto ylittää 12 Mt:n kokorajan."));
      return;
    }
    setFileLoading(true);
    try {
      const parsed = parseHealthCsv(await file.text());
      setFileName(file.name);
      setTable(parsed);
      const detectedKind = suggestHealthCsvImportKind(parsed.headers);
      const nextKind = detectedKind ?? kind;
      setKind(nextKind);
      setMapping(suggestHealthCsvColumnMapping(parsed.headers, nextKind));
      if (parsed.fatalError !== null) setFileError(parsed.fatalError);
    } catch {
      setFileError(t("CSV-tiedoston lukeminen epäonnistui."));
    } finally {
      setFileLoading(false);
    }
  };

  const commitImport = async (): Promise<void> => {
    if (
      table === null ||
      preview === null ||
      preview.validCount === 0 ||
      preview.mappingErrors.length > 0
    ) {
      return;
    }
    setCommitting(true);
    setResultMessage(null);
    setFailedRows([]);
    try {
      const result = await commitHealthCsvImport(importRepositories, preview.rows);
      if (result.importedCount > 0) {
        window.dispatchEvent(new CustomEvent("lifeos:data-changed"));
      }
      setFailedRows(result.failedRows.map((row) => row.rowNumber));
      setResultMessage(
        tTemplate(
          "Tallennettuja rivejä: {{0}}. Ohitettuja kaksoiskappaleita: {{1}}. Tallennusvirheitä: {{2}}.",
          [
            String(result.importedCount),
            String(result.duplicateRows.length),
            String(result.failedRows.length),
          ],
        ),
      );
      if (result.failedRows.length === 0) {
        setTable(null);
        setFileName("");
      } else {
        const failedNumbers = new Set(result.failedRows.map((row) => row.rowNumber));
        const importedNumbers = new Set(
          validRows.filter((row) => !failedNumbers.has(row.rowNumber)).map((row) => row.rowNumber),
        );
        const processedNumbers = new Set([...importedNumbers, ...result.duplicateRows]);
        if (processedNumbers.size > 0) {
          setTable((current) =>
            current === null
              ? null
              : {
                  ...current,
                  rows: current.rows.filter((row) => !processedNumbers.has(row.rowNumber)),
                },
          );
        }
      }
    } catch {
      setResultMessage(t("Tuonti keskeytyi. Tarkista tallennustila ja yritä uudelleen."));
    } finally {
      setCommitting(false);
    }
  };

  const content = (
    <>
      <p data-ui="health-csv-import-intro">
        {t(
          "Valitse terveyshistorian CSV. Tiedosto käsitellään tällä laitteella ja kelvolliset rivit tallennetaan paikallisesti.",
        )}
      </p>
      <p data-ui="health-csv-import-note">
        {t(
          "Tuonti luo uusia merkintöjä. Tunnisteet ja kohdistamattomat sarakkeet ohitetaan; täysin saman sisältöiset kirjaukset tunnistetaan kaksoiskappaleiksi.",
        )}
      </p>
      <label data-ui="csv-import-file">
        <span>{t("CSV-tiedosto")}</span>
        <input
          aria-label={t("Valitse CSV-tiedosto")}
          type="file"
          accept=".csv,text/csv"
          disabled={fileLoading || committing}
          onChange={(event) => void onFileChange(event)}
        />
      </label>
      {fileName !== "" ? <p data-ui="csv-import-filename">{fileName}</p> : null}
      {fileLoading ? <p role="status">{t("Luetaan CSV-tiedostoa…")}</p> : null}
      {kind === "supplements" && !supplementsReady ? (
        <p role="status">{t("Ladataan lisäravinteita…")}</p>
      ) : null}
      {table !== null && existingRecords === null && !historyReadFailed ? (
        <p role="status">{t("Tarkistetaan aiempia merkintöjä…")}</p>
      ) : null}
      {historyReadFailed ? (
        <Alert tone="danger" title={t("Aiemman historian tarkistaminen epäonnistui")}>
          <p>{t("Tuontia ei voi jatkaa ennen kuin kaksoiskappaleet on tarkistettu.")}</p>
          <Button
            variant="secondary"
            onClick={() => {
              setHistoryReloadKey((current) => current + 1);
            }}
          >
            {t("Yritä uudelleen")}
          </Button>
        </Alert>
      ) : null}
      {kind === "supplements" && supplementsFailed ? (
        <Alert tone="danger" title={t("Lisäravinteita ei voitu ladata")}>
          {t("Lisäravinne-CSV:tä ei voi tarkistaa ilman tämän laitteen lisäravinnetietoja.")}
        </Alert>
      ) : null}
      {fileError !== null ? (
        <Alert tone="danger" title={t("CSV-tiedostoa ei voi tuoda")}>
          {translateImportError(fileError)}
        </Alert>
      ) : null}
      {table !== null && table.fatalError === null ? (
        <>
          <div data-ui="csv-import-controls">
            <Select
              label={t("Tuotava historia")}
              value={kind}
              options={HEALTH_IMPORT_KINDS.map((optionKind) => ({
                value: optionKind,
                label: t(HEALTH_CSV_IMPORT_LABELS[optionKind]),
              }))}
              onChange={(event) => {
                const nextKind = event.currentTarget.value as HealthCsvImportKind;
                setKind(nextKind);
                setMapping(suggestHealthCsvColumnMapping(table.headers, nextKind));
                setResultMessage(null);
                setFailedRows([]);
              }}
            />
            <p data-ui="csv-import-delimiter">
              {tTemplate("Tiedoston erotin: {{0}}", [
                table.delimiter === ","
                  ? t("pilkku")
                  : table.delimiter === ";"
                    ? t("puolipiste")
                    : t("sarkain"),
              ])}
            </p>
          </div>
          <section data-ui="csv-import-mapping" aria-labelledby="csv-import-mapping-title">
            <div data-ui="csv-import-section-heading">
              <h3 id="csv-import-mapping-title">{t("Kohdista sarakkeet")}</h3>
              <p>{t("Varmista, että jokainen tieto vastaa oikeaa CSV-saraketta.")}</p>
            </div>
            <div data-ui="csv-import-field-grid">
              {HEALTH_CSV_IMPORT_FIELDS[kind].map((field) => (
                <Select
                  key={field.key}
                  label={t(field.label)}
                  value={mapping[field.key] === undefined ? "" : String(mapping[field.key])}
                  required={field.required}
                  placeholder={field.required ? t("Valitse sarake") : t("Älä tuo tätä kenttää")}
                  options={table.headers.map((header, index) => ({
                    value: String(index),
                    label: `${String(index + 1)}. ${header}`,
                  }))}
                  onChange={(event) => {
                    const selected = event.currentTarget.value;
                    setMapping((current) => ({
                      ...current,
                      [field.key]: selected === "" ? undefined : Number(selected),
                    }));
                    setResultMessage(null);
                    setFailedRows([]);
                  }}
                />
              ))}
            </div>
            {preview !== null && preview.mappingErrors.length > 0 ? (
              <ul data-ui="csv-import-mapping-errors" role="alert">
                {preview.mappingErrors.map((error) => (
                  <li key={error}>{translateImportError(error)}</li>
                ))}
              </ul>
            ) : null}
          </section>
          {preview !== null ? (
            <section data-ui="csv-import-preview" aria-labelledby="csv-import-preview-title">
              <div data-ui="csv-import-section-heading">
                <h3 id="csv-import-preview-title">{t("Esikatselu")}</h3>
                <p role="status">
                  {tTemplate(
                    "Tuotavia rivejä: {{0}} · Ohitettavia kaksoiskappaleita: {{1}} · Virherivejä: {{2}}",
                    [
                      String(preview.validCount),
                      String(preview.duplicateCount),
                      String(preview.invalidCount),
                    ],
                  )}
                </p>
              </div>
              {preview.rows.length === 0 ? (
                <p>{t("CSV-tiedosto ei sisällä tietorivejä.")}</p>
              ) : null}
              {preview.validCount > 0 ? (
                <div data-ui="csv-import-table-scroll">
                  <table data-ui="csv-import-table">
                    <caption>{t("Ensimmäiset tuotavat rivit")}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t("Rivi")}</th>
                        {selectedFields.slice(0, 5).map((field) => (
                          <th key={field.key} scope="col">
                            {t(field.label)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {validRows.slice(0, PREVIEW_LIMIT).map((row) => (
                        <tr key={row.rowNumber}>
                          <th scope="row">{row.rowNumber}</th>
                          {selectedFields.slice(0, 5).map((field) => (
                            <td key={field.key}>
                              {previewValue(row, mapping[field.key] ?? 0) || "—"}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {duplicateRows.length > 0 ? (
                <section
                  data-ui="csv-import-duplicate-rows"
                  aria-labelledby="csv-import-duplicates-title"
                >
                  <h4 id="csv-import-duplicates-title">{t("Ohitettavat kaksoiskappaleet")}</h4>
                  <p>
                    {t(
                      "Rivi vastaa aiempaa merkintää tai tiedoston aiempaa kelvollista riviä. Sitä ei tallenneta.",
                    )}
                  </p>
                  <ul>
                    {duplicateRows.slice(0, ERROR_ROW_LIMIT).map((row) => (
                      <li key={row.rowNumber}>
                        {tTemplate("Rivi {{0}}", [String(row.rowNumber)])}
                      </li>
                    ))}
                  </ul>
                  {duplicateRows.length > ERROR_ROW_LIMIT ? (
                    <p>
                      {tTemplate("Näytetään {{0}} ensimmäistä kaksoiskappaleriviä.", [
                        String(ERROR_ROW_LIMIT),
                      ])}
                    </p>
                  ) : null}
                </section>
              ) : null}
              {errorRows.length > 0 ? (
                <section
                  data-ui="csv-import-invalid-rows"
                  aria-labelledby="csv-import-errors-title"
                >
                  <h4 id="csv-import-errors-title">{t("Virherivit")}</h4>
                  <p>
                    {t(
                      "Näitä rivejä ei tallenneta. Korjaa ne tiedostoon tai jatka kelvollisilla riveillä.",
                    )}
                  </p>
                  <ul>
                    {errorRows.slice(0, ERROR_ROW_LIMIT).map((row) => (
                      <li key={row.rowNumber}>
                        <strong>{tTemplate("Rivi {{0}}", [String(row.rowNumber)])}</strong>
                        <ul>
                          {row.errors.slice(0, 3).map((error, index) => (
                            <li key={`${String(row.rowNumber)}-${String(index)}`}>
                              {translateImportError(error)}
                            </li>
                          ))}
                          {row.errors.length > 3 ? (
                            <li>
                              {tTemplate("Muita virheitä: {{0}}", [String(row.errors.length - 3)])}
                            </li>
                          ) : null}
                        </ul>
                      </li>
                    ))}
                  </ul>
                  {errorRows.length > ERROR_ROW_LIMIT ? (
                    <p>
                      {tTemplate("Näytetään {{0}} ensimmäistä virheriviä.", [
                        String(ERROR_ROW_LIMIT),
                      ])}
                    </p>
                  ) : null}
                </section>
              ) : null}
              {preview.validCount > 0 ? (
                <Button
                  variant="primary"
                  loading={committing}
                  disabled={committing || preview.mappingErrors.length > 0}
                  onClick={() => void commitImport()}
                >
                  {tTemplate("Tuo kelvolliset rivit ({{0}})", [String(preview.validCount)])}
                </Button>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
      {resultMessage !== null ? (
        <p role="status" data-ui="csv-import-result">
          {resultMessage}
          {failedRows.length > 0 ? (
            <span> {tTemplate("Virherivit: {{0}}", [failedRows.join(", ")])}</span>
          ) : null}
        </p>
      ) : null}
    </>
  );

  return (
    <Card heading={t("Tuo terveyshistoria CSV-tiedostosta")} data-testid="health-csv-import">
      {content}
    </Card>
  );
}
