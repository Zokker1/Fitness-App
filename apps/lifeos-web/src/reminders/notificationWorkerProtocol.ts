import { safeNotificationRoute } from "../routes.ts";

export const NOTIFICATION_CLICK_MESSAGE_TYPE = "lifeos:notification-click";
export const NOTIFICATION_CLICK_MESSAGE_VERSION = 1;

export interface NotificationClickMessage {
  readonly type: typeof NOTIFICATION_CLICK_MESSAGE_TYPE;
  readonly version: typeof NOTIFICATION_CLICK_MESSAGE_VERSION;
  readonly route: string;
}

/** Parse cloneable Notification.data or postMessage input as untrusted data. */
export function parseNotificationClickMessage(value: unknown): NotificationClickMessage | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    record.type !== NOTIFICATION_CLICK_MESSAGE_TYPE ||
    record.version !== NOTIFICATION_CLICK_MESSAGE_VERSION ||
    typeof record.route !== "string"
  ) {
    return null;
  }
  return {
    type: NOTIFICATION_CLICK_MESSAGE_TYPE,
    version: NOTIFICATION_CLICK_MESSAGE_VERSION,
    route: safeNotificationRoute(record.route),
  };
}
