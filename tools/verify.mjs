// T035: CI/local verify -orkestrointi (Node, ei Python-järjestelmää).
// Yksi komento ajaa ydintarkistukset puhtaasta reposta järjestyksessä:
// toolchain → puhdas asennus → typecheck → lint → format:check →
// unit/integration-testit → build → preview-smoke (root/deep-link/manifest/SW).
// E2E-selainmatriisi EI kuulu tähän (T039-portti ajaa sen erikseen).
// Fail-fast: ensimmäinen kaatunut vaihe pysäyttää ajon selkeään virheeseen.
// Turvallisuus: ei tulosta env-arvoja; salaisuusportti on buildin sisällä (T029).
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const STEPS = [
  { name: "toolchain", command: "node", args: ["--version"] },
  { name: "install:clean", command: "npm", args: ["ci"] },
  { name: "typecheck", command: "npm", args: ["run", "typecheck", "--workspaces", "--if-present"] },
  { name: "lint", command: "npm", args: ["run", "lint"] },
  { name: "format:check", command: "npm", args: ["run", "format:check"] },
  { name: "test", command: "npm", args: ["test"] },
  { name: "build", command: "npm", args: ["run", "build", "--workspace", "@lifeos/web"] },
];

function runStep(step) {
  console.log(`[verify] ▶ ${step.name}: ${step.command} ${step.args.join(" ")}`);
  const result = spawnSync(step.command, [...step.args], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      `[verify] ✖ vaihe epäonnistui: ${step.name} (exit ${String(result.status ?? "tuntematon")})`,
    );
  }
  console.log(`[verify] ✔ ${step.name}`);
}

/**
 * T035-korjaus: varmista dev-.env ennen buildia. Puhdas checkout sisältää
 * vain .env.examplen (.env on gitignoressa); ilman tätä T029-portti kaataa
 * buildin puuttuvaan VITE_APP_ORIGINiin. Olemassa olevaa .env:ää ei koskaan
 * ylikirjoiteta; CI tekee saman `cp .env.example .env`.
 * Toteutus erillisenä .cjs-apurina (ei node -e -lainausmerkkiongelmia
 * Windows PowerShellissä).
 */
function ensureDevEnv() {
  console.log("[verify] ▶ env: tarkista .env (.env.example → .env jos puuttuu)");
  const result = spawnSync("node", ["tools/ensure-dev-env.cjs"], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error("[verify] ✖ env-vaihe epäonnistui");
  }
  console.log("[verify] ✔ env");
}

async function fetchStatus(url) {
  const response = await fetch(url, { redirect: "manual" });
  await response.arrayBuffer().catch(() => undefined);
  return response.status;
}

async function previewSmoke() {
  console.log("[verify] ▶ preview-smoke: vite preview + HTTP-tarkistukset");
  const server = spawn(
    "npm",
    ["run", "preview", "--workspace", "@lifeos/web", "--", "--host", "127.0.0.1", "--port", "4174"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );
  let output = "";
  // Vite värittää lokin ANSI-koodeilla ja npm voi reitittää Local-rivin
  // stdoutiin TAI stderriin — kuoritaan koodit ja kuunnellaan molempia.
  // Lisäksi HTTP-pollaus toimii varmistuksena jos lokirivi hukkuu.
  const stripAnsi = (text) => text.replace(/\u001b\[[0-9;]*m/g, "");
  const isReadySignal = (text) => {
    const plain = stripAnsi(text);
    return plain.includes("Local:") || plain.includes("127.0.0.1:4174");
  };
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `[verify] ✖ preview-smoke: preview ei käynnistynyt 30 s kuluessa. Lokin alku:\n${stripAnsi(output).slice(0, 2000)}`,
        ),
      );
    }, 30_000);
    const onChunk = (chunk) => {
      output += chunk.toString();
      if (isReadySignal(output)) {
        clearTimeout(timer);
        resolve();
      }
    };
    server.stdout?.on("data", onChunk);
    server.stderr?.on("data", onChunk);
    server.on("exit", (code) => {
      if (!isReadySignal(output)) {
        clearTimeout(timer);
        reject(
          new Error(
            `[verify] ✖ preview-smoke: preview sammui ennen valmiutta (exit ${String(code ?? "?")}). Lokin alku:\n${stripAnsi(output).slice(0, 2000)}`,
          ),
        );
      }
    });
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  const stopServer = async () => {
    try {
      if (server.pid !== undefined && process.platform === "win32") {
        // npm → vite -ketju jää Windowsilla orvoksi pelkällä killillä;
        // kaadetaan koko puu jotta portti vapautuu seuraavalle ajolle.
        const { spawnSync: sync } = await import("node:child_process");
        sync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        server.kill();
      }
    } catch {
      // Best-effort: previewin sammutus ei saa kaataa verifyä.
    }
    await delay(1000);
  };
  const waitForHttp = async () => {
    const deadline = Date.now() + 30_000;
    for (;;) {
      try {
        const status = await fetchStatus("http://127.0.0.1:4174/");
        if (status === 200) {
          return;
        }
      } catch {
        // Preview ei vielä vastaa — pollataan kunnes deadline.
      }
      if (Date.now() > deadline) {
        throw new Error("[verify] ✖ preview-smoke: HTTP ei vastannut 30 s kuluessa");
      }
      await delay(500);
    }
  };
  try {
    await Promise.race([ready, waitForHttp()]);
    const base = "http://127.0.0.1:4174";
    const checks = [
      ["root", `${base}/`],
      ["deep-link", `${base}/tasks`],
      ["manifest", `${base}/manifest.webmanifest`],
      ["sw", `${base}/sw.js`],
    ];
    for (const [name, url] of checks) {
      const status = await fetchStatus(url);
      if (status !== 200) {
        throw new Error(
          `[verify] ✖ preview-smoke: ${name} palautti ${String(status)} (odotettiin 200)`,
        );
      }
      console.log(`[verify]   ✔ ${name}=200`);
    }
  } finally {
    await stopServer();
  }
  console.log("[verify] ✔ preview-smoke");
}

async function main() {
  const started = Date.now();
  console.log("[verify] LifeOS CI/local verify käynnistyy (T035)");
  for (const step of STEPS) {
    // install:clean (npm ci) tyhjentää node_modulesin; env-vaihe ajetaan
    // vasta sen jälkeen jotta järjestys on deterministinen joka ajossa.
    runStep(step);
    if (step.name === "install:clean") {
      ensureDevEnv();
    }
  }
  await previewSmoke();
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[verify] VALMIS ${seconds}s — kaikki ydintarkistukset vihreät`);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
