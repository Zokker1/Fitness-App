// T023: selain-SPA:n reittirunko. Selaimessa käytetään historiapohjaista
// navigointia (syvälinkit toimivat); testit käyttävät muistipohjaista historiaa.
export const appRoutes = [
  { path: "/", label: "Tänään", elementId: "today" },
  { path: "/tasks", label: "Tehtävät", elementId: "tasks" },
  { path: "/projects", label: "Projektit", elementId: "projects" },
  { path: "/calendar", label: "Kalenteri", elementId: "calendar" },
  { path: "/goals", label: "Tavoitteet ja rutiinit", elementId: "goals" },
  { path: "/focus", label: "Fokus", elementId: "focus" },
  { path: "/nutrition", label: "Ravinto", elementId: "nutrition" },
  { path: "/health", label: "Terveys", elementId: "health" },
  { path: "/insights", label: "Insights", elementId: "insights" },
  { path: "/settings", label: "Asetukset", elementId: "settings" },
] as const;

export type AppRoutePath = (typeof appRoutes)[number]["path"];

const knownPaths = new Set<string>(appRoutes.map((route) => route.path));
const notificationPaths = new Set([
  ...knownPaths,
  "/health/foods",
  "/nutrition/foods",
  "/insights/history",
]);

const SAFE_ID_QUERY_KEYS: Readonly<Record<string, readonly string[]>> = {
  "/tasks": ["task"],
  "/goals": ["goal", "routine"],
};

const OPAQUE_ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Resolve a notification destination to an allowlisted internal route. */
export function safeNotificationRoute(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/";
  }

  try {
    const url = new URL(value, "https://lifeos.invalid");
    if (
      url.origin !== "https://lifeos.invalid" ||
      url.username !== "" ||
      url.password !== "" ||
      !notificationPaths.has(url.pathname)
    ) {
      return "/";
    }

    const safeParams = new URLSearchParams();
    for (const key of SAFE_ID_QUERY_KEYS[url.pathname] ?? []) {
      const values = url.searchParams.getAll(key);
      const id = values.length === 1 ? values[0] : undefined;
      if (id !== undefined && OPAQUE_ENTITY_ID.test(id)) safeParams.set(key, id);
    }

    const query = safeParams.toString();
    return query.length === 0 ? url.pathname : `${url.pathname}?${query}`;
  } catch {
    return "/";
  }
}

export function normalizePath(pathname: string): AppRoutePath | "/404" {
  if (knownPaths.has(pathname)) {
    return pathname as AppRoutePath;
  }
  return "/404";
}
