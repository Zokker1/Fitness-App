// T030: tietokannan worker-kytkentä. Rekisteröi Vite-?worker-tehtaan
// @lifeos/data-clientille. Worker-tiedosto (db.worker.ts) paketoituu
// erillisenä chunkina; sqlite3.wasm kulkee assettina web-puolen ?url-
// importista worker-entryyn — worker ei arvaa polkua eikä lataa verkosta.
//
// Huom: ?worker-import on Vite-virtuaalimoduuli (build validoi Viten).
// tsc:lle se deklaroidaan erillisessä src/vite-worker.d.ts:ssä.
//
// T038: EI pagehide/visibilityclosea. Mitattu: (a) pagehide ei ateşoidu
// ohjelmallisessa sulkemisessa, (b) visibilitychange→close rikkoo elävän
// sivun (taustalle meno sulkisi kannan kesken käytön), (c) sulkemisen
// jälkeinen avaus toimii ilmankin (poolin retry hoitaa). closeDatabase on
// vain eksplisiittiseen E2E-diagnostiikkaan (PersistenceProbe-nappi) —
// tuotantokoodi ei sulje kantaa automaattisesti.
import DbWorker from "../db.worker.ts?worker";
import { configureDatabaseWorker } from "@lifeos/data";

let configured = false;

export function configureLifeosDatabase(): void {
  if (configured) {
    return;
  }
  configured = true;
  configureDatabaseWorker({
    create: () => new DbWorker({ name: "lifeos-db" }),
  });
}

/** Testeille: nollaa kertakonfigurointi. */
export function resetLifeosDatabaseForTests(): void {
  configured = false;
}
