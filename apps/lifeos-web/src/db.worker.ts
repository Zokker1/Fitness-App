// T030: Vite-?worker-entry. Käärii @lifeos/data sqliteWorkerin worker-
// kontekstiin ja injektoi wasm-URL:n (web-puolen ?url-asset).
// Workerissa ei Reactia/DOM:ia/Drivea — vain SQLite + OPFS + protokolla.
//
// Huom: suhteellinen syväimportti worker-moduuliin. @lifeos/data-aliasta
// ei käytetä tässä tiedostossa koska Viten worker-bundleri resolvoi
// syväpolun väärin aliaksen kautta (index.ts/sqliteWorker-virhe); julkinen
// index.ts ei re-exportoi workeria (ei pääsäikeen bundleen).
//
// T039 (SAH-lukkojen vapautus): goto/reload EI tuhoa workeria kun sivu on
// bfcache-kelpoinen — vanha workeri voi jäädä eloon ja pitää SAH-lukkoja,
// jolloin uusi workeri saa createSyncAccessHandle-NoModificationAllowed-
// Errorin ja putoaa muistiin. Siksi workeri kuuntelee pagehideä (bfcache +
// sulku): se sulkee DB:n (flushaa + vapauttaa SAHit) jotta seuraava sivu
// saa lukot. close on best-effort — ei postMessagea takaisin (sivu on jo
// menossa), vain paikallinen db.close() samassa workerissa.
import sqliteWasmUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import {
  configureWorkerAssets,
  notifyPageHidden,
} from "../../../packages/data/src/sqliteWorker.ts";

configureWorkerAssets({ sqliteWasmUrl });

self.addEventListener("pagehide", () => {
  notifyPageHidden();
});
