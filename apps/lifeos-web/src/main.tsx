import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@lifeos/ui";
import { App } from "./App.tsx";
import { createBrowserCapabilities } from "./adapters/index.ts";
import { configureLifeosDatabase } from "./adapters/database.ts";
import { loadWebConfig } from "./config.ts";
import { DataProvider } from "./dataContext.tsx";
import { ErrorBoundary } from "./errors/ErrorBoundary.tsx";
import { fromBootstrapError } from "./errors/appError.ts";
import { StorageStatusProvider } from "./storage/StorageStatusContext.tsx";
import { ThemeProvider } from "./theme/ThemeContext.tsx";
import { GamificationVisibilityProvider } from "./preferences/GamificationVisibilityContext.tsx";
import { AppLockProvider } from "./preferences/AppLockContext.tsx";
import { LocalContentBoundary } from "./security/LocalContentBoundary.tsx";
import { WeightTargetProvider } from "./preferences/WeightTargetContext.tsx";
import { HeightProvider } from "./preferences/HeightContext.tsx";
import { HydrationTargetProvider } from "./preferences/HydrationTargetContext.tsx";
import { LanguageProvider } from "./language.tsx";
import { NotificationCategoriesProvider } from "./preferences/NotificationCategoriesContext.tsx";
import { isLocalContentEncryptionEnabled, isPersistentStorage } from "./storage/persistenceMode.ts";

function resolveBasename(): string {
  const baseUrl = import.meta.env.BASE_URL;
  if (typeof baseUrl !== "string" || baseUrl === "./" || baseUrl === "") {
    return "/";
  }
  return baseUrl;
}

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root-elementtiä (#root) ei löytynyt.");
}

// T029: validoi kriittinen config ennen renderiä — puuttuva asetus kaataa
// käynnistyksen selkeään virheeseen eikä hiljaiseen rikkinäisyyteen.
// T037: bootstrap-virhe renderöidään redaktoituna (ei raakaa stackia);
// root- ja SW-virheet eivät koskaan näytä error.messagea sellaisenaan.
function renderBootstrapError(error: unknown): void {
  const appError = fromBootstrapError(error);
  const root = document.getElementById("root");
  if (root !== null) {
    root.replaceChildren();
    const main = document.createElement("main");
    const heading = document.createElement("h2");
    heading.textContent = appError.title;
    heading.tabIndex = -1;
    const body = document.createElement("p");
    body.textContent = appError.body;
    const code = document.createElement("p");
    code.textContent = `Tekninen koodi: ${appError.diagnosticCode}`;
    main.append(heading, body, code);
    root.append(main);
    heading.focus();
  }
}

try {
  loadWebConfig();
} catch (error: unknown) {
  renderBootstrapError(error);
  throw error;
}

// T030: rekisteröi db-worker-tehdas (laiska luonti ensimmäisellä
// tietokantakutsulla; ei hidasta starttia eikä avaa kantaa tässä).
configureLifeosDatabase();

// T043: ThemeProvider uloimpana sisältöproviderina (ErrorBoundaryn alla,
// Routerin/DataProviderin ulkopuolella — teema ei riipu reitistä/datasta).
// A1 / §57.1: tuotantosovelluksen oletus on pysyvä tallennus. Muistipohjaisen
// tilan saa erikseen käyttöön diagnostiikassa parametrilla ?storage=muisti.
const storageSearch = typeof window === "undefined" ? "" : window.location.search;
const persistentData = isPersistentStorage(storageSearch);
const localContentEncryptionEnabled = isLocalContentEncryptionEnabled(storageSearch);

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <LanguageProvider>
        <ThemeProvider>
          <BrowserRouter basename={resolveBasename()}>
            <DataProvider persistent={persistentData}>
              <AppLockProvider
                persistent={persistentData}
                localContentEncryptionEnabled={localContentEncryptionEnabled}
              >
                <LocalContentBoundary>
                  <StorageStatusProvider>
                    <WeightTargetProvider persistent={persistentData}>
                      <HydrationTargetProvider persistent={persistentData}>
                        <HeightProvider persistent={persistentData}>
                          <GamificationVisibilityProvider persistent={persistentData}>
                            <NotificationCategoriesProvider persistent={persistentData}>
                              <App />
                            </NotificationCategoriesProvider>
                          </GamificationVisibilityProvider>
                        </HeightProvider>
                      </HydrationTargetProvider>
                    </WeightTargetProvider>
                  </StorageStatusProvider>
                </LocalContentBoundary>
              </AppLockProvider>
            </DataProvider>
          </BrowserRouter>
        </ThemeProvider>
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// T025: SW-rekisteröinti kulkee capability-rajan kautta (ei suoraa
// selain-API-viittausta app-johdossa). Tila käytetään
// myöhemmin asetusten/diagnostiikan offline-indikaattorissa.
// T037: hylkääminen ei kaada; tila näkyy diagnostiikassa, ei raakana.
void createBrowserCapabilities()
  .serviceWorker.state()
  .catch(() => undefined);
