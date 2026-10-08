import { defineConfig } from "vitest/config";
import path from "node:path";

// T033: data-unit + node-db-integration. Node-ympäristö (ei selainta):
// - unit: repositories/services/migrations/protokolla puhtaasti;
// - db-integration: oikea @sqlite.org/sqlite-wasm node-build :memory:-kannalla
//   (sama M001-ketju kuin workerissa). Selain-OPFS/varsinainen Worker-testit
//   kuuluvat Playwright-E2E:hen (T038), ei tähän.
export default defineConfig({
  resolve: {
    alias: {
      "@lifeos/domain": path.resolve(import.meta.dirname, "../domain/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
