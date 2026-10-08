// T045: yleinen Icon-järjestelmä. Yksi ikoniperhe (Lucide, itse isännöidyt
// SVG-mask-assetit icons/-kansiossa, ei emojeita ikoneina, brief §2/§7):
// T096: search-ikoni (Lucide search, suurennuslasi) hakulaukaisimiin.
// - IconKey: kaikki käytettävissä olevat ikonit (nav + status). Uusi ikoni:
//   1) kopioi Lucide-SVG icons/-kansioon samalla normalisoinnilla
//   (aria-hidden + focusable=false + currentColor), 2) lisää avain + import
//   alle. Ei dynaamista polkua (bundleri staattiseen analyysiin).
// - Icon: koristeikoni labelin vieressä (aria-hidden SVG:ssä; ei yksin
//   interaktiivisen nimenä — §31). Koko perii kontekstin (1.25rem navissa,
//   1em tekstin seassa data-ui="icon-inline").
// - StatusIcon: tilan ikoni + sanallinen label (tila ei pelkällä värillä,
//   §31) semanttisiin pintoihin (banner/virhe/tyhjä).
// shellNav.ts:n ShellIconKey on navin osajoukko (reitti->ikoni); tämä on
// koko perhe. AppShell kuluttaa Iconia (ei omaa NavIconia).

import bodyIcon from "./icons/person-standing.svg?no-inline";
import thermometerIcon from "./icons/thermometer.svg?no-inline";
import dropletIcon from "./icons/droplet.svg?no-inline";
import gridIcon from "./icons/layout-grid.svg?no-inline";
import rulerIcon from "./icons/ruler.svg?no-inline";
import sparklesIcon from "./icons/sparkles.svg?no-inline";
import addIcon from "./icons/add.svg?no-inline";
import alertIcon from "./icons/alert.svg?no-inline";
import calendarIcon from "./icons/calendar.svg?no-inline";
import chartIcon from "./icons/chart-no-axes-column.svg?no-inline";
import checkIcon from "./icons/check.svg?no-inline";
import chevronIcon from "./icons/chevron.svg?no-inline";
import closeIcon from "./icons/close.svg?no-inline";
import focusIcon from "./icons/focus.svg?no-inline";
import healthIcon from "./icons/health.svg?no-inline";
import homeIcon from "./icons/home.svg?no-inline";
import infoIcon from "./icons/info.svg?no-inline";
import insightsIcon from "./icons/insights.svg?no-inline";
import moreIcon from "./icons/more.svg?no-inline";
import nutritionIcon from "./icons/nutrition.svg?no-inline";
import searchIcon from "./icons/search.svg?no-inline";
import settingsIcon from "./icons/settings.svg?no-inline";
import tasksIcon from "./icons/tasks.svg?no-inline";
import targetIcon from "./icons/target.svg?no-inline";
import trendIcon from "./icons/trending-up.svg?no-inline";
import warningIcon from "./icons/warning.svg?no-inline";
import weightIcon from "./icons/weight.svg?no-inline";

export type IconKey =
  | "home"
  | "tasks"
  | "calendar"
  | "focus"
  | "health"
  | "nutrition"
  | "insights"
  | "settings"
  | "more"
  | "search"
  | "close"
  | "add"
  | "alert"
  | "check"
  | "chevron"
  | "info"
  | "warning"
  | "chart"
  | "target"
  | "trend"
  | "weight"
  | "body"
  | "thermometer"
  | "droplet"
  | "grid"
  | "ruler"
  | "sparkles";

const ICON_URLS: Record<IconKey, string> = {
  home: homeIcon,
  tasks: tasksIcon,
  calendar: calendarIcon,
  focus: focusIcon,
  health: healthIcon,
  nutrition: nutritionIcon,
  insights: insightsIcon,
  settings: settingsIcon,
  more: moreIcon,
  search: searchIcon,
  close: closeIcon,
  add: addIcon,
  alert: alertIcon,
  check: checkIcon,
  chevron: chevronIcon,
  info: infoIcon,
  warning: warningIcon,
  chart: chartIcon,
  target: targetIcon,
  trend: trendIcon,
  weight: weightIcon,
  sparkles: sparklesIcon,
  ruler: rulerIcon,
  grid: gridIcon,
  droplet: dropletIcon,
  thermometer: thermometerIcon,
  body: bodyIcon,
};

/** Kaikki ikonit aakkosissa (testit + dokumentaatio; ei hiljaista puutetta). */
export const iconKeys: readonly IconKey[] = [
  "add",
  "alert",
  "body",
  "calendar",
  "chart",
  "check",
  "chevron",
  "close",
  "droplet",
  "focus",
  "grid",
  "health",
  "home",
  "info",
  "insights",
  "more",
  "nutrition",
  "ruler",
  "search",
  "settings",
  "sparkles",
  "target",
  "tasks",
  "thermometer",
  "trend",
  "warning",
  "weight",
];

/** Vite-paketoima paikallinen SVG-maskin URL, ei raakaa SVG-HTML:ää. */
export function iconAssetUrl(key: IconKey): string {
  return ICON_URLS[key];
}
