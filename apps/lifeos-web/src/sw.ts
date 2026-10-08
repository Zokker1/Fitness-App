/// <reference lib="webworker" />
// T024: LifeOS service worker (injectManifest). Workbox precache + runtime.
// Elinkaarisäännöt:
// - skipWaiting vain käyttäjän hyväksymällä päivityksellä (prompt-malli,
//   ei pakkopäivitystä kesken kirjauksen). clientsClaim päällä jotta
//   hallittu aktivointi ottaa ohjat nopeasti.
// - Vanhat precachet siivotaan (cleanupOutdatedCaches).
// - Navigointi -> precachen index.html (SPA-fallback), mutta /api/* ei
//   koskaan SW:stä.
// - Käyttäjädata (Drive/sync/backup) ei koskaan cacheen (NetworkOnly).
//
// T039 (offline-shell, mitattu): NetworkFirst EI palvele offline-reloadia —
// offline-navigointi epäonnistuu (net::ERR_FAILED) koska handler yrittää
// ensin verkkoa eikä precache-vastaus kelpaa navigate-pyynnölle ilman
// verkkoa tässä ketjussa. Siksi navigointi on CacheFirst createHandler-
// BoundToURL("index.html") + NetworkFirst-fallback: offline palvelee
// precachen shellin välittömästi, online päivittää taustalla.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";
import { parseNotificationClickMessage } from "./reminders/notificationWorkerProtocol.ts";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

const navigationHandler = createHandlerBoundToURL("index.html");

const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [/^\/api\//],
});

registerRoute(navigationRoute);

// Eksplisiittinen raja: sync/backup/Drive-liikenne ei koskaan SW-cachen kautta.
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());

self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (typeof event.data !== "object" || event.data === null || Array.isArray(event.data)) return;
  if ((event.data as Record<string, unknown>).type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

// T293: route an explicit notification click only. There is no push or
// periodic-sync delivery here; exact reminders while the browser is closed
// still require a real push/scheduler backend and are not promised.
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const message = parseNotificationClickMessage(event.notification.data as unknown);
  if (message === null) return;

  event.waitUntil(
    (async () => {
      const destination = new URL(message.route, self.location.origin).href;
      const windowClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const client = windowClients.find((candidate) => {
        try {
          return new URL(candidate.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });

      if (client !== undefined) {
        try {
          await client.focus();
          client.postMessage(message);
          return;
        } catch {
          // Opening the allowlisted URL is the fallback if client messaging fails.
        }
      }

      await self.clients.openWindow(destination);
    })(),
  );
});
