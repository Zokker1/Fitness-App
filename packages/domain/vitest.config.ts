import { defineConfig } from "vitest/config";

// T033: domain-unit. Puhdas node-ajo, ei selainta/DOM:ia — domain on
// alustariippumaton (T026-eristys). allowImportingTsExtensions jotta
// .ts-suffiksiset src-importit toimivat testeissä kuten tsc:ssä.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
