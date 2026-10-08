// T025: capability-adapterien koonti + kulutusraja.
// - `createBrowserCapabilities()` on ainoa tehdas jota app saa kutsua.
// - Domain/data/UI eivät koske suoraan window/navigator/Notification/
//   serviceWorker/file-APIeihin; ne kuluttavat näitä rajapintoja injektoituna
//   (vartioitu T025-rajaskannilla: koodiriveillä ei navigator./localStorage/
//   Notification-/serviceWorker-viittauksia adapters/-kansion ulkopuolella).
import { readBrowserEnvironment } from "@lifeos/capabilities";
import type {
  FileCapability,
  NotificationCapability,
  OAuthCapability,
  ServiceWorkerCapability,
  StorageCapability,
} from "@lifeos/capabilities";
import { loadWebConfig } from "../config.ts";
import {
  createFileCapability,
  createNotificationCapability,
  createOAuthCapability,
  createServiceWorkerCapability,
  createStorageCapability,
} from "./browserCapabilities.ts";
export { createUnavailableCalendarProvider } from "./calendarProvider.ts";
export { createUnavailableWearableProvider } from "./wearableProvider.ts";
export {
  createGoogleDriveSyncProvider,
  GOOGLE_DRIVE_SYNC_BATCH_MAX_BYTES,
  type GoogleDriveSyncProviderOptions,
} from "./googleDriveSyncProvider.ts";
export { prepareBrowserNotification } from "./browserCapabilities.ts";

export interface BrowserCapabilities {
  readonly storage: StorageCapability;
  readonly notifications: NotificationCapability;
  readonly file: FileCapability;
  readonly oauth: OAuthCapability;
  readonly serviceWorker: ServiceWorkerCapability;
}

export function createBrowserCapabilities(): BrowserCapabilities {
  // Selainkonteksti luetaan adapterikerroksessa (ainoa paikka joka saa
  // koskea window/navigator-globaaleihin T025-rajan mukaan).
  const isSecureContext = typeof window !== "undefined" && window.isSecureContext;
  const env = readBrowserEnvironment({
    isSecureContext,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  });
  return {
    storage: createStorageCapability(),
    notifications: createNotificationCapability(),
    file: createFileCapability(),
    oauth: createOAuthCapability(env, loadWebConfig().googleClientId),
    serviceWorker: createServiceWorkerCapability(),
  };
}
