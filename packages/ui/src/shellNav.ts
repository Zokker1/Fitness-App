// T044: shell-navigaation puhdas malli (ei Reactia, ei selainta, ei DOM:ia).
// Sama eristysmalli kuin theme.ts/lifecycle.ts: päätökset testataan ilman
// selainta; AppShell renderöi vain tämän tuloksen.
//
// Malli (§3 navirakenne + §27):
// - primary: bottom navigationiin mahtuvat tärkeimmät (Tänään, Tehtävät,
//   Kalenteri, Fokus) + Lisää-painike toissijaisille.
// - secondary: loput (Projektit, Tavoitteet, Ravinto, Terveys, Insights, Asetukset) — mobiilissa
//   Lisää-drawerissa, desktop-railissa täytenä listana.
// - Ikonit: IconKey (icons.ts, yksi Lucide-perhe); nav käyttää osajoukkoa.
//   ShellIconKey on taaksepäin-yhteensopiva alias IconKeylle.
// - moreTarget: drawer auki ollessa nykyinen secondary-reitti (back pysyy),
//   muuten ensimmäinen secondary (deterministinen, ei arvausta).
// - Reitit joiden path puuttuu tunnetusta joukosta pudotetaan (fail-safe:
//   tuntematon reitti ei kaada navia eikä tuota rikkinäistä linkkiä).
// - currentPath joka ei täsmää mihinkään: mikään ei ole aktiivinen
//   (ei väärää aria-currentia; 404-sivu hoitaa sisällön).

import type { IconKey } from "./icons.ts";

/** Navin ikoniavain (IconKeyn osajoukko; status-ikonit eivät kuulu naviin). */
export type ShellIconKey = Extract<
  IconKey,
  | "home"
  | "tasks"
  | "calendar"
  | "focus"
  | "health"
  | "nutrition"
  | "insights"
  | "settings"
  | "more"
  | "close"
>;

export interface ShellNavItem {
  readonly path: string;
  readonly label: string;
  readonly icon: ShellIconKey;
}

export interface ShellNav {
  readonly primary: readonly ShellNavItem[];
  readonly secondary: readonly ShellNavItem[];
  readonly moreActive: boolean;
  readonly moreTarget: string;
}

/** Polku -> ikoni. Uusi reitti ilman merkintää: ei hiljaista väärää ikonia vaan "more". */
const ICON_BY_PATH: Readonly<Record<string, ShellIconKey>> = {
  "/": "home",
  "/tasks": "tasks",
  "/projects": "tasks",
  "/calendar": "calendar",
  "/focus": "focus",
  "/nutrition": "nutrition",
  "/health": "health",
  "/insights": "insights",
  "/goals": "tasks",
  "/settings": "settings",
};

/** Bottom navigationiin mahtuvat (§27: tärkeimmät + Lisää). */
const PRIMARY_PATHS: readonly string[] = ["/", "/tasks", "/calendar", "/focus"];

const KNOWN_PATHS = [
  "/",
  "/tasks",
  "/projects",
  "/calendar",
  "/goals",
  "/focus",
  "/nutrition",
  "/health",
  "/insights",
  "/settings",
] as const;

type KnownShellPath = (typeof KNOWN_PATHS)[number];

export function iconForPath(path: string): ShellIconKey {
  return ICON_BY_PATH[path] ?? "more";
}

export function isKnownShellPath(path: string): path is KnownShellPath {
  return (KNOWN_PATHS as readonly string[]).includes(path);
}

export function buildShellNav(
  routes: readonly { readonly path: string; readonly label: string }[],
  currentPath: string,
): ShellNav {
  const items: ShellNavItem[] = [];
  for (const route of routes) {
    if (!isKnownShellPath(route.path)) {
      continue;
    }
    items.push({ path: route.path, label: route.label, icon: iconForPath(route.path) });
  }
  const primaryPaths: readonly string[] = PRIMARY_PATHS;
  const primary = items.filter((item) => primaryPaths.includes(item.path));
  const secondary = items.filter((item) => !primaryPaths.includes(item.path));
  const moreActive = secondary.some((item) => item.path === currentPath);
  const moreTarget = moreActive ? currentPath : (secondary[0]?.path ?? "/settings");
  return { primary, secondary, moreActive, moreTarget };
}

/** Aktiivinen polku nav-korostukseen (täsmäytys; muuten null = ei korostusta). */
export function activeNavPath(
  items: readonly { readonly path: string }[],
  currentPath: string,
): string | null {
  return items.some((item) => item.path === currentPath) ? currentPath : null;
}
