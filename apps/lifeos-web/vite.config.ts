import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { assertNoSecrets, scanBundleForSecretKeys } from "../../packages/config/src/secrets.ts";

// T029: config-portti. Ajetaan config-vaiheessa ennen bundlea:
// kielletty salaisuusmuuttuja tai tuntematon VITE_-avain kaataa buildin
// selkeään virheeseen (T350: ei client secretiä/tokenia/yksityisavainta
// frontend-bundleen). Buildin jälkeen dist skannataan samoilla neuloilla.
function lifeosConfigGuard(): { name: string; closeBundle(): void } {
  return {
    name: "lifeos-config-guard",
    closeBundle(): void {
      const distDir = path.resolve(import.meta.dirname, "dist");
      const hits: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walk(full);
          } else if (/\.(js|css|html|json)$/.test(entry.name)) {
            const text = readFileSync(full, "utf8");
            for (const hit of scanBundleForSecretKeys(text)) {
              hits.push(`${entry.name}:${hit}`);
            }
          }
        }
      };
      walk(distDir);
      if (hits.length > 0) {
        throw new Error(
          `LifeOS salaisuusportti esti buildin: bundle sisältää kiellettyjä avaimia (${hits.join(", ")}).`,
        );
      }
    },
  };
}

function readStaticPreviewHeaders(): Record<string, string> {
  const headersPath = path.resolve(import.meta.dirname, "public/_headers");
  const lines = readFileSync(headersPath, "utf8").split(/\r?\n/u);
  const headers: Record<string, string> = {};
  let matchesAllPaths = false;

  for (const line of lines) {
    if (line.trim() === "/*") {
      matchesAllPaths = true;
      continue;
    }
    if (line.length > 0 && !/^\s/u.test(line)) {
      matchesAllPaths = false;
      continue;
    }
    if (!matchesAllPaths) continue;
    const match = /^\s{2}([^:]+):\s*(.+)$/u.exec(line);
    const name = match?.[1];
    const value = match?.[2];
    if (name !== undefined && value !== undefined) headers[name] = value;
  }

  if (headers["Content-Security-Policy"] === undefined) {
    throw new Error("Production preview requires a Content-Security-Policy in public/_headers.");
  }
  return headers;
}

// T024: PWA/offline shell. T023-pohja + manifest + injectManifest-SW.
// - strategies: injectManifest jotta SW-versiointi ja DB-skeema pysyvät
//   hallinnassa (ei geneeristä generateSW-preachea sokkona).
// - App-shell: index.html + staattiset assetit precacheen; navigoinnit
//   fallback index.html:ään (SPA-reitit, T023).
// - API/Drive/data: NetworkOnly — käyttäjädata ei SW-cacheen.
// - devOptions: SW pois devissä (ei riko HMR:ää); PWA validoidaan buildissa.
export default defineConfig(({ mode }) => {
  // Lataa .env* TÄHÄN prosessiin jotta portti näkee samat arvot kuin bundle.
  // envDir: repo-juuri (T029: yksi .env repojuuressa, ei hajautettuna).
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const env = loadEnv(mode, repoRoot, "");
  assertNoSecrets(env);
  if (mode === "production" && (env.VITE_APP_ORIGIN === undefined || env.VITE_APP_ORIGIN === "")) {
    throw new Error(
      "Puuttuva kriittinen asetus VITE_APP_ORIGIN. Aseta se .env-tiedostoon (katso .env.example).",
    );
  }
  if (
    mode === "production" &&
    (env.VITE_GOOGLE_CLIENT_ID === undefined || env.VITE_GOOGLE_CLIENT_ID === "")
  ) {
    throw new Error(
      "Puuttuva kriittinen asetus VITE_GOOGLE_CLIENT_ID. Aseta se .env-tiedostoon (katso .env.example).",
    );
  }
  return {
    base: "./",
    // T033-korjaus: Vite lukee .env:n oletuksena app-hakemistosta, mutta
    // T029:n kanoninen .env asuu repo-juuressa — osoita envDir juureen jotta
    // import.meta.env leivotaan bundleen (muuten preview/E2E kaatuu
    // missing-app-origin vaikka guardin loadEnv näki arvot).
    envDir: repoRoot,
    plugins: [
      react(),
      lifeosConfigGuard(),
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.ts",
        registerType: "prompt",
        injectRegister: false,
        manifestFilename: "manifest.webmanifest",
        useCredentials: false,
        manifest: {
          name: "LifeOS",
          short_name: "LifeOS",
          description: "LifeOS — local-first arjenhallinnan selainapp.",
          id: "/",
          start_url: "/",
          scope: "/",
          shortcuts: [
            {
              name: "Tänään",
              short_name: "Tänään",
              description: "Avaa tämän päivän näkymä",
              url: "/",
            },
            {
              name: "Vesi",
              short_name: "Vesi",
              description: "Avaa veden pikakirjaus",
              url: "/nutrition?quick=water",
            },
            {
              name: "Aloita fokus",
              short_name: "Fokus",
              description: "Avaa fokusaloitus",
              url: "/focus?shortcut=start",
            },
            {
              name: "Momentum",
              short_name: "Momentum",
              description: "Avaa tavoitteiden Momentum-seuranta",
              url: "/insights?shortcut=momentum",
            },
          ],
          display: "standalone",
          display_override: ["window-controls-overlay", "standalone"],
          orientation: "any",
          dir: "ltr",
          lang: "fi",
          theme_color: "#1a2e22",
          background_color: "#f4f6f3",
          categories: ["productivity", "health", "lifestyle"],
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        injectManifest: {
          // T039 (offline-shell): wasm EI saa puuttua precachesta — db-worker
          // lataa sqlite3.wasm dynaamisesti (?url-asset) myös offline-
          // navigoinnin jälkeen. Ilman wasm:ia offline-avaus kaatuu
          // wasm-compile-virheeseen vaikka shell muuten latautuisi.
          // T041: woff2 mukaan samasta syystä — fontti on itse isännöity
          // (@fontsource-variable, ei CDN:ää) ja offline-shell vaatii sen.
          globPatterns: ["**/*.{js,css,html,svg,png,webmanifest,wasm,woff2}"],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        },
        // Huom: strategies: injectManifest -tilassa navigointi-fallback ja
        // runtime-caching elävät src/sw.ts:ssä (NavigationRoute + precache),
        // ei tässä configissa. Tähän ei kuulu erillistä workbox-avainta.
        devOptions: {
          enabled: false,
        },
      }),
    ],
    build: {
      outDir: "dist",
      assetsDir: "assets",
      assetsInlineLimit: 0,
      sourcemap: false,
      manifest: true,
      chunkSizeWarningLimit: 600,
    },
    resolve: {
      alias: {
        "@lifeos/capabilities": path.resolve(
          import.meta.dirname,
          "../../packages/capabilities/src/index.ts",
        ),
        "@lifeos/domain": path.resolve(import.meta.dirname, "../../packages/domain/src/index.ts"),
        "@lifeos/data": path.resolve(import.meta.dirname, "../../packages/data/src/index.ts"),
        "@lifeos/ui": path.resolve(import.meta.dirname, "../../packages/ui/src/index.ts"),
        "@lifeos/config": path.resolve(import.meta.dirname, "../../packages/config/src/index.ts"),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
    },
    preview: {
      port: 4173,
      strictPort: true,
      headers: readStaticPreviewHeaders(),
    },
  };
});
