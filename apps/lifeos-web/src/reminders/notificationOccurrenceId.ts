/**
 * Stable notification-state ID for a reminder occurrence.
 * A persisted ID lets client and future service-worker delivery share dedupe.
 */
export async function notificationOccurrenceId(occurrenceKey: string): Promise<string> {
  if (occurrenceKey.trim().length === 0) {
    throw new Error("Reminder occurrence key is required.");
  }
  const bytes = new TextEncoder().encode(`lifeos-reminder-occurrence-v1:${occurrenceKey}`);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  return `notification-${hex}`;
}
