// T030: Vite-virtuaalimoduulien tsc-deklaraatiot (?worker/?url).
// Nämä ovat build-ajan moduuleja jotka Vite resolvoi; tsc tarvitsee vain
// muodot. Worker-entry (db.worker.ts) ja wasm-assetti kulkevat näiden kautta.
declare module "*.ts?worker" {
  const WorkerConstructor: new (options?: { name?: string }) => Worker;
  export default WorkerConstructor;
}

declare module "@sqlite.org/sqlite-wasm/sqlite3.wasm?url" {
  const url: string;
  export default url;
}
