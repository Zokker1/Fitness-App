// T025: selaintoteutukset capability-rajapinnoille (@lifeos/capabilities).
// Tämä on ainoa paikka joka saa koskea suoraan navigator/Notification/
// serviceWorker/file-APIeihin. Domain/data/UI kuluttavat näitä injektoituna
// (ei globaaliviittauksia muualla app-koodissa).
//
// Turvallisuusrajat (ADR-001 §4):
// - Ei localStoragea domain-datalle (ei toteutusta täällä lainkaan).
// - Ei token-persistenssiä (OAuth-sessio vain muistissa).
// - Ei PII:tä virheviesteissä; ei tokeneita diagnostiikassa.

import type {
  BrowserEnvironment,
  CapabilityError,
  CapabilityResult,
  FileCapability,
  NotificationCapability,
  NotificationPermissionState,
  NotificationRequest,
  OAuthCapability,
  PickedFile,
  ServiceWorkerCapability,
  ServiceWorkerCapabilityState,
  StorageCapability,
  StorageCapabilitySnapshot,
} from "@lifeos/capabilities";
import { redactNotificationCopy } from "@lifeos/domain";
import { safeNotificationRoute } from "../routes.ts";
import { createGoogleOAuthCapability } from "./googleOAuth.ts";
import {
  NOTIFICATION_CLICK_MESSAGE_TYPE,
  NOTIFICATION_CLICK_MESSAGE_VERSION,
} from "../reminders/notificationWorkerProtocol.ts";

function storageError(
  code: CapabilityError["code"],
  userMessage: string,
  diagnosticCode: string,
): CapabilityError {
  return { capability: "storage", code, userMessage, diagnosticCode };
}

function isOpfsSupported(): boolean {
  try {
    if (typeof navigator === "undefined") {
      return false;
    }
    const storage = navigator.storage as StorageManager & { getDirectory?: unknown };
    return typeof storage.getDirectory === "function";
  } catch {
    return false;
  }
}

export function createStorageCapability(): StorageCapability {
  return {
    name: "storage",
    snapshot(): Promise<CapabilityResult<StorageCapabilitySnapshot>> {
      try {
        if (typeof navigator === "undefined") {
          return Promise.resolve({
            ok: false,
            error: storageError(
              "unsupported",
              "Selain ei tue tallennustilan kyselyä. Varmista ajantasainen selain.",
              "storage.snapshot.unsupported",
            ),
          });
        }
        return Promise.all([
          navigator.storage.persisted().catch(() => null),
          navigator.storage.estimate().catch(() => null),
        ]).then(([persisted, estimate]) => ({
          ok: true as const,
          value: {
            opfsSupported: isOpfsSupported(),
            persisted: typeof persisted === "boolean" ? persisted : null,
            quotaBytes: estimate?.quota ?? null,
            usageBytes: estimate?.usage ?? null,
          },
        }));
      } catch {
        return Promise.resolve({
          ok: false,
          error: storageError(
            "transient-failure",
            "Tallennustilan kysely epäonnistui. Yritä uudelleen.",
            "storage.snapshot.failed",
          ),
        });
      }
    },
    requestPersistence(): Promise<CapabilityResult<boolean>> {
      try {
        if (typeof navigator === "undefined") {
          return Promise.resolve({
            ok: false,
            error: storageError(
              "unsupported",
              "Selain ei tue pysyvän tallennuksen pyyntöä.",
              "storage.persist.unsupported",
            ),
          });
        }
        // persist on StorageManager-metodi — kutsutaan suoraan vastaanottajalla
        // (ei irrotusta muuttujaan) jotta unbound-method-lintti ei hälytä.
        const storage = navigator.storage;
        return storage.persist().then((value) => ({ ok: true as const, value }));
      } catch {
        return Promise.resolve({
          ok: false,
          error: storageError(
            "transient-failure",
            "Pysyvän tallennuksen pyyntö epäonnistui.",
            "storage.persist.failed",
          ),
        });
      }
    },
  };
}

function toPermissionState(value: unknown): NotificationPermissionState {
  return value === "granted" || value === "denied" ? value : "default";
}

/** Valmistaa lukitusnäytölle turvallisen pyynnön ennen selainrajapintaa. */
export function prepareBrowserNotification(request: NotificationRequest): NotificationRequest {
  return {
    ...request,
    ...redactNotificationCopy(request),
    route: safeNotificationRoute(request.route),
  };
}

export function createNotificationCapability(): NotificationCapability {
  return {
    name: "notifications",
    permission(): Promise<CapabilityResult<NotificationPermissionState>> {
      if (typeof Notification === "undefined") {
        return Promise.resolve({
          ok: false,
          error: {
            capability: "notifications",
            code: "unsupported",
            userMessage: "Selain ei tue ilmoituksia.",
            diagnosticCode: "notifications.permission.unsupported",
          },
        });
      }
      return Promise.resolve({
        ok: true as const,
        value: toPermissionState(Notification.permission),
      });
    },
    async requestPermission(): Promise<CapabilityResult<NotificationPermissionState>> {
      if (
        typeof Notification === "undefined" ||
        typeof Notification.requestPermission !== "function"
      ) {
        return {
          ok: false,
          error: {
            capability: "notifications",
            code: "unsupported",
            userMessage: "Selain ei tue ilmoituslupaa.",
            diagnosticCode: "notifications.request.unsupported",
          },
        };
      }
      try {
        return { ok: true, value: toPermissionState(await Notification.requestPermission()) };
      } catch {
        return {
          ok: false,
          error: {
            capability: "notifications",
            code: "denied",
            userMessage: "Ilmoituslupaa ei saatu.",
            diagnosticCode: "notifications.request.denied",
          },
        };
      }
    },
    async showIfBackgrounded(request: NotificationRequest): Promise<CapabilityResult<boolean>> {
      if (
        typeof Notification === "undefined" ||
        Notification.permission !== "granted" ||
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        return { ok: true, value: false };
      }

      const prepared = prepareBrowserNotification(request);
      const data = {
        type: NOTIFICATION_CLICK_MESSAGE_TYPE,
        version: NOTIFICATION_CLICK_MESSAGE_VERSION,
        route: prepared.route,
      };

      try {
        if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration();
          if (registration !== undefined && typeof registration.showNotification === "function") {
            await registration.showNotification(prepared.title, {
              body: prepared.body,
              data,
            });
            return { ok: true, value: true };
          }
        }

        const notification = new Notification(prepared.title, {
          body: prepared.body,
          data,
        });
        notification.onclick = () => {
          notification.close();
          window.focus();
          window.location.assign(prepared.route);
        };
        return { ok: true, value: true };
      } catch {
        return {
          ok: false,
          error: {
            capability: "notifications",
            code: "unavailable",
            userMessage: "Selainilmoitusta ei voitu näyttää; muistutus näkyy sovelluksessa.",
            diagnosticCode: "notifications.show.failed",
          },
        };
      }
    },
  };
}

export function createFileCapability(): FileCapability {
  return {
    name: "file",
    async pickFile(options): Promise<CapabilityResult<PickedFile | null>> {
      try {
        if (typeof document === "undefined") {
          return {
            ok: false,
            error: {
              capability: "file",
              code: "unsupported",
              userMessage: "Tiedostonvalinta ei ole käytössä tässä ympäristössä.",
              diagnosticCode: "file.pick.unsupported",
            },
          };
        }
        const input = document.createElement("input");
        input.type = "file";
        if (options?.accept !== undefined && options.accept.length > 0) {
          input.accept = options.accept.join(",");
        }
        const picked = await new Promise<File | null>((resolve) => {
          input.addEventListener("change", () => {
            resolve(input.files?.[0] ?? null);
          });
          input.addEventListener("cancel", () => {
            resolve(null);
          });
          input.click();
        });
        if (picked === null) {
          return { ok: true, value: null };
        }
        const buffer = await picked.arrayBuffer();
        return {
          ok: true,
          value: {
            name: picked.name,
            mimeType: picked.type,
            sizeBytes: picked.size,
            bytes: new Uint8Array(buffer),
          },
        };
      } catch {
        return {
          ok: false,
          error: {
            capability: "file",
            code: "transient-failure",
            userMessage: "Tiedoston lukeminen epäonnistui.",
            diagnosticCode: "file.pick.failed",
          },
        };
      }
    },
    downloadFile(file): Promise<CapabilityResult<boolean>> {
      try {
        if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
          return Promise.resolve({
            ok: false,
            error: {
              capability: "file",
              code: "unsupported",
              userMessage: "Tiedoston lataus ei ole käytössä tässä ympäristössä.",
              diagnosticCode: "file.download.unsupported",
            },
          });
        }
        const blob = new Blob([file.bytes as unknown as BlobPart], { type: file.mimeType });
        const url = URL.createObjectURL(blob);
        try {
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = file.suggestedName;
          const body = document.body as HTMLBodyElement | null;
          body?.appendChild(anchor);
          anchor.click();
          anchor.remove();
        } finally {
          URL.revokeObjectURL(url);
        }
        return Promise.resolve({ ok: true as const, value: true });
      } catch {
        return Promise.resolve({
          ok: false,
          error: {
            capability: "file",
            code: "transient-failure",
            userMessage: "Tiedoston lataus epäonnistui.",
            diagnosticCode: "file.download.failed",
          },
        });
      }
    },
  };
}

export function createOAuthCapability(env: BrowserEnvironment, clientId: string): OAuthCapability {
  return createGoogleOAuthCapability(env, clientId);
}

export function createServiceWorkerCapability(): ServiceWorkerCapability {
  return {
    name: "service-worker",
    async state(): Promise<CapabilityResult<ServiceWorkerCapabilityState>> {
      try {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
          return {
            ok: false,
            error: {
              capability: "service-worker",
              code: "unsupported",
              userMessage: "Offline-tila vaatii tuotantobuildin tuetussa selaimessa.",
              diagnosticCode: "sw.state.unsupported",
            },
          };
        }
        if (import.meta.env.DEV) {
          return {
            ok: false,
            error: {
              capability: "service-worker",
              code: "unsupported",
              userMessage: "Offline-tila vaatii tuotantobuildin tuetussa selaimessa.",
              diagnosticCode: "sw.state.dev-skipped",
            },
          };
        }
        await navigator.serviceWorker.register(resolveServiceWorkerUrl(), {
          type: "classic",
        });
      } catch {
        return {
          ok: false,
          error: {
            capability: "service-worker",
            code: "transient-failure",
            userMessage: "Offline-tilan käynnistys epäonnistui.",
            diagnosticCode: "sw.state.register-failed",
          },
        };
      }
      const registration =
        typeof navigator !== "undefined" && "serviceWorker" in navigator
          ? await navigator.serviceWorker.getRegistration().catch(() => undefined)
          : undefined;
      if (registration?.waiting !== null && registration?.waiting !== undefined) {
        return { ok: true, value: "waiting-for-user" };
      }
      return { ok: true, value: "registered" };
    },
    async activateWaiting(): Promise<CapabilityResult<boolean>> {
      try {
        if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
          return {
            ok: false,
            error: {
              capability: "service-worker",
              code: "unsupported",
              userMessage: "Offline-päivitys ei ole käytössä tässä selaimessa.",
              diagnosticCode: "sw.activate.unsupported",
            },
          };
        }
        const registration = await navigator.serviceWorker.getRegistration();
        registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
        return { ok: true, value: true };
      } catch {
        return {
          ok: false,
          error: {
            capability: "service-worker",
            code: "transient-failure",
            userMessage: "Offline-päivityksen aktivointi epäonnistui.",
            diagnosticCode: "sw.activate.failed",
          },
        };
      }
    },
  };
}

// BASE_URL on "./" (T023, alipolku-yhteensopivat assetit), mutta SW-URL:n on
// oltava origin-absoluuttinen: "./sw.js" hajoaisi alireiteillä
// (/tasks -> /tasks/sw.js). Juurihostaus (B17 kanoninen) => "/sw.js";
// alipolkuhostaus antaa eksplisiittisen --base-lipun buildissa.
function resolveServiceWorkerUrl(): string {
  const baseUrl = import.meta.env.BASE_URL;
  if (typeof baseUrl !== "string" || baseUrl === "./" || baseUrl === "") {
    return "/sw.js";
  }
  const normalized = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalized}sw.js`;
}
