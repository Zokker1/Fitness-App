// T029: packages/config julkinen pinta. Yksi import-polku:
//   import { validatePublicWebConfig } from "@lifeos/config";
export type {
  PublicWebConfigInput,
  ConfigErrorCode,
  ConfigError,
  ValidatedWebConfig,
} from "./validate.ts";
export { validatePublicWebConfig } from "./validate.ts";
export type { SecretScanIssue } from "./secrets.ts";
export { scanEnvForSecrets, assertNoSecrets, scanBundleForSecretKeys } from "./secrets.ts";
