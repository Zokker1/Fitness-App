import { unlockLocalContent, lockLocalContent } from "@lifeos/data";
import type { ActiveSyncWriteContext } from "@lifeos/data";

export const SYNC_KEY_STATE_EVENT = "lifeos:sync-key-state";

let activeContext: ActiveSyncWriteContext | null = null;

function publishKeyState(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SYNC_KEY_STATE_EVENT));
  }
}

export function getActiveSyncWriteContext(): ActiveSyncWriteContext | null {
  if (activeContext?.keySession.isUnlocked) return activeContext;
  if (activeContext !== null) {
    activeContext.keySession.lock();
    activeContext = null;
    void lockLocalContent();
    publishKeyState();
  }
  return null;
}

export function isSyncWriteKeyActive(): boolean {
  return getActiveSyncWriteContext() !== null;
}

export async function activateSyncWriteKey(
  context: ActiveSyncWriteContext,
  afterUnlock?: () => Promise<void>,
): Promise<void> {
  if (!context.keySession.isUnlocked) throw new Error("Data-key session is locked.");
  const localContent = await context.keySession.withKey(unlockLocalContent);
  if (!localContent.ok) throw new Error(localContent.error.diagnosticCode);
  try {
    await afterUnlock?.();
  } catch (error) {
    await lockLocalContent();
    throw error;
  }
  if (activeContext !== null && activeContext.keySession !== context.keySession) {
    activeContext.keySession.lock();
  }
  activeContext = context;
  publishKeyState();
}

export function lockActiveSyncWriteKey(): void {
  activeContext?.keySession.lock();
  activeContext = null;
  void lockLocalContent();
  publishKeyState();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", lockActiveSyncWriteKey);
}
