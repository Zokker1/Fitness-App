import { useEffect } from "react";
import { useNavigate } from "react-router";
import { parseNotificationClickMessage } from "./notificationWorkerProtocol.ts";

/** Routes validated notification-click messages from this origin's service worker. */
export function ServiceWorkerNotificationBridge(): null {
  const navigate = useNavigate();

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (event: MessageEvent<unknown>): void => {
      const source = event.source;
      if (source === null || !("scriptURL" in source) || typeof source.scriptURL !== "string") {
        return;
      }
      try {
        if (new URL(source.scriptURL, window.location.href).origin !== window.location.origin) {
          return;
        }
      } catch {
        return;
      }

      const message = parseNotificationClickMessage(event.data);
      if (message !== null) void navigate(message.route);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
    };
  }, [navigate]);

  return null;
}
