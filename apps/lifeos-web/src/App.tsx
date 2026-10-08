import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import type { OAuthCapability, OAuthSession } from "@lifeos/capabilities";
import type { SyncProvider } from "@lifeos/data";
import { Navigate, Route, Routes, useLocation, useSearchParams } from "react-router";
import {
  AppShell,
  Card,
  Display,
  EmptyState,
  Skeleton,
  Switch,
  themePreferenceLabel,
  type ThemePreference,
} from "@lifeos/ui";
import { appRoutes } from "./routes.ts";
import { ButtonProbe } from "./showcase/ButtonProbe.tsx";
import { CardProbe } from "./showcase/CardProbe.tsx";
import { ChartProbe } from "./showcase/ChartProbe.tsx";
import { FormProbe } from "./showcase/FormProbe.tsx";
import { MotionProbe } from "./showcase/MotionProbe.tsx";
import { OverlayProbe } from "./showcase/OverlayProbe.tsx";
import { ProgressProbe } from "./showcase/ProgressProbe.tsx";
import { ProbeTabs, probeSectionFromParam } from "./showcase/ProbeTabs.tsx";
import { SearchProbe } from "./showcase/SearchProbe.tsx";
import { StateProbe } from "./showcase/StateProbe.tsx";
import { useGlobalSearch } from "./search/useGlobalSearch.tsx";
import { TypographyProbe } from "./showcase/TypographyProbe.tsx";
import { InstallationProbe } from "./storage/InstallationProbe.tsx";
import { PersistenceProbe } from "./storage/PersistenceProbe.tsx";
import { PreferencesProbe } from "./storage/PreferencesProbe.tsx";
import { QuickAdd } from "./quickadd/QuickAdd.tsx";
import { StorageBanner } from "./storage/StorageBanner.tsx";
import { StorageStatusCard } from "./storage/StorageStatusCard.tsx";
import { useAppStorageStatus } from "./storage/StorageStatusContext.tsx";
import { useTheme } from "./theme/ThemeContext.tsx";
import { TodayCardsProbe } from "./showcase/TodayCardsProbe.tsx";
import {
  AchievementsGalleryProbe,
  JourneyCollectionProbe,
} from "./showcase/AchievementsGalleryProbe.tsx";
import { RoutinePlayerProbe } from "./showcase/RoutinePlayerProbe.tsx";
import { TodayView } from "./views/today/TodayView.tsx";
import { HistoryBrowser } from "./views/history/HistoryBrowser.tsx";
import { DataExportSettings } from "./views/settings/DataExportSettings.tsx";
import { HealthCsvImport } from "./views/settings/HealthCsvImport.tsx";
import { LanguageSelector } from "./LanguageSelector.tsx";
import { t, useLanguage } from "./language.tsx";
import { TaskRoute } from "./views/tasks/TaskRoute.tsx";
import { CalendarDayView } from "./views/calendar/CalendarDayView.tsx";
import { ProjectView } from "./views/projects/ProjectView.tsx";
import { GoalDetailPreview, GoalsRoute } from "./views/goals/GoalsRoute.tsx";
import { FocusView } from "./views/focus/FocusView.tsx";
import { InsightsView } from "./views/insights/InsightsView.tsx";
import { useGamificationVisibility } from "./preferences/GamificationVisibilityContext.tsx";
import { ErrorCard } from "./errors/ErrorCard.tsx";
import { GamificationCelebration } from "./gamification/GamificationCelebration.tsx";
import { ReminderDeliveryBridge } from "./reminders/ReminderDeliveryBridge.tsx";
import { NotificationSettingsSection } from "./views/settings/NotificationSettingsSection.tsx";
import { NotificationHistorySection } from "./views/settings/NotificationHistorySection.tsx";
import { ConflictResolutionSection } from "./views/settings/ConflictResolutionSection.tsx";
import { ServiceWorkerNotificationBridge } from "./reminders/ServiceWorkerNotificationBridge.tsx";
import { createBrowserCapabilities, createGoogleDriveSyncProvider } from "./adapters/index.ts";
import { SyncStatusSection } from "./views/settings/SyncStatusSection.tsx";
import { AppLockSettings } from "./preferences/AppLockSettings.tsx";
import { BackupRotationCoordinator } from "./backup/BackupRotationCoordinator.tsx";

const HealthOverview = lazy(() =>
  import("./views/health/HealthOverview.tsx").then((module) => ({
    default: module.HealthOverview,
  })),
);
const FoodLibraryPage = lazy(() =>
  import("./views/health/FoodLibraryPage.tsx").then((module) => ({
    default: module.FoodLibraryPage,
  })),
);
const NutritionOverview = lazy(() =>
  import("./views/nutrition/NutritionOverview.tsx").then((module) => ({
    default: module.NutritionOverview,
  })),
);

function RoutePlaceholder({ label }: { label: string }): React.JSX.Element {
  // T055 a11y-baseline: jokaisella näkymällä on yksi h1 (Display, brief §3
  // "näkymäotsikot"); kortit ovat h2-osioita sen alla.
  return (
    <>
      <Display>{label}</Display>
      <Card>
        <EmptyState
          title={t("Sisältö rakentuu myöhemmissä lohkoissa")}
          hint={t(
            "T028: yhteinen AppShell (bottom navigation / rail) on nyt käytössä molemmilla leveyksillä.",
          )}
        />
      </Card>
    </>
  );
}

// T036: asetusten tallennusosio. Kortti kytketään hook-tulokseen; nappi
// pyytää persist():n käyttäjän aloitteesta (automaatti hoituu hookissa).
function SettingsStorageSection(): React.JSX.Element {
  const { status, loading, loadError, persistence, requestPersistence } = useAppStorageStatus();
  const [requesting, setRequesting] = useState(false);
  return (
    <StorageStatusCard
      status={status}
      loading={loading}
      loadError={loadError}
      requesting={requesting}
      requestError={persistence.error}
      requestGranted={persistence.granted}
      onRequestPersistence={() => {
        setRequesting(true);
        void requestPersistence().finally(() => {
          setRequesting(false);
        });
      }}
    />
  );
}

// T043: teemavalinta (system/light/dark). Segmented-valitsin T048:ssä;
// tässä saavutettava radioryhmä samoilla tokeneilla (ei uutta visuaalista
// kieltä). Preferenssi persistoidaan providerissa; system tyhjentää avaimen.
const THEME_OPTIONS: readonly ThemePreference[] = ["system", "light", "dark"];

function SettingsThemeSection(): React.JSX.Element {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <Card heading={t("Ulkoasu")}>
      <fieldset data-testid="theme-choice">
        <legend>
          {t("Teema (nyt: ")}
          {resolved === "dark" ? t("tumma") : t("vaalea")})
        </legend>
        {THEME_OPTIONS.map((option) => (
          <label key={option}>
            <input
              type="radio"
              name="lifeos-theme"
              value={option}
              checked={preference === option}
              onChange={() => {
                setPreference(option);
              }}
            />{" "}
            {t(themePreferenceLabel(option))}
          </label>
        ))}
      </fieldset>
    </Card>
  );
}

function SettingsGamificationSection(): React.JSX.Element {
  const { visible, loading, saving, error, reload, setVisible } = useGamificationVisibility();
  return (
    <Card heading={t("Pelillistäminen")}>
      <div data-testid="gamification-visibility-settings">
        <Switch
          checked={visible === true}
          disabled={loading || visible === null || saving}
          data-testid="gamification-visibility-toggle"
          aria-describedby="gamification-visibility-hint"
          onChange={(event) => {
            void setVisible(event.target.checked);
          }}
        >
          {t("Näytä edistyminen, saavutukset ja tähtikartta")}
        </Switch>
        <p id="gamification-visibility-hint" data-ui="gamification-visibility-hint">
          {t(
            "Pois päältä: XP:tä ja tasoja ei näytetä, ja saavutukset, tähtikartta sekä fokushistorian XP-merkinnät piilotetaan. Suoritukset ja palkintojen kirjaaminen jatkuvat.",
          )}
        </p>
      </div>
      {error !== null ? <ErrorCard error={error} onRetry={() => void reload()} /> : null}
    </Card>
  );
}

type SyncProviderFactory = (getSession: () => OAuthSession | null) => SyncProvider;

function SettingsView({
  oauth,
  createProvider,
}: {
  readonly oauth: OAuthCapability;
  readonly createProvider: SyncProviderFactory;
}): React.JSX.Element {
  return (
    <>
      <Display>{t("Asetukset")}</Display>
      <SettingsThemeSection />
      <NotificationSettingsSection />
      <NotificationHistorySection />
      <AppLockSettings />
      <SyncStatusSection oauth={oauth} createProvider={createProvider} />
      <ConflictResolutionSection />
      <SettingsGamificationSection />
      <DataExportSettings />
      <HealthCsvImport />
      <SettingsStorageSection />
    </>
  );
}

function UnlockedAppContent(): React.JSX.Element {
  useLanguage();
  const oauth = useMemo(() => createBrowserCapabilities().oauth, []);
  const createSyncProvider = useCallback<SyncProviderFactory>(
    (getSession) => createGoogleDriveSyncProvider({ oauth, getSession }),
    [oauth],
  );
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { status } = useAppStorageStatus();
  const localizedRoutes = appRoutes.map((route) => ({ ...route, label: t(route.label) }));
  // T038: diagnostiikkareitti vain ?e2e=1:llä (tuotannossa piilossa).
  const showProbe = searchParams.get("e2e") === "1";
  // T056-tukimuutos: näyteikkunat osioituna (ei loputonta syötettä);
  // oletus "nakyma" = varsinainen sovellusnäkymä.
  const probeSection = probeSectionFromParam(searchParams.get("probe"));
  // T096: tuotannon hakukokemus — nav-laukaisimet + dialogi (ei navireittiä).
  const search = useGlobalSearch();
  const currentPath = location.pathname.startsWith("/insights/")
    ? "/insights"
    : location.pathname.startsWith("/health/")
      ? "/health"
      : location.pathname.startsWith("/nutrition/")
        ? "/nutrition"
        : location.pathname;
  return (
    <AppShell
      routes={localizedRoutes}
      currentPath={currentPath}
      navSearchButton={search.navButton}
      railSearchButton={search.railButton}
      languageControl={<LanguageSelector />}
      labels={{
        skipToContent: t("Siirry sisältöön"),
        primaryNavigation: t("Päänavigaatio"),
        mobileNavigation: t("Päänavigaatio (mobiili)"),
        sidebar: t("Sivupalkki"),
        sidebarNote: t("Täydentyy myöhemmissä lohkoissa (synkronointi, tehosteet)."),
        more: t("Lisää"),
        closeMenu: t("Sulje valikko"),
      }}
    >
      <BackupRotationCoordinator />
      <StorageBanner status={status} />
      <ReminderDeliveryBridge />
      <ServiceWorkerNotificationBridge />
      {showProbe ? <ProbeTabs active={probeSection} /> : null}
      {showProbe && probeSection === "tavoite" ? <GoalDetailPreview /> : null}
      {showProbe && probeSection === "rutiini" ? <RoutinePlayerProbe /> : null}
      {showProbe && probeSection === "typografia" ? <TypographyProbe /> : null}
      {showProbe && probeSection === "tanaan" ? <TodayCardsProbe /> : null}
      {showProbe && probeSection === "saavutukset" ? <AchievementsGalleryProbe /> : null}
      {showProbe && probeSection === "saavutukset" ? <JourneyCollectionProbe /> : null}
      {showProbe && probeSection === "haku" ? <SearchProbe /> : null}
      {showProbe && probeSection === "persistenssi" ? <PersistenceProbe /> : null}
      {showProbe && probeSection === "persistenssi" ? <PreferencesProbe /> : null}
      {showProbe && probeSection === "persistenssi" ? <InstallationProbe /> : null}
      {showProbe && probeSection === "napit" ? <ButtonProbe /> : null}
      {showProbe && probeSection === "lomakkeet" ? <FormProbe /> : null}
      {showProbe && probeSection === "kortit" ? <CardProbe /> : null}
      {showProbe && probeSection === "overlayt" ? <OverlayProbe /> : null}
      {showProbe && probeSection === "tilat" ? <StateProbe /> : null}
      {showProbe && probeSection === "edistyminen" ? <ProgressProbe /> : null}
      {showProbe && probeSection === "graafit" ? <ChartProbe /> : null}
      {showProbe && probeSection === "liike" ? <MotionProbe /> : null}
      <Routes>
        {/* T081: Tänään on nyt oikea näkymä; keskeneräiset osa-alueet säilyttävät shell-reitin. */}
        <Route path="/" element={<TodayView />} />
        <Route path="/tasks" element={<TaskRoute />} />
        <Route path="/projects" element={<ProjectView />} />
        <Route path="/calendar" element={<CalendarDayView />} />
        <Route path="/goals" element={<GoalsRoute />} />
        <Route path="/focus" element={<FocusView />} />
        <Route path="/health/foods" element={<Navigate to="/nutrition/foods" replace />} />
        <Route
          path="/nutrition/foods"
          element={
            <Suspense
              fallback={
                <Card heading={t("Omat ruoat")}>
                  <Skeleton lines={4} label={t("Ladataan ruokakirjastoa…")} />
                </Card>
              }
            >
              <FoodLibraryPage />
            </Suspense>
          }
        />
        <Route
          path="/nutrition"
          element={
            <Suspense
              fallback={
                <Card heading={t("Ravinto")}>
                  <Skeleton lines={4} label={t("Ladataan ravintonäkymää…")} />
                </Card>
              }
            >
              <NutritionOverview />
            </Suspense>
          }
        />
        <Route
          path="/health"
          element={
            <Suspense
              fallback={
                <Card heading={t("Terveys")}>
                  <Skeleton lines={4} label={t("Ladataan terveysnäkymää…")} />
                </Card>
              }
            >
              <HealthOverview />
            </Suspense>
          }
        />
        <Route path="/insights" element={<InsightsView />} />
        <Route path="/insights/history" element={<HistoryBrowser />} />
        <Route
          path="/settings"
          element={<SettingsView oauth={oauth} createProvider={createSyncProvider} />}
        />
        <Route path="*" element={<RoutePlaceholder label={t("Sivua ei löytynyt")} />} />
      </Routes>
      {/* T090: Quick Add kaikilla reiteillä (FAB + Alt+N → sheet/modal). */}
      <QuickAdd
        launcherVisible={
          ![
            "/nutrition/foods",
            "/health/foods",
            "/insights",
            "/insights/history",
            "/settings",
          ].includes(location.pathname)
        }
      />
      <GamificationCelebration />
      {search.dialog}
    </AppShell>
  );
}

export function App(): React.JSX.Element {
  return <UnlockedAppContent />;
}
