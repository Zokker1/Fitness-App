// T081: Today-header — päivä, tervehdys ja tallennus-/offline-indikaattori
// yhdellä hillityllä rivillä (§4). Data tulee T080-projektiosta (phase) ja
// storage-tilasta; ei koristeellisuutta, ei synkankaanvalheita (indikaattori
// kertoo paikallisen tallennuksen, ei pilveä).
// Responsiivisuus: sama pino toimii molemmilla leveyksillä (ei absoluuttisia
// mittoja); indicator rivi meta-tekstinä.
import { t } from "../../language.tsx";
import { useMemo } from "react";
import { Display } from "@lifeos/ui";
import { buildTodayProjection } from "@lifeos/data";
import { useAppStorageStatus } from "../../storage/StorageStatusContext.tsx";
import { formatTodayDate, greetingForPhase, syncIndicator } from "./header.ts";
import { useOnlineStatus } from "../../adapters/useOnlineStatus.ts";

function localDateKey(nowIso: string, timezoneOffsetMinutes: number): string {
  return new Date(Date.parse(nowIso) + timezoneOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Tyhjä projektio-syöte (T081: header lukee vain phasea; kortit T082+ syöttävät datan). */
function emptyProjectionInput(localDate: string, nowIso: string, offsetMinutes: number) {
  return {
    localDate,
    now: nowIso,
    timezoneOffsetMinutes: offsetMinutes,
    tasks: [],
    checklistItems: [],
    focusSessions: [],
    hydrationEntries: [],
    nutritionEntries: [],
    supplements: [],
    supplementLogs: [],
    goals: [],
    goalDays: [],
    calendarBlocks: [],
    latestWeight: null,
    reminders: [],
    xpTransactions: [],
  };
}

export function TodayHeader(): React.JSX.Element {
  const { status } = useAppStorageStatus();
  const online = useOnlineStatus();
  // Nyt + offset renderiä kohden (ei joka renderissä kelloa seurata — header
  // on staattinen katsaus, päivittyy navigoinnissa/refreshillä).
  const nowIso = useMemo(() => new Date().toISOString(), []);
  // Selaimen oma offset: getTimezoneOffset palauttaa UTC−local -minuutit,
  // projektio haluaa local−UTC -suunnan (esim. UTC+3 → +180).
  const offsetMinutes = -new Date().getTimezoneOffset();
  const localDate = localDateKey(nowIso, offsetMinutes);
  const projection = buildTodayProjection(emptyProjectionInput(localDate, nowIso, offsetMinutes));
  const greeting = projection.ok
    ? greetingForPhase(projection.value.phase)
    : greetingForPhase("paiva");
  const indicator = syncIndicator(online, status.backend);

  return (
    <header data-ui="today-header" data-testid="today-header">
      <Display>{t("Tänään")}</Display>
      <p data-ui="meta" data-testid="today-date">
        {formatTodayDate(nowIso, offsetMinutes)}
      </p>
      <p data-ui="meta" data-testid="today-greeting">
        {t(greeting)}
      </p>
      <p data-ui="meta">
        <span data-ui="sync-indicator" data-tone={indicator.tone} data-testid="sync-indicator">
          <span data-ui="sync-dot" aria-hidden="true" />
          {t(indicator.label)}
        </span>
      </p>
    </header>
  );
}
