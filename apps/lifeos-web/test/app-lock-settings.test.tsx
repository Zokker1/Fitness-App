import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppLockProvider } from "../src/preferences/AppLockContext.tsx";
import { AppLockSettings } from "../src/preferences/AppLockSettings.tsx";

function renderSettings(): void {
  render(
    <AppLockProvider persistent={false}>
      <AppLockSettings />
    </AppLockProvider>,
  );
}

describe("app lock settings", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("stores the user's enable choice and restores it after reload", () => {
    renderSettings();
    const toggle = screen.getByTestId("app-lock-toggle");
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    expect(toggle).toBeChecked();
    expect(window.localStorage.getItem("lifeos-app-lock-enabled")).toBe("true");

    cleanup();
    renderSettings();
    expect(screen.getByTestId("app-lock-toggle")).toBeChecked();
  });
});
