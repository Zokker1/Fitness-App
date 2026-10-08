// T034: strict lint-portti (flat config, ESLint 10).
// - type-aware säännöt päällä src-koodille (ei any-vuotoja, ei kelluvia
//   lupauksia, ei käyttämättömiä); test/e2e/config-kevennykset erikseen.
// - react-hooks säännöt appin tsx:lle (exhaustive-deps + rules-of-hooks).
// - Prettier hoitaa formatoinnin (eslint-config-prettier poistaa päällekkäiset).
// - Rajaskannit (T025/T027/T032/T036) jäävät erillisiksi node-skripteiksi —
//   ESLint ei korvaa arkkitehtuurirajoja, vain koodihygienian.
// - T036: storage-raja no-restricted-importsina: UI ei koske sqlite/opfs-
//   moduuleihin (capability + data-kerros omistavat ne);
//   "opfsSupported"-tyyppiset kenttänimet sallitaan (ei importtia).
//
// Huom: projectService-ajo tarvitsee tsconfigin jokaiseen lintattavaan
// tiedostoon. Test/e2e/config-tiedostot on lisätty workspace-tsconfigien
// include-listoihin (T034) jotta default-projektia ei tarvita; juuren
// eslint.config.mjs lintataan ilman type-aware-sääntöjä (JS-config).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

const tsconfigRootDir = import.meta.dirname;

// Huom: typescript-eslint flat-configin `config()`-apu on ESLint 10:ssä
// deprekoitu core-defineConfigin hyväksi; käytetään sitä + tyyppivapaa
// legacy-yhteensopivuuskerros type-aware-sääntöjen alla (ei unsafe-virhettä).
const helper = tseslint.config;

export default helper(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/test-results/**",
      "**/playwright-report/**",
      "**/.playwright-cli/**",
      "output/playwright/**",
      "package-lock.json",
      "eslint.config.mjs",
      // T035: verify-orkestrointi on tavallista JS:ää (ei TS-projektia) —
      // lintataan ilman type-aware-sääntöjä (js/recommended + prettier).
      "tools/verify.mjs",
      "tools/ensure-dev-env.cjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["apps/lifeos-web/src/**/*.tsx", "apps/lifeos-web/test/**/*.tsx"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    files: [
      "apps/*/test/**/*.ts",
      "apps/*/test/**/*.tsx",
      "apps/*/e2e/**/*.ts",
      "apps/lifeos-web/src/**/*.d.ts",
    ],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: ["packages/data/src/sqliteWorker.ts", "packages/data/src/sqliteClient.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    files: ["packages/config/src/secrets.ts"],
    rules: {
      "no-console": "off",
    },
  },
  {
    // T036 storage-raja + T037 virheraja: App, storage-komponentit/hookit,
    // ErrorCard/Boundary eivät importoi sqlite/opfs-moduuleja, eivät koske
    // raakaan SQL:ään/worker-protokollaan eivätkä lue raakoja virhetyyppejä.
    // Poikkeukset dokumentoitu:
    // - dataContext.tsx: DI-kokoonpano joka saa rakentaa muististoret (T032).
    // - errors/appError.ts: AINOA joka saa kääntää raa'at virhetyypit
    //   AppErroriksi (T037-kääntäjät) ja lukea error.messagea redaktioon —
    //   siksi se on poissa tästä files-listasta (oma lohko alla).
    files: [
      "apps/lifeos-web/src/App.tsx",
      "apps/lifeos-web/src/storage/**/*.ts",
      "apps/lifeos-web/src/storage/**/*.tsx",
      "apps/lifeos-web/src/errors/ErrorCard.tsx",
      "apps/lifeos-web/src/errors/ErrorBoundary.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@lifeos/data",
              importNames: [
                "InMemoryStore",
                "InMemoryUnitOfWork",
                "sendDbRequest",
                "configureDatabaseWorker",
                "resetDatabaseWorkerForTests",
              ],
              message:
                "T036-raja: UI ei koske store-toteutuksiin/worker-clientiin. Käytä useData/useAppStorageStatus + service-funktioita.",
            },
            {
              // T037: error-moduuli on ainoa joka kääntää Data/Capability/
              // Config/Domain-virheet. Komponentit kuluttavat AppErroria +
              // ErrorCardia, eivät raakoja virhetyyppejä.
              name: "@lifeos/data",
              importNames: ["DataError", "DataErrorCode"],
              message:
                "T037-raja: käsittele virheet AppError-kerroksen kautta (src/errors/appError.ts), älä raakana DataErrorina.",
            },
            {
              name: "@lifeos/capabilities",
              importNames: ["CapabilityError", "CapabilityErrorCode"],
              message:
                "T037-raja: käsittele virheet AppError-kerroksen kautta (src/errors/appError.ts), älä raakana CapabilityErrorina.",
            },
            {
              name: "@lifeos/domain",
              importNames: ["DomainError", "DomainErrorCode"],
              message:
                "T037-raja: käsittele virheet AppError-kerroksen kautta (src/errors/appError.ts), älä raakana DomainErrorina.",
            },
            {
              name: "@lifeos/config",
              importNames: ["ConfigError", "ConfigErrorCode"],
              message:
                "T037-raja: käsittele virheet AppError-kerroksen kautta (src/errors/appError.ts), älä raakana ConfigErrorina.",
            },
          ],
          patterns: [
            {
              group: ["**/sqliteWorker", "**/sqliteClient", "**/sqliteProtocol"],
              message:
                "T036-raja: UI ei koske worker-protokollaan/SQLite-moduuleihin. Data-kerros omistaa ne.",
            },
            {
              group: ["@sqlite.org/*", "**/*sqlite*", "**/*opfs*"],
              message:
                "T036-raja: UI ei importoi sqlite/opfs-moduuleja. Capability + data-kerros omistavat ne.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/\\bSELECT\\s|\\bINSERT\\s+INTO\\b|\\bUPDATE\\s|\\bDELETE\\s+FROM\\b|\\bCREATE\\s+TABLE\\b|\\bPRAGMA\\b|\\bBEGIN;|\\bCOMMIT;|\\bROLLBACK;/i]",
          message: "T036-raja: ei raakaa SQL:ää UI-kerroksessa.",
        },
        {
          // T037: error.message/stack raakana näyttöön tai lokiin vuotaa
          // herkkiä tunnisteita (§48). UI:ssa viestit tulevat AppErrorista;
          // consoleen vain reportError (koodi+otsikko) DEVissä.
          selector: "MemberExpression[property.name='message']:not(:has(ThisExpression))",
          message:
            "T037-raja: älä lue error.messagea UI-kerroksessa. Käännä virhe AppErroriksi (fromUnknown/...) ja näytä sen kentät.",
        },
        {
          selector: "MemberExpression[property.name='stack']",
          message: "T037-raja: älä lue error.stackia UI-kerroksessa. Se ei kuulu käyttäjälle.",
        },
      ],
    },
  },
  {
    // T037: error-moduulin sisäinen redaktio. fromUnknown/fromBootstrapError
    // saavat lukea error.messagea VAIN redaktion sisällä (startsWith/slice
    // prefix-tarkistus + sanitizeForDisplay). Suora interpolointi viestiin
    // on kielletty — viestit ovat staattista fi-copya.
    files: ["apps/lifeos-web/src/errors/appError.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[property.name='stack']",
          message: "T037-raja: älä lue error.stackia edes error-moduulissa.",
        },
        {
          selector: "TemplateLiteral > MemberExpression[property.name='message']",
          message:
            "T037-raja: älä interpoloi error.messagea. Käytä staattista copya + sanitizeForDisplay.",
        },
      ],
    },
  },
  {
    // This static browser script is loaded before the TypeScript app starts.
    files: ["apps/lifeos-web/public/theme-boot.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        URL: "readonly",
      },
    },
  },
);
