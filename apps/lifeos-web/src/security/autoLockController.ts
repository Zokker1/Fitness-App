export const APP_AUTO_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export interface AutoLockControllerOptions {
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly lock: () => void;
  readonly now?: () => number;
  readonly window?: Window;
  readonly document?: Document;
}

/** Runs a memory-only idle/background timer for one active key session. */
export function startAutoLockController(options: AutoLockControllerOptions): () => void {
  const browserWindow = options.window ?? (typeof window === "undefined" ? undefined : window);
  const browserDocument =
    options.document ?? (typeof document === "undefined" ? undefined : document);
  const timeoutMs = options.timeoutMs ?? APP_AUTO_LOCK_TIMEOUT_MS;
  const now = options.now ?? Date.now;
  if (
    !options.enabled ||
    browserWindow === undefined ||
    browserDocument === undefined ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return () => {};
  }

  let disposed = false;
  let lastActivityAt = now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };
  const cleanup = (): void => {
    clearTimer();
    browserWindow.removeEventListener("pagehide", onPageHide);
    browserWindow.removeEventListener("pageshow", onPageShow);
    browserWindow.removeEventListener("pointerdown", onActivity);
    browserWindow.removeEventListener("keydown", onActivity);
    browserWindow.removeEventListener("touchstart", onActivity);
    browserWindow.removeEventListener("wheel", onActivity);
    browserDocument.removeEventListener("visibilitychange", onVisibilityChange);
  };
  const lock = (): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
    options.lock();
  };
  const schedule = (): void => {
    clearTimer();
    const remaining = timeoutMs - (now() - lastActivityAt);
    if (remaining <= 0) {
      lock();
      return;
    }
    timer = setTimeout(schedule, remaining);
  };
  const onActivity = (): void => {
    if (browserDocument.visibilityState !== "visible") return;
    lastActivityAt = now();
    schedule();
  };
  const onVisibilityChange = (): void => {
    if (browserDocument.visibilityState === "visible") schedule();
  };
  const onPageHide = (): void => {
    lock();
  };
  const onPageShow = (): void => {
    schedule();
  };

  browserWindow.addEventListener("pagehide", onPageHide);
  browserWindow.addEventListener("pageshow", onPageShow);
  browserWindow.addEventListener("pointerdown", onActivity, { passive: true });
  browserWindow.addEventListener("keydown", onActivity);
  browserWindow.addEventListener("touchstart", onActivity, { passive: true });
  browserWindow.addEventListener("wheel", onActivity, { passive: true });
  browserDocument.addEventListener("visibilitychange", onVisibilityChange);
  schedule();

  return () => {
    if (disposed) return;
    disposed = true;
    cleanup();
  };
}
