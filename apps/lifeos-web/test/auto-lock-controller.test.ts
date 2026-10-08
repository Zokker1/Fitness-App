import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startAutoLockController } from "../src/security/autoLockController.ts";

describe("auto-lock controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets the inactivity deadline on user input", () => {
    const lock = vi.fn();
    const visibilityState = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const stop = startAutoLockController({ enabled: true, timeoutMs: 1_000, lock });

    vi.advanceTimersByTime(800);
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(999);
    expect(lock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(lock).toHaveBeenCalledTimes(1);

    stop();
    visibilityState.mockRestore();
  });

  it("locks immediately when a throttled background timer is noticed on return", () => {
    const lock = vi.fn();
    let currentVisibility: DocumentVisibilityState = "visible";
    const eventTarget = new EventTarget();
    Object.defineProperty(eventTarget, "visibilityState", {
      get: () => currentVisibility,
    });
    const documentStub = eventTarget as unknown as Document;
    const stop = startAutoLockController({
      enabled: true,
      timeoutMs: 1_000,
      lock,
      window,
      document: documentStub,
    });

    currentVisibility = "hidden";
    documentStub.dispatchEvent(new Event("visibilitychange"));
    vi.setSystemTime(Date.now() + 1_001);
    currentVisibility = "visible";
    documentStub.dispatchEvent(new Event("visibilitychange"));

    expect(lock).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not start when the setting is disabled", () => {
    const lock = vi.fn();
    startAutoLockController({ enabled: false, timeoutMs: 1_000, lock });

    vi.advanceTimersByTime(5_000);

    expect(lock).not.toHaveBeenCalled();
  });
});
